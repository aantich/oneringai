/** Pin control traffic and keep SDK-generated errors from echoing credentials/body content. */
export function managedFetch(fetcher: typeof fetch, baseURL: string): typeof fetch {
  const origin = new URL(baseURL).origin;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== origin || url.username || url.password) throw new Error('Managed control request crossed its connector origin');
    let response: Response;
    try { response = await fetcher(input, { ...init, redirect: 'error' }); }
    catch { throw new Error('Managed control transport failed; native acceptance must be reconciled'); }
    if (response.redirected || (response.status >= 300 && response.status < 400)) { await response.body?.cancel(); throw new Error('Managed control redirects are disabled'); }
    if (response.ok) return response;
    await response.body?.cancel();
    return new Response(JSON.stringify({ error: { type: 'managed_request_error', message: `Managed API request failed (HTTP ${response.status}); retrieve original state before retrying a mutation` } }), { status: response.status, headers: { 'content-type': 'application/json' } });
  };
}
