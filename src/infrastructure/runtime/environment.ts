/** Private host environment access; no browser process shim. */
export const env = (name: string): string | undefined => process.env[name];
export const browserSDKOptions: { dangerouslyAllowBrowser?: boolean } = {};
export function unrefTimer(timer: ReturnType<typeof setTimeout>): void { timer.unref(); }
export function onProcessShutdown(close: () => void): void {
  process.on('exit', close);
  process.on('SIGINT', () => { close(); process.exit(0); });
  process.on('SIGTERM', () => { close(); process.exit(0); });
}
