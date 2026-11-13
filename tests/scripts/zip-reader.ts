// テスト用の zip の読み取り（作成側の実装とは別に、中央ディレクトリから読む）。
export interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly crc: number;
  readonly compressed: Buffer;
  readonly uncompressedSize: number;
  readonly flags: number;
}

export function readZip(zip: Buffer): ZipEntry[] {
  // 末尾の EOCD（0x06054b50）を探す
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('EOCD が無い');
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('中央ディレクトリが壊れている');
    const flags = zip.readUInt16LE(offset + 8);
    const method = zip.readUInt16LE(offset + 10);
    const crc = zip.readUInt32LE(offset + 16);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const uncompressedSize = zip.readUInt32LE(offset + 24);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    // 本体は、ローカルヘッダーの後ろ
    if (zip.readUInt32LE(localOffset) !== 0x04034b50)
      throw new Error('ローカルヘッダーが壊れている');
    const localName = zip.readUInt16LE(localOffset + 26);
    const localExtra = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    entries.push({
      name,
      method,
      crc,
      compressed: zip.subarray(start, start + compressedSize),
      uncompressedSize,
      flags,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
