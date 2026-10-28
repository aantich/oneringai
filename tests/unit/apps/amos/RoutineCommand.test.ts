import { afterEach, describe, expect, it, vi } from 'vitest';
import { Agent } from '@everworker/oneringai';
import { RoutineCommand } from '../../../../apps/amos/src/commands/commands/RoutineCommand.js';
import { DEFAULT_CONFIG } from '../../../../apps/amos/src/config/types.js';
import type { CommandContext, IAmosApp } from '../../../../apps/amos/src/config/types.js';
import { fixture } from '../../core/routing/fixture.js';
import { Connector } from '@/core/Connector.js';
afterEach(() => { vi.restoreAllMocks(); Connector.clear(); });
function host(command: RoutineCommand, args: string[]): CommandContext {
  const config = structuredClone(DEFAULT_CONFIG); config.activeConnector = 'mock'; config.activeModel = 'main';
  const app = { getConfig: () => config, getConnectorManager: () => ({ registerConnector: vi.fn() }) } as unknown as IAmosApp;
  return { app, args, rawInput: '/routine ' + args.join(' ') };
}
describe('AMOS verified synthetic routine', () => {
  it('explains billing and same-process limits without creating an Agent', async () => {
    const command = new RoutineCommand(), create = vi.spyOn(Agent, 'create');
    expect((await command.execute(host(command, []))).message).toContain('one billable'); expect(create).not.toHaveBeenCalled();
    expect((await command.execute(host(command, ['confirm']))).success).toBe(false);
  });
  it('waits, inspects and reconciles without a second model call', async () => {
    const command = new RoutineCommand(), f = fixture({ modelExecution: { customProviderAttempts: 'single' } });
    vi.spyOn(Agent, 'create').mockImplementation(config => { f.agent.tools.registerMany(config.tools ?? []); return f.agent as unknown as Agent; });
    try {
      expect((await command.execute(host(command, ['demo']))).message).toContain('waiting');
      const waiting = (await command.execute(host(command, ['inspect']))).message; expect(waiting).toContain('task: waiting'); expect(waiting).toContain('Observed host verification: not verified'); expect(waiting).toContain('Model accounting:');
      expect((await command.execute(host(command, ['demo']))).success).toBe(false);
      expect((await command.execute(host(command, ['confirm']))).message).toContain('completed'); expect(f.primary.generate).toHaveBeenCalledTimes(1); expect((await command.execute(host(command, ['inspect']))).message).toContain('Observed host verification: verified');
    } finally { command.close(); f.agent.destroy(); }
  });
  it('cancel revokes the waiting handle and rejects later confirmation', async () => {
    const command = new RoutineCommand(), f = fixture({ modelExecution: { customProviderAttempts: 'single' } });
    vi.spyOn(Agent, 'create').mockImplementation(config => { f.agent.tools.registerMany(config.tools ?? []); return f.agent as unknown as Agent; });
    try {
      await command.execute(host(command, ['demo'])); expect((await command.execute(host(command, ['cancel']))).message).toContain('revoked');
      expect((await command.execute(host(command, ['confirm']))).success).toBe(false); expect(f.primary.generate).toHaveBeenCalledTimes(1);
    } finally { command.close(); f.agent.destroy(); }
  });
});
