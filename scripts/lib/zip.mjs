// 配備物の zip を、Node だけで作る（外部の zip コマンドや依存に頼らない。Windows でも同じに動かす）。
// 作るのは、小さなファイルだけの zip（zip64 は使わない）。同じ入力から、毎回同じバイト列ができる
// （更新日時を固定する。前の版の zip との差を見やすくし、保管した zip と作り直した zip を比べられる）。
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32（zip・gzip と同じ。0 以上の整数）。 */
export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// 更新日時は、MS-DOS の初め（1980-01-01 00:00:00）に固定する。
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const FLAG_UTF8 = 0x0800;
const UNIX_FILE_0644 = (0o100644 << 16) >>> 0;
const VERSION_MADE_BY = (3 << 8) | 20; // Unix・zip 2.0
const VERSION_NEEDED = 20;

function checkName(name) {
  if (
    name === '' ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.split('/').some((part) => part === '..' || part === '')
  ) {
    throw new Error(`zip の中のパスとして使えません: ${JSON.stringify(name)}`);
  }
}

/** files: { name, data }[] から zip の Buffer を作る。 */
export function createZip(files) {
  const names = new Set();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    checkName(file.name);
    if (names.has(file.name)) {
      throw new Error(`zip の中のパスが重複しています: ${file.name}`);
    }
    names.add(file.name);

    const name = Buffer.from(file.name, 'utf8');
    const crc = crc32(file.data);
    const deflated = deflateRawSync(file.data, { level: 9 });
    // 圧縮して小さくなるときだけ圧縮する（短いファイルは、そのまま入れる）。
    const useDeflate = deflated.length < file.data.length;
    const body = useDeflate ? deflated : file.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION_NEEDED, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION_MADE_BY, 4);
    central.writeUInt16LE(VERSION_NEEDED, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(file.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(UNIX_FILE_0644, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralBytes = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBytes, end]);
}
