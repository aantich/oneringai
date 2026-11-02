> **Deferred architecture:** the backend auth, profile, discovery, and proxy code is
> preserved under neutral backend names, disabled by default, and intended for
> future Youetal work. This document is a historical design proposal, not a claim
> that the current UI exposes or validates hosted functionality. See
> [the current integration status](BACKEND_INTEGRATION.md).

# Edge Proxy Architecture for hosea

## TL;DR

Deploy a Cloudflare Workers edge proxy that:
1. **Validates** user JWT tokens (custom auth, not Supabase)
2. **Injects** vendor API keys (OpenAI, Anthropic, Google, Grok)
3. **Deducts** tokens from user balance (token economy, not USD)
4. **Streams** responses back to the client

**Token Economy:**
- Users have TOKEN balance (abstracts vendor pricing)
- Actions cost tokens: chat ~1-10/1K, images ~30, video ~20/sec
- Plans: Free (500 tokens/mo), Pro ($20 → 10K), Enterprise ($100 → 100K)
- Can buy additional token packs via Stripe

**Hybrid mode:** Users can fall back to their own API keys if they prefer.

**Estimated work:** 2 new packages (edge-proxy, auth-server), ~15 modified files in the app/library.

---

## Current State

hosea is an Electron desktop app where:
- Users enter their own API keys locally
- Keys stored in `~/.hosea/connectors/*.json`
- Direct API calls: `App → Provider → Vendor API`

## Goal

Centralize API key management so users:
1. Register/authenticate with your server
2. Make API calls through a lightweight edge proxy
3. Never see or manage vendor API keys

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         CURRENT FLOW                                 │
│                                                                      │
│  App → Provider → OpenAI/Anthropic/Google (direct)                  │
│             (user's keys)                                            │
└─────────────────────────────────────────────────────────────────────┘

                              ↓ BECOMES ↓

┌─────────────────────────────────────────────────────────────────────┐
│                         NEW FLOW                                     │
│                                                                      │
│  App → Edge Proxy → OpenAI/Anthropic/Google                         │
│  (user token)  (your keys)                                          │
│                                                                      │
│  ┌──────────┐      ┌─────────────────┐      ┌──────────────┐        │
│  │  App     │ ───► │  Edge Worker    │ ───► │  Vendor API  │        │
│  │  (user)  │      │  (Cloudflare/   │      │  (OpenAI,    │        │
│  │          │ ◄─── │   Vercel Edge)  │ ◄─── │   Anthropic) │        │
│  └──────────┘      └─────────────────┘      └──────────────┘        │
│       │                    │                                         │
│       │ Auth               │ Validates token                         │
│       ▼                    │ Adds vendor API key                     │
│  ┌──────────┐              │ Rate limits per user                    │
│  │  Auth    │◄─────────────┘ Meters usage                            │
│  │  Server  │              │ Logs to D1 for billing                  │
│  │ (Custom  │                                                        │
│  │   JWT)   │───────► Stripe (subscriptions, payments)               │
│  └──────────┘                                                        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Components

### 1. Edge Proxy (Cloudflare Workers)

**Why Cloudflare Workers:**
- 300+ edge locations globally (low latency)
- Streaming support (critical for LLM responses)
- Built-in KV storage for API keys
- $5/month for 10M requests
- Sub-10ms cold start

**Proxy Responsibilities:**
- Validate user JWT token
- Look up vendor API key from KV
- Add `Authorization` header to vendor request
- Forward request to vendor
- Stream response back to client
- Log usage for billing/metering

**Example Worker Code:**

```typescript
// workers/llm-proxy/src/index.ts
import { Hono } from 'hono';
import { jwt } from 'hono/jwt';

const app = new Hono();

// JWT validation middleware
app.use('/*', jwt({ secret: env.JWT_SECRET }));

// Vendor routing
app.all('/v1/openai/*', async (c) => {
  const apiKey = await c.env.VENDOR_KEYS.get('openai');
  const path = c.req.path.replace('/v1/openai', '');

  const response = await fetch(`https://api.openai.com${path}`, {
    method: c.req.method,
    headers: {
      ...Object.fromEntries(c.req.headers),
      'Authorization': `Bearer ${apiKey}`,
    },
    body: c.req.body,
  });

  // Stream response back
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

app.all('/v1/anthropic/*', async (c) => {
  const apiKey = await c.env.VENDOR_KEYS.get('anthropic');
  const path = c.req.path.replace('/v1/anthropic', '');

  const response = await fetch(`https://api.anthropic.com${path}`, {
    method: c.req.method,
    headers: {
      ...Object.fromEntries(c.req.headers),
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: c.req.body,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

app.all('/v1/google/*', async (c) => {
  const apiKey = await c.env.VENDOR_KEYS.get('google');
  const path = c.req.path.replace('/v1/google', '');

  const response = await fetch(`https://generativelanguage.googleapis.com${path}`, {
    method: c.req.method,
    headers: {
      ...Object.fromEntries(c.req.headers),
      'x-goog-api-key': apiKey,
    },
    body: c.req.body,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

app.all('/v1/grok/*', async (c) => {
  const apiKey = await c.env.VENDOR_KEYS.get('grok');
  const path = c.req.path.replace('/v1/grok', '');

  // Grok uses OpenAI-compatible API
  const response = await fetch(`https://api.x.ai${path}`, {
    method: c.req.method,
    headers: {
      ...Object.fromEntries(c.req.headers),
      'Authorization': `Bearer ${apiKey}`,
    },
    body: c.req.body,
  });

  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
});

export default app;
```

### 2. Custom Auth Server

**User Registration Flow:**
1. User opens the app → "Sign In" button
2. Email/password or OAuth flow (Google, GitHub)
3. Backend issues JWT token (RS256 signed)
4. Token stored locally in the app (Electron safeStorage)
5. All API requests include token in header

**Custom Auth Backend (Node.js/Express or Cloudflare Worker):**

```typescript
// packages/auth-server/src/index.ts
import { Hono } from 'hono';
import { sign, verify } from 'hono/jwt';
import bcrypt from 'bcryptjs';

const app = new Hono();

// Sign up
app.post('/auth/signup', async (c) => {
  const { email, password } = await c.req.json();
  const hashedPassword = await bcrypt.hash(password, 10);

  // Store user in D1 database
  const user = await c.env.DB.prepare(
    'INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id'
  ).bind(email, hashedPassword).first();

  // Create Stripe customer
  const stripeCustomer = await stripe.customers.create({ email });
  await c.env.DB.prepare(
    'UPDATE users SET stripe_customer_id = ? WHERE id = ?'
  ).bind(stripeCustomer.id, user.id).run();

  const token = await sign({
    sub: user.id,
    email,
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  }, c.env.JWT_SECRET);

  const refreshToken = await sign({
    sub: user.id,
    type: 'refresh',
    exp: Math.floor(Date.now() / 1000) + 604800 // 7 days
  }, c.env.JWT_REFRESH_SECRET);

  return c.json({ token, refreshToken, user: { id: user.id, email } });
});

// Sign in
app.post('/auth/signin', async (c) => {
  const { email, password } = await c.req.json();

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE email = ?'
  ).bind(email).first();

  if (!user || !await bcrypt.compare(password, user.password_hash)) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  const token = await sign({ sub: user.id, email }, c.env.JWT_SECRET);
  const refreshToken = await sign({ sub: user.id, type: 'refresh' }, c.env.JWT_REFRESH_SECRET);

  return c.json({ token, refreshToken, user: { id: user.id, email } });
});

// Refresh token
app.post('/auth/refresh', async (c) => {
  const { refreshToken } = await c.req.json();
  const payload = await verify(refreshToken, c.env.JWT_REFRESH_SECRET);

  if (payload.type !== 'refresh') {
    return c.json({ error: 'Invalid token type' }, 401);
  }

  const user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(payload.sub).first();

  const newToken = await sign({ sub: user.id, email: user.email }, c.env.JWT_SECRET);
  return c.json({ token: newToken });
});

export default app;
```

**Database Schema (Cloudflare D1 or PostgreSQL):**
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  stripe_customer_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE usage (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT REFERENCES users(id),
  vendor TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT UNIQUE REFERENCES users(id),
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',  -- free, pro, enterprise
  monthly_budget_usd REAL DEFAULT 5.00,
  current_month_usage_usd REAL DEFAULT 0.00,
  billing_cycle_start DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_usage_user_id ON usage(user_id);
CREATE INDEX idx_usage_created_at ON usage(created_at);
```

### 3. hosea Client Changes

**New Connector Type: `proxy`**

Instead of storing vendor API keys, users authenticate with your service:

```typescript
// New connector type in oneringai
interface ProxyConnectorConfig {
  type: 'proxy';
  name: string;
  proxyUrl: string;        // https://llm-proxy.yourcompany.workers.dev
  authToken: string;       // User's JWT from Supabase
  vendor: Vendor;          // Which vendor to route to
}

// Example usage
Connector.create({
  name: 'openai-via-proxy',
  type: 'proxy',
  proxyUrl: 'https://llm-proxy.oneringai.workers.dev',
  authToken: userJwt,
  vendor: Vendor.OpenAI,
});
```

**Library Changes Required:**

1. **New ProxyTextProvider** (`src/infrastructure/providers/proxy/ProxyTextProvider.ts`)
   - Wraps vendor-specific logic
   - Routes to proxy instead of vendor directly
   - Includes auth token in requests

2. **Connector Enhancement**
   - Support `type: 'proxy'` in addition to `type: 'api_key'`
   - Store proxy URL and auth token

3. **Provider Factory Update** (`src/core/createProvider.ts`)
   - Detect proxy connectors
   - Return ProxyTextProvider instead of vendor-specific provider

---

## Implementation Plan

### Phase 1: Edge Proxy + Auth Server (Server Side)

**Files to create:**

```
packages/edge-proxy/
├── package.json
├── wrangler.toml           # Cloudflare config
├── src/
│   ├── index.ts            # Main worker entry
│   ├── vendors/
│   │   ├── openai.ts       # OpenAI routing
│   │   ├── anthropic.ts    # Anthropic routing
│   │   ├── google.ts       # Google routing
│   │   ├── grok.ts         # Grok routing
│   │   └── index.ts        # Vendor registry
│   ├── auth/
│   │   └── jwt.ts          # JWT validation
│   ├── metering/
│   │   └── usage.ts        # Usage tracking + billing
│   └── types.ts
└── test/
    └── proxy.test.ts

packages/auth-server/
├── package.json
├── wrangler.toml           # Cloudflare config
├── src/
│   ├── index.ts            # Main worker entry
│   ├── routes/
│   │   ├── auth.ts         # signup, signin, refresh
│   │   ├── billing.ts      # checkout, portal, usage
│   │   └── user.ts         # profile, settings
│   ├── stripe.ts           # Stripe integration
│   ├── db.ts               # D1 queries
│   └── types.ts
├── schema.sql              # D1 database schema
└── test/
    └── auth.test.ts
```

**wrangler.toml:**
```toml
name = "llm-proxy"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[vars]
ENVIRONMENT = "production"

[[kv_namespaces]]
binding = "VENDOR_KEYS"
id = "xxx"

[[d1_databases]]
binding = "DB"
database_name = "usage"
database_id = "xxx"
```

### Phase 2: Auth Integration (Custom JWT)

**Files to create/modify:**

```
apps/hosea/
├── src/
│   ├── main/
│   │   ├── AuthService.ts      # NEW: Handle custom auth
│   │   └── ipc-handlers.ts     # Add auth handlers
│   ├── renderer/
│   │   ├── pages/
│   │   │   └── LoginPage.tsx   # NEW: Login UI
│   │   └── contexts/
│   │       └── AuthContext.tsx # NEW: Auth state
│   └── preload/
│       └── index.ts            # Add auth API
```

**AuthService.ts (hosea Client):**
```typescript
import { safeStorage } from 'electron';

const AUTH_API = 'https://auth.oneringai.com';  // Your auth server

export class AuthService {
  private token: string | null = null;
  private refreshToken: string | null = null;

  async signUp(email: string, password: string) {
    const response = await fetch(`${AUTH_API}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Sign up failed');
    }

    const data = await response.json();
    await this.storeTokens(data.token, data.refreshToken);
    return data.user;
  }

  async signIn(email: string, password: string) {
    const response = await fetch(`${AUTH_API}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      throw new Error('Invalid credentials');
    }

    const data = await response.json();
    await this.storeTokens(data.token, data.refreshToken);
    return data.user;
  }

  async refreshAccessToken() {
    const refreshToken = await this.getStoredRefreshToken();
    if (!refreshToken) throw new Error('No refresh token');

    const response = await fetch(`${AUTH_API}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      await this.clearTokens();
      throw new Error('Session expired');
    }

    const data = await response.json();
    await this.storeTokens(data.token, refreshToken);
    return data.token;
  }

  async getToken(): Promise<string | null> {
    if (this.token && !this.isTokenExpired(this.token)) {
      return this.token;
    }

    // Try to refresh
    try {
      return await this.refreshAccessToken();
    } catch {
      return null;
    }
  }

  private async storeTokens(token: string, refreshToken: string) {
    this.token = token;
    this.refreshToken = refreshToken;

    // Store encrypted in Electron's safeStorage
    const encrypted = safeStorage.encryptString(JSON.stringify({ token, refreshToken }));
    // Save to file: ~/.hosea/auth.enc
  }

  private isTokenExpired(token: string): boolean {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now() - 60000; // 1 min buffer
  }

  async signOut() {
    await this.clearTokens();
  }

  private async clearTokens() {
    this.token = null;
    this.refreshToken = null;
    // Delete ~/.hosea/auth.enc
  }
}
```

### Phase 3: Library Changes

**Files to modify/create:**

```
packages/agents/src/
├── core/
│   ├── Connector.ts           # Add proxy type support
│   └── createProvider.ts      # Handle proxy connectors
├── infrastructure/
│   └── providers/
│       └── proxy/
│           └── ProxyTextProvider.ts  # NEW
```

**ProxyTextProvider.ts:**
```typescript
export class ProxyTextProvider extends BaseTextProvider {
  private proxyUrl: string;
  private authToken: string;
  private targetVendor: Vendor;

  constructor(config: ProxyProviderConfig) {
    super(config);
    this.proxyUrl = config.proxyUrl;
    this.authToken = config.authToken;
    this.targetVendor = config.vendor;
  }

  async *generate(messages: Message[], options: GenerateOptions): AsyncGenerator<StreamEvent> {
    const vendorPath = this.getVendorPath();
    const url = `${this.proxyUrl}/v1/${vendorPath}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.authToken}`,  // User's JWT
        'X-Target-Vendor': this.targetVendor,
      },
      body: JSON.stringify({
        model: this.model,
        messages: this.formatMessages(messages),
        stream: true,
        ...options,
      }),
    });

    // Handle streaming response
    for await (const event of this.parseSSE(response.body)) {
      yield event;
    }
  }

  private getVendorPath(): string {
    switch (this.targetVendor) {
      case Vendor.OpenAI: return 'openai';
      case Vendor.Anthropic: return 'anthropic';
      case Vendor.Google: return 'google';
      // ... etc
    }
  }
}
```

---

## User Experience Flow

### New User

1. **Download & Install hosea**
2. **Launch → See "Sign In" screen**
3. **Click "Sign in with Google"** → Browser opens
4. **Complete OAuth** → Redirected back to the app
5. **App stores JWT locally**
6. **Ready to chat** - no API keys needed!

### Existing User (Migration)

1. **Update hosea** to new version
2. **See prompt:** "We now manage API keys for you! Sign in to continue."
3. **Sign in** → JWT stored
4. **Old connectors preserved** (can still use own keys if desired)
5. **Default connector switches to proxy**

### Settings UI

```
┌─────────────────────────────────────────────┐
│  Connection Settings                         │
├─────────────────────────────────────────────┤
│                                             │
│  ● Use OneRing AI (Recommended)             │
│    └─ Signed in as: user@email.com          │
│    └─ Plan: Pro ($20/month)                 │
│    └─ Token Balance: 7,234 tokens           │
│    └─ [Buy More Tokens] [Upgrade Plan]      │
│                                             │
│  ○ Use my own API keys                      │
│    └─ [Manage Connectors]                   │
│                                             │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Token Usage (Last 30 Days)                  │
├─────────────────────────────────────────────┤
│                                             │
│  Chat:           2,145 tokens (72%)         │
│  ████████████████████░░░░░                  │
│                                             │
│  Image Gen:        520 tokens (17%)         │
│  █████░░░░░░░░░░░░░░░░░░░░░                 │
│                                             │
│  Audio:            335 tokens (11%)         │
│  ███░░░░░░░░░░░░░░░░░░░░░░░░                │
│                                             │
│  [View Transaction History]                 │
│                                             │
└─────────────────────────────────────────────┘
```

---

## Security Considerations

### Token Security
- JWTs signed with RS256 (asymmetric)
- Short expiry (1 hour) with refresh tokens
- Stored in Electron's safeStorage (encrypted)

### Rate Limiting
- Per-user rate limits at edge
- Monthly spend caps
- Abuse detection (unusual patterns)

### API Key Security
- Vendor keys stored in Cloudflare KV (encrypted at rest)
- Never exposed to clients
- Rotated regularly

### Request Validation
- Validate JWT signature at edge
- Check user plan/limits before forwarding
- Sanitize request bodies

---

## Token Economy & Billing

### Token Model Overview

Users have a **TOKEN balance** (not USD). Actions cost tokens:

| Action | Token Cost | Notes |
|--------|------------|-------|
| Text chat (per 1K LLM tokens) | 1 token | Input + output combined |
| Image generation | 10-50 tokens | Varies by model/size |
| Video generation | 100-500 tokens | Varies by duration/quality |
| Audio synthesis (TTS) | 5-20 tokens | Per minute of audio |
| Audio transcription (STT) | 3-10 tokens | Per minute of audio |

**Why tokens?**
- Abstracts vendor pricing complexity from users
- Allows margin control (set exchange rates)
- Enables promotional credits, referral bonuses
- Simplifies UI ("You have 5,000 tokens" vs "$2.34 remaining")

### Subscription Plans

| Plan | Monthly Price | Monthly Tokens | Rollover | Extra Token Price |
|------|---------------|----------------|----------|-------------------|
| Free | $0 | 500 | No | $10 / 1,000 tokens |
| Pro | $20 | 10,000 | Up to 5,000 | $8 / 1,000 tokens |
| Enterprise | $100 | 100,000 | Unlimited | $5 / 1,000 tokens |

### Database Schema (Updated)

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  stripe_customer_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Token balance tracking
CREATE TABLE token_balances (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  current_balance INTEGER DEFAULT 0,           -- Current available tokens
  lifetime_purchased INTEGER DEFAULT 0,        -- Total tokens ever purchased
  lifetime_granted INTEGER DEFAULT 0,          -- Total tokens from subscriptions
  lifetime_used INTEGER DEFAULT 0,             -- Total tokens consumed
  last_grant_at DATETIME,                      -- Last monthly grant timestamp
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Subscription info
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT UNIQUE REFERENCES users(id),
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',                    -- free, pro, enterprise
  monthly_token_grant INTEGER DEFAULT 500,     -- Tokens granted each month
  max_rollover INTEGER DEFAULT 0,              -- Max tokens to carry over
  billing_cycle_start DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Token transactions (audit log)
CREATE TABLE token_transactions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL,                          -- 'grant', 'purchase', 'usage', 'refund', 'promo'
  amount INTEGER NOT NULL,                     -- Positive = credit, negative = debit
  balance_after INTEGER NOT NULL,              -- Balance after this transaction
  description TEXT,                            -- Human readable
  metadata TEXT,                               -- JSON: vendor, model, action type, etc.
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Usage details (for analytics)
CREATE TABLE usage_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id TEXT REFERENCES users(id),
  transaction_id TEXT REFERENCES token_transactions(id),
  action_type TEXT NOT NULL,                   -- 'chat', 'image', 'video', 'tts', 'stt'
  vendor TEXT NOT NULL,
  model TEXT NOT NULL,
  vendor_input_tokens INTEGER,                 -- Raw vendor tokens (for cost calc)
  vendor_output_tokens INTEGER,
  tokens_charged INTEGER NOT NULL,             -- Our tokens charged
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_transactions_user ON token_transactions(user_id, created_at);
CREATE INDEX idx_usage_user ON usage_log(user_id, created_at);
```

### Token Pricing Engine

```typescript
// packages/auth-server/src/pricing.ts

interface TokenPrice {
  action: 'chat' | 'image' | 'video' | 'tts' | 'stt';
  vendor: string;
  model: string;
  tokensPerUnit: number;  // e.g., tokens per 1K LLM tokens, per image, per minute
}

const PRICING: TokenPrice[] = [
  // Chat - per 1K LLM tokens (input + output)
  { action: 'chat', vendor: 'openai', model: 'gpt-4.1', tokensPerUnit: 2 },
  { action: 'chat', vendor: 'openai', model: 'gpt-5.6-terra', tokensPerUnit: 5 },
  { action: 'chat', vendor: 'anthropic', model: 'claude-4.5-sonnet', tokensPerUnit: 2 },
  { action: 'chat', vendor: 'anthropic', model: 'claude-4.5-opus', tokensPerUnit: 10 },
  { action: 'chat', vendor: 'google', model: 'gemini-2.5-pro', tokensPerUnit: 2 },
  { action: 'chat', vendor: 'grok', model: 'grok-3', tokensPerUnit: 3 },

  // Images - per image
  { action: 'image', vendor: 'openai', model: 'gpt-image-2', tokensPerUnit: 30 },
  { action: 'image', vendor: 'openai', model: 'gpt-image-1', tokensPerUnit: 50 },

  // Video - per second
  { action: 'video', vendor: 'openai', model: 'sora', tokensPerUnit: 20 },

  // TTS - per minute
  { action: 'tts', vendor: 'openai', model: 'tts-1', tokensPerUnit: 5 },
  { action: 'tts', vendor: 'openai', model: 'tts-1-hd', tokensPerUnit: 10 },

  // STT - per minute
  { action: 'stt', vendor: 'openai', model: 'whisper-1', tokensPerUnit: 3 },
];

export function calculateTokenCost(
  action: string,
  vendor: string,
  model: string,
  units: number  // 1K tokens for chat, 1 for image, minutes for audio
): number {
  const price = PRICING.find(p =>
    p.action === action && p.vendor === vendor && p.model === model
  );

  if (!price) {
    // Default pricing for unknown models
    return Math.ceil(units * 2);
  }

  return Math.ceil(units * price.tokensPerUnit);
}
```

### Stripe Integration (Updated for Tokens)

```typescript
// packages/auth-server/src/stripe.ts
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Stripe Products to create:
// 1. Subscriptions: pro_monthly ($20), enterprise_monthly ($100)
// 2. One-time: token_pack_1000 ($10), token_pack_5000 ($40), token_pack_10000 ($50)

export async function createSubscriptionCheckout(userId: string, plan: 'pro' | 'enterprise') {
  const user = await getUser(userId);
  const priceId = plan === 'pro' ? 'price_pro_monthly' : 'price_enterprise_monthly';

  const session = await stripe.checkout.sessions.create({
    customer: user.stripe_customer_id,
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: 'hosea://billing/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'hosea://billing/cancel',
  });

  return session.url;
}

export async function createTokenPurchaseCheckout(userId: string, packSize: number) {
  const user = await getUser(userId);

  const priceMap: Record<number, string> = {
    1000: 'price_tokens_1000',
    5000: 'price_tokens_5000',
    10000: 'price_tokens_10000',
  };

  const session = await stripe.checkout.sessions.create({
    customer: user.stripe_customer_id,
    mode: 'payment',
    line_items: [{ price: priceMap[packSize], quantity: 1 }],
    success_url: 'hosea://billing/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'hosea://billing/cancel',
    metadata: { user_id: userId, token_amount: packSize.toString() },
  });

  return session.url;
}

export async function handleWebhook(event: Stripe.Event) {
  switch (event.type) {
    // Subscription created/renewed - grant monthly tokens
    case 'invoice.paid':
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.subscription) {
        const sub = await stripe.subscriptions.retrieve(invoice.subscription as string);
        const plan = sub.items.data[0].price.lookup_key;  // 'pro' or 'enterprise'
        const userId = await getUserByStripeCustomer(invoice.customer as string);

        const tokenGrant = plan === 'pro' ? 10000 : 100000;
        await grantTokens(userId, tokenGrant, 'subscription_grant', `Monthly ${plan} grant`);
      }
      break;

    // One-time token purchase completed
    case 'checkout.session.completed':
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === 'payment' && session.metadata?.token_amount) {
        const userId = session.metadata.user_id;
        const amount = parseInt(session.metadata.token_amount);
        await grantTokens(userId, amount, 'purchase', `Purchased ${amount} tokens`);
      }
      break;

    // Subscription canceled - downgrade to free
    case 'customer.subscription.deleted':
      const canceled = event.data.object as Stripe.Subscription;
      const userId = await getUserByStripeCustomer(canceled.customer as string);
      await downgradeToFree(userId);
      break;
  }
}

async function grantTokens(userId: string, amount: number, type: string, description: string) {
  // Get current balance
  const balance = await db.prepare(
    'SELECT current_balance FROM token_balances WHERE user_id = ?'
  ).bind(userId).first();

  const newBalance = (balance?.current_balance || 0) + amount;

  // Update balance
  await db.prepare(`
    UPDATE token_balances SET
      current_balance = ?,
      lifetime_granted = lifetime_granted + ?,
      last_grant_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(newBalance, amount, userId).run();

  // Record transaction
  await db.prepare(`
    INSERT INTO token_transactions (user_id, type, amount, balance_after, description)
    VALUES (?, ?, ?, ?, ?)
  `).bind(userId, type, amount, newBalance, description).run();
}
```

### Usage Metering in Proxy (Token-Based)

```typescript
// In edge proxy after successful vendor response
async function deductTokens(
  c: Context,
  action: 'chat' | 'image' | 'video' | 'tts' | 'stt',
  vendor: string,
  model: string,
  vendorUsage: { inputTokens?: number; outputTokens?: number; units?: number }
) {
  const userId = c.get('jwtPayload').sub;

  // Calculate our token cost
  let units: number;
  if (action === 'chat') {
    units = ((vendorUsage.inputTokens || 0) + (vendorUsage.outputTokens || 0)) / 1000;
  } else {
    units = vendorUsage.units || 1;
  }

  const tokenCost = calculateTokenCost(action, vendor, model, units);

  // Deduct from balance (atomic transaction)
  const result = await c.env.DB.prepare(`
    UPDATE token_balances
    SET current_balance = current_balance - ?,
        lifetime_used = lifetime_used + ?
    WHERE user_id = ? AND current_balance >= ?
    RETURNING current_balance
  `).bind(tokenCost, tokenCost, userId, tokenCost).first();

  if (!result) {
    throw new Error('INSUFFICIENT_TOKENS');
  }

  // Record transaction
  const txn = await c.env.DB.prepare(`
    INSERT INTO token_transactions (user_id, type, amount, balance_after, description, metadata)
    VALUES (?, 'usage', ?, ?, ?, ?)
    RETURNING id
  `).bind(
    userId,
    -tokenCost,
    result.current_balance,
    `${action} - ${model}`,
    JSON.stringify({ action, vendor, model, vendorUsage })
  ).first();

  // Record detailed usage
  await c.env.DB.prepare(`
    INSERT INTO usage_log (user_id, transaction_id, action_type, vendor, model,
                          vendor_input_tokens, vendor_output_tokens, tokens_charged)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    userId, txn.id, action, vendor, model,
    vendorUsage.inputTokens || 0,
    vendorUsage.outputTokens || 0,
    tokenCost
  ).run();
}

// Check balance before forwarding request
async function checkBalance(c: Context, estimatedCost: number): boolean {
  const userId = c.get('jwtPayload').sub;
  const balance = await c.env.DB.prepare(
    'SELECT current_balance FROM token_balances WHERE user_id = ?'
  ).bind(userId).first();

  return (balance?.current_balance || 0) >= estimatedCost;
}
```

### User Balance API

```typescript
// packages/auth-server/src/routes/billing.ts

// GET /billing/balance
app.get('/billing/balance', async (c) => {
  const userId = c.get('jwtPayload').sub;

  const balance = await c.env.DB.prepare(`
    SELECT
      tb.current_balance,
      tb.lifetime_used,
      s.plan,
      s.monthly_token_grant
    FROM token_balances tb
    JOIN subscriptions s ON s.user_id = tb.user_id
    WHERE tb.user_id = ?
  `).bind(userId).first();

  return c.json({
    currentBalance: balance.current_balance,
    lifetimeUsed: balance.lifetime_used,
    plan: balance.plan,
    monthlyGrant: balance.monthly_token_grant,
  });
});

// GET /billing/transactions?limit=50&offset=0
app.get('/billing/transactions', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');

  const transactions = await c.env.DB.prepare(`
    SELECT * FROM token_transactions
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).bind(userId, limit, offset).all();

  return c.json({ transactions: transactions.results });
});

// GET /billing/usage?period=month (usage breakdown)
app.get('/billing/usage', async (c) => {
  const userId = c.get('jwtPayload').sub;

  const usage = await c.env.DB.prepare(`
    SELECT
      action_type,
      vendor,
      SUM(tokens_charged) as total_tokens,
      COUNT(*) as count
    FROM usage_log
    WHERE user_id = ?
      AND created_at > datetime('now', '-30 days')
    GROUP BY action_type, vendor
  `).bind(userId).all();

  return c.json({ usage: usage.results });
});
```

---

## Cost Analysis

### Infrastructure Costs (Your Side)

| Component | Service | Cost |
|-----------|---------|------|
| Edge Proxy | Cloudflare Workers | ~$5/month (10M requests) |
| Auth Server | Cloudflare Workers | ~$5/month |
| Database | Cloudflare D1 | ~$5/month (5GB) |
| Stripe | 2.9% + $0.30 per transaction | Variable |
| **Total** | | **~$15/month base + Stripe fees** |

### Token Economics

**Your cost per 1,000 tokens you sell (approximate):**

| Action | Vendor Cost | You Charge | Margin |
|--------|-------------|------------|--------|
| Chat (GPT-4.1, 1K LLM tokens) | ~$0.003 | 2 tokens = $0.02 | 85% |
| Chat (Claude Opus, 1K LLM tokens) | ~$0.06 | 10 tokens = $0.10 | 40% |
| Image (DALL-E 3) | ~$0.04 | 30 tokens = $0.30 | 87% |
| Video (Sora, per sec) | ~$0.50 | 20 tokens = $0.20 | -60% (loss leader) |

**Break-even analysis:**
- Free tier (500 tokens) costs you ~$0.50-1.00/user/month
- Pro tier ($20, 10K tokens) costs you ~$10-15/user/month → 25-50% margin
- Enterprise ($100, 100K tokens) costs you ~$50-70 → 30-50% margin

### Revenue Model

1. **Subscriptions** - Predictable monthly revenue
2. **Token top-ups** - High margin impulse purchases
3. **Usage overage** - Users who exceed free tier convert to paid

**Growth levers:**
- Referral bonus: Grant 500 tokens for referrals
- Promo codes: Easy to create campaigns
- Enterprise custom pricing: Negotiate bulk token rates

---

## Files to Modify Summary

### New Packages (Server Side)
- `packages/edge-proxy/` - Cloudflare Worker for LLM API proxying
- `packages/auth-server/` - Cloudflare Worker for auth + billing

### New Files (hosea Client)
- `apps/hosea/src/main/AuthService.ts` - Custom JWT auth client
- `apps/hosea/src/renderer/pages/LoginPage.tsx` - Login/signup UI
- `apps/hosea/src/renderer/pages/BillingPage.tsx` - Usage + upgrade UI
- `apps/hosea/src/renderer/contexts/AuthContext.tsx` - Auth state management

### Modified Files (hosea Client)
- `apps/hosea/src/main/AgentService.ts` - Support proxy connectors
- `apps/hosea/src/main/ipc-handlers.ts` - Add auth + billing handlers
- `apps/hosea/src/preload/index.ts` - Expose auth API to renderer
- `apps/hosea/src/renderer/App.tsx` - Add auth flow, protected routes
- `apps/hosea/src/renderer/components/SettingsModal.tsx` - Hybrid mode toggle

### Modified Files (Library)
- `packages/agents/src/core/Connector.ts` - Add `type: 'proxy'` support
- `packages/agents/src/core/createProvider.ts` - Handle proxy connectors
- `packages/agents/src/infrastructure/providers/proxy/ProxyTextProvider.ts` - New provider

---

## Verification Plan

1. **Edge Proxy Tests**
   - Deploy to Cloudflare Workers (staging)
   - Test all 4 vendors with curl: OpenAI, Anthropic, Google, Grok
   - Verify streaming works correctly (SSE parsing)
   - Load test with k6 (100 concurrent users)
   - Verify usage metering records correctly in D1

2. **Auth Server Tests**
   - Sign up flow (email/password)
   - Sign in flow
   - Token refresh (automatic and manual)
   - Stripe checkout flow (test mode)
   - Webhook handling (subscription events)

3. **hosea Client Tests**
   - Fresh install → sign up → chat works
   - Token storage in safeStorage (encrypted)
   - Auto token refresh when expired
   - Hybrid mode: switch between proxy and own keys
   - Billing page shows accurate usage

4. **End-to-End Tests**
   - New user: install → sign up → select plan → chat
   - Existing user migration: upgrade → sign in → keep old sessions
   - Budget exceeded: show upgrade prompt
   - Proxy down: fallback to own keys (if configured)

5. **Security Tests**
   - Invalid/expired JWT rejected at edge
   - Rate limiting enforced per user
   - No API keys leaked in error responses
   - Stripe webhook signature validation

---

## Decisions Made

- **Vendors**: OpenAI, Anthropic, Google, Grok (4 vendors from day one)
- **Billing**: Token-based economy with Stripe (subscriptions + token pack purchases)
- **Auth**: Custom JWT auth (roll your own, no Supabase/Auth0)
- **Fallback**: Hybrid mode - users can choose proxy OR their own keys
- **Pricing**: Free (500 tokens/mo), Pro ($20 → 10K), Enterprise ($100 → 100K) + buyable token packs
