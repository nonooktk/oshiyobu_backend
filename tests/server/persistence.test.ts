import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJsonLogger } from '../../src/server/logger';
import { SNAPSHOT_FILE, createSnapshotWriter, prepareDataDir } from '../../src/server/persistence';
import { MeterStore } from '../../src/server/store';

// 設計 D-12・D-24・K-16・I-130: メモリが正本で、JSON の保存ファイル 1 つ（一時ファイル → 名前の変更）。
// 起動時にフォルダを作る。作れない・書けないときは、ログに警告して、保存なしで動く。
const hex16 = (n: number) => n.toString(16).padStart(16, '0');

describe('保存先と保存ファイル', () => {
  let root: string;
  const logs: Array<Record<string, unknown>> = [];
  const logger = createJsonLogger((line) => logs.push(JSON.parse(line) as Record<string, unknown>));

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'oshiyobu-persist-'));
    logs.length = 0;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await rm(root, { recursive: true, force: true });
  });

  it('存在しないフォルダは、起動時に（途中のフォルダも）作る。書けるので writable: true・中身は空', async () => {
    const dir = join(root, 'a', 'b', 'data');
    const loaded = await prepareDataDir(dir, logger);
    expect(loaded).toEqual({ writable: true, snapshot: undefined });
    expect((await readdir(dir)).sort()).toEqual([]); // 確かめに作った一時ファイルは消す
  });

  it('保存ファイルがあれば、読んで検査した中身を返す', async () => {
    await writeFile(
      join(root, SNAPSHOT_FILE),
      JSON.stringify({
        v: 1,
        resetAt: null,
        performances: { 'tech0:cbox': { joined: 1, ids: [hex16(1)] } },
      }),
    );
    const loaded = await prepareDataDir(root, logger);
    expect(loaded.writable).toBe(true);
    expect(loaded.snapshot?.performances['tech0:cbox']?.ids).toEqual([hex16(1)]);
  });

  it('壊れた保存ファイル（JSON でない）は、空で始める。警告を出し、落ちない（I-130 (d)）', async () => {
    await writeFile(join(root, SNAPSHOT_FILE), '{ not json');
    const loaded = await prepareDataDir(root, logger);
    expect(loaded).toEqual({ writable: true, snapshot: undefined });
    expect(logs.map((l) => l['event'])).toContain('snapshot_unreadable');
  });

  it('JSON でも形が違う保存ファイルは、空で始める。警告を出す', async () => {
    await writeFile(join(root, SNAPSHOT_FILE), JSON.stringify({ v: 99 }));
    const loaded = await prepareDataDir(root, logger);
    expect(loaded.snapshot).toBeUndefined();
    expect(logs.map((l) => l['event'])).toContain('snapshot_unreadable');
  });

  it('フォルダを作れない（途中がファイル）ときは、警告を出して保存なしにする。落ちない（I-130 (c)）', async () => {
    const blocker = join(root, 'blocker');
    await writeFile(blocker, 'x');
    const loaded = await prepareDataDir(join(blocker, 'data'), logger);
    expect(loaded).toEqual({ writable: false, snapshot: undefined });
    expect(logs).toContainEqual(
      expect.objectContaining({ event: 'persistence_disabled', level: 'warn' }),
    );
  });

  it('書き込みは、変更のあと delayMs でまとめて 1 回（一時ファイルに書いて、名前を変える）', async () => {
    vi.useFakeTimers();
    const store = new MeterStore();
    const writer = createSnapshotWriter({
      dir: root,
      logger,
      getSnapshot: () => store.snapshot(),
      delayMs: 500,
    });
    store.join('tech0:cbox', hex16(1));
    writer.schedule();
    store.join('tech0:cbox', hex16(2));
    writer.schedule();
    store.join('tech0:cbox', hex16(3));
    writer.schedule();
    await vi.advanceTimersByTimeAsync(499);
    expect(await readdir(root)).toEqual([]); // まだ書かない
    await vi.advanceTimersByTimeAsync(1);
    await writer.flush();
    expect(writer.writeCount()).toBe(1);
    expect(await readdir(root)).toEqual([SNAPSHOT_FILE]); // 一時ファイルが残らない
    const saved = JSON.parse(await readFile(join(root, SNAPSHOT_FILE), 'utf8')) as {
      performances: Record<string, { joined: number; ids: string[] }>;
    };
    expect(saved.performances['tech0:cbox']).toEqual({
      joined: 3,
      ids: [hex16(1), hex16(2), hex16(3)],
    });
  });

  it('flush は、待たずにすぐ書く（終了の合図のとき）。変更が無ければ書かない', async () => {
    const store = new MeterStore();
    const writer = createSnapshotWriter({
      dir: root,
      logger,
      getSnapshot: () => store.snapshot(),
      delayMs: 60_000,
    });
    await writer.flush();
    expect(writer.writeCount()).toBe(0);
    store.join('krs48:FUK-012', hex16(9));
    writer.schedule();
    await writer.flush();
    expect(writer.writeCount()).toBe(1);
    expect(await readFile(join(root, SNAPSHOT_FILE), 'utf8')).toContain(hex16(9));
  });

  it('保存した中身を、次の起動で読み直すと、同じ状態に戻る（再起動で数が消えない）', async () => {
    const store = new MeterStore();
    store.join('tech0:cbox', hex16(1));
    store.reset();
    store.join('tech0:cbox', hex16(2));
    const writer = createSnapshotWriter({ dir: root, logger, getSnapshot: () => store.snapshot() });
    writer.schedule();
    await writer.flush();
    const loaded = await prepareDataDir(root, logger);
    expect(loaded.snapshot).toEqual(store.snapshot());
  });

  it('書けなくなったときは、警告を出して、落ちない。直ったら次の変更で書ける', async () => {
    const store = new MeterStore();
    const gone = join(root, 'gone');
    const writer = createSnapshotWriter({ dir: gone, logger, getSnapshot: () => store.snapshot() });
    store.join('tech0:cbox', hex16(1));
    writer.schedule();
    await writer.flush(); // フォルダが無いので失敗する
    expect(logs).toContainEqual(
      expect.objectContaining({ event: 'persist_failed', level: 'warn' }),
    );
    await prepareDataDir(gone, logger); // 直った（フォルダができた）
    store.join('tech0:cbox', hex16(2));
    writer.schedule();
    await writer.flush();
    expect(await readFile(join(gone, SNAPSHOT_FILE), 'utf8')).toContain(hex16(2));
  });
});
