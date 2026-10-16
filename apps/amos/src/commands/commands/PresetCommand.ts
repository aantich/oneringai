import type { AgentPresetName } from '@everworker/oneringai';
import { BaseCommand } from '../BaseCommand.js';
import type { CommandContext, CommandResult } from '../../config/types.js';

export class PresetCommand extends BaseCommand {
  readonly name = 'preset';
  readonly aliases = ['profile'];
  readonly description = 'Select next-agent presets and inspect active capabilities';
  readonly usage = '/preset [inspect|set <research|workflow|off>]';
  get detailedHelp(): string {
    return `${this.usage}\nResearch: evidence, observation masking, bounded recovery, 12 iterations.\n`
      + 'Workflow: evidence, protected task state, algorithmic compaction, bounded recovery, 8 iterations.\n'
      + 'Configure evidence ownership/storage first; workflow also requires taskState. Existing explicit strategy, loopPolicy, helpers and maxIterations override defaults.\n'
      + 'Selection is saved for the next agent initialization. Use /session new to apply; the active conversation is unchanged.\n'
      + 'Off removes preset defaults on next initialization; existing explicit features remain configured.\n'
      + 'No helper calls or host completion check are added. /preset inspect shows active versus saved selection.\n';
  }
  async execute({ app, args }: CommandContext): Promise<CommandResult> {
    const runner = app.getAgent();
    if (!args.length || (args.length === 1 && args[0] === 'inspect')) {
      if (!runner?.inspectCapabilities) return this.error('Initialize an agent before inspecting capabilities.');
      try {
        const report = runner.inspectCapabilities();
        return this.success(`Saved selection (next initialization): ${app.getConfig().preset ?? 'off'}\nActive preset: ${report.activePreset ?? 'off'}\n`
          + `${JSON.stringify(report.capabilities, null, 2)}\n\n${this.detailedHelp}`);
      } catch { return this.error('Capability inspection failed; check the configured provider and model.'); }
    }
    if (args.length !== 2 || args[0] !== 'set' || !['research', 'workflow', 'off'].includes(args[1]!)) return this.error(this.usage);
    if (!runner?.validatePreset) return this.error('Initialize an agent before selecting a preset.');
    const config = app.getConfig();
    const hadPreset = Object.hasOwn(config, 'preset');
    const previous = config.preset;
    const next = args[1] === 'off' ? null : args[1] as AgentPresetName;
    try { runner.validatePreset(next, config); }
    catch (error) { return this.error(error instanceof Error ? error.message : 'Invalid preset configuration.'); }
    app.updateConfig({ preset: next });
    try { await app.saveConfig(); }
    catch {
      app.updateConfig({ preset: previous });
      if (!hadPreset) { delete config.preset; delete app.getConfig().preset; }
      else { config.preset = previous; app.getConfig().preset = previous; }
      return this.error('Preset could not be saved; previous selection restored. Active agent is unchanged.');
    }
    return this.success(`Saved preset ${next ?? 'off'} for the next agent initialization. Use /session new to apply. No model calls made; active agent is unchanged.`);
  }
}
