# Optional backend: preserved for future Youetal integration

The desktop redesign preserves browser auth, token/profile management, connector
discovery, and proxied connector registration. It does not complete or release a
Youetal service integration. The current user-facing workspace uses direct model
providers, local Ollama, and user-configured service connectors.

## What remains

- `src/main/BackendAuthService.ts`: browser authentication and support detection.
- `AgentService.ts`: backend profiles, JWT expiry metadata, discovery, sync,
  profile switching, and LLM/universal proxy connector registration.
- `src/preload/index.ts`: neutral `window.hosea.backend` IPC bridge.
- `src/main/index.ts`: gated backend handlers and conditional startup profile sync.
- `EDGE_PROXY_ARCHITECTURE.md`: deferred architecture proposal for the next phase.

The old company product names have been replaced with neutral backend names.
The auth/proxy implementation was retained, rather than replaced with stubs.

## Disabled by default

`HOSEA_ENABLE_BACKEND=1` opts a normal launch into backend profile loading/sync and
backend IPC. With the flag absent, the backend is dormant, and backend IPC rejects
with a clear disabled error. Backend-sourced connectors are not loaded into the
active connector registries while this integration is disabled.

The design preview **always disables the backend**, even if this flag is inherited.
No backend login/profile controls appear in the current UI. Future work must
restore the UI intentionally after validating the service contract and auth flow.

`HOSEA_BACKEND_URL` overrides the future default; the neutral default is
`https://youetal.ai`. No request is made simply because a default URL exists.
Backend profiles are stored at `<dataDir>/backend-profiles.json`. The existing
single-config migration remains under neutral local filenames. Historical app
data is left untouched, and old credentials are not imported or transmitted.

## OAuth and telemetry are separate

Vendor OAuth/PKCE support remains implemented. There are no bundled organization
client IDs or shared client secrets. Put your own app registrations in
`<dataDir>/built-in-oauth-apps.json`, or configure a service connector directly.
See [OAuth setup](OAUTH_VENDOR_SETUP.md).

Startup installation/device telemetry has been removed. Future backend auth and
proxy functionality does not depend on telemetry and is not enabled by analytics.

## Before re-enabling the product flow

Validate the real Youetal endpoints, audience/scopes, token exchange and expiry,
profile switching, proxy connector isolation, cancellation, and error reporting.
Provide new OAuth registrations where needed and an explicit data migration path.
The redesign verifies the feature gates locally; no live backend login or proxy
call is claimed.
