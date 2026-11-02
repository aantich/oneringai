import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: {
      configPath: './wrangler.toml',
    },
    miniflare: {
      d1Databases: ['DB'],
      kvNamespaces: ['KV'],
      bindings: {
        JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
        ENCRYPTION_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        ENVIRONMENT: 'test',
      },
    },
  })],
});
