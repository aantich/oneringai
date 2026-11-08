export const env = (_name: string): string | undefined => undefined;
export const browserSDKOptions: { dangerouslyAllowBrowser?: boolean } = { dangerouslyAllowBrowser: true };
export function unrefTimer(_timer: ReturnType<typeof setTimeout>): void { /* Browser timers have no process lifetime handle. */ }
export function onProcessShutdown(_close: () => void): void { /* Host owns explicit teardown; no guaranteed unload checkpoint. */ }
