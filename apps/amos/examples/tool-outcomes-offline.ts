/** Offline AMOS rendering of real Stage 02 execution outcomes. Build the library first. */
import { demonstrateToolOutcomes } from '../../../examples/tool-outcomes-and-cancellation.js';
import { describeToolOutcome } from '../src/agent/toolOutcomes.js';
for (const outcome of await demonstrateToolOutcomes()) {
  console.log(describeToolOutcome(outcome) ?? `${outcome.toolName}: succeeded`);
}
