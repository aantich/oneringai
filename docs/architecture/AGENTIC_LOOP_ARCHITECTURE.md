# Agentic Loop Architecture

This document provides a detailed explanation of the Agent agentic loop implementation in `oneringai`.

## Table of Contents

1. [High-Level Architecture](#high-level-architecture)
2. [Context Management](#context-management)
3. [Instructions Handling](#instructions-handling)
4. [Tool Calling Flow](#tool-calling-flow)
5. [The Agentic Loop Flow](#the-agentic-loop-flow)
6. [Event System](#event-system)
7. [Hook System](#hook-system)
8. [Streaming vs Non-Streaming](#streaming-vs-non-streaming)
9. [Pause/Resume/Cancel](#pauseresumecancel)

---

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Agent.create()                          │
│  - Resolves connector (name → Connector instance)              │
│  - Creates ITextProvider via createProvider()                  │
│  - Creates AgentContext (with ToolManager inside)              │
│  - Inherits from BaseAgent                                      │
│  - Contains all agentic loop logic inline                      │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Agent                                    │
│  - run() / stream() - main execution methods                    │
│  - Manages iteration cycle (LLM → Tools → LLM → ...)           │
│  - Manages context via AgentContext                             │
│  - Executes hooks at lifecycle points via HookManager           │
│  - Emits events throughout execution via EventEmitter           │
│  - Supports pause/resume/cancel                                 │
└─────────────────────────────────┬───────────────────────────────┘
                                  │
            ┌─────────────────────┼─────────────────┐
            ▼                     ▼                 ▼
     ┌──────────────┐      ┌─────────────┐   ┌─────────────┐
     │ ITextProvider│      │ ToolManager │   │ HookManager │
     └──────────────┘      └─────────────┘   └─────────────┘
```

### Component Responsibilities

| Component | Responsibility |
|-----------|----------------|
| **BaseAgent** | Abstract base class with provider creation, destroy lifecycle |
| **Agent** | Full agentic loop implementation, run/stream, hooks, events |
| **AgentContext** | Unified facade: ToolManager, WorkingMemory, IdempotencyCache |
| **ITextProvider** | Vendor-specific LLM communication (OpenAI, Anthropic, Google, etc.) |
| **ToolManager** | Tool registration, lookup, execution, circuit breakers |
| **ExecutionContext** | Per-execution metrics, history, audit trail, resource limits |
| **HookManager** | Hook registration and execution at lifecycle points |

---

## Context Management

The context is managed through a growing array of `InputItem[]` that accumulates across iterations.

### Message Types

```typescript
// Input message types
export type InputItem = Message | CompactionItem;

// Message structure
export interface Message {
  type: 'message';
  id?: string;
  role: MessageRole;  // 'user' | 'assistant' | 'developer'
  content: Content[];
}

// Content types
export enum ContentType {
  INPUT_TEXT = 'input_text',
  INPUT_IMAGE_URL = 'input_image_url',
  INPUT_FILE = 'input_file',
  OUTPUT_TEXT = 'output_text',
  TOOL_USE = 'tool_use',
  TOOL_RESULT = 'tool_result',
}
```

### Context Building After Tool Calls

After each iteration with tool calls, context is built via `buildInputWithToolResults()`:

```typescript
private buildInputWithToolResults(
  previousOutput: OutputItem[],
  toolResults: ToolResult[]
): InputItem[] {
  const input: InputItem[] = [];

  // 1. Add assistant's previous response (contains tool_use content)
  for (const item of previousOutput) {
    if (item.type === 'message') {
      input.push(item);
    }
  }

  // 2. Add tool results as USER message with tool_result content
  const toolResultContents: ToolResultContent[] = toolResults.map((result) => ({
    type: ContentType.TOOL_RESULT,
    tool_use_id: result.tool_use_id,
    content: result.content,
    error: result.error,
  }));

  if (toolResultContents.length > 0) {
    input.push({
      type: 'message',
      role: MessageRole.USER,
      content: toolResultContents,
    });
  }

  return input;
}
```

### Example Context Flow

```
Iteration 1:
  Input: "What's the weather in Paris?"
  Output: [assistant message with tool_use: get_weather({location: "Paris"})]

Iteration 2:
  Input: [
    {role: assistant, content: [tool_use: get_weather]},
    {role: user, content: [tool_result: {temp: 72}]}
  ]
  Output: "The weather in Paris is 72°F"
```

### Context Sliding Window

To prevent unbounded memory growth, a sliding window is applied:

```typescript
const maxInputMessages = config.limits?.maxInputMessages ?? 50;
if (currentInput.length > maxInputMessages) {
  const firstMessage = currentInput[0];
  const recentMessages = currentInput.slice(-(maxInputMessages - 1));

  // Preserve system/developer message
  if (firstMessage?.role === MessageRole.DEVELOPER) {
    currentInput = [firstMessage, ...recentMessages];
  } else {
    currentInput = currentInput.slice(-maxInputMessages);
  }
}
```

---

## Instructions Handling

Instructions (system prompts) are handled through the `instructions` field in Agent configuration.

### Flow

1. **Agent.run()** passes `config.instructions` to the generate methods
2. **generateWithHooks()** includes instructions in every LLM call
3. **Provider** converts instructions to vendor-specific format

### Provider-Specific Handling

| Provider | Instructions Handling |
|----------|----------------------|
| **OpenAI** | Prepended as `developer` role message |
| **Anthropic** | Set as `system` parameter |
| **Google** | Set as `systemInstruction` field |

### OpenAI Example

```typescript
// OpenAITextProvider.convertInput()
if (instructions && !hasDeveloperMessage) {
  messages.push({
    role: 'developer',
    content: instructions,
  });
}
```

### Anthropic Example

```typescript
// AnthropicConverter.convertRequest()
if (options.instructions) {
  params.system = options.instructions;
}
```

### Google Example

```typescript
// GoogleConverter.convertRequest()
if (options.instructions) {
  request.systemInstruction = { parts: [{ text: options.instructions }] };
}
```

---

## Tool Calling Flow

### Step 1: Extract Tool Calls from Response

```typescript
private extractToolCalls(output: OutputItem[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];

  for (const item of output) {
    if (item.type === 'message' && item.role === MessageRole.ASSISTANT) {
      for (const content of item.content) {
        if (content.type === ContentType.TOOL_USE) {
          toolCalls.push({
            id: content.id,
            type: 'function',
            function: {
              name: content.name,
              arguments: content.arguments,  // JSON string
            },
            blocking: true,
            state: ToolCallState.PENDING,
          });
        }
      }
    }
  }
  return toolCalls;
}
```

### Step 2: Execute Tools via ToolManager

```typescript
// ToolManager.execute()
async execute(toolName: string, args: any): Promise<any> {
  const tool = this.get(toolName);
  if (!tool) throw new ToolNotFoundError(toolName);

  return await tool.execute(args);
}
```

### Step 3: Timeout Handling

Tools are wrapped with configurable timeout (default 30 seconds):

```typescript
private async executeWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new ToolTimeoutError('tool', timeoutMs));
    }, timeoutMs);

    fn()
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((error) => { clearTimeout(timer); reject(error); });
  });
}
```

### Tool Results Format

Tool results are wrapped in a USER role message with `tool_result` content:

```typescript
{
  type: 'message',
  role: MessageRole.USER,
  content: [{
    type: ContentType.TOOL_RESULT,
    tool_use_id: 'call_abc123',
    content: { temp: 72, location: 'Paris' },
    error: undefined
  }]
}
```

Each provider converts this to their native format:
- **OpenAI**: Separate `role: 'tool'` messages
- **Anthropic**: `tool_result` blocks in user message
- **Google**: `functionResponse` parts in user message

---

## The Agentic Loop Flow

### Complete Execution Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     EXECUTION START                               │
│  1. Generate executionId (exec_uuid)                             │
│  2. Create ExecutionContext                                      │
│  3. Reset paused/cancelled flags                                 │
│  4. Emit 'execution:start' event                                 │
│  5. Execute 'before:execution' hook                              │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│              ITERATION LOOP (while iteration < maxIterations)    │
│                                                                   │
│  1. checkPause() - wait if paused                                │
│  2. Check if cancelled → throw Error                             │
│  3. context.checkLimits() - time, tool calls, context size      │
│  4. Execute 'pause:check' hook - dynamic pause decisions        │
│  5. Emit 'iteration:start' event                                │
│                                                                   │
│  6. ──► LLM CALL ◄──                                             │
│     • Execute 'before:llm' hook (can modify options)            │
│     • Emit 'llm:request' event                                  │
│     • Call provider.generate()                                   │
│     • Emit 'llm:response' event                                 │
│     • Execute 'after:llm' hook                                  │
│                                                                   │
│  7. Extract tool calls from response                             │
│  8. Emit 'tool:detected' if tools found                         │
│                                                                   │
│  9. IF NO TOOL CALLS:                                            │
│     • Emit 'iteration:complete'                                  │
│     • Set finalResponse = response                               │
│     • BREAK loop                                                 │
│                                                                   │
│  10. IF TOOL CALLS EXIST:                                        │
│     For each tool:                                               │
│     ├─ context.addToolCall()                                     │
│     ├─ checkPause()                                              │
│     ├─ Execute 'before:tool' hook (can skip/modify)             │
│     ├─ Execute 'approve:tool' hook (can reject)                 │
│     ├─ Emit 'tool:start' event                                  │
│     ├─ Execute tool with timeout                                 │
│     ├─ Execute 'after:tool' hook (can modify result)            │
│     └─ Emit 'tool:complete' or 'tool:error'                     │
│                                                                   │
│  11. Store iteration record in context                           │
│  12. Update metrics (tokens, durations)                          │
│  13. Emit 'iteration:complete' event                             │
│  14. Build next input with tool results                          │
│  15. iteration++ → Loop back                                     │
└──────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     EXECUTION COMPLETE                            │
│  1. Check if hit maxIterations → throw error                     │
│  2. Calculate totalDuration                                      │
│  3. Execute 'after:execution' hook                               │
│  4. Emit 'execution:complete' event                              │
│  5. Return finalResponse                                         │
│                                                                   │
│  FINALLY (always runs):                                          │
│  • executionContext.cleanup() - clear for GC                     │
│  • hookManager.clear()                                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## Event System

Events are emitted via EventEmitter3 directly from Agent.

### Available Events

| Event | Payload | When |
|-------|---------|------|
| `execution:start` | executionId, config, timestamp | Loop begins |
| `execution:complete` | executionId, response, duration | Loop completes successfully |
| `execution:error` | executionId, error, timestamp | Unrecoverable error |
| `execution:paused` | executionId, reason, timestamp | Pause requested |
| `execution:resumed` | executionId, timestamp | Resumed from pause |
| `execution:cancelled` | executionId, reason, timestamp | Cancelled |
| `iteration:start` | executionId, iteration, timestamp | Iteration begins |
| `iteration:complete` | executionId, iteration, response, duration | Iteration ends |
| `llm:request` | executionId, iteration, options, timestamp | Before LLM call |
| `llm:response` | executionId, iteration, response, duration | After LLM response |
| `llm:error` | executionId, iteration, error, timestamp | LLM call failed |
| `tool:detected` | executionId, iteration, toolCalls, timestamp | Tools found in response |
| `tool:start` | executionId, iteration, toolCall, timestamp | Tool execution begins |
| `tool:complete` | executionId, iteration, toolCall, result | Tool succeeded |
| `tool:error` | executionId, iteration, toolCall, error | Tool failed |
| `tool:timeout` | executionId, iteration, toolCall, timeout | Tool timed out |
| `hook:error` | hookName, error, timestamp | Hook threw error |

### Usage Example

```typescript
const agent = Agent.create({ connector: 'openai', model: 'gpt-4' });

agent.on('tool:start', ({ toolCall }) => {
  console.log(`Executing tool: ${toolCall.function.name}`);
});

agent.on('tool:complete', ({ toolCall, result }) => {
  console.log(`Tool ${toolCall.function.name} completed:`, result);
});

agent.on('execution:complete', ({ response, duration }) => {
  console.log(`Completed in ${duration}ms`);
});
```

---

## Hook System

Hooks inject custom logic at lifecycle points via HookManager.

### Available Hooks

| Hook | When | Can Modify | Return |
|------|------|------------|--------|
| `before:execution` | Before loop starts | Config | `{}` |
| `after:execution` | After loop completes | Response | `{}` |
| `before:llm` | Before LLM call | Options | `{ modified?, skip? }` |
| `after:llm` | After LLM response | - | `{}` |
| `before:tool` | Before tool execution | Args | `{ modified?, skip?, mockResult? }` |
| `after:tool` | After tool execution | Result | `{ modified? }` |
| `approve:tool` | Before tool (approval gate) | - | `{ approved, reason? }` |
| `pause:check` | Each iteration | - | `{ shouldPause, reason? }` |

### Hook Example

```typescript
const agent = Agent.create({
  connector: 'openai',
  model: 'gpt-4',
  hooks: {
    'before:tool': async ({ toolCall }) => {
      // Log all tool calls
      console.log(`About to execute: ${toolCall.function.name}`);
      return {};
    },
    'approve:tool': async ({ toolCall }) => {
      // Block dangerous tools
      if (toolCall.function.name === 'delete_all_data') {
        return { approved: false, reason: 'Dangerous operation blocked' };
      }
      return { approved: true };
    },
  },
});
```

---

## Streaming vs Non-Streaming

The library provides two execution modes that share unified core logic.

### Comparison Table

| Aspect | `run()` | `stream()` |
|--------|---------|------------|
| Return type | `Promise<AgentResponse>` | `AsyncIterableIterator<StreamEvent>` |
| Context building | Unified via `appendToContext()` | Unified via `appendToContext()` |
| Sliding window | Unified via `applySlidingWindow()` | Unified via `applySlidingWindow()` |
| Tool error handling | Respects `toolFailureMode` | Respects `toolFailureMode` |
| History preservation | Full history preserved | Full history preserved |

### Shared Helper Methods

Both execution modes use the same core methods for context management:

```typescript
// Build new messages from LLM response and tool results
private buildNewMessages(previousOutput: OutputItem[], toolResults: ToolResult[]): InputItem[]

// Append new messages to context, preserving history
private appendToContext(currentInput: string | InputItem[], newMessages: InputItem[]): InputItem[]

// Apply sliding window to prevent unbounded growth (tool-boundary safe)
private applySlidingWindow(input: InputItem[], maxMessages: number): InputItem[]

// Find safe cut point that doesn't break tool_use/tool_result pairs
private findSafeToolBoundary(input: InputItem[], targetIndex: number): number

// Verify tool_use and tool_result IDs are balanced in a slice
private isToolBoundarySafe(input: InputItem[], startIndex: number): boolean
```

### Tool Boundary Safety

The sliding window implementation ensures tool_use and tool_result pairs are never broken:

1. **Every `tool_result` must have a matching `tool_use`** - Starting context with an orphaned tool_result would cause API errors
2. **Every `tool_use` should have a matching `tool_result`** - Except for the last message in current iteration (pending execution)
3. **Safe boundary detection** - The algorithm searches for cut points where all tool IDs are balanced

### Streaming Event Types

```typescript
export enum StreamEventType {
  RESPONSE_CREATED = 'response.created',
  OUTPUT_TEXT_DELTA = 'response.output_text.delta',
  TOOL_CALL_START = 'response.tool_call.start',
  TOOL_CALL_ARGUMENTS_DELTA = 'response.tool_call.arguments.delta',
  TOOL_CALL_ARGUMENTS_DONE = 'response.tool_call.arguments.done',
  TOOL_EXECUTION_START = 'response.tool_execution.start',
  TOOL_EXECUTION_DONE = 'response.tool_execution.done',
  ITERATION_COMPLETE = 'response.iteration.complete',
  RESPONSE_COMPLETE = 'response.complete',
  ERROR = 'error',
}
```

### Streaming Usage

```typescript
for await (const event of agent.stream('What is the weather?')) {
  switch (event.type) {
    case StreamEventType.OUTPUT_TEXT_DELTA:
      process.stdout.write(event.delta);
      break;
    case StreamEventType.TOOL_EXECUTION_START:
      console.log(`\nExecuting: ${event.tool_name}`);
      break;
    case StreamEventType.RESPONSE_COMPLETE:
      console.log(`\nDone! Used ${event.usage.total_tokens} tokens`);
      break;
  }
}
```

---

## Pause/Resume/Cancel

Agent supports pausing, resuming, and cancelling execution mid-flight.

### Methods

```typescript
// Pause execution (blocks at next safe point)
agent.pause(reason?: string): void

// Resume execution
agent.resume(): void

// Cancel execution entirely
agent.cancel(reason?: string): void

// Check current state
agent.isPaused: boolean
agent.isCancelled: boolean
```

### Pause Points

Execution pauses at safe points:
- Before each iteration starts
- Before each tool execution
- Via `pause:check` hook returning `{ shouldPause: true }`

### Example

```typescript
const agent = Agent.create({ connector: 'openai', model: 'gpt-4' });

// Listen for pause events
agent.on('execution:paused', ({ reason }) => {
  console.log(`Paused: ${reason}`);
});

// Start execution
const resultPromise = agent.run('Process these files');

// Pause after 5 seconds
setTimeout(() => {
  agent.pause('User requested pause');
}, 5000);

// Resume after user confirms
userConfirmButton.onClick(() => {
  agent.resume();
});

const result = await resultPromise;
```

---

## File References

| File | Purpose |
|------|---------|
| `src/core/Agent.ts` | Full Agent implementation with agentic loop |
| `src/core/BaseAgent.ts` | Abstract base class with provider creation |
| `src/core/AgentContext.ts` | Unified context facade |
| `src/core/ToolManager.ts` | Tool registration/execution |
| `src/capabilities/agents/ExecutionContext.ts` | Metrics, history, limits |
| `src/capabilities/agents/HookManager.ts` | Hook orchestration |
| `src/capabilities/agents/types/EventTypes.ts` | Event type definitions |
| `src/capabilities/agents/types/HookTypes.ts` | Hook type definitions |
| `src/domain/entities/Message.ts` | InputItem, OutputItem types |
| `src/domain/entities/Content.ts` | Content types |
| `src/domain/entities/Tool.ts` | ToolFunction, ToolCall types |
| `src/infrastructure/providers/*/` | Provider implementations |

---

**Version:** 0.3.0
**Last Updated:** 2026-02-02
**Changes:** Merged AgenticLoop into Agent class - all agentic loop logic now lives directly in Agent
