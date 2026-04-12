/**
 * TemplateEngine Unit Tests
 *
 * Tests the extensible template engine for agent instructions:
 * - Built-in handlers (DATE, TIME, DATETIME, RANDOM, AGENT_ID, etc.)
 * - Custom handler registration
 * - Async handler support
 * - Escape mechanisms (triple braces, raw blocks)
 * - Phase filtering (static vs dynamic)
 * - processSync error on async handlers
 * - Unknown commands left as-is
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateEngine } from '@/core/TemplateEngine.js';
import type { TemplateContext } from '@/core/TemplateEngine.js';

describe('TemplateEngine', () => {
  beforeEach(() => {
    TemplateEngine.reset();
  });

  // ==========================================================================
  // Registration
  // ==========================================================================

  describe('registration', () => {
    it('registers and checks handler existence', () => {
      TemplateEngine.register('CUSTOM', () => 'value');
      expect(TemplateEngine.has('CUSTOM')).toBe(true);
      expect(TemplateEngine.has('custom')).toBe(true); // case-insensitive
    });

    it('unregisters handler', () => {
      TemplateEngine.register('TEMP', () => 'val');
      expect(TemplateEngine.has('TEMP')).toBe(true);
      TemplateEngine.unregister('TEMP');
      expect(TemplateEngine.has('TEMP')).toBe(false);
    });

    it('lists registered handlers', () => {
      const handlers = TemplateEngine.getRegisteredHandlers();
      // Built-ins should be present
      expect(handlers).toContain('DATE');
      expect(handlers).toContain('TIME');
      expect(handlers).toContain('DATETIME');
      expect(handlers).toContain('RANDOM');
      expect(handlers).toContain('AGENT_ID');
      expect(handlers).toContain('AGENT_NAME');
      expect(handlers).toContain('MODEL');
      expect(handlers).toContain('VENDOR');
      expect(handlers).toContain('USER_ID');
    });

    it('overwrites handler on re-registration', async () => {
      TemplateEngine.register('FOO', () => 'first');
      expect(await TemplateEngine.process('{{FOO}}')).toBe('first');
      TemplateEngine.register('FOO', () => 'second');
      expect(await TemplateEngine.process('{{FOO}}')).toBe('second');
    });

    it('allows overriding built-in handlers', async () => {
      // Override DATE to return a fixed value (e.g., user-timezone formatting)
      TemplateEngine.register('DATE', () => '12 April 2026', { dynamic: true });
      expect(await TemplateEngine.process('{{DATE}}')).toBe('12 April 2026');
    });

    it('override registered BEFORE first process() call wins', async () => {
      // This is the critical ordering test: register() must trigger ensureBuiltins()
      // so that the user's handler overwrites the built-in, not the other way around.
      TemplateEngine.reset();
      // Register BEFORE any process/has/getRegisteredHandlers call
      TemplateEngine.register('DATE', () => 'custom-date', { dynamic: true });
      const result = await TemplateEngine.process('{{DATE}}');
      expect(result).toBe('custom-date');
    });

    it('unregister works on built-ins', async () => {
      TemplateEngine.unregister('DATE');
      // DATE is now unknown → left as-is
      expect(await TemplateEngine.process('{{DATE}}')).toBe('{{DATE}}');
    });

    it('unregister before first use works correctly', async () => {
      TemplateEngine.reset();
      TemplateEngine.unregister('RANDOM');
      expect(await TemplateEngine.process('{{RANDOM}}')).toBe('{{RANDOM}}');
    });

    it('override preserves dynamic flag from user registration', async () => {
      // Override AGENT_ID (built-in static) as dynamic
      TemplateEngine.register('AGENT_ID', () => 'dynamic-id', { dynamic: true });
      // Static phase should NOT resolve it anymore
      const result = await TemplateEngine.process('{{AGENT_ID}}', {}, { phase: 'static' });
      expect(result).toBe('{{AGENT_ID}}');
      // Dynamic phase should resolve it
      const result2 = await TemplateEngine.process('{{AGENT_ID}}', {}, { phase: 'dynamic' });
      expect(result2).toBe('dynamic-id');
    });
  });

  // ==========================================================================
  // Built-in static handlers
  // ==========================================================================

  describe('built-in static handlers', () => {
    const ctx: TemplateContext = {
      agentId: 'test-agent',
      agentName: 'Test Agent',
      model: 'gpt-4',
      vendor: 'openai',
      userId: 'user-123',
    };

    it('resolves AGENT_ID', async () => {
      expect(await TemplateEngine.process('ID: {{AGENT_ID}}', ctx)).toBe('ID: test-agent');
    });

    it('resolves AGENT_NAME', async () => {
      expect(await TemplateEngine.process('Name: {{AGENT_NAME}}', ctx)).toBe('Name: Test Agent');
    });

    it('resolves MODEL', async () => {
      expect(await TemplateEngine.process('Model: {{MODEL}}', ctx)).toBe('Model: gpt-4');
    });

    it('resolves VENDOR', async () => {
      expect(await TemplateEngine.process('Vendor: {{VENDOR}}', ctx)).toBe('Vendor: openai');
    });

    it('resolves USER_ID', async () => {
      expect(await TemplateEngine.process('User: {{USER_ID}}', ctx)).toBe('User: user-123');
    });

    it('returns empty string for missing context fields', async () => {
      expect(await TemplateEngine.process('{{AGENT_ID}}', {})).toBe('');
    });

    it('resolves multiple static handlers in one string', async () => {
      const result = await TemplateEngine.process(
        'Agent {{AGENT_ID}} using {{MODEL}} on {{VENDOR}}', ctx
      );
      expect(result).toBe('Agent test-agent using gpt-4 on openai');
    });
  });

  // ==========================================================================
  // Built-in dynamic handlers
  // ==========================================================================

  describe('built-in dynamic handlers', () => {
    it('resolves DATE with default format (ISO)', async () => {
      const result = await TemplateEngine.process('{{DATE}}');
      // Should be YYYY-MM-DD
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('resolves DATE with custom format', async () => {
      const result = await TemplateEngine.process('{{DATE:MM/DD/YYYY}}');
      expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    });

    it('resolves TIME with default format', async () => {
      const result = await TemplateEngine.process('{{TIME}}');
      // Should be HH:mm:ss
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('resolves DATETIME with default format', async () => {
      const result = await TemplateEngine.process('{{DATETIME}}');
      // Should be YYYY-MM-DD HH:mm:ss
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('resolves DATETIME with custom format', async () => {
      const result = await TemplateEngine.process('{{DATETIME:YYYY/MM/DD HH:mm}}');
      expect(result).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/);
    });

    it('resolves RANDOM with default range (1-100)', async () => {
      const result = await TemplateEngine.process('{{RANDOM}}');
      const num = parseInt(result, 10);
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(100);
    });

    it('resolves RANDOM with custom range', async () => {
      const result = await TemplateEngine.process('{{RANDOM:5:10}}');
      const num = parseInt(result, 10);
      expect(num).toBeGreaterThanOrEqual(5);
      expect(num).toBeLessThanOrEqual(10);
    });

    it('handles RANDOM with invalid range gracefully', async () => {
      const result = await TemplateEngine.process('{{RANDOM:abc:xyz}}');
      const num = parseInt(result, 10);
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(100);
    });

    it('handles RANDOM with inverted range (min > max) gracefully', async () => {
      const result = await TemplateEngine.process('{{RANDOM:50:10}}');
      const num = parseInt(result, 10);
      // Falls back to 1-100
      expect(num).toBeGreaterThanOrEqual(1);
      expect(num).toBeLessThanOrEqual(100);
    });

    it('handles RANDOM with single-value range (min === max)', async () => {
      const result = await TemplateEngine.process('{{RANDOM:7:7}}');
      expect(result).toBe('7');
    });

    it('resolves TIME with custom format (no seconds)', async () => {
      const result = await TemplateEngine.process('{{TIME:HH:mm}}');
      expect(result).toMatch(/^\d{2}:\d{2}$/);
    });

    it('resolves DATE with dot separator', async () => {
      const result = await TemplateEngine.process('{{DATE:DD.MM.YYYY}}');
      expect(result).toMatch(/^\d{2}\.\d{2}\.\d{4}$/);
    });

    it('resolves DATETIME with AM/PM', async () => {
      const result = await TemplateEngine.process('{{DATETIME:YYYY-MM-DD hh:mm A}}');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} (AM|PM)$/);
    });

    it('resolves TIME with lowercase am/pm', async () => {
      const result = await TemplateEngine.process('{{TIME:hh:mm a}}');
      expect(result).toMatch(/^\d{2}:\d{2} (am|pm)$/);
    });
  });

  // ==========================================================================
  // Custom handlers
  // ==========================================================================

  describe('custom handlers', () => {
    it('registers and resolves a sync custom handler', async () => {
      TemplateEngine.register('COMPANY', () => 'Acme Corp');
      expect(await TemplateEngine.process('Welcome to {{COMPANY}}')).toBe('Welcome to Acme Corp');
    });

    it('registers and resolves a custom handler with arg', async () => {
      TemplateEngine.register('GREET', (arg) => `Hello, ${arg ?? 'World'}!`);
      expect(await TemplateEngine.process('{{GREET:Alice}}')).toBe('Hello, Alice!');
      expect(await TemplateEngine.process('{{GREET}}')).toBe('Hello, World!');
    });

    it('handler receives context', async () => {
      TemplateEngine.register('CTX_TEST', (_, ctx) => String(ctx.customField));
      const result = await TemplateEngine.process('{{CTX_TEST}}', { customField: 42 });
      expect(result).toBe('42');
    });

    it('registers and resolves an async custom handler', async () => {
      TemplateEngine.register('ASYNC_VAL', async () => {
        return 'async-result';
      }, { dynamic: true });
      expect(await TemplateEngine.process('{{ASYNC_VAL}}')).toBe('async-result');
    });

    it('supports multiple custom handlers in one string', async () => {
      TemplateEngine.register('A', () => 'alpha');
      TemplateEngine.register('B', () => 'beta');
      expect(await TemplateEngine.process('{{A}} and {{B}}')).toBe('alpha and beta');
    });

    it('custom handler with empty arg (colon but no value)', async () => {
      TemplateEngine.register('ECHO', (arg) => `[${arg ?? 'none'}]`);
      expect(await TemplateEngine.process('{{ECHO:}}')).toBe('[]');
      expect(await TemplateEngine.process('{{ECHO}}')).toBe('[none]');
    });

    it('custom handler arg preserves colons (everything after first colon)', async () => {
      TemplateEngine.register('LOOKUP', (arg) => `looked up: ${arg}`);
      expect(await TemplateEngine.process('{{LOOKUP:table:key:sub}}')).toBe('looked up: table:key:sub');
    });

    it('custom handler uses both arg and context together', async () => {
      TemplateEngine.register('GREET_USER', (arg, ctx) => {
        const style = arg ?? 'formal';
        const name = (ctx.userName as string) ?? 'stranger';
        return style === 'casual' ? `Hey ${name}!` : `Good day, ${name}.`;
      });
      expect(await TemplateEngine.process('{{GREET_USER:casual}}', { userName: 'Alice' }))
        .toBe('Hey Alice!');
      expect(await TemplateEngine.process('{{GREET_USER:formal}}', { userName: 'Bob' }))
        .toBe('Good day, Bob.');
      expect(await TemplateEngine.process('{{GREET_USER}}', { userName: 'Carol' }))
        .toBe('Good day, Carol.');
    });

    it('async custom handler with arg', async () => {
      TemplateEngine.register('FETCH', async (arg) => {
        // Simulate async lookup
        const data: Record<string, string> = { users: '42', orders: '108' };
        return data[arg ?? ''] ?? '0';
      }, { dynamic: true });
      expect(await TemplateEngine.process('{{FETCH:users}}')).toBe('42');
      expect(await TemplateEngine.process('{{FETCH:orders}}')).toBe('108');
      expect(await TemplateEngine.process('{{FETCH:missing}}')).toBe('0');
    });

    it('dynamic custom handler with arg respects phase filtering', async () => {
      TemplateEngine.register('COUNTER', (arg) => {
        const prefix = arg ?? 'item';
        return `${prefix}-001`;
      }, { dynamic: true });

      // Static phase should skip it
      const staticResult = await TemplateEngine.process('{{COUNTER:task}}', {}, { phase: 'static' });
      expect(staticResult).toBe('{{COUNTER:task}}');

      // Dynamic phase should resolve it
      const dynamicResult = await TemplateEngine.process('{{COUNTER:task}}', {}, { phase: 'dynamic' });
      expect(dynamicResult).toBe('task-001');
    });

    it('realistic use case: timezone-aware date override', async () => {
      // Simulates a client app overriding DATE to show user's timezone
      TemplateEngine.register('DATE', (fmt, ctx) => {
        const tz = (ctx.timezone as string) ?? 'UTC';
        const now = new Date();
        if (!fmt) {
          return now.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD
        }
        return `${now.toLocaleDateString('en-CA', { timeZone: tz })} (${tz})`;
      }, { dynamic: true });

      const result = await TemplateEngine.process(
        'Today: {{DATE}}, Annotated: {{DATE:with_tz}}',
        { timezone: 'America/New_York' }
      );
      expect(result).toMatch(/Today: \d{4}-\d{2}-\d{2}/);
      expect(result).toContain('America/New_York');
    });

    it('realistic use case: i18n translation handler', async () => {
      const translations: Record<string, Record<string, string>> = {
        en: { greeting: 'Hello', farewell: 'Goodbye' },
        es: { greeting: 'Hola', farewell: 'Adiós' },
      };
      TemplateEngine.register('T', (key, ctx) => {
        const lang = (ctx.lang as string) ?? 'en';
        return translations[lang]?.[key ?? ''] ?? `[missing: ${key}]`;
      });

      expect(await TemplateEngine.process('{{T:greeting}}, {{T:farewell}}', { lang: 'es' }))
        .toBe('Hola, Adiós');
      expect(await TemplateEngine.process('{{T:greeting}}', { lang: 'en' }))
        .toBe('Hello');
      expect(await TemplateEngine.process('{{T:unknown}}', { lang: 'en' }))
        .toBe('[missing: unknown]');
    });
  });

  // ==========================================================================
  // Phase filtering
  // ==========================================================================

  describe('phase filtering', () => {
    it('static phase only resolves static handlers', async () => {
      const ctx: TemplateContext = { agentId: 'test' };
      const result = await TemplateEngine.process(
        'Agent: {{AGENT_ID}}, Date: {{DATE}}', ctx, { phase: 'static' }
      );
      expect(result).toBe('Agent: test, Date: {{DATE}}');
    });

    it('dynamic phase only resolves dynamic handlers', async () => {
      const ctx: TemplateContext = { agentId: 'test' };
      const result = await TemplateEngine.process(
        'Agent: {{AGENT_ID}}, Date: {{DATE}}', ctx, { phase: 'dynamic' }
      );
      // AGENT_ID left as-is, DATE resolved
      expect(result).toContain('Agent: {{AGENT_ID}}');
      expect(result).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    });

    it('all phase resolves everything (default)', async () => {
      const ctx: TemplateContext = { agentId: 'test' };
      const result = await TemplateEngine.process(
        'Agent: {{AGENT_ID}}, Date: {{DATE}}', ctx
      );
      expect(result).toContain('Agent: test');
      expect(result).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
    });

    it('custom handler respects dynamic flag', async () => {
      TemplateEngine.register('STATIC_VAL', () => 'static');
      TemplateEngine.register('DYNAMIC_VAL', () => 'dynamic', { dynamic: true });

      const staticPass = await TemplateEngine.process(
        '{{STATIC_VAL}} {{DYNAMIC_VAL}}', {}, { phase: 'static' }
      );
      expect(staticPass).toBe('static {{DYNAMIC_VAL}}');

      const dynamicPass = await TemplateEngine.process(
        '{{STATIC_VAL}} {{DYNAMIC_VAL}}', {}, { phase: 'dynamic' }
      );
      expect(dynamicPass).toBe('{{STATIC_VAL}} dynamic');
    });

    it('two-pass processing works correctly', async () => {
      const ctx: TemplateContext = { agentId: 'my-agent', model: 'gpt-4' };
      const instructions = 'Agent {{AGENT_ID}} ({{MODEL}}) started on {{DATE}}';

      // Pass 1: static
      const afterStatic = TemplateEngine.processSync(instructions, ctx, { phase: 'static' });
      expect(afterStatic).toBe('Agent my-agent (gpt-4) started on {{DATE}}');

      // Pass 2: dynamic
      const afterDynamic = await TemplateEngine.process(afterStatic, ctx, { phase: 'dynamic' });
      expect(afterDynamic).toMatch(/Agent my-agent \(gpt-4\) started on \d{4}-\d{2}-\d{2}/);
    });
  });

  // ==========================================================================
  // processSync
  // ==========================================================================

  describe('processSync', () => {
    it('resolves sync handlers', () => {
      const ctx: TemplateContext = { agentId: 'sync-test' };
      const result = TemplateEngine.processSync('{{AGENT_ID}}', ctx);
      expect(result).toBe('sync-test');
    });

    it('throws on async handler', () => {
      TemplateEngine.register('ASYNC_ONLY', async () => 'value');
      expect(() => {
        TemplateEngine.processSync('{{ASYNC_ONLY}}');
      }).toThrow(/Promise/);
      expect(() => {
        TemplateEngine.processSync('{{ASYNC_ONLY}}');
      }).toThrow(/processSync/);
    });

    it('does not throw if async handler is not matched by phase', () => {
      TemplateEngine.register('ASYNC_DYN', async () => 'val', { dynamic: true });
      // static phase won't match the dynamic async handler
      expect(() => {
        TemplateEngine.processSync('{{ASYNC_DYN}}', {}, { phase: 'static' });
      }).not.toThrow();
    });
  });

  // ==========================================================================
  // Escaping: triple braces
  // ==========================================================================

  describe('triple brace escaping', () => {
    it('converts triple braces to literal double braces', async () => {
      const result = await TemplateEngine.process('{{{DATE}}}');
      expect(result).toBe('{{DATE}}');
    });

    it('does not process content inside triple braces', async () => {
      const ctx: TemplateContext = { agentId: 'test' };
      const result = await TemplateEngine.process('{{{AGENT_ID}}}', ctx);
      expect(result).toBe('{{AGENT_ID}}');
    });

    it('mixes escaped and unescaped templates', async () => {
      const ctx: TemplateContext = { agentId: 'test' };
      const result = await TemplateEngine.process(
        'Real: {{AGENT_ID}}, Literal: {{{AGENT_ID}}}', ctx
      );
      expect(result).toBe('Real: test, Literal: {{AGENT_ID}}');
    });

    it('handles multiple triple-brace escapes', async () => {
      const result = await TemplateEngine.process('{{{FOO}}} and {{{BAR}}}');
      expect(result).toBe('{{FOO}} and {{BAR}}');
    });
  });

  // ==========================================================================
  // Escaping: raw blocks
  // ==========================================================================

  describe('raw block escaping', () => {
    it('preserves content in raw blocks verbatim', async () => {
      const result = await TemplateEngine.process('{{raw}}{{DATE}} is a template{{/raw}}');
      expect(result).toBe('{{DATE}} is a template');
    });

    it('does not process templates inside raw blocks', async () => {
      const ctx: TemplateContext = { agentId: 'test' };
      const result = await TemplateEngine.process(
        '{{raw}}Agent: {{AGENT_ID}}, Date: {{DATE}}{{/raw}}', ctx
      );
      expect(result).toBe('Agent: {{AGENT_ID}}, Date: {{DATE}}');
    });

    it('processes templates outside raw blocks normally', async () => {
      const ctx: TemplateContext = { agentId: 'test' };
      const result = await TemplateEngine.process(
        'Before: {{AGENT_ID}} {{raw}}Inside: {{AGENT_ID}}{{/raw}} After: {{AGENT_ID}}', ctx
      );
      expect(result).toBe('Before: test Inside: {{AGENT_ID}} After: test');
    });

    it('handles multiline raw blocks', async () => {
      const input = `{{raw}}
Line 1: {{DATE}}
Line 2: {{TIME}}
{{/raw}}`;
      const result = await TemplateEngine.process(input);
      expect(result).toBe(`
Line 1: {{DATE}}
Line 2: {{TIME}}
`);
    });

    it('handles multiple raw blocks', async () => {
      const result = await TemplateEngine.process(
        '{{raw}}{{A}}{{/raw}} middle {{raw}}{{B}}{{/raw}}'
      );
      expect(result).toBe('{{A}} middle {{B}}');
    });
  });

  // ==========================================================================
  // Unknown commands
  // ==========================================================================

  describe('unknown commands', () => {
    it('leaves unknown template commands as-is', async () => {
      const result = await TemplateEngine.process('{{UNKNOWN_THING}}');
      expect(result).toBe('{{UNKNOWN_THING}}');
    });

    it('resolves known and leaves unknown', async () => {
      const ctx: TemplateContext = { agentId: 'test' };
      const result = await TemplateEngine.process('{{AGENT_ID}} and {{NONEXISTENT}}', ctx);
      expect(result).toBe('test and {{NONEXISTENT}}');
    });
  });

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  describe('edge cases', () => {
    it('returns empty string for empty input', async () => {
      expect(await TemplateEngine.process('')).toBe('');
    });

    it('returns text unchanged when no templates present', async () => {
      const text = 'Hello world, no templates here.';
      expect(await TemplateEngine.process(text)).toBe(text);
    });

    it('handles adjacent templates', async () => {
      TemplateEngine.register('A', () => 'X');
      TemplateEngine.register('B', () => 'Y');
      expect(await TemplateEngine.process('{{A}}{{B}}')).toBe('XY');
    });

    it('handles template at start and end', async () => {
      TemplateEngine.register('START', () => 'begin');
      TemplateEngine.register('END', () => 'finish');
      expect(await TemplateEngine.process('{{START}} middle {{END}}')).toBe('begin middle finish');
    });

    it('handles handler returning text with curly braces', async () => {
      TemplateEngine.register('JSON', () => '{"key": "value"}');
      expect(await TemplateEngine.process('Data: {{JSON}}')).toBe('Data: {"key": "value"}');
    });

    it('does not recursively process handler output', async () => {
      TemplateEngine.register('META', () => '{{DATE}}');
      const result = await TemplateEngine.process('{{META}}');
      // Should return literal {{DATE}}, not the resolved date
      expect(result).toBe('{{DATE}}');
    });

    it('handles duplicate templates with same command', async () => {
      const ctx: TemplateContext = { agentId: 'dup' };
      const result = await TemplateEngine.process('{{AGENT_ID}} and {{AGENT_ID}}', ctx);
      expect(result).toBe('dup and dup');
    });

    it('RANDOM produces potentially different values for duplicate calls', async () => {
      // Run many times to statistically verify randomness
      const results = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const result = await TemplateEngine.process('{{RANDOM:1:1000000}}');
        results.add(result);
      }
      // With range 1-1000000, 50 calls should produce at least 2 distinct values
      expect(results.size).toBeGreaterThan(1);
    });

    it('case-insensitive command matching', async () => {
      TemplateEngine.register('MyCmd', () => 'works');
      expect(await TemplateEngine.process('{{MYCMD}}')).toBe('works');
      expect(await TemplateEngine.process('{{mycmd}}')).toBe('works');
      expect(await TemplateEngine.process('{{MyCmd}}')).toBe('works');
    });

    it('processSync returns text unchanged for empty input', () => {
      expect(TemplateEngine.processSync('')).toBe('');
    });

    it('handles null-ish context gracefully', async () => {
      expect(await TemplateEngine.process('{{AGENT_ID}}')).toBe('');
      expect(await TemplateEngine.process('{{AGENT_ID}}', undefined)).toBe('');
    });
  });

  // ==========================================================================
  // Date format tokens
  // ==========================================================================

  describe('date format tokens', () => {
    it('supports YYYY, MM, DD tokens', async () => {
      const result = await TemplateEngine.process('{{DATE:YYYY-MM-DD}}');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('supports HH, mm, ss tokens', async () => {
      const result = await TemplateEngine.process('{{TIME:HH:mm:ss}}');
      expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it('supports AM/PM tokens', async () => {
      const result = await TemplateEngine.process('{{TIME:hh:mm A}}');
      expect(result).toMatch(/^\d{2}:\d{2} (AM|PM)$/);
    });

    it('supports YY (2-digit year)', async () => {
      const result = await TemplateEngine.process('{{DATE:YY}}');
      expect(result).toMatch(/^\d{2}$/);
    });
  });

  // ==========================================================================
  // Reset
  // ==========================================================================

  describe('reset', () => {
    it('clears all handlers including built-ins', () => {
      expect(TemplateEngine.has('DATE')).toBe(true);
      TemplateEngine.reset();
      // After reset, has() triggers ensureBuiltins again
      expect(TemplateEngine.has('DATE')).toBe(true);
    });

    it('clears custom handlers on reset', async () => {
      TemplateEngine.register('CUSTOM', () => 'val');
      expect(TemplateEngine.has('CUSTOM')).toBe(true);
      TemplateEngine.reset();
      // Custom handler is gone, but built-ins re-initialized
      expect(TemplateEngine.has('CUSTOM')).toBe(false);
      expect(TemplateEngine.has('DATE')).toBe(true);
    });
  });

  // ==========================================================================
  // Integration: combined escaping and processing
  // ==========================================================================

  describe('integration: combined escaping and processing', () => {
    it('explains the template language to an LLM', async () => {
      const ctx: TemplateContext = { agentId: 'helper' };
      const instructions = `You are agent {{AGENT_ID}}.

When users ask about our template syntax, explain:
- Use {{{DATE}}} for the current date
- Use {{{AGENT_ID}}} for the agent ID
- Use {{{RANDOM:min:max}}} for random numbers

The current date is {{DATE}}.`;

      const result = await TemplateEngine.process(instructions, ctx);
      expect(result).toContain('You are agent helper');
      expect(result).toContain('Use {{DATE}} for the current date');
      expect(result).toContain('Use {{AGENT_ID}} for the agent ID');
      expect(result).toContain('Use {{RANDOM:min:max}} for random numbers');
      expect(result).toMatch(/The current date is \d{4}-\d{2}-\d{2}/);
    });

    it('raw block for documentation section', async () => {
      const instructions = `Process data for today ({{DATE}}).

{{raw}}
## Template Reference
{{DATE}} - Current date
{{TIME}} - Current time
{{AGENT_ID}} - Agent identifier
{{/raw}}`;

      const result = await TemplateEngine.process(instructions);
      // DATE outside raw block is resolved
      expect(result).toMatch(/Process data for today \(\d{4}-\d{2}-\d{2}\)/);
      // Inside raw block, everything is literal
      expect(result).toContain('{{DATE}} - Current date');
      expect(result).toContain('{{TIME}} - Current time');
      expect(result).toContain('{{AGENT_ID}} - Agent identifier');
    });
  });
});
