# OAuth Vendor Setup Guide (Desktop / Electron)

hosea uses OAuth 2.0 Authorization Code + PKCE for authenticating users with third-party services. The infrastructure is fully implemented — this document covers how to register your app with each vendor.

Hosea ships without organization-owned client IDs or shared client secrets.
Configure a service connector through the UI, or add your own quick-connect
registrations to `<HOSEA_DATA_DIR>/built-in-oauth-apps.json` (default `~/.hosea/`).
The file is an array of `BuiltInOAuthApp` objects defined in
`src/main/built-in-oauth-apps.ts`; restart after changing it. For example:

```json
[
  {
    "vendorId": "microsoft",
    "displayName": "Microsoft",
    "clientId": "YOUR_PUBLIC_CLIENT_ID",
    "authTemplateId": "oauth-user",
    "scopes": ["User.Read", "offline_access"],
    "extraCredentials": { "tenantId": "common" }
  }
]
```

Only use registrations you control. Desktop apps cannot keep embedded client
secrets confidential; prefer supported public-client / PKCE flows. Quick-connect
cards appear only for configured registrations. The backend login/proxy path is
separate and [disabled for now](BACKEND_INTEGRATION.md).

**Redirect URI for all vendors:** `http://localhost:19876/oauth/callback`

---

## Architecture Overview

```
User clicks "Connect" in the app
  → App opens system browser → vendor OAuth consent page
  → User approves
  → Vendor redirects to http://localhost:19876/oauth/callback
  → App captures auth code, exchanges for tokens (PKCE)
  → Tokens stored locally (AES-256-GCM encrypted)
```

All flows use the existing `VendorOAuthService` + `OAuthCallbackServer` in `apps/hosea/src/main/`.

---

## Tier 1: Full Marketplace + PKCE Support

### Microsoft (Entra ID / Azure AD)

**Register once → any M365 user can authenticate**

| Field | Value |
|-------|-------|
| Portal | [Azure App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) |
| Client Secret Needed | No (public client + PKCE) |
| Admin Consent Required | Only for `OnlineMeetingTranscript.Read.All` |
| Time to Go Live | Immediate |

**Steps:**

1. Go to Azure Portal → App Registrations → **"New registration"**
   - Name: `hosea`
   - Supported account types: **"Accounts in any organizational directory and personal Microsoft accounts"** (multi-tenant + personal)
   - Redirect URI: Platform = **"Mobile and desktop applications"**, URI = `http://localhost:19876/oauth/callback`
2. After creation, note the **Application (client) ID** — this is your `clientId`
3. Go to **"Authentication"** tab:
   - Under "Advanced settings", toggle **"Allow public client flows"** → **Yes**
   - Confirm redirect URI is listed under "Mobile and desktop applications"
4. Go to **"API permissions"** → Add Microsoft Graph **delegated** permissions (see scope table below)
5. For admin-consent scopes: click **"Grant admin consent for [tenant]"** (requires Global Admin)

**Do NOT create a client secret** — the app is a public client using PKCE.

**Connector config:**
```json
{
  "name": "microsoft",
  "vendor": "microsoft",
  "auth": {
    "type": "oauth",
    "flow": "authorization_code",
    "clientId": "<your-application-client-id>",
    "authorizationUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "tokenUrl": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    "redirectUri": "http://localhost:19876/oauth/callback",
    "scope": "openid profile offline_access Calendars.ReadWrite OnlineMeetings.Read OnlineMeetingTranscript.Read.All ChannelMessage.Send ChatMessage.Send Chat.ReadWrite Sites.ReadWrite.All Files.ReadWrite.All",
    "usePKCE": true
  }
}
```

**Authorization URL variants:**
- `/common/` — any org + personal Microsoft accounts (broadest)
- `/organizations/` — work/school accounts only
- `/consumers/` — personal Microsoft accounts only
- `/<tenant-id>/` — single organization only

#### Microsoft Graph Permissions Reference

| Scope | Purpose | Consent | Notes |
|-------|---------|---------|-------|
| `openid` | OpenID Connect sign-in | User | Required for identity |
| `profile` | User's basic profile | User | Name, email |
| `offline_access` | Refresh tokens | User | Required for persistent sessions |
| `Calendars.ReadWrite` | Read/write calendar events | User | Create, update, delete meetings. Setting `isOnlineMeeting: true` creates Teams meetings without extra scopes. |
| `OnlineMeetings.Read` | List online meetings | User | Required to enumerate meetings before fetching transcripts |
| `OnlineMeetingTranscript.Read.All` | Read meeting transcripts | **Admin** | Returns `.vtt` or `.docx` format. Transcription must be enabled in Teams admin center. |
| `ChannelMessage.Send` | Send to Teams channels | User | POST to `/teams/{id}/channels/{id}/messages`. User must be a channel member. |
| `ChatMessage.Send` | Send to Teams chats | User | POST to `/chats/{id}/messages`. For existing chats only. |
| `Chat.ReadWrite` | Read/write Teams chats | User | Create new chats, read chat metadata and messages. |
| `Sites.ReadWrite.All` | SharePoint sites, lists, docs | User | Despite `.All`, delegated access respects SharePoint permissions. Covers search via `/search/query`. |
| `Files.ReadWrite.All` | OneDrive files + shared files | User | User's OneDrive + files shared with them. `.All` needed for shared files; without it only user's own OneDrive. |

**Gotchas:**
- `Sites.ReadWrite.All` and `Files.ReadWrite.All` sound broad but in delegated mode they only access what the signed-in user already has permission to see in SharePoint/OneDrive
- For cross-service search (OneDrive + SharePoint + Teams files), use the `/search/query` endpoint — requires both `Files.Read.All` and `Sites.Read.All`
- Reading channel messages (not just sending) requires `ChannelMessage.Read.All` (**admin consent**)
- Teams messaging endpoints are rate-limited more aggressively (~2 msg/sec per app per chat)

---

### Google (Google Cloud / Workspace)

**Register once → any Google user can authenticate**

| Field | Value |
|-------|-------|
| Portal | [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) |
| Client Secret Needed | Yes (Google requires it even for desktop apps, but it's not truly secret) |
| Verification Required | Yes, for sensitive scopes (Gmail, Drive, Calendar) |
| Time to Go Live | Immediate for testing; days-weeks for production verification |

**Steps:**

1. Go to Google Cloud Console → Create project (or use existing)
2. Enable required APIs: Gmail API, Google Calendar API, Google Drive API, etc.
3. Go to **Credentials** → **"Create Credentials"** → **"OAuth client ID"**
   - Application type: **"Desktop app"**
   - Name: `hosea`
4. Download the JSON — note **Client ID** and **Client Secret**
5. Go to **"OAuth consent screen"**:
   - User Type: **"External"**
   - Fill in app name, support email, logo
   - Add scopes for each API
   - Add test users (required while in "Testing" status)
6. To go to production: click **"Publish App"** (triggers Google verification for sensitive scopes)

**Connector config:**
```json
{
  "name": "google",
  "vendor": "google",
  "auth": {
    "type": "oauth",
    "flow": "authorization_code",
    "clientId": "<your-client-id>.apps.googleusercontent.com",
    "clientSecret": "<your-client-secret>",
    "authorizationUrl": "https://accounts.google.com/o/oauth2/v2/auth",
    "tokenUrl": "https://oauth2.googleapis.com/token",
    "redirectUri": "http://localhost:19876/oauth/callback",
    "scope": "openid profile email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive",
    "usePKCE": true
  }
}
```

**Gotchas:**
- While in "Testing" mode, only listed test users can authenticate (max 100 users)
- Sensitive scopes require Google's verification process (privacy policy, homepage, demo video)
- Add `access_type=offline` to get refresh tokens (may need extra auth URL param)
- Google issues a client secret for desktop apps but it's considered non-confidential

---

### GitHub

**Register once → any GitHub user can authenticate**

| Field | Value |
|-------|-------|
| Portal | [GitHub → Settings → Developer settings → GitHub Apps](https://github.com/settings/apps) |
| Client Secret Needed | Yes |
| Verification Required | None |
| Time to Go Live | Immediate |

**Steps:**

1. Go to GitHub Settings → Developer settings → **GitHub Apps** → **"New GitHub App"**
   - App name: `hosea`
   - Homepage URL: your website
   - Callback URL: `http://localhost:19876/oauth/callback`
   - Check **"Request user authorization (OAuth) during installation"**
   - Uncheck **"Active"** under Webhook (unless needed)
2. Set **Permissions** (per resource):
   - Repository: Contents (read/write), Issues (read/write), Pull requests (read/write), etc.
   - Account: Email addresses (read)
3. Where can this app be installed: **"Any account"**
4. After creation: note **Client ID**, generate a **Client Secret**

**Connector config:**
```json
{
  "name": "github",
  "vendor": "github",
  "auth": {
    "type": "oauth",
    "flow": "authorization_code",
    "clientId": "<your-client-id>",
    "clientSecret": "<your-client-secret>",
    "authorizationUrl": "https://github.com/login/oauth/authorize",
    "tokenUrl": "https://github.com/login/oauth/access_token",
    "redirectUri": "http://localhost:19876/oauth/callback",
    "scope": "repo read:user user:email",
    "usePKCE": true
  }
}
```

**Gotchas:**
- GitHub tokens don't expire by default. Enable "Expire user authorization tokens" in app settings for refresh token support.
- GitHub App (preferred) vs OAuth App: GitHub Apps have granular per-repo permissions and can be installed per-org
- For Marketplace listing: go to app settings → "List in Marketplace"

---

### Salesforce

**Register once → any Salesforce org can authenticate**

| Field | Value |
|-------|-------|
| Portal | Setup → Apps → App Manager → New Connected App |
| Client Secret Needed | Optional with PKCE (include for refresh token reliability) |
| Verification Required | AppExchange = months; direct OAuth = none |
| Time to Go Live | Immediate (2-10 min propagation) |

**Steps:**

1. Log into a Salesforce org → **Setup** → **Apps** → **App Manager** → **"New Connected App"**
   - Connected App Name: `hosea`
   - Contact Email: your email
2. Under **"API (Enable OAuth Settings)"**:
   - Check **"Enable OAuth Settings"**
   - Callback URL: `http://localhost:19876/oauth/callback`
   - Selected OAuth Scopes: `api`, `refresh_token`, `offline_access`
   - Check **"Require Proof Key for Code Exchange (PKCE)"**
   - Check **"Enable Authorization Code and Credentials Flow"**
3. Under **"OAuth Policies"**:
   - Permitted Users: **"All users may self-authorize"**
4. Save and wait 2-10 minutes for propagation
5. Note **Consumer Key** (= clientId) and **Consumer Secret**

**Connector config:**
```json
{
  "name": "salesforce",
  "vendor": "salesforce",
  "auth": {
    "type": "oauth",
    "flow": "authorization_code",
    "clientId": "<consumer-key>",
    "clientSecret": "<consumer-secret>",
    "authorizationUrl": "https://login.salesforce.com/services/oauth2/authorize",
    "tokenUrl": "https://login.salesforce.com/services/oauth2/token",
    "redirectUri": "http://localhost:19876/oauth/callback",
    "scope": "api refresh_token",
    "usePKCE": true
  }
}
```

**URL variants:**
- `https://login.salesforce.com` — production orgs
- `https://test.salesforce.com` — sandbox orgs

**Gotchas:**
- Salesforce fully supports PKCE without client_secret (true public client)
- Refresh tokens are long-lived by default
- AppExchange listing requires Salesforce Security Review (extensive process)

---

## Tier 1: Require Backend Token Proxy (No PKCE)

These vendors require `client_secret` for token exchange and do NOT support PKCE for public clients. For desktop apps, you need a lightweight backend proxy to exchange the auth code.

### Slack

| Field | Value |
|-------|-------|
| Portal | [Slack API → Your Apps](https://api.slack.com/apps) |
| Client Secret Needed | Yes (required at token exchange) |
| PKCE Support | No |

**Steps:**
1. Go to api.slack.com/apps → **"Create New App"** → "From scratch"
2. Set **Redirect URL**: `http://localhost:19876/oauth/callback`
3. Under **"OAuth & Permissions"**: add Bot Token Scopes and User Token Scopes as needed
4. Note **Client ID** and **Client Secret**

**Requires backend proxy for token exchange.** The desktop app sends the auth code to your backend, which exchanges it using the client secret.

---

### HubSpot

| Field | Value |
|-------|-------|
| Portal | [HubSpot Developer Portal](https://developers.hubspot.com/) |
| Client Secret Needed | Yes |
| PKCE Support | No |

**Steps:**
1. Go to HubSpot Developer Portal → Create app
2. Under **"Auth"**: set Redirect URL to `http://localhost:19876/oauth/callback`
3. Select required scopes
4. Note **Client ID** and **Client Secret**

**Requires backend proxy for token exchange.**

---

### Shopify

| Field | Value |
|-------|-------|
| Portal | [Shopify Partners](https://partners.shopify.com/) |
| Client Secret Needed | Yes |
| PKCE Support | No |
| Special Requirement | Redirect URI must be HTTPS |

**Requires backend proxy** — Shopify mandates HTTPS redirect URIs, so the entire OAuth flow must go through your server.

---

## Tier 2: OAuth App Registration (Same PKCE Pattern)

These vendors support the same Authorization Code + PKCE pattern. Register using the same redirect URI (`http://localhost:19876/oauth/callback`).

| Vendor | Portal | Secret Required | PKCE | Admin Consent |
|--------|--------|----------------|------|--------------|
| **Jira / Confluence** | [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/) | Yes | Yes (3LO) | No |
| **Linear** | [linear.app/developers](https://linear.app/developers) | Yes | Yes | No |
| **Asana** | [Asana Developer Console](https://app.asana.com/0/developer-console) | Yes | Yes | No |
| **Notion** | [notion.so/my-integrations](https://www.notion.so/my-integrations) | Yes | No | No |
| **Airtable** | [Airtable Developer Hub](https://airtable.com/developers) | Yes | Yes | No |
| **Dropbox** | [dropbox.com/developers](https://www.dropbox.com/developers) | Yes | Yes | No |
| **Box** | [Box Developer Console](https://app.box.com/developers/console) | Yes | Yes | No |
| **Stripe** | [Stripe Connect](https://dashboard.stripe.com/connect) | Yes | No | No |
| **QuickBooks** | [Intuit Developer Portal](https://developer.intuit.com/) | Yes | Yes | No |
| **Discord** | [discord.com/developers](https://discord.com/developers/applications) | Yes | Yes | No |
| **GitLab** | GitLab Settings → Applications | Yes | Yes | No |
| **Bitbucket** | Bitbucket Settings → OAuth consumers | Yes | Yes | No |
| **Zendesk** | [Zendesk Developer Portal](https://developer.zendesk.com/) | Yes | Yes | No |
| **Intercom** | [Intercom Developer Hub](https://developers.intercom.com/) | Yes | Yes | No |
| **Mailchimp** | [Mailchimp Developer Portal](https://mailchimp.com/developer/) | Yes | No | No |
| **PagerDuty** | [PagerDuty Developer Platform](https://developer.pagerduty.com/) | Yes | Yes | No |
| **Pipedrive** | [Pipedrive Developer Portal](https://developers.pipedrive.com/) | Yes | Yes | No |

---

## Tier 3: API Key Only (No OAuth)

These services use static API keys. Users enter their key directly in the app's connector settings.

| Vendor | Auth Model |
|--------|-----------|
| Telegram | Bot Token via @BotFather |
| SendGrid | API Key |
| Postmark | Server Token |
| Datadog | API Key + App Key |
| AWS | IAM Access Key + Secret |
| Twilio | Account SID + Auth Token |
| Serper / Brave Search / Tavily / RapidAPI | API Key |
| ZenRows | API Key |

---

## Token Storage

hosea stores all OAuth tokens locally using AES-256-GCM encryption:
- **Location**: `~/.oneringai/oauth/tokens/` (file permissions 0o600)
- **Encryption key**: Set `OAUTH_ENCRYPTION_KEY` env var for persistence across restarts
- **Filenames**: SHA256-hashed (no sensitive data in filesystem)
- **Refresh**: Automatic refresh 5 minutes before expiry
