/**
 * Shared validation for thinking/reasoning configuration across all providers.
 */
export function validateThinkingConfig(
  thinking: {
    enabled: boolean;
    mode?: 'adaptive' | 'enabled' | 'between_tools' | 'disabled';
    budgetTokens?: number;
    effort?: string;
  }
): void {
  if (thinking.mode && !['adaptive', 'enabled', 'between_tools', 'disabled'].includes(thinking.mode)) {
    throw new Error(`Invalid thinking mode: '${thinking.mode}'.`);
  }
  if (thinking.mode === 'disabled' && thinking.enabled) {
    throw new Error("Invalid thinking config: mode 'disabled' requires enabled: false.");
  }
  if (thinking.mode && thinking.mode !== 'disabled' && !thinking.enabled) {
    throw new Error(`Invalid thinking config: mode '${thinking.mode}' requires enabled: true.`);
  }

  if (thinking.budgetTokens !== undefined) {
    if (typeof thinking.budgetTokens !== 'number' || thinking.budgetTokens < 1) {
      throw new Error(
        `Invalid thinking budgetTokens: ${thinking.budgetTokens}. Must be a positive number.`
      );
    }
  }

  if (thinking.effort !== undefined) {
    const validEfforts = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    if (!validEfforts.includes(thinking.effort)) {
      throw new Error(
        `Invalid thinking effort: '${thinking.effort}'. Must be one of: ${validEfforts.join(', ')}`
      );
    }
  }
}
