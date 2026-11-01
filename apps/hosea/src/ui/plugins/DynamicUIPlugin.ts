/**
 * DynamicUIPlugin — Instruction-only plugin for Dynamic UI side-panel content.
 *
 * Teaches the LLM how to create persistent, rich-content cards in the user's
 * side panel using InContextMemory's `showInUI: true` flag.
 *
 * This plugin has NO tools, NO content, NO state — it only injects instructions
 * into the system prompt. Requires InContextMemory to be enabled.
 *
 * The Interactive UI section (```ui forms/buttons) is **opt-in** and disabled
 * by default — pass `{ interactiveUI: true }` in the plugin config to enable.
 *
 * Lives in Hosea because it's only useful for UI-enabled agents.
 * Apps register it manually:
 *
 * ```typescript
 * import { DynamicUIPlugin } from '../plugins.js';
 * ctx.registerPlugin(new DynamicUIPlugin({ interactiveUI: true }));
 * ```
 */

import type { IContextPluginNextGen } from 'oneringai';
import type { ToolFunction } from 'oneringai';

// Simple token estimator (~3.5 chars per token, matching BasePluginNextGen)
const estimateTokens = (text: string): number => Math.ceil(text.length / 3.5);

// ============================================================================
// Instructions
// ============================================================================

const SIDE_PANEL_INSTRUCTIONS = `## Dynamic UI — Side Panel

You can display **persistent document cards** in the user's side panel alongside the chat. These cards are **session-persistent** — they remain visible and accessible as the conversation continues, and the user can revisit, consult, and reference them at any time.

### Core Principle: Artifacts go to Dynamic UI, conversation stays in chat

**Dynamic UI is your primary output surface for any deliverable or artifact.** Anything the user might need to come back to — review, consult, adjust, compare, or reference later — MUST be placed in the Dynamic UI side panel. Think of Dynamic UI cards as **living documents** that persist alongside the conversation.

**Chat is ONLY for short, ephemeral exchanges:** acknowledgements, clarifications, questions, brief status updates, and discussion. Chat messages scroll away and become hard to find — never put end results or important artifacts in chat alone.

**Always use Dynamic UI (side panel) for:**
- Analysis results, reports, and summaries
- Generated code, configurations, and scripts
- Charts, diagrams, and visualizations
- Reference tables, comparisons, and structured data
- Dashboards and live status/progress displays
- Plans, outlines, and structured recommendations
- Interactive forms for collecting user input
- Any content the user asked you to "create", "generate", "write", "build", or "prepare"

**Use chat ONLY for:**
- Brief acknowledgements ("Done — I've updated the dashboard card")
- Clarifying questions ("Which format do you prefer?")
- Short discussion and reasoning
- Pointing the user to a Dynamic UI card you just created/updated

**Rule of thumb:** If your response contains a result, deliverable, or artifact — put it in a Dynamic UI card. If it's just a sentence or two of conversation — keep it in chat.

### How Dynamic UI works — the \`showInUI\` flag

Dynamic UI is a layer on top of the **Whiteboard** store (\`store: "whiteboard"\`). Every whiteboard entry has an optional \`showInUI\` flag that decides whether the entry is also rendered as a card in the user's side panel:

- \`showInUI: true\` → entry is **promoted to a side-panel card** that the user sees and can revisit. Use this for every artifact, deliverable, dashboard, or piece of content the user should see.
- \`showInUI: false\` (or omitted) → entry stays on the whiteboard, **visible only to you** — internal state, scratch values, working notes the user shouldn't see.

The card stays in sync with the whiteboard entry: update the entry → the card re-renders in place; delete the entry → the card disappears.

**Creating / updating a panel card** (call \`store_set\` with a flat object — all fields are top-level params):
\`\`\`
store_set({
  store: "whiteboard",
  key: "<unique-key>",
  description: "<card title — shown as header>",
  value: "<markdown content goes here>",
  showInUI: true,
  priority: "high"
})
\`\`\`

**Updating a card:** call \`store_set\` again with the same \`key\`. The new \`value\` replaces the previous content; the card re-renders in place. Same call, no separate "update" tool.

**Hiding a card but keeping the data:** call \`store_set\` again with \`showInUI: false\`. The entry stays on the whiteboard (still visible to you in context), but the side-panel card is removed.

**Removing a card AND the underlying data:** \`store_delete({ store: "whiteboard", key: "<unique-key>" })\`

**Formatting:** Cards render the same rich markdown as chat — use freely:

### Basic Markdown
- **Bold**, *italic*, ~~strikethrough~~, \`inline code\`
- Headers (# ## ###), lists, blockquotes, links
- Tables (GitHub Flavored Markdown)

### Code Blocks
Use fenced code blocks with language identifiers for syntax highlighting:
\`\`\`python
def hello():
    print("Hello!")
\`\`\`

### Mathematical Formulas (LaTeX/KaTeX)
- Inline math: $E = mc^2$
- Block math:
$$
\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}
$$

### Mermaid Diagrams
Create flowcharts, sequence diagrams, class diagrams, state diagrams, ER diagrams, and more:
\`\`\`mermaid
flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Action 1]
    B -->|No| D[Action 2]
    C --> E[End]
    D --> E
\`\`\`

### Vega-Lite Charts
Create interactive data visualizations (bar charts, line charts, scatter plots, etc.):
\`\`\`vega-lite
{
  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
  "description": "A simple bar chart",
  "data": {
    "values": [
      {"category": "A", "value": 28},
      {"category": "B", "value": 55},
      {"category": "C", "value": 43}
    ]
  },
  "mark": "bar",
  "encoding": {
    "x": {"field": "category", "type": "nominal"},
    "y": {"field": "value", "type": "quantitative"}
  }
}
\`\`\`

### Markmap Mindmaps
Create interactive mindmaps from markdown hierarchies:
\`\`\`markmap
# Central Topic
## Branch 1
### Sub-item 1.1
### Sub-item 1.2
## Branch 2
### Sub-item 2.1
## Branch 3
\`\`\`

### Formatting Best Practices
1. Use diagrams and charts when explaining complex concepts, processes, or data
2. Use tables for comparing options or presenting structured data
3. Use code blocks with proper language tags for any code
4. Use math notation for formulas and equations
5. Use mindmaps for brainstorming or showing hierarchical relationships
6. Keep visualizations simple and focused on the key message

**Best practices:**
- Use descriptive keys: \`"project_status"\`, \`"analysis_chart"\`, \`"api_endpoints"\`
- **Update** existing entries (same key) rather than creating duplicates
- Use \`priority: "high"\` or \`"critical"\` so UI cards survive context compaction
- Keep content focused and scannable — one concept per card
- Provide a clear \`description\` — it becomes the card's header/title
- Remove cards when no longer relevant: \`store_delete({ store: "whiteboard", key: "<key>" })\`
- Internal state that should NOT be shown to the user: omit \`showInUI\` or set it to \`false\` (default)`;

// ============================================================================
// Interactive UI Instructions (opt-in via plugin config: { interactiveUI: true })
// ============================================================================
//
// Disabled by default — only injected when the agent's plugin config explicitly
// enables it. Keeps prompt tokens down for agents that don't need form support
// and avoids tempting the LLM to emit \`\`\`ui blocks the host UI may not render.

const INTERACTIVE_UI_INSTRUCTIONS = `

---

## Interactive UI — Forms & Actions

You can create **interactive forms** that the user can fill out and submit. Use \\\`\\\`\\\`ui fenced code blocks containing a JSON schema. When the user presses a button, their form data is sent back to you as a user message.

**When to use Interactive UI:**
- Collecting structured input (names, selections, preferences, parameters)
- Presenting choices with buttons (confirm/cancel, pick an option)
- Settings panels, configuration forms
- Multi-step wizards where each step collects different data
- Any time you need the user to provide specific inputs rather than free-form text

**When NOT to use Interactive UI:**
- Simple yes/no questions — just ask in chat
- Displaying read-only information — use regular markdown instead
- One-time quick answers — chat is faster

### Schema format

\\\`\\\`\\\`ui blocks contain a JSON object with a \`layout\` array and optional \`actions\` array:

\`\`\`
{
  "layout": [ ...components and layout nodes... ],
  "actions": [ ...button definitions... ]
}
\`\`\`

### Layout nodes

Use \`row\` and \`col\` to arrange components in a responsive grid (Bootstrap 12-column system):

\`\`\`json
{
  "type": "row",
  "children": [
    { "type": "col", "width": 6, "children": [ ...components... ] },
    { "type": "col", "width": 6, "children": [ ...components... ] }
  ]
}
\`\`\`

- \`width\` is 1–12 (defaults to equal-width \`col\` if omitted)
- Rows and columns can be nested

### Form components

**input** — Text input field
\`\`\`json
{ "type": "input", "id": "name", "label": "Your Name", "placeholder": "Enter name...", "inputType": "text", "required": true, "helpText": "First and last name" }
\`\`\`
inputType options: "text" (default), "number", "email", "password", "url", "tel"

**textarea** — Multi-line text
\`\`\`json
{ "type": "textarea", "id": "notes", "label": "Notes", "rows": 4, "placeholder": "Additional details..." }
\`\`\`

**select** — Dropdown
\`\`\`json
{ "type": "select", "id": "priority", "label": "Priority", "options": ["Low", "Medium", "High"], "defaultValue": "Medium" }
\`\`\`
Options can also be objects: \`[{ "label": "Display Text", "value": "actual_value" }]\`

**checkbox** — Boolean toggle
\`\`\`json
{ "type": "checkbox", "id": "agree", "label": "I agree to the terms", "defaultChecked": false }
\`\`\`

**radio** — Single choice from options
\`\`\`json
{ "type": "radio", "id": "plan", "label": "Select plan", "options": ["Free", "Pro", "Enterprise"], "defaultValue": "Free" }
\`\`\`

### Display components

**alert** — Informational banner
\`\`\`json
{ "type": "alert", "variant": "info", "text": "This will create a new project." }
\`\`\`
Variants: "primary", "secondary", "success", "danger", "warning", "info"

**progress** — Progress bar
\`\`\`json
{ "type": "progress", "now": 65, "label": "Upload progress", "variant": "success", "striped": true }
\`\`\`

**text** — Simple text paragraph
\`\`\`json
{ "type": "text", "content": "Fill out the form below.", "variant": "muted" }
\`\`\`

### Action buttons

Buttons trigger actions. Place them in the \`actions\` array (rendered at the bottom) or inline in the \`layout\`.

\`\`\`json
{ "type": "button", "label": "Submit", "variant": "primary", "action": "submit_form" }
\`\`\`
- \`action\` — a descriptive string identifier (e.g. "submit_form", "cancel", "next_step", "confirm_delete")
- \`variant\` — "primary", "secondary", "success", "danger", "warning", "info", "outline-primary", "outline-secondary", "link"
- \`size\` — "sm" or "lg" (optional)

### What happens when a button is pressed

When the user clicks a button, you receive a message containing:
1. The \`action\` string you defined on the button
2. All current form field values as a JSON object (keyed by component \`id\`)

You should then process the submitted data and respond appropriately — continue the workflow, store results, update the form, or remove it.

### Complete example

A form for creating a new project, placed in the side panel. Note the flat-object call signature — \`store\`, \`key\`, \`description\`, \`value\`, \`showInUI\`, \`priority\` are all top-level params:

\`\`\`
store_set({
  store: "whiteboard",
  key: "new_project_form",
  description: "New Project",
  showInUI: true,
  priority: "high",
  value: \`
# Create New Project

\\\`\\\`\\\`ui
{
  "layout": [
    { "type": "alert", "variant": "info", "text": "Fill out the details below to create a new project." },
    {
      "type": "row",
      "children": [
        { "type": "col", "width": 8, "children": [
          { "type": "input", "id": "project_name", "label": "Project Name", "placeholder": "My Project", "required": true }
        ]},
        { "type": "col", "width": 4, "children": [
          { "type": "select", "id": "visibility", "label": "Visibility", "options": ["Public", "Private"], "defaultValue": "Private" }
        ]}
      ]
    },
    { "type": "textarea", "id": "description", "label": "Description", "rows": 3, "placeholder": "What is this project about?" },
    { "type": "checkbox", "id": "init_readme", "label": "Initialize with README", "defaultChecked": true }
  ],
  "actions": [
    { "type": "button", "label": "Create Project", "variant": "primary", "action": "create_project" },
    { "type": "button", "label": "Cancel", "variant": "outline-secondary", "action": "cancel_create" }
  ]
}
\\\`\\\`\\\`
  \`
})
\`\`\`

### Interactive UI best practices

- **Every form component needs a unique \`id\`** — this is how values are collected
- **Use descriptive action strings** — you'll receive them back and need to know what to do
- **Combine with regular markdown** — you can mix interactive UI blocks with text, headers, tables in the same card
- **Remove forms after submission** — once processed, update the card with results or remove it
- **Keep forms focused** — one purpose per form, don't overload with too many fields
- **Provide defaults** when reasonable — reduces friction for the user
- **Use alerts** to explain what the form does before the fields
- **Use grid layout** to keep forms compact — put related short fields side by side`;

// ============================================================================
// Plugin Implementation
// ============================================================================

/**
 * Config accepted by DynamicUIPlugin.
 *
 * @property interactiveUI - When `true`, appends the Interactive UI (forms,
 *   buttons, \`\`\`ui blocks) instruction section to the system prompt. Defaults
 *   to `false` — agents only get the Side Panel (showInUI) instructions unless
 *   the host explicitly opts in. Forms add ~190 tokens of prompt overhead and
 *   require the host UI to render \`\`\`ui blocks (see InteractiveUIBlock).
 */
export interface DynamicUIPluginConfig {
  interactiveUI?: boolean;
}

export class DynamicUIPlugin implements IContextPluginNextGen {
  readonly name = 'dynamic_ui';

  private readonly _interactiveUIEnabled: boolean;
  private _instructionsCache: string | null = null;
  private _instructionsTokenCache: number | null = null;

  constructor(config?: DynamicUIPluginConfig | Record<string, unknown>) {
    this._interactiveUIEnabled = (config as DynamicUIPluginConfig | undefined)?.interactiveUI === true;
  }

  // --- Instructions (the only thing this plugin provides) ---

  getInstructions(): string {
    if (this._instructionsCache === null) {
      this._instructionsCache = this._interactiveUIEnabled
        ? SIDE_PANEL_INSTRUCTIONS + INTERACTIVE_UI_INSTRUCTIONS
        : SIDE_PANEL_INSTRUCTIONS;
    }
    return this._instructionsCache;
  }

  getInstructionsTokenSize(): number {
    if (this._instructionsTokenCache === null) {
      this._instructionsTokenCache = estimateTokens(this.getInstructions());
    }
    return this._instructionsTokenCache;
  }

  // --- No content ---

  async getContent(): Promise<null> {
    return null;
  }

  getContents(): null {
    return null;
  }

  getTokenSize(): number {
    return 0;
  }

  // --- Not compactable (no content to compact) ---

  isCompactable(): boolean {
    return false;
  }

  async compact(_targetTokensToFree: number): Promise<number> {
    return 0;
  }

  // --- No tools ---

  getTools(): ToolFunction[] {
    return [];
  }

  // --- No state ---

  getState(): null {
    return null;
  }

  restoreState(_state: unknown): void {
    // No-op: no state to restore
  }

  // --- Cleanup ---

  destroy(): void {
    // No-op: no resources to release
  }
}
