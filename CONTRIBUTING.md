# Contributing to OneRingAI

Welcome, and thank you for considering a contribution to OneRingAI! Whether you're fixing a typo, adding a new vendor provider, building a plugin, or improving documentation — every contribution matters.

## Getting Started

### Prerequisites

- **Node.js 18+**
- **npm** (comes with Node.js)
- Familiarity with **TypeScript** (strict mode)

### Setup

```bash
git clone git@github.com:aantich/oneringai.git
cd oneringai
npm install
npm run build
npm run test:unit
```

### Useful Commands

| Command | Description |
|---|---|
| `npm run build` | Full build (code generation + tsup) |
| `npm run dev` | Watch mode for development |
| `npm run typecheck` | Type checking (no emit) |
| `npm run lint` | ESLint |
| `npm run test:unit` | Run unit tests (vitest) |
| `npm run test:integration` | Integration tests (requires API keys) |

## How to Contribute

### Reporting Issues

Open an issue on [GitHub](https://github.com/aantich/oneringai/issues) with:

- A clear title and description
- Steps to reproduce (if applicable)
- Expected vs. actual behavior
- Your Node.js version and OS

### Submitting a Pull Request

1. **Fork** the repository and create a branch from `main`.
2. Make your changes, following the conventions below.
3. Add or update **unit tests** for any new or changed behavior.
4. Run `npm run typecheck && npm run test:unit` and make sure everything passes.
5. Update `CHANGELOG.md` under `[Unreleased]` with a description of your change.
6. Open a PR against `main` with a clear title and description of *what* and *why*.

We review all PRs and aim to provide feedback promptly. Small, focused PRs are easier to review and merge.

## Architectural Principles

These principles guide every design decision in OneRingAI. Please keep them in mind when contributing.

### 1. Connector-First Design

Authentication flows through the `Connector` registry — the single source of truth for all credentials, resilience config, and vendor metadata. Never scatter auth logic across providers or tools.

```
User Code → Connector Registry → Agent → Provider → LLM
```

- Use `Connector.create()` / `Connector.get()` — never pass raw API keys through constructors.
- Connectors carry resilience (circuit breaker, retry, timeout) so individual tools and providers don't have to.

### 2. Plugin-Based Context Management

`AgentContextNextGen` uses composable plugins for all context features. If you're adding a new context capability, build it as a plugin — not by modifying the core context class.

- Each plugin manages its own token tracking and state.
- Plugins provide: instructions, content, tools.
- Compaction happens **once**, right before the LLM call — not incrementally.

**Existing plugins for reference:**
- `WorkingMemoryPluginNextGen` — tiered external memory with index in context
- `InContextMemoryPluginNextGen` — key-value data stored directly in the prompt
- `PersistentInstructionsPluginNextGen` — disk-persisted agent instructions

### 3. Composition Over Inheritance

Prefer composing behavior from small, focused pieces rather than deep inheritance hierarchies. Agents compose a context, a provider, and a tool manager — they don't inherit from a monolithic base.

### 4. Registry Pattern

Shared resources use static registries with `create()` / `get()` semantics:

- `Connector.create()` / `Connector.get()` — auth
- `MCPRegistry.create()` / `MCPRegistry.get()` — MCP servers
- `ConnectorTools.registerService()` / `ConnectorTools.for()` — service tools

If you're adding a new subsystem that manages named instances, follow this pattern.

### 5. IDisposable for Resource Cleanup

Any class that holds resources (connections, timers, subscriptions) must implement `IDisposable`:

```typescript
interface IDisposable {
  destroy(): void;
  isDestroyed: boolean;
}
```

### 6. Keep It Minimal

- Don't add abstractions for single-use operations.
- Don't add error handling for scenarios that can't happen.
- Three similar lines of code are better than a premature abstraction.
- If a feature needs a new dependency, consider whether it can be lazy-loaded.

## Code Conventions

### ESM with `.js` Extensions

All imports must use the `.js` extension, even for TypeScript files:

```typescript
// Correct
import { Agent } from './Agent.js';
import { Connector } from '../core/Connector.js';

// Incorrect
import { Agent } from './Agent';
import { Agent } from './Agent.ts';
```

### Type Exports

Separate runtime values from type-only exports:

```typescript
export { MessageRole } from './Message.js';        // Enum (runtime value)
export type { Message } from './Message.js';        // Interface (type-only)
```

### Error Handling

Use the custom error classes from `src/domain/errors/AIErrors.ts`:

```typescript
throw new ProviderAuthError('openai', 'Invalid API key');
throw new ToolExecutionError('tool_name', 'Reason');
```

### Tool Definitions

Follow the `ToolFunction` interface:

```typescript
const myTool: ToolFunction = {
  definition: {
    type: 'function',
    function: {
      name: 'tool_name',           // snake_case
      description: 'What it does',
      parameters: { type: 'object', properties: { ... }, required: [...] },
    },
  },
  execute: async (args) => ({ result: 'value' }),
  describeCall: (args) => args.key,  // One-line summary for logs
};
```

### Constants

All default values live in `src/core/constants.ts`. Don't scatter magic numbers across files.

### Testing

- Place unit tests next to the source file or in a `__tests__/` directory.
- Use `vitest` — it's already configured.
- Name test files `*.test.ts`.
- Aim for tests that verify behavior, not implementation details.

## What to Contribute

Here are some areas where contributions are especially welcome:

| Area | Examples |
|---|---|
| **New providers** | Add a vendor to `src/infrastructure/providers/` |
| **New tools** | Filesystem, API, productivity — anything useful for agents |
| **Context plugins** | New `IContextPluginNextGen` implementations |
| **ConnectorTools services** | Add service detection patterns for new APIs |
| **MCP transports** | New transport types for `MCPClient` |
| **OAuth templates** | Pre-configured templates for popular APIs |
| **Documentation** | Improve README, add examples, fix typos |
| **Bug fixes** | Check the [issues](https://github.com/aantich/oneringai/issues) |
| **Tests** | Improve coverage, especially for edge cases |

## Adding a New Vendor Provider

1. Add the vendor to `src/core/Vendor.ts`.
2. Create the provider in `src/infrastructure/providers/<vendor>/`.
3. Extend `BaseTextProvider` from `src/infrastructure/providers/base/`.
4. Register in the factory at `src/core/createProvider.ts`.
5. Add model entries to `src/domain/entities/Model.ts` with pricing and feature flags.
6. Add tests.

## Adding a Context Plugin

1. Create a new class extending `BasePluginNextGen` in `src/core/context-nextgen/plugins/`.
2. Implement `getInstructions()`, `getContent()`, and optionally `getTools()`.
3. Manage your own token tracking via the base class helpers.
4. Register with `ctx.registerPlugin(myPlugin)` or add to the feature flags system.
5. Add tests.

## Code of Conduct

Be respectful, constructive, and inclusive. We're building something together — every contributor deserves a welcoming environment regardless of experience level, background, or identity.

## License

By contributing to OneRingAI, you agree that your contributions will be licensed under the same license as the project.

---

Thank you for helping make OneRingAI better. If you have questions, open an issue or start a discussion — we're happy to help you get oriented.
