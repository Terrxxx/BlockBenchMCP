export type LogLevel = 'info' | 'warn' | 'error';
export type LogFields = Record<string, string | number | boolean>;
export type Logger = (level: LogLevel, event: string, fields?: LogFields) => void;
export const stderrLogger: Logger = (level, event, fields = {}) => {
  process.stderr.write(`${JSON.stringify({ time: new Date().toISOString(), level, event, ...fields })}\n`);
};
export const silentLogger: Logger = () => {};
