// Preserve Node's existing lazy require fallbacks and their bundled paths.
export function loadConnectorToolsModule(): { ConnectorTools: any } {
  // esbuild recognizes require() inside try as optional; moving the catch out
  // would make its intentionally absent bundled path a build-time dependency.
  // eslint-disable-next-line no-useless-catch
  try { return require('../../tools/connector/ConnectorTools.js'); }
  catch (error) { throw error; } // Keep the existing optional require at build time too.
}
export function loadBuiltInToolRegistry(): any {
  // eslint-disable-next-line no-useless-catch -- same optional Node fallback
  try { return require('../../tools/registry.generated.js'); }
  catch (error) { throw error; }
}
