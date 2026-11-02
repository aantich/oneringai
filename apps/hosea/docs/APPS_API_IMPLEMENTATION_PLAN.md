# Implementation Plan: `apps/api/` - Generic Extensible API Proxy

## Overview

Create a **fully extensible** Cloudflare Worker that can proxy requests to ANY API service - not just LLM vendors. Users authenticate with JWT, and the proxy:
1. Routes requests to any configured service
2. Injects appropriate authentication (API keys, OAuth tokens, etc.)
3. Tracks usage with flexible metering (tokens, API calls, bytes, duration)
4. Deducts from user's token balance

**Key Principles**:
1. **REUSE existing library types** - `ConnectorAuth`, `VendorTemplate`, `SERVICE_DEFINITIONS`, `MODEL_REGISTRY`
2. **No duplication** - Don't recreate what exists in `oneringai`
3. **Configuration-driven** - New services via config, not code changes

---

## Reuse from `oneringai`

### Types to Import (not recreate)

```typescript
// From oneringai - DO NOT DUPLICATE
import {
  // Auth types
  ConnectorAuth,
  APIKeyConnectorAuth,
  OAuthConnectorAuth,
  JWTConnectorAuth,
  NoneConnectorAuth,
  ConnectorConfig,

  // Service definitions
  SERVICE_DEFINITIONS,
  ServiceDefinition,
  ServiceCategory,
  ServiceType,
  getServiceInfo,
  detectServiceFromURL,

  // Vendor templates
  VendorTemplate,
  AuthTemplate,
  AuthTemplateField,

  // Model registry & pricing
  MODEL_REGISTRY,
  ILLMDescription,
  LLM_MODELS,

  // Vendor enum
  Vendor,
} from 'oneringai';
```

### What the Library Already Provides

| Component | Location | What It Has |
|-----------|----------|-------------|
| `SERVICE_DEFINITIONS` | `src/domain/entities/Services.ts` | 35+ services with id, name, category, baseURL, urlPattern |
| `VendorTemplate` | `src/connectors/vendors/types.ts` | Full auth templates per vendor (api_key, oauth flows) |
| `AuthTemplate` | `src/connectors/vendors/types.ts` | Required/optional fields, scopes, OAuth URLs |
| `ConnectorAuth` | `src/domain/entities/Connector.ts` | api_key, oauth, jwt, none with all config options |
| `MODEL_REGISTRY` | `src/domain/entities/Model.ts` | Model pricing (cpm), context windows, features |

### What We Add (NOT duplicate)

| Component | Purpose | Location |
|-----------|---------|----------|
| `service_overrides` | Platform-specific overrides (metering type, pricing multiplier) | D1 table |
| `custom_services` | User-defined services (extends SERVICE_DEFINITIONS) | D1 table |
| `user_credentials` | User's API keys (encrypted) | D1 table |
| `platform_credentials` | Platform's API keys for managed services | KV store |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         GENERIC PROXY FLOW                               │
│                                                                          │
│  Client Request                                                          │
│       │                                                                  │
│       ▼                                                                  │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐    │
│  │  JWT Middleware │ ──► │ Service Router  │ ──► │  Auth Injector  │    │
│  │  (validate user)│     │ (lookup config) │     │ (add API key)   │    │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘    │
│                                 │                        │               │
│                                 ▼                        ▼               │
│                          ┌─────────────────┐     ┌─────────────────┐    │
│                          │ Service Registry│     │  Target API     │    │
│                          │ (D1 database)   │     │  (any service)  │    │
│                          └─────────────────┘     └─────────────────┘    │
│                                                          │               │
│                                                          ▼               │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐    │
│  │  Response       │ ◄── │ Usage Metering  │ ◄── │  Response       │    │
│  │  to Client      │     │ (tokens/calls)  │     │  from Target    │    │
│  └─────────────────┘     └─────────────────┘     └─────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Core Concepts

### Service Resolution (Layered Approach)

```
1. Check custom_services table (user-defined services)
2. Check service_overrides table (platform config for known services)
3. Fall back to SERVICE_DEFINITIONS from library (35+ built-in services)
4. For LLM models: use MODEL_REGISTRY for pricing
```

### Service Override (D1) - Extends Library Definitions

```typescript
// Only stores OVERRIDES, not full definitions
// Full service info comes from SERVICE_DEFINITIONS in library
interface ServiceOverride {
  serviceId: string;             // References SERVICE_DEFINITIONS.id

  // Metering config (not in library)
  meteringType: 'llm_tokens' | 'api_calls' | 'data_bytes' | 'duration_seconds';
  meteringConfig?: {
    usagePath?: string;          // JSON path for LLM token extraction
    inputPath?: string;
    outputPath?: string;
    callCost?: number;           // Tokens per API call
  };

  // Pricing override (library has vendor costs, we set our margin)
  pricingMultiplier?: number;    // Multiply library cost by this (default: 2.0)
  fixedCostPerCall?: number;     // Or fixed tokens per call

  // Platform settings
  enabled: boolean;
  platformKeyEnabled: boolean;   // Can users use platform's API key?

  updatedAt: string;
}
```

### Custom Service (D1) - For User-Defined Services

```typescript
// For services NOT in SERVICE_DEFINITIONS
// Mirrors ServiceDefinition structure from library
interface CustomService {
  id: string;                    // Must not conflict with SERVICE_DEFINITIONS
  userId: string;                // Owner (null = platform-wide)
  name: string;
  category: ServiceCategory;     // Reuse library enum

  // Routing (same as library)
  baseURL: string;
  pathPrefix?: string;

  // Auth template (reuse library types)
  authType: 'api_key' | 'oauth' | 'jwt' | 'none';
  authConfig: Partial<ConnectorAuth>;  // Reuse library type

  // Metering
  meteringType: 'llm_tokens' | 'api_calls' | 'data_bytes' | 'duration_seconds';
  meteringConfig?: object;

  // Pricing
  tokensPerUnit: number;

  createdAt: string;
  updatedAt: string;
}
```

### User Credentials (D1) - Reuses Library Auth Types

```typescript
interface UserCredential {
  id: string;
  userId: string;
  serviceId: string;             // SERVICE_DEFINITIONS.id or custom_services.id

  name: string;                  // User's label

  // Reuse library auth type directly
  authType: ConnectorAuth['type'];  // 'api_key' | 'oauth' | 'jwt' | 'none'
  encryptedCredential: string;      // Encrypted ConnectorAuth JSON

  // Optional overrides
  customBaseURL?: string;

  createdAt: string;
  lastUsedAt?: string;
}
```

### LLM Pricing (From Library MODEL_REGISTRY)

```typescript
// DON'T duplicate - use MODEL_REGISTRY from library
import { MODEL_REGISTRY, ILLMDescription } from 'oneringai';

function calculateLLMCost(model: string, inputTokens: number, outputTokens: number): number {
  const modelInfo = MODEL_REGISTRY[model];
  if (!modelInfo) return estimateUnknownModelCost(inputTokens, outputTokens);

  // Library stores cost per million tokens (cpm)
  const inputCost = (inputTokens / 1_000_000) * modelInfo.features.input.cpm;
  const outputCost = (outputTokens / 1_000_000) * modelInfo.features.output.cpm;
  const vendorCostUSD = inputCost + outputCost;

  // Convert to our tokens with margin (e.g., 2x markup)
  const override = getServiceOverride(modelInfo.provider);
  const multiplier = override?.pricingMultiplier || 2.0;

  // $0.01 vendor cost = 1 token at 2x margin
  return Math.ceil(vendorCostUSD * 100 * multiplier);
}
```

### Platform Credentials (KV)

```typescript
// Stored in PLATFORM_CREDENTIALS KV namespace
// Key: platform:{serviceId}
// Value: Encrypted ConnectorAuth JSON (reuses library type)

interface PlatformCredential {
  serviceId: string;
  auth: ConnectorAuth;           // Reuse library type
  rateLimit?: number;            // Requests per minute
  enabled: boolean;
}
```

---

## Directory Structure

```
apps/api/
├── package.json
├── tsconfig.json
├── wrangler.toml
├── schema.sql
├── seed-services.sql            # Initial service definitions
├── seed-admin.sql               # Initial super admin user
├── src/
│   ├── index.ts                 # Main Hono app
│   ├── types.ts                 # All type definitions
│   ├── env.ts                   # Cloudflare bindings
│   │
│   ├── routes/
│   │   ├── index.ts
│   │   ├── auth.ts              # /auth/* - signup, signin, refresh
│   │   ├── proxy.ts             # /proxy/* - generic proxy endpoint
│   │   ├── billing.ts           # /billing/* - balance, usage, checkout
│   │   ├── services.ts          # /services/* - list, configure services
│   │   ├── credentials.ts       # /credentials/* - manage user credentials
│   │   └── admin/               # /admin/* - admin routes
│   │       ├── index.ts         # Admin route registry
│   │       ├── users.ts         # User management
│   │       ├── subscriptions.ts # Plan/subscription management
│   │       ├── tokens.ts        # Token balance operations
│   │       ├── analytics.ts     # Usage analytics
│   │       ├── services.ts      # Service management
│   │       ├── credentials.ts   # Platform credentials
│   │       └── audit.ts         # Audit log viewing
│   │
│   ├── middleware/
│   │   ├── jwt.ts               # JWT validation
│   │   ├── rateLimit.ts         # Per-user rate limiting
│   │   ├── balanceCheck.ts      # Pre-request balance check
│   │   ├── adminAuth.ts         # Admin role verification
│   │   └── auditLog.ts          # Admin action logging
│   │
│   ├── services/
│   │   ├── auth.ts              # User authentication
│   │   ├── users.ts             # User CRUD operations
│   │   ├── tokens.ts            # Token balance management
│   │   ├── metering.ts          # Usage metering (generic)
│   │   ├── analytics.ts         # Analytics aggregation
│   │   ├── stripe.ts            # Stripe integration
│   │   ├── crypto.ts            # Credential encryption
│   │   └── serviceRegistry.ts   # Service definition management
│   │
│   ├── proxy/
│   │   ├── router.ts            # Generic request routing
│   │   ├── authInjector.ts      # Inject auth into requests
│   │   ├── usageExtractor.ts    # Extract usage from responses
│   │   └── streamHandler.ts     # Handle streaming responses
│   │
│   └── db/
│       ├── schema.ts            # Type-safe D1 queries
│       └── migrations/          # Schema migrations
│
└── test/
    ├── proxy.test.ts
    ├── metering.test.ts
    ├── admin.test.ts            # Admin API tests
    └── fixtures/
```

---

## Database Schema

```sql
-- ============================================================
-- USERS & AUTH
-- ============================================================

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  stripe_customer_id TEXT,
  role TEXT DEFAULT 'user',      -- 'user', 'admin', 'super_admin'
  status TEXT DEFAULT 'active',  -- 'active', 'suspended', 'deleted'
  last_active_at DATETIME,
  created_by TEXT,               -- Admin who created (if applicable)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  token_hash TEXT UNIQUE NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- BILLING & TOKENS
-- ============================================================

CREATE TABLE token_balances (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  current_balance INTEGER DEFAULT 0,
  lifetime_purchased INTEGER DEFAULT 0,
  lifetime_granted INTEGER DEFAULT 0,
  lifetime_used INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT UNIQUE REFERENCES users(id),
  stripe_subscription_id TEXT,
  plan TEXT DEFAULT 'free',
  monthly_token_grant INTEGER DEFAULT 500,
  billing_cycle_start DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE token_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  type TEXT NOT NULL,             -- 'grant', 'purchase', 'usage', 'refund', 'adjustment'
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  service_id TEXT,                -- For usage transactions
  credential_id TEXT,
  description TEXT,
  metadata TEXT,                  -- JSON
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- SERVICES (Extends library SERVICE_DEFINITIONS)
-- ============================================================

-- Platform overrides for library services (metering, pricing)
-- NOT full service definitions - those come from SERVICE_DEFINITIONS
CREATE TABLE service_overrides (
  service_id TEXT PRIMARY KEY,    -- Must exist in SERVICE_DEFINITIONS

  -- Metering (not in library)
  metering_type TEXT NOT NULL DEFAULT 'api_calls',
  metering_config TEXT,           -- JSON: { usagePath, callCost, etc. }

  -- Pricing (library has vendor cost, we add margin)
  pricing_multiplier REAL DEFAULT 2.0,
  fixed_cost_per_call INTEGER,    -- Alternative to multiplier

  -- Platform settings
  enabled INTEGER DEFAULT 1,
  platform_key_enabled INTEGER DEFAULT 0,

  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Custom services (NOT in library SERVICE_DEFINITIONS)
CREATE TABLE custom_services (
  id TEXT PRIMARY KEY,
  user_id TEXT,                   -- NULL = platform-wide, else user-owned
  name TEXT NOT NULL,
  category TEXT NOT NULL,         -- ServiceCategory from library

  -- Routing
  base_url TEXT NOT NULL,
  path_prefix TEXT,

  -- Auth (reuses library ConnectorAuth type)
  auth_type TEXT NOT NULL,        -- 'api_key', 'oauth', 'jwt', 'none'
  auth_config TEXT NOT NULL,      -- JSON: Partial<ConnectorAuth>

  -- Metering
  metering_type TEXT NOT NULL DEFAULT 'api_calls',
  metering_config TEXT,

  -- Pricing
  tokens_per_unit INTEGER DEFAULT 1,

  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(user_id, id)             -- User can't duplicate IDs
);

-- ============================================================
-- CREDENTIALS
-- ============================================================

-- User's API keys/tokens for services
CREATE TABLE user_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  service_id TEXT NOT NULL,       -- SERVICE_DEFINITIONS.id or custom_services.id

  name TEXT NOT NULL,             -- User's label
  auth_type TEXT NOT NULL,        -- 'api_key', 'oauth', 'jwt'
  encrypted_credential TEXT NOT NULL,  -- Encrypted ConnectorAuth JSON

  custom_base_url TEXT,           -- Optional override

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME,

  UNIQUE(user_id, service_id, name)
);

-- ============================================================
-- USAGE TRACKING
-- ============================================================

CREATE TABLE usage_log (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  transaction_id TEXT REFERENCES token_transactions(id),

  service_id TEXT NOT NULL,
  credential_id TEXT,
  is_platform_key INTEGER DEFAULT 0,

  -- Request
  method TEXT,
  path TEXT,
  model TEXT,                     -- For LLM requests

  -- Metering
  metering_type TEXT NOT NULL,
  raw_usage TEXT,                 -- JSON: { inputTokens, outputTokens } or { calls: 1 }
  tokens_charged INTEGER NOT NULL,

  -- Response
  status_code INTEGER,
  response_time_ms INTEGER,

  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ADMIN
-- ============================================================

CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,           -- 'user.create', 'balance.grant', etc.
  target_type TEXT,               -- 'user', 'service', 'credential'
  target_id TEXT,
  details TEXT,                   -- JSON
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE custom_pricing (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  pricing_config TEXT NOT NULL,   -- JSON: { byService: { openai: 1.5 }, discount: 10 }
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_credentials_user ON user_credentials(user_id);
CREATE INDEX idx_credentials_service ON user_credentials(service_id);
CREATE INDEX idx_transactions_user ON token_transactions(user_id, created_at);
CREATE INDEX idx_usage_user ON usage_log(user_id, created_at);
CREATE INDEX idx_usage_service ON usage_log(service_id, created_at);
CREATE INDEX idx_audit_admin ON admin_audit_log(admin_id, created_at);
```

---

## API Routes

### Proxy Routes (the core feature)

```
POST /proxy/{serviceId}/*
GET  /proxy/{serviceId}/*
PUT  /proxy/{serviceId}/*
DELETE /proxy/{serviceId}/*

Headers:
  Authorization: Bearer {userJWT}
  X-Credential-Id: {credentialId}     # Optional: which credential to use
  X-Use-Platform-Key: true            # Optional: use platform's API key

Flow:
1. Validate JWT → get userId
2. Lookup serviceId in service_definitions
3. Determine credential source:
   - If X-Use-Platform-Key: use platform credential from KV
   - If X-Credential-Id: use specified user credential
   - Else: use user's default credential for this service
4. Check user balance (estimate cost)
5. Build target request:
   - URL: service.baseUrl + remaining path
   - Inject auth based on service.authConfig
   - Forward headers (filtered)
   - Forward body
6. Execute request to target
7. Stream response back to user
8. Extract usage based on service.meteringConfig
9. Deduct tokens from balance
10. Log usage
```

### Service Management Routes

```
GET  /services                        # List all available services
GET  /services/{serviceId}            # Get service details
POST /services                        # Create custom service (user-defined)
PUT  /services/{serviceId}            # Update custom service
DELETE /services/{serviceId}          # Delete custom service

# Admin only
POST /admin/services                  # Create system service
PUT  /admin/services/{serviceId}      # Update system service
```

### Credential Management Routes

```
GET  /credentials                     # List user's credentials
GET  /credentials/{credentialId}      # Get credential (without secret)
POST /credentials                     # Add new credential
PUT  /credentials/{credentialId}      # Update credential
DELETE /credentials/{credentialId}    # Delete credential

Body for POST/PUT:
{
  "serviceId": "github",
  "name": "my-github-token",
  "credentialType": "api_key",
  "credential": "ghp_xxxx..."         # Will be encrypted
}
```

### Auth Routes (same as before)

```
POST /auth/signup
POST /auth/signin
POST /auth/refresh
POST /auth/logout
```

### Billing Routes (same as before)

```
GET  /billing/balance
GET  /billing/usage
GET  /billing/usage/by-service        # Usage breakdown by service
GET  /billing/transactions
POST /billing/checkout/subscription
POST /billing/checkout/tokens
POST /billing/webhook
```

---

## Admin System

### Admin Roles

```typescript
type UserRole = 'user' | 'admin' | 'super_admin';

// Permissions:
// user        - Regular user, can only access their own data
// admin       - Can view all users, manage users, grant tokens
// super_admin - Full access including creating admins, system config
```

### Admin Routes (`/admin/*`)

All admin routes require `role: 'admin'` or `role: 'super_admin'` in JWT.

#### User Management

```
GET    /admin/users                    # List all users (paginated, searchable)
GET    /admin/users/{userId}           # Get user details
POST   /admin/users                    # Create new user (with plan)
PUT    /admin/users/{userId}           # Update user (email, role, status)
DELETE /admin/users/{userId}           # Soft delete user (disable account)

Query params for GET /admin/users:
  ?page=1&limit=50                     # Pagination
  ?search=email@example.com            # Search by email
  ?role=admin                          # Filter by role
  ?plan=pro                            # Filter by plan
  ?sortBy=created_at&order=desc        # Sorting
```

#### Plan & Subscription Management

```
GET    /admin/users/{userId}/subscription    # Get user's subscription
PUT    /admin/users/{userId}/subscription    # Update user's plan
POST   /admin/users/{userId}/subscription/cancel  # Cancel subscription

PUT body:
{
  "plan": "pro",                       # free, pro, enterprise, custom
  "monthlyTokenGrant": 10000,          # Override default grant
  "customPricing": true                # Enable custom pricing
}
```

#### Token Balance Management

```
GET    /admin/users/{userId}/balance        # Get balance details
POST   /admin/users/{userId}/balance/grant  # Grant tokens (bonus, promo)
POST   /admin/users/{userId}/balance/adjust # Adjust balance (refund, correction)

POST /grant body:
{
  "amount": 5000,
  "reason": "promotional_credit",
  "description": "Welcome bonus for early adopter"
}

POST /adjust body:
{
  "amount": -500,                      # Positive = add, negative = subtract
  "reason": "refund",
  "description": "Refund for service outage"
}
```

#### Usage Analytics

```
GET    /admin/users/{userId}/usage          # User's usage history
GET    /admin/users/{userId}/transactions   # User's transaction history

GET    /admin/analytics/overview            # Platform-wide stats
GET    /admin/analytics/usage               # Aggregated usage stats
GET    /admin/analytics/revenue             # Revenue metrics

Query params for analytics:
  ?period=day|week|month|year
  ?startDate=2026-01-01
  ?endDate=2026-02-01
  ?groupBy=service|user|plan
```

#### Service Management

```
GET    /admin/services                      # List all services (including disabled)
POST   /admin/services                      # Create system service
PUT    /admin/services/{serviceId}          # Update service config
DELETE /admin/services/{serviceId}          # Disable/delete service

POST   /admin/services/{serviceId}/credentials  # Set platform API key for service
```

#### Platform Credentials (API Keys)

```
GET    /admin/platform-credentials                  # List platform credentials
PUT    /admin/platform-credentials/{serviceId}      # Set/update platform API key
DELETE /admin/platform-credentials/{serviceId}      # Remove platform API key

PUT body:
{
  "apiKey": "sk-xxx...",
  "rateLimit": 10000,              # Requests per minute
  "enabled": true
}
```

#### Audit Log

```
GET    /admin/audit-log                     # View admin actions log

Query params:
  ?adminId=xxx                         # Filter by admin who performed action
  ?action=user.create|balance.grant    # Filter by action type
  ?targetUserId=xxx                    # Filter by affected user
```

### Admin Dashboard Data Types

```typescript
// GET /admin/analytics/overview response
interface PlatformOverview {
  users: {
    total: number;
    activeThisMonth: number;
    newThisMonth: number;
    byPlan: Record<string, number>;    // { free: 1000, pro: 200, enterprise: 10 }
  };
  tokens: {
    totalGranted: number;
    totalPurchased: number;
    totalUsed: number;
    revenueThisMonth: number;          // USD from token purchases
  };
  usage: {
    requestsThisMonth: number;
    tokensBurnedThisMonth: number;
    byService: Record<string, number>; // { openai: 50000, github: 2000 }
  };
}

// GET /admin/analytics/usage response
interface UsageAnalytics {
  period: string;
  data: Array<{
    date: string;
    requests: number;
    tokensUsed: number;
    uniqueUsers: number;
    byService: Record<string, number>;
  }>;
}

// GET /admin/users response
interface UserListItem {
  id: string;
  email: string;
  role: UserRole;
  plan: string;
  balance: number;
  lifetimeUsed: number;
  createdAt: string;
  lastActiveAt: string;
  status: 'active' | 'suspended' | 'deleted';
}
```

### Database Schema Additions for Admin

```sql
-- Add to users table
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user';
ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active';
ALTER TABLE users ADD COLUMN last_active_at DATETIME;
ALTER TABLE users ADD COLUMN created_by TEXT;  -- Admin who created this user

-- Admin audit log
CREATE TABLE admin_audit_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,                -- 'user.create', 'balance.grant', etc.
  target_type TEXT,                    -- 'user', 'service', 'credential'
  target_id TEXT,
  details TEXT,                        -- JSON with action details
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_admin ON admin_audit_log(admin_id, created_at);
CREATE INDEX idx_audit_target ON admin_audit_log(target_type, target_id);

-- Custom pricing for enterprise users
CREATE TABLE custom_pricing (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  pricing_config TEXT NOT NULL,        -- JSON: { byService: { openai: 1.5, ... } }
  discount_percent INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Admin Middleware

```typescript
// src/middleware/adminAuth.ts

export const requireAdmin = async (c: Context, next: Next) => {
  const payload = c.get('jwtPayload');

  if (!payload?.role || !['admin', 'super_admin'].includes(payload.role)) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  c.set('adminRole', payload.role);
  await next();
};

export const requireSuperAdmin = async (c: Context, next: Next) => {
  const payload = c.get('jwtPayload');

  if (payload?.role !== 'super_admin') {
    return c.json({ error: 'Super admin access required' }, 403);
  }

  await next();
};

// Audit logging middleware
export const auditLog = (action: string) => {
  return async (c: Context, next: Next) => {
    await next();

    // Log after successful action
    if (c.res.status < 400) {
      const adminId = c.get('jwtPayload').sub;
      await c.env.DB.prepare(`
        INSERT INTO admin_audit_log (id, admin_id, action, target_type, target_id, details, ip_address)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        adminId,
        action,
        c.get('auditTargetType'),
        c.get('auditTargetId'),
        JSON.stringify(c.get('auditDetails')),
        c.req.header('CF-Connecting-IP')
      ).run();
    }
  };
};
```

### Initial Super Admin Setup

```typescript
// First super admin created via CLI or environment variable
// wrangler.toml:
// [vars]
// INITIAL_ADMIN_EMAIL = "admin@oneringai.com"

// On first request, check if any admin exists
// If not, create one with INITIAL_ADMIN_EMAIL
// Password sent via email or set via secure link

// Alternative: CLI command
// wrangler d1 execute oneringai --command "INSERT INTO users (id, email, password_hash, role) VALUES ('admin-001', 'admin@oneringai.com', 'hashed_password', 'super_admin')"
```

### Admin Web Interface (Future)

The admin API is designed to support a web-based admin dashboard:

```
apps/admin-dashboard/              # Separate React/Next.js app
├── package.json
├── src/
│   ├── pages/
│   │   ├── dashboard.tsx          # Overview stats
│   │   ├── users/
│   │   │   ├── index.tsx          # User list
│   │   │   └── [id].tsx           # User detail
│   │   ├── services/
│   │   │   └── index.tsx          # Service management
│   │   └── analytics/
│   │       └── index.tsx          # Usage analytics
│   └── components/
│       ├── UserTable.tsx
│       ├── UsageChart.tsx
│       └── TokenGrantModal.tsx
```

**Note**: Admin dashboard is a separate phase. The API routes come first.

---

## Seed Data (Overrides Only)

Service definitions come from library `SERVICE_DEFINITIONS`. We only seed **overrides** for metering and pricing.

```sql
-- seed-overrides.sql
-- Only adds metering/pricing config - service info comes from library

-- LLM Services (metering: llm_tokens, pricing from MODEL_REGISTRY)
INSERT INTO service_overrides (service_id, metering_type, metering_config, pricing_multiplier, platform_key_enabled) VALUES
('openai', 'llm_tokens',
  '{"usagePath":"usage.total_tokens","inputPath":"usage.prompt_tokens","outputPath":"usage.completion_tokens"}',
  2.0, 1),
('anthropic', 'llm_tokens',
  '{"usagePath":"usage.input_tokens+usage.output_tokens","inputPath":"usage.input_tokens","outputPath":"usage.output_tokens"}',
  2.0, 1),
('google', 'llm_tokens',
  '{"usagePath":"usageMetadata.totalTokenCount"}',
  2.0, 1),
('grok', 'llm_tokens',
  '{"usagePath":"usage.total_tokens"}',
  2.0, 1);

-- API Services (metering: api_calls, fixed cost per call)
INSERT INTO service_overrides (service_id, metering_type, fixed_cost_per_call, platform_key_enabled) VALUES
('serper', 'api_calls', 1, 1),
('brave-search', 'api_calls', 1, 1),
('tavily', 'api_calls', 1, 1),
('zenrows', 'api_calls', 2, 1),
('github', 'api_calls', 1, 0),   -- No platform key for GitHub
('slack', 'api_calls', 1, 0),
('notion', 'api_calls', 1, 0);

-- Note: Services not in this table use defaults:
-- - metering_type: 'api_calls'
-- - fixed_cost_per_call: 1
-- - platform_key_enabled: 0
```

### Service Resolution Logic

```typescript
// src/services/serviceRegistry.ts
import { SERVICE_DEFINITIONS, getServiceInfo } from 'oneringai';

export async function resolveService(serviceId: string, db: D1Database): Promise<ResolvedService> {
  // 1. Check custom_services (user-defined)
  const custom = await db.prepare(
    'SELECT * FROM custom_services WHERE id = ? AND enabled = 1'
  ).bind(serviceId).first();
  if (custom) return parseCustomService(custom);

  // 2. Check library SERVICE_DEFINITIONS
  const libraryService = getServiceInfo(serviceId);
  if (!libraryService) {
    throw new Error(`Unknown service: ${serviceId}`);
  }

  // 3. Get platform overrides (metering, pricing)
  const override = await db.prepare(
    'SELECT * FROM service_overrides WHERE service_id = ?'
  ).bind(serviceId).first();

  return {
    ...libraryService,              // id, name, category, baseURL from library
    metering: override ? parseMeteringConfig(override) : DEFAULT_METERING,
    pricing: override ? parsePricingConfig(override) : DEFAULT_PRICING,
    platformKeyEnabled: override?.platform_key_enabled ?? false,
  };
}
```

---

## Metering Implementation (Uses Library MODEL_REGISTRY)

```typescript
// src/services/metering.ts
import { MODEL_REGISTRY, ILLMDescription } from 'oneringai';

interface UsageResult {
  rawUsage: Record<string, number>;
  tokensCharged: number;
}

export async function extractUsage(
  service: ResolvedService,
  responseBody: string | null,
  responseTimeMs: number
): Promise<UsageResult> {
  switch (service.metering.type) {
    case 'llm_tokens':
      return extractLLMTokenUsage(service, responseBody);

    case 'api_calls':
      return {
        rawUsage: { calls: 1 },
        tokensCharged: service.pricing.fixedCostPerCall || 1,
      };

    case 'data_bytes':
      const bytes = responseBody?.length || 0;
      return {
        rawUsage: { bytes },
        tokensCharged: Math.ceil(bytes / (service.metering.bytesPerToken || 1000)),
      };

    case 'duration_seconds':
      const seconds = responseTimeMs / 1000;
      return {
        rawUsage: { durationMs: responseTimeMs },
        tokensCharged: Math.ceil(seconds * (service.pricing.tokensPerSecond || 1)),
      };

    default:
      return { rawUsage: { calls: 1 }, tokensCharged: 1 };
  }
}

/**
 * Extract LLM token usage using MODEL_REGISTRY for pricing
 */
function extractLLMTokenUsage(
  service: ResolvedService,
  responseBody: string | null
): UsageResult {
  if (!responseBody) return { rawUsage: {}, tokensCharged: 0 };

  try {
    const data = JSON.parse(responseBody);
    const config = service.metering;

    // Extract token counts using JSON paths from config
    const inputTokens = getJsonPath(data, config.inputPath) || 0;
    const outputTokens = getJsonPath(data, config.outputPath) || 0;
    const model = data.model || 'unknown';

    // === KEY: Use library MODEL_REGISTRY for pricing ===
    const modelInfo = MODEL_REGISTRY[model] as ILLMDescription | undefined;

    let vendorCostUSD: number;
    if (modelInfo) {
      // Use actual vendor pricing from library (cost per million tokens)
      const inputCostPerM = modelInfo.features.input.cpm;
      const outputCostPerM = modelInfo.features.output.cpm;
      vendorCostUSD = (inputTokens * inputCostPerM + outputTokens * outputCostPerM) / 1_000_000;
    } else {
      // Fallback for unknown models: estimate $0.002 per 1K tokens
      vendorCostUSD = ((inputTokens + outputTokens) / 1000) * 0.002;
    }

    // Apply platform margin (e.g., 2x = 100% markup)
    const multiplier = service.pricing.multiplier || 2.0;

    // Convert to platform tokens: $0.01 = 1 token at 1x, 2 tokens at 2x
    const tokensCharged = Math.ceil(vendorCostUSD * 100 * multiplier);

    return {
      rawUsage: { inputTokens, outputTokens, model, vendorCostUSD },
      tokensCharged: Math.max(1, tokensCharged), // Minimum 1 token
    };
  } catch {
    return { rawUsage: {}, tokensCharged: 1 };
  }
}

/**
 * Get value from nested JSON using dot notation path
 */
function getJsonPath(obj: any, path?: string): number | undefined {
  if (!path) return undefined;

  // Handle addition expressions like "usage.input_tokens+usage.output_tokens"
  if (path.includes('+')) {
    return path.split('+').reduce((sum, p) => sum + (getJsonPath(obj, p.trim()) || 0), 0);
  }

  return path.split('.').reduce((o, k) => o?.[k], obj);
}
```

---

## Streaming Support

For LLM streaming responses, we need special handling:

```typescript
// src/proxy/streamHandler.ts

export async function handleStreamingProxy(
  request: Request,
  targetUrl: string,
  headers: Headers,
  service: ServiceDefinition,
  ctx: ExecutionContext
): Promise<Response> {
  const targetResponse = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.body,
  });

  if (!targetResponse.body) {
    return targetResponse;
  }

  // For SSE streams, we need to:
  // 1. Pass through the stream to the client
  // 2. Accumulate data to extract final usage

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = targetResponse.body.getReader();

  let accumulatedData = '';
  let finalUsage: UsageResult | null = null;

  // Process stream in background
  ctx.waitUntil((async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          await writer.close();
          break;
        }

        // Pass through to client
        await writer.write(value);

        // Accumulate for usage extraction
        const text = new TextDecoder().decode(value);
        accumulatedData += text;

        // Check for usage in final chunk (OpenAI pattern)
        if (text.includes('"usage"') || text.includes('[DONE]')) {
          finalUsage = extractUsageFromSSE(accumulatedData, service);
        }
      }

      // Record usage after stream completes
      if (finalUsage) {
        await recordUsage(userId, service, finalUsage);
      }
    } catch (error) {
      await writer.abort(error);
    }
  })());

  return new Response(readable, {
    status: targetResponse.status,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
```

---

## hosea Integration (Reuses Library Patterns)

### Key Files to Modify/Create

| File | Changes |
|------|---------|
| `apps/hosea/src/main/AuthService.ts` | NEW - JWT auth, token storage via safeStorage |
| `apps/hosea/src/main/AgentService.ts` | Add proxy connector support |
| `apps/hosea/src/main/index.ts` | Add auth/billing IPC handlers |
| `apps/hosea/src/preload/index.ts` | Expose auth/billing APIs |

### AuthService (Reuses Library Patterns)

```typescript
// apps/hosea/src/main/AuthService.ts
import { safeStorage } from 'electron';
import type { ConnectorAuth, APIKeyConnectorAuth } from 'oneringai';

const API_BASE = 'https://api.oneringai.com';

export class AuthService {
  private dataDir: string;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  // Creates a ConnectorAuth object for use with library Connector
  getProxyAuth(): APIKeyConnectorAuth {
    return {
      type: 'api_key',
      apiKey: this.accessToken || '',
      headerName: 'Authorization',
      headerPrefix: 'Bearer ',
    };
  }

  async signIn(email: string, password: string): Promise<AuthUser> { /* ... */ }
  async signUp(email: string, password: string): Promise<AuthUser> { /* ... */ }
  async getAccessToken(): Promise<string | null> { /* auto-refresh */ }
  async getBalance(): Promise<BalanceInfo> { /* ... */ }

  // Store encrypted using Electron safeStorage
  private async storeTokens(access: string, refresh: string): Promise<void> {
    const data = JSON.stringify({ accessToken: access, refreshToken: refresh });
    const encrypted = safeStorage.encryptString(data);
    await writeFile(join(this.dataDir, 'auth.enc'), encrypted);
  }
}
```

### AgentService Updates (Reuses Connector Pattern)

```typescript
// apps/hosea/src/main/AgentService.ts
import { Connector, Vendor, SERVICE_DEFINITIONS, getServiceInfo } from 'oneringai';

export class AgentService {
  private authService: AuthService | null = null;

  setAuthService(authService: AuthService): void {
    this.authService = authService;
  }

  /**
   * Create proxy connector for ANY service (reuses library Connector.create)
   */
  async createProxyConnector(
    serviceId: string,
    options?: { credentialId?: string; usePlatformKey?: boolean }
  ): Promise<void> {
    if (!this.authService?.isAuthenticated()) {
      throw new Error('Not authenticated');
    }

    // Get service info from library (not duplicate!)
    const serviceInfo = getServiceInfo(serviceId);
    if (!serviceInfo) {
      throw new Error(`Unknown service: ${serviceId}`);
    }

    const name = `${serviceId}-proxy`;
    const proxyBaseURL = `https://api.oneringai.com/proxy/${serviceId}`;

    // Use library Connector.create with proxy auth
    Connector.create({
      name,
      vendor: Vendor.Custom,
      serviceType: serviceId,
      baseURL: proxyBaseURL,
      displayName: `${serviceInfo.name} (via OneRing)`,

      // Reuse library auth type
      auth: this.authService.getProxyAuth(),

      // Vendor-specific options for credential routing
      options: {
        ...(options?.usePlatformKey && { usePlatformKey: true }),
        ...(options?.credentialId && { credentialId: options.credentialId }),
      },
    });
  }

  /**
   * Get available services (combines library + custom)
   */
  async getAvailableServices(): Promise<ServiceInfo[]> {
    // Library services
    const libraryServices = SERVICE_DEFINITIONS.map(s => ({
      id: s.id,
      name: s.name,
      category: s.category,
      source: 'library' as const,
    }));

    // Custom services from API (if authenticated)
    if (this.authService?.isAuthenticated()) {
      const token = await this.authService.getAccessToken();
      const response = await fetch('https://api.oneringai.com/services', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const { services } = await response.json();
      return [...libraryServices, ...services.map(s => ({ ...s, source: 'custom' }))];
    }

    return libraryServices;
  }
}
```

### IPC Handlers (Follows Existing Patterns)

```typescript
// apps/hosea/src/main/index.ts - new handlers

// Auth handlers (follow existing connector pattern)
ipcMain.handle('auth:signin', safeHandler(async (_e, email: string, password: string) => {
  return authService.signIn(email, password);
}));

ipcMain.handle('auth:signup', safeHandler(async (_e, email: string, password: string) => {
  return authService.signUp(email, password);
}));

ipcMain.handle('auth:signout', safeHandler(async () => {
  return authService.signOut();
}));

ipcMain.handle('auth:status', safeHandler(async () => {
  return {
    authenticated: authService.isAuthenticated(),
    ...(authService.isAuthenticated() && { balance: await authService.getBalance() }),
  };
}));

// Billing handlers
ipcMain.handle('billing:balance', safeHandler(async () => {
  return authService.getBalance();
}));

ipcMain.handle('billing:checkout', safeHandler(async (_e, type: string, params: unknown) => {
  return authService.createCheckout(type, params);
}));

// Proxy connector handlers
ipcMain.handle('proxy:create-connector', safeHandler(async (_e, serviceId: string, opts?: object) => {
  return agentService.createProxyConnector(serviceId, opts);
}));

ipcMain.handle('proxy:list-services', safeHandler(async () => {
  return agentService.getAvailableServices();
}));
```

---

## Implementation Phases

### Phase 1: Core Infrastructure
1. Project setup (package.json, wrangler.toml, tsconfig)
2. Database schema + migrations
3. Auth routes (signup, signin, refresh)
4. JWT middleware with role support
5. Basic service registry (CRUD for service_definitions)

### Phase 2: Generic Proxy
6. Generic proxy router
7. Auth injection (bearer, header, query, basic)
8. Credential management (user credentials CRUD)
9. Platform credential support (KV storage)

### Phase 3: Metering
10. Usage extraction (LLM tokens, API calls, bytes, duration)
11. Balance checking middleware
12. Token deduction + transaction logging
13. Streaming support with usage tracking

### Phase 4: Billing
14. Stripe integration
15. Subscription management
16. Token purchases
17. Usage analytics endpoints (user-facing)

### Phase 5: Admin System
18. Admin authentication middleware
19. User management routes (list, create, update, delete)
20. Plan/subscription management routes
21. Token balance operations (grant, adjust)
22. Admin analytics routes (overview, usage, revenue)
23. Service management routes (system services)
24. Platform credentials management
25. Audit log system

### Phase 6: Seed Data + Testing
26. Seed initial service definitions (LLM vendors, search, etc.)
27. Seed initial super admin user
28. Integration tests (including admin flows)
29. Load testing

### Phase 7: hosea Integration
30. AuthService in the app
31. Generic proxy connector support
32. Credential management UI
33. Service browser UI

### Phase 8: Admin Dashboard (Future)
34. Separate admin web app (React/Next.js)
35. Dashboard overview page
36. User management UI
37. Analytics visualizations
38. Service configuration UI

---

## Verification Plan

### API Tests
```bash
# Create credential
curl -X POST https://api.oneringai.com/credentials \
  -H "Authorization: Bearer $JWT" \
  -d '{"serviceId":"github","name":"my-github","credential":"ghp_xxx"}'

# Proxy request to GitHub
curl https://api.oneringai.com/proxy/github/user \
  -H "Authorization: Bearer $JWT"

# Proxy request to OpenAI (with platform key)
curl https://api.oneringai.com/proxy/openai/chat/completions \
  -H "Authorization: Bearer $JWT" \
  -H "X-Use-Platform-Key: true" \
  -d '{"model":"gpt-4","messages":[...]}'

# Check usage by service
curl https://api.oneringai.com/billing/usage/by-service \
  -H "Authorization: Bearer $JWT"
```

### Metering Tests
- LLM request → verify token count extracted from response
- GitHub API call → verify 1 call counted
- Large response → verify bytes metered correctly
- Streaming response → verify final usage extracted

### End-to-End (User)
1. Sign up → Get 500 free tokens
2. Add GitHub credential → Make API calls → See tokens deducted
3. Use platform OpenAI key → Chat → See token usage
4. Run out of tokens → Get 402 error → Purchase more

### Admin Tests
```bash
# List users (as admin)
curl https://api.oneringai.com/admin/users \
  -H "Authorization: Bearer $ADMIN_JWT"

# Create new user with pro plan
curl -X POST https://api.oneringai.com/admin/users \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"email":"new@user.com","plan":"pro","password":"temp123"}'

# Grant bonus tokens
curl -X POST https://api.oneringai.com/admin/users/{userId}/balance/grant \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"amount":1000,"reason":"promo","description":"Welcome bonus"}'

# View platform analytics
curl https://api.oneringai.com/admin/analytics/overview \
  -H "Authorization: Bearer $ADMIN_JWT"

# Update user plan
curl -X PUT https://api.oneringai.com/admin/users/{userId}/subscription \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -d '{"plan":"enterprise","monthlyTokenGrant":50000}'

# View audit log
curl https://api.oneringai.com/admin/audit-log?action=balance.grant \
  -H "Authorization: Bearer $ADMIN_JWT"
```

### Admin End-to-End
1. Login as super_admin → View dashboard overview
2. Create new user → Assign pro plan → Verify token grant
3. Grant bonus tokens → Verify reflected in user balance
4. View user's usage history → Export to CSV
5. Update service pricing → Verify new requests use updated pricing
6. View audit log → Verify all admin actions logged

---

## Summary: Reuse vs New

### Reused from `oneringai` Library

| Component | Location | Used For |
|-----------|----------|----------|
| `SERVICE_DEFINITIONS` | `src/domain/entities/Services.ts` | Service routing (baseURL, name, category) |
| `VendorTemplate` | `src/connectors/vendors/types.ts` | Auth templates for services |
| `ConnectorAuth` | `src/domain/entities/Connector.ts` | Auth type definitions |
| `MODEL_REGISTRY` | `src/domain/entities/Model.ts` | LLM pricing (cpm) |
| `Connector.create()` | `src/core/Connector.ts` | Creating proxy connectors in the app |
| `Vendor` enum | `src/core/Vendor.ts` | Vendor identification |
| `ServiceCategory` | `src/domain/entities/Services.ts` | Category enum |

### Reused from hosea App

| Pattern | Location | Used For |
|---------|----------|----------|
| `safeHandler` wrapper | `apps/hosea/src/main/index.ts` | IPC error handling |
| IPC handler structure | `apps/hosea/src/main/index.ts` | New auth/billing handlers |
| File storage pattern | `apps/hosea/src/main/AgentService.ts` | Token storage location |
| HoseaAPI namespace | `apps/hosea/src/preload/index.ts` | Exposing auth/billing APIs |

### New (apps/api/)

| Component | Purpose |
|-----------|---------|
| `service_overrides` table | Metering config + pricing for library services |
| `custom_services` table | User-defined services |
| `user_credentials` table | Encrypted user API keys |
| Metering system | Usage extraction + token calculation |
| Admin routes | User/plan/token management |
| Stripe integration | Subscriptions + token purchases |

### NOT Created (Avoided Duplication)

| What | Why Not |
|------|---------|
| Service definitions table | Use `SERVICE_DEFINITIONS` from library |
| Model pricing table | Use `MODEL_REGISTRY` from library |
| Auth type definitions | Use `ConnectorAuth` from library |
| Vendor templates | Use `VendorTemplate` from library |
| Custom connector class | Use `Connector.create()` from library |
