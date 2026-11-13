// 配備物（dist/server/server.mjs）の入口。環境変数から設定を読み、共有メーターの API を待ち受ける。
// 起動コマンドは `node server.mjs`（設計 D-23）。終了の合図（SIGTERM・SIGINT）で、保存を済ませてから終わる。
import { createJsonLogger } from './logger';
import { startServer } from './start';

const logger = createJsonLogger((line) => {
  process.stdout.write(`${line}\n`);
});

try {
  const running = await startServer({ env: process.env, logger });
  const shutdown = (signal: string): void => {
    logger.info('shutdown', { signal });
    void running.close().then(() => {
      process.exit(0);
    });
  };
  process.once('SIGTERM', () => {
    shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    shutdown('SIGINT');
  });
} catch (error) {
  // 理由の記号（EADDRINUSE など）だけを出す。メッセージ（パスなど）は出さない。
  const code =
    typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'UNKNOWN';
  logger.warn('start_failed', { reason: code });
  process.exit(1);
}
