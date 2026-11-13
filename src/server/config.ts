/** 起動のときの設定の警告。値（とくに合言葉）は入れず、種類だけ持つ。 */
export interface ConfigWarning {
  readonly code:
    'invalid_port' | 'invalid_cors_origin' | 'passphrase_not_configured' | 'passphrase_too_short';
  /** 公開してよい補足（使えなかった origin など）。 */
  readonly detail?: string;
}

export interface ServerConfig {
  /** 待ち受けの番号。 */
  readonly port: number;
  /** 保存先のフォルダ。 */
  readonly dataDir: string;
  /** 許す接続元（完全一致）。 */
  readonly corsOrigins: readonly string[];
  /** 発表者の合言葉。未設定・短いときは undefined（reset を無効にする）。 */
  readonly presenterPassphrase: string | undefined;
}

export const DEFAULT_PORT = 8787;
export const DEFAULT_DATA_DIR = './data';
/** 合言葉の最小の長さ（文字）。これより短いと reset を無効にする（設計 D-15）。 */
export const MIN_PASSPHRASE_LENGTH = 12;

/** 合言葉として使える長さか（文字＝コードポイントで数える）。 */
export function isUsablePassphrase(value: string): boolean {
  return Array.from(value).length >= MIN_PASSPHRASE_LENGTH;
}
/** NODE_ENV が未設定のときだけ許す、開発の画面の origin。 */
const DEV_ORIGIN = 'http://localhost:5173';

type Env = Readonly<Record<string, string | undefined>>;

/** 空文字は、設定されていないものとして扱う（.env.example を写して、値が空のままのとき）。 */
function valueOf(env: Env, key: string): string | undefined {
  const value = env[key];
  return value === undefined || value === '' ? undefined : value;
}

function parsePort(raw: string | undefined, warnings: ConfigWarning[]): number {
  if (raw === undefined) {
    return DEFAULT_PORT;
  }
  const port = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isInteger(port) && port >= 1 && port <= 65535) {
    return port;
  }
  warnings.push({ code: 'invalid_port' });
  return DEFAULT_PORT;
}

function parseOrigins(
  raw: string | undefined,
  nodeEnv: string | undefined,
  warnings: ConfigWarning[],
): string[] {
  const origins: string[] = [];
  for (const entry of (raw ?? '').split(',')) {
    const trimmed = entry.trim().replace(/\/$/, '');
    if (trimmed === '') {
      continue;
    }
    if (isOrigin(trimmed)) {
      origins.push(trimmed);
    } else {
      warnings.push({ code: 'invalid_cors_origin', detail: trimmed });
    }
  }
  if (nodeEnv === undefined) {
    origins.push(DEV_ORIGIN);
  }
  return [...new Set(origins)];
}

/** `https://host[:port]` の形か（パス・ワイルドカード・大文字のホスト名は不可）。 */
function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.origin === value;
  } catch {
    return false;
  }
}

/** 環境変数から設定を作る（設計 D-24）。使えない値は、既定値にして、警告を返す。 */
export function loadConfig(env: Env): { config: ServerConfig; warnings: ConfigWarning[] } {
  const warnings: ConfigWarning[] = [];
  const port = parsePort(valueOf(env, 'PORT'), warnings);
  const dataDir = valueOf(env, 'DATA_DIR') ?? DEFAULT_DATA_DIR;
  const corsOrigins = parseOrigins(
    valueOf(env, 'CORS_ORIGINS'),
    valueOf(env, 'NODE_ENV'),
    warnings,
  );

  const passphrase = valueOf(env, 'PRESENTER_PASSPHRASE');
  let presenterPassphrase: string | undefined;
  if (passphrase === undefined) {
    warnings.push({ code: 'passphrase_not_configured' });
  } else if (!isUsablePassphrase(passphrase)) {
    warnings.push({ code: 'passphrase_too_short' });
  } else {
    presenterPassphrase = passphrase;
  }

  return { config: { port, dataDir, corsOrigins, presenterPassphrase }, warnings };
}
