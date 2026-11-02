/**
 * Test harness — creates a Hono app with miniflare D1/KV bindings
 */
import { env } from 'cloudflare:workers';
import app from '../src/index.js';
import schema from '../schema.sql?raw';

export { app, env };

/** Helper: make a request to the app */
export async function request(
  method: string,
  path: string,
  options: {
    body?: unknown;
    headers?: Record<string, string>;
    token?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  return app.request(path, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  }, env);
}

/** Helper: signup and return tokens */
export async function createTestUser(
  email = `test-${crypto.randomUUID().slice(0, 8)}@test.com`,
  password = 'testpassword123',
): Promise<{ userId: string; email: string; accessToken: string; refreshToken: string }> {
  const res = await request('POST', '/auth/signup', {
    body: { email, password },
  });
  const data = await res.json() as {
    user: { id: string; email: string };
    accessToken: string;
    refreshToken: string;
  };
  return {
    userId: data.user.id,
    email: data.user.email,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
  };
}

/** Helper: promote a user to admin or super_admin */
export async function promoteUser(
  userId: string,
  role: 'admin' | 'super_admin' = 'super_admin',
): Promise<void> {
  await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?')
    .bind(role, userId)
    .run();
}

/** Helper: run schema.sql on the test DB */
export async function migrateDB(): Promise<void> {
  const statements = schema.split(';').filter((statement) => statement.trim());
  for (const statement of statements) {
    await env.DB.prepare(statement).run();
  }
}
