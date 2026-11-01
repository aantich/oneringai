import { describe, expect, it, vi } from 'vitest';
import { rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CodexSdkDriver } from '@/agent-runtime/codex.js';
import { ClaudeAgentSdkDriver } from '@/agent-runtime/claude.js';
import { createNativeStateDirectory } from '@/agent-runtime/NativeStateDirectory.js';
import type { DriverOpenSessionRequest } from '@/agent-runtime/AgentDriver.js';

describe('native checkpoint completeness boundary', () => {
  it.each(['codex', 'claude'] as const)('refuses %s history restore without a verifier, before loading/executing native code', async vendor => {
    const loadSdk = vi.fn(async () => { throw new Error('Native code must not run'); });
    const driver = vendor === 'codex' ? new CodexSdkDriver({ loadSdk }) : new ClaudeAgentSdkDriver({ loadSdk });
    const checkpoint = vendor === 'codex' ? { kind: 'codex-sdk-v1', home: '/missing', threadId: 'native' } : { kind: 'claude-sdk-v1', home: '/missing', nativeSessionId: 'native' };
    await expect(driver.restoreSession({ checkpoint } as DriverOpenSessionRequest & { checkpoint: typeof checkpoint })).rejects.toThrow('verifyNativeCheckpoint'); expect(loadSdk).not.toHaveBeenCalled();
  });
  it.each(['codex', 'claude'] as const)('requires complete %s state beyond an authentic private directory marker', async vendor => {
    const root = await createNativeStateDirectory(`oneringai-${vendor}-`, 'session_native');
    const verifyNativeCheckpoint = vi.fn(async ({ directory }: { directory: string }) => { await readFile(path.join(directory, 'required-native-transcript')); });
    const loadSdk = vi.fn(async () => { throw new Error('Native code must not run'); });
    const driver = vendor === 'codex' ? new CodexSdkDriver({ loadSdk, verifyNativeCheckpoint }) : new ClaudeAgentSdkDriver({ loadSdk, verifyNativeCheckpoint });
    try {
      const checkpoint = vendor === 'codex' ? { kind: 'codex-sdk-v1', home: root, threadId: 'native' } : { kind: 'claude-sdk-v1', home: root, nativeSessionId: 'native' };
      await expect(driver.restoreSession({ sessionId: 'session_native', checkpoint } as DriverOpenSessionRequest & { checkpoint: typeof checkpoint })).rejects.toThrow('ENOENT');
      expect(verifyNativeCheckpoint).toHaveBeenCalledOnce(); expect(loadSdk).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
