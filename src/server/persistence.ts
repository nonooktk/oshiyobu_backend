import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from './logger';
import { parseSnapshot } from './store';
import type { StoreSnapshot } from './store';

/** 保存ファイルの名前（保存先のフォルダの中）。 */
export const SNAPSHOT_FILE = 'meter.json';
const TEMP_FILE = `${SNAPSHOT_FILE}.tmp`;

/** 変更のあと、まとめて書くまでの待ち（ミリ秒。設計 D-03）。 */
export const DEFAULT_WRITE_DELAY_MS = 500;

/** Node のエラーから、理由の記号（EACCES など）だけを取り出す。メッセージ（パスを含みうる）は出さない。 */
function codeOf(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return 'UNKNOWN';
}

/** 一時ファイルに書いて、名前を変える（書きかけのファイルを残さない）。 */
async function writeAtomically(dir: string, text: string): Promise<void> {
  const temp = join(dir, TEMP_FILE);
  await writeFile(temp, text, { mode: 0o600 });
  await rename(temp, join(dir, SNAPSHOT_FILE));
}

/**
 * 起動時: 保存先のフォルダを（途中も）作り、書けることを確かめて、保存ファイルがあれば読む（設計 D-12・K-16）。
 * 作れない・書けないときは、警告を出して writable: false を返す（保存なし＝メモリだけで動く）。
 * 保存ファイルが壊れている・形が違うときは、警告を出して、空で始める。どの場合も例外を投げない。
 */
export async function prepareDataDir(
  dir: string,
  logger: Logger,
): Promise<{ writable: boolean; snapshot: StoreSnapshot | undefined }> {
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, TEMP_FILE), '', { mode: 0o600 });
    await rm(join(dir, TEMP_FILE));
  } catch (error) {
    logger.warn('persistence_disabled', { reason: codeOf(error) });
    return { writable: false, snapshot: undefined };
  }

  let text: string;
  try {
    text = await readFile(join(dir, SNAPSHOT_FILE), 'utf8');
  } catch (error) {
    if (codeOf(error) !== 'ENOENT') {
      logger.warn('snapshot_unreadable', { reason: codeOf(error) });
    }
    return { writable: true, snapshot: undefined };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    logger.warn('snapshot_unreadable', { reason: 'invalid_json' });
    return { writable: true, snapshot: undefined };
  }
  const snapshot = parseSnapshot(parsed);
  if (snapshot === null) {
    logger.warn('snapshot_unreadable', { reason: 'invalid_shape' });
    return { writable: true, snapshot: undefined };
  }
  return { writable: true, snapshot };
}

export interface SnapshotWriterOptions {
  readonly dir: string;
  readonly logger: Logger;
  /** 書く中身を返す（書く時点の状態）。 */
  readonly getSnapshot: () => StoreSnapshot;
  /** 変更のあと、まとめて書くまでの待ち（ミリ秒）。 */
  readonly delayMs?: number;
}

export interface SnapshotWriter {
  /** 変更があったことを知らせる（delayMs のあとに、まとめて 1 回書く）。 */
  schedule(): void;
  /** 待たずに、すぐ書く（変更があれば）。書き終わるまで待つ。終了の合図のときに呼ぶ。 */
  flush(): Promise<void>;
  /** 書いた回数（確かめ用）。 */
  writeCount(): number;
}

/**
 * 保存ファイルの書き込み。メモリが正本で、変更のたびに、delayMs でまとめて書く。
 * 書けなかったときは、警告を出して続ける（次の変更で、また書く）。
 */
export function createSnapshotWriter(options: SnapshotWriterOptions): SnapshotWriter {
  const delayMs = options.delayMs ?? DEFAULT_WRITE_DELAY_MS;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 書き込みは 1 つずつ順に行う（前の書き込みが終わってから、次を始める）。
  let queue: Promise<void> = Promise.resolve();
  let writes = 0;

  const writeNow = async (): Promise<void> => {
    dirty = false;
    try {
      await writeAtomically(options.dir, JSON.stringify(options.getSnapshot()));
      writes += 1;
    } catch (error) {
      dirty = true; // 次の変更・終了の合図で、また書く
      options.logger.warn('persist_failed', { reason: codeOf(error) });
    }
  };

  const startWrite = (): Promise<void> => {
    queue = queue.then(writeNow);
    return queue;
  };

  return {
    schedule() {
      dirty = true;
      if (timer === undefined) {
        timer = setTimeout(() => {
          timer = undefined;
          void startWrite();
        }, delayMs);
        timer.unref();
      }
    },
    async flush() {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      await queue;
      if (dirty) {
        await startWrite();
      }
    },
    writeCount: () => writes,
  };
}
