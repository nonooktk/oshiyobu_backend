export interface ZipFile {
  /** zip の中のパス（/ 区切り。先頭の / と .. は不可）。 */
  readonly name: string;
  readonly data: Buffer;
}
export function crc32(data: Uint8Array): number;
export function createZip(files: readonly ZipFile[]): Buffer;
