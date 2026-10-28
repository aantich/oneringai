/** Offline public-API composition; temporary artifacts are verified and cleaned. */
import { runMeetingComposition, compositionSummary } from './agentic-baseline/composition.js';
const results = [];
for (const fixture of ['development', 'held-out-budget-735', 'held-out-quote-947']) for (const variant of ['local', 'remote'] as const) results.push(await runMeetingComposition(variant, fixture));
console.log(JSON.stringify(compositionSummary(results)));
