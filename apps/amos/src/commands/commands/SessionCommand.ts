/**
 * SessionCommand - Manage sessions
 */

import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult } from '../../config/types.js';

export class SessionCommand extends BaseCommand {
  readonly name = 'session';
  readonly aliases = ['sess', 's'];
  readonly description = 'Manage sessions (save, load, list, delete, info, new)';
  readonly usage = '/session <save|load|list|delete|info|new> [args]';

  get detailedHelp(): string {
    return `
/session - Manage Sessions

Save and restore conversation sessions for continuity.

USAGE:
  /session             Show current session info
  /session info        Same as above
  /session save [name] Save current session
  /session load <id>   Load a saved session
  /session list        List all saved sessions
  /session delete <id> Delete a saved session
  /session new         Start a fresh session

EXAMPLES:
  /session               Show current session status
  /session save mywork   Save session as "mywork"
  /session list          List available sessions
  /session load abc123   Load session by ID
  /session new           Start fresh (offers to save first)

ALIASES:
  /sess, /s
`;
  }

  async execute(context: CommandContext): Promise<CommandResult> {
    const { subcommand, subArgs } = this.parseSubcommand(context.args);

    switch (subcommand) {
      case 'save':
        return this.saveSession(context, subArgs[0]);

      case 'load':
        return this.loadSession(context, subArgs[0]);

      case 'list':
      case 'ls':
        return this.listSessions(context);

      case 'delete':
      case 'rm':
        return this.deleteSession(context, subArgs[0]);

      case 'info':
      case null:
        return this.showSessionInfo(context);

      case 'new':
      case 'clear':
        return this.newSession(context);

      default:
        return this.error(
          `Unknown subcommand: ${subcommand}\n` +
          'Available: save, load, list, delete, info, new'
        );
    }
  }

  private async saveSession(context: CommandContext, name?: string): Promise<CommandResult> {
    const { app } = context;
    const agent = app.getAgent();

    if (!agent) {
      return this.error('No active agent. Start a conversation first.');
    }

    try {
      const sessionId = await agent.saveSession(name);

      if (name) {
        app.print(`Session saved as "${name}" (ID: ${sessionId})`);
      } else {
        app.print(`Session saved (ID: ${sessionId})`);
      }

      app.updateConfig({
        session: {
          ...app.getConfig().session,
          activeSessionId: sessionId,
        },
      });
      await app.saveConfig();

      return this.success();
    } catch (error) {
      return this.error(`Failed to save session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async loadSession(context: CommandContext, sessionId?: string): Promise<CommandResult> {
    const { app } = context;

    if (!sessionId) {
      return this.error('Session ID required. Usage: /session load <id>\nUse /session list to see available sessions.');
    }

    const agent = app.getAgent();
    if (!agent) {
      return this.error('No active agent. Configure a connector first.');
    }

    try {
      await agent.loadSession(sessionId);

      app.updateConfig({
        session: {
          ...app.getConfig().session,
          activeSessionId: sessionId,
        },
      });
      await app.saveConfig();

      return this.success(`Session loaded: ${sessionId}`);
    } catch (error) {
      return this.error(`Failed to load session: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async listSessions(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const agent = app.getAgent();
    if (!agent) {
      return this.error('No active agent. Configure a connector first.');
    }

    const sessions = await agent.listSessions();
    if (sessions.length === 0) {
      return this.success('No saved sessions. Use /session save [name] to create one.');
    }

    const current = agent.getSessionId() || app.getConfig().session.activeSessionId;
    const lines = ['Saved Sessions:', ''];
    for (const session of sessions) {
      const marker = session.id === current ? '→' : ' ';
      const title = session.title ? ` — ${session.title}` : '';
      lines.push(`${marker} ${session.id}${title}`);
      lines.push(`    ${session.messageCount} messages, saved ${session.lastSavedAt.toLocaleString()}`);
    }
    lines.push('');
    lines.push('Use /session load <id> to resume a session.');

    return this.success(lines.join('\n'));
  }

  private async deleteSession(context: CommandContext, sessionId?: string): Promise<CommandResult> {
    const { app } = context;

    if (!sessionId) {
      return this.error('Session ID required. Usage: /session delete <id>');
    }

    const confirm = await app.confirm(`Delete session "${sessionId}"? This cannot be undone.`);
    if (!confirm) {
      return this.success('Cancelled.');
    }

    const agent = app.getAgent();
    if (!agent) {
      return this.error('No active agent. Configure a connector first.');
    }

    try {
      await agent.deleteSession(sessionId);
    } catch (error) {
      return this.error(`Failed to delete session: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Clear from config if it was active
    const config = app.getConfig();
    if (config.session.activeSessionId === sessionId || agent.getSessionId() === sessionId) {
      app.updateConfig({
        session: {
          ...config.session,
          activeSessionId: null,
        },
      });
      await app.createAgent({ freshSession: true });
      await app.saveConfig();
    }

    return this.success(`Session ${sessionId} deleted.`);
  }

  private async showSessionInfo(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    const config = app.getConfig();
    const agent = app.getAgent();

    const sessionId = agent?.getSessionId() || config.session.activeSessionId;

    const info = `
Session Information:

Current Session: ${sessionId || '(none)'}
Auto-save: ${config.session.autoSave ? 'Enabled' : 'Disabled'}
Auto-save Interval: ${config.session.autoSaveIntervalMs / 1000}s

Agent Status: ${agent ? (agent.isRunning() ? 'Running' : 'Ready') : 'No agent'}
`;

    return this.success(info);
  }

  private async newSession(context: CommandContext): Promise<CommandResult> {
    const { app } = context;
    // Offer to save current session
    const agent = app.getAgent();
    if (agent && agent.getSessionId()) {
      const save = await app.confirm('Save current session before starting new?');
      if (save) {
        await agent.saveSession();
        app.print('Session saved.');
      }
    }

    // The app clears the pointer only after the fresh candidate is ready.
    await app.createAgent({ freshSession: true });
    await app.saveConfig();

    return this.success('New session started.');
  }
}
