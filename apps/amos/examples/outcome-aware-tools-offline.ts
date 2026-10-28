/** C1 uses AMOS's existing renderer; no new command, config or policy is required. */
import { demonstrateOutcomeTools } from '../../../examples/outcome-aware-tools.js';
import { describeToolOutcome } from '../src/agent/toolOutcomes.js';
for (const { outcome } of await demonstrateOutcomeTools()) {
  console.log(describeToolOutcome(outcome) ?? `${outcome.toolName}: succeeded execution (business decision is separate)`);
}
