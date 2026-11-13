/** ログの項目。値は、文字・数・真偽・null だけ（オブジェクトは出さない）。 */
export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
}

/**
 * ログに出さない項目の名前（IP・端末の番号・本文・合言葉。設計 D-14・D-31）。
 * 出さない決まりは呼ぶ側でも守るが、渡されても出さない（二重の備え）。
 */
const FORBIDDEN_FIELDS = new Set([
  'ip',
  'deviceId',
  'device',
  'body',
  'passphrase',
  'key',
  'secret',
  'header',
]);

/** 1 行 1 件の JSON で出すログ。固定のイベント名・公演 ID・人数だけを出す。 */
export function createJsonLogger(
  write: (line: string) => void,
  now: () => number = () => Date.now(),
): Logger {
  const emit = (level: 'info' | 'warn', event: string, fields: LogFields = {}) => {
    const safe = Object.fromEntries(
      Object.entries(fields).filter(([name]) => !FORBIDDEN_FIELDS.has(name)),
    );
    write(JSON.stringify({ t: new Date(now()).toISOString(), level, event, ...safe }));
  };
  return {
    info: (event, fields) => {
      emit('info', event, fields);
    },
    warn: (event, fields) => {
      emit('warn', event, fields);
    },
  };
}
