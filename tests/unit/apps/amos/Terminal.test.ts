import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Terminal } from '../../../../apps/amos/src/ui/Terminal.js';

const state = vi.hoisted(() => ({ createInterface: vi.fn() }));
vi.mock('node:readline', () => ({ createInterface: state.createInterface }));

class Input extends EventEmitter {
  answer?: (value: string) => void;
  closed = false;
  question(_prompt: string, callback: (value: string) => void) {
    if (this.closed) throw new Error('ERR_USE_AFTER_CLOSE');
    this.answer = callback;
  }
  close() { if (!this.closed) { this.closed = true; this.emit('close'); } }
}
describe('AMOS terminal input lifecycle', () => {
  let input: Input;
  beforeEach(() => { input = new Input(); state.createInterface.mockReset().mockReturnValue(input); });
  it('returns EOF immediately when stdin closes before the next REPL read', async () => {
    const terminal = new Terminal(); terminal.initialize(); input.close();
    expect(await terminal.readline('> ')).toBeNull();
    expect(await terminal.readline('> ')).toBeNull();
    expect(await terminal.prompt('Name: ')).toBe('');
    expect(state.createInterface).toHaveBeenCalledTimes(1);
  });
  it.each(['readline', 'prompt'] as const)('settles a pending %s on EOF and never reopens stdin', async method => {
    const terminal = new Terminal(); terminal.initialize();
    const pending = terminal[method]('> '); input.close();
    expect(await pending).toBe(method === 'readline' ? null : '');
    expect(await terminal.readline('> ')).toBeNull();
    expect(await terminal.prompt('Name: ')).toBe('');
    expect(input.listenerCount('close')).toBe(0);
    expect(state.createInterface).toHaveBeenCalledTimes(1);
  });
  it('cleans question listeners after answers and closes pending reads at teardown', async () => {
    const terminal = new Terminal(); terminal.initialize(); terminal.initialize();
    for (let index = 0; index < 15; index++) {
      const pending = terminal.readline('> '); input.answer!('answer');
      expect(await pending).toBe('answer'); expect(input.listenerCount('close')).toBe(1);
    }
    const pending = terminal.readline('> '); terminal.close(); terminal.close();
    expect(await pending).toBeNull(); expect(await terminal.readline('> ')).toBeNull();
    expect(state.createInterface).toHaveBeenCalledTimes(1);
  });
  it('preserves temporary prompts and settles their EOF without leaking interfaces', async () => {
    const terminal = new Terminal();
    const pending = terminal.prompt('Name: '); input.answer!('name');
    expect(await pending).toBe('name'); expect(input.closed).toBe(true);
    input = new Input(); state.createInterface.mockReturnValue(input);
    const next = terminal.prompt('Next: '); input.close();
    expect(await next).toBe(''); expect(await terminal.prompt('Again: ')).toBe('');
    expect(state.createInterface).toHaveBeenCalledTimes(2);
  });
  it.each(['pending', 'already closed'])('settles real closed stdin with a %s prompt', state => {
    const module = new URL('../../../../apps/amos/src/ui/Terminal.ts', import.meta.url).href;
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `
      import { once } from 'node:events';
      import { Terminal } from ${JSON.stringify(module)};
      const terminal = new Terminal(); terminal.initialize();
      if (${JSON.stringify(state)} === 'already closed') {
        await once(process.stdin, 'end'); await new Promise(resolve => setImmediate(resolve));
      }
      if (await terminal.prompt('Name: ') !== '') throw Error('Prompt did not settle at EOF');
      if (await terminal.readline('> ') !== null) throw Error('REPL did not settle at EOF');
      terminal.close(); console.log('EOF settled');
    `], { input: '', encoding: 'utf8', timeout: 5000, maxBuffer: 16384 });
    expect(output).toContain('EOF settled');
    expect(output).not.toContain('ERR_USE_AFTER_CLOSE');
  });
});
