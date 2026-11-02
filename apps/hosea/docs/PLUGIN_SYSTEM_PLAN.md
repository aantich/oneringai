# hosea Plugin System - Implementation Plan

> Runtime-loadable tool plugins for pre-built hosea Electron app

## 1. Overview

Allow users of the pre-built hosea app (installed via dmg/exe/AppImage) to extend the agent with custom tools by loading JavaScript plugins at runtime. Plugins are discovered from a well-known directory on disk and optionally installed via npm packages through the UI.

### Goals

- Users can add new tools without rebuilding the app
- Plugin API is simple: export a well-defined object, get tools registered
- Works with the existing `UnifiedToolCatalog` / `IToolProvider` architecture
- Security-conscious: plugins run with explicit user consent, tools require approval by default
- Supports both "drop a JS file" and "install npm package" workflows

### Non-Goals (v1)

- Plugin marketplace / registry
- Sandboxed execution (v2 consideration)
- Hot-reload while agent is mid-conversation
- Plugin-to-plugin dependencies

---

## 2. Architecture

### 2.1 Plugin Contract

Each plugin is a CommonJS module that exports a `HoseaPlugin` object:

```typescript
// hosea-plugin-contract.d.ts (published as hosea-plugin-types)

import type { ToolFunction } from 'oneringai';

export interface HoseaPlugin {
  /** Unique plugin identifier (kebab-case, e.g. "my-weather-tools") */
  name: string;
  /** SemVer version string */
  version: string;
  /** Human-readable display name */
  displayName: string;
  /** Brief description shown in UI */
  description: string;
  /** Author name or organization */
  author?: string;
  /** Tool definitions provided by this plugin */
  tools: HoseaPluginTool[];
  /** Called once when plugin is loaded. Receive app context for logging, config, etc. */
  activate?: (context: PluginActivationContext) => Promise<void> | void;
  /** Called when plugin is unloaded or app shuts down */
  deactivate?: () => Promise<void> | void;
}

export interface HoseaPluginTool {
  /** Tool category for UI grouping */
  category?: string;
  /** Human-readable display name */
  displayName: string;
  /** Whether this tool is safe without user approval (default: false) */
  safeByDefault?: boolean;
  /** The ToolFunction definition + execute handler */
  tool: ToolFunction;
}

export interface PluginActivationContext {
  /** Hosea app version */
  appVersion: string;
  /** Path to plugin's persistent data directory */
  dataDir: string;
  /** Logger scoped to this plugin */
  log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
}
```

### 2.2 Plugin Directory Structure

```
~/.hosea/plugins/
├── manifest.json              # Tracks installed plugins + enabled state
├── my-weather-tools/
│   ├── index.js               # Plugin entry point (CJS)
│   └── package.json           # Optional, for npm-installed plugins
├── custom-db-tools/
│   ├── index.js
│   └── node_modules/          # Plugin's own dependencies
└── node_modules/              # Shared dependencies (npm --prefix installs here)
```

### 2.3 Manifest File

```json
{
  "version": 1,
  "plugins": {
    "my-weather-tools": {
      "enabled": true,
      "source": "local",
      "path": "my-weather-tools",
      "installedAt": "2026-01-15T10:00:00Z"
    },
    "hosea-plugin-db": {
      "enabled": true,
      "source": "npm",
      "package": "hosea-plugin-db",
      "version": "1.2.0",
      "path": "node_modules/hosea-plugin-db",
      "installedAt": "2026-01-20T14:30:00Z"
    }
  }
}
```

### 2.4 Component Diagram

```
┌──────────────────────────────────────────────────────┐
│  hosea Main Process                     │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  UnifiedToolCatalog                             │ │
│  │                                                 │ │
│  │  ┌──────────────┐  ┌───────────────────────┐   │ │
│  │  │ OneRingTool   │  │ BrowserToolProvider   │   │ │
│  │  │ Provider      │  │                       │   │ │
│  │  └──────────────┘  └───────────────────────┘   │ │
│  │                                                 │ │
│  │  ┌──────────────────────────────────────────┐  │ │
│  │  │ UserPluginProvider          (NEW)        │  │ │
│  │  │                                          │  │ │
│  │  │  ┌────────────┐  ┌────────────┐         │  │ │
│  │  │  │ Plugin A   │  │ Plugin B   │  ...    │  │ │
│  │  │  │ (2 tools)  │  │ (1 tool)   │         │  │ │
│  │  │  └────────────┘  └────────────┘         │  │ │
│  │  └──────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  PluginManager                  (NEW)           │ │
│  │  - scanPluginsDir()                             │ │
│  │  - loadPlugin(path)                             │ │
│  │  - installFromNpm(packageName)                  │ │
│  │  - uninstallPlugin(name)                        │ │
│  │  - enablePlugin(name) / disablePlugin(name)     │ │
│  │  - getInstalledPlugins()                        │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  IPC Handlers                   (NEW)           │ │
│  │  plugin:list, plugin:install, plugin:remove,    │ │
│  │  plugin:enable, plugin:disable, plugin:reload   │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│  hosea Renderer                         │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  PluginsPage                    (NEW)           │ │
│  │  - List installed plugins                       │ │
│  │  - Enable/disable toggle per plugin             │ │
│  │  - Install from npm input                       │ │
│  │  - Install from local folder picker             │ │
│  │  - Uninstall button                             │ │
│  │  - Per-plugin tool list                         │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

---

## 3. Implementation Phases

### Phase 1: Core Plugin Loading (Local Files)

**New files:**

| File | Purpose |
|------|---------|
| `src/main/plugins/PluginManager.ts` | Plugin lifecycle: scan, load, validate, unload |
| `src/main/tools/providers/UserPluginProvider.ts` | `IToolProvider` that exposes plugin tools to catalog |
| `src/shared/plugin-types.ts` | Shared type definitions (HoseaPlugin, manifest, etc.) |

**Changes to existing files:**

| File | Change |
|------|--------|
| `src/main/AgentService.ts` | Initialize `PluginManager`, register `UserPluginProvider` |
| `src/main/index.ts` | Add plugin IPC handlers |
| `src/preload/index.ts` | Expose plugin API to renderer |

#### 3.1 PluginManager

```typescript
// src/main/plugins/PluginManager.ts

export class PluginManager {
  private plugins: Map<string, LoadedPlugin> = new Map();
  private pluginsDir: string;
  private manifestPath: string;

  constructor(pluginsDir: string) { ... }

  /** Scan plugins directory and load all enabled plugins */
  async initialize(): Promise<PluginLoadResult[]> { ... }

  /** Load a single plugin from a directory */
  async loadPlugin(pluginDir: string): Promise<PluginLoadResult> {
    // 1. Resolve entry point (index.js or package.json main)
    // 2. require() the module
    // 3. Validate exports match HoseaPlugin contract
    // 4. Validate tool definitions (name uniqueness, valid schema)
    // 5. Call plugin.activate() if present
    // 6. Store in loaded plugins map
    // 7. Update manifest
  }

  /** Unload a plugin (call deactivate, remove from map) */
  async unloadPlugin(name: string): Promise<void> { ... }

  /** Get all tools from all loaded plugins */
  getAllTools(): UnifiedToolEntry[] { ... }

  /** Enable/disable without unloading */
  async setEnabled(name: string, enabled: boolean): Promise<void> { ... }

  /** Get plugin metadata for UI */
  getInstalledPlugins(): PluginInfo[] { ... }

  /** Install from npm package */
  async installFromNpm(packageName: string, version?: string): Promise<PluginLoadResult> {
    // 1. Run: npm install <package> --prefix <pluginsDir> --save=false
    // 2. Resolve installed path
    // 3. loadPlugin() from installed path
    // 4. Update manifest with source: 'npm'
  }

  /** Install from local path (copy or symlink) */
  async installFromLocal(sourcePath: string): Promise<PluginLoadResult> { ... }

  /** Uninstall plugin (unload + delete files) */
  async uninstall(name: string): Promise<void> { ... }

  /** Reload a single plugin (unload + load) */
  async reloadPlugin(name: string): Promise<PluginLoadResult> { ... }
}
```

#### 3.2 UserPluginProvider

```typescript
// src/main/tools/providers/UserPluginProvider.ts

export class UserPluginProvider implements IToolProvider {
  readonly name = 'user-plugins';
  readonly source = 'custom' as const;

  constructor(private pluginManager: PluginManager) {}

  getTools(): UnifiedToolEntry[] {
    return this.pluginManager.getAllTools();
  }

  getToolByName(name: string): UnifiedToolEntry | undefined {
    return this.getTools().find(t => t.name === name);
  }
}
```

#### 3.3 Plugin Validation

On load, validate:

1. **Structure**: Exported object has `name`, `version`, `tools` array
2. **Naming**: Plugin name is kebab-case, tool names are snake_case, no collisions with built-in tools
3. **Tool schemas**: Each tool has valid `definition.function` with `name`, `description`, `parameters`
4. **Tool execute**: Each tool has an `execute` function
5. **No prototype pollution**: Basic check that exports don't modify globals

```typescript
function validatePlugin(exports: unknown): ValidationResult {
  // Type guard checks
  // Name format validation
  // Tool definition validation
  // Return { valid: boolean, errors: string[] }
}
```

#### 3.4 Loading Mechanism

```typescript
function loadPluginModule(entryPath: string): HoseaPlugin {
  // Clear require cache to support reload
  delete require.cache[require.resolve(entryPath)];

  // Load the module
  const mod = require(entryPath);

  // Support both default export and direct export
  const plugin = mod.default || mod;

  // Validate
  const result = validatePlugin(plugin);
  if (!result.valid) {
    throw new PluginValidationError(result.errors);
  }

  return plugin;
}
```

### Phase 2: npm Install Support

**Additional changes:**

| File | Change |
|------|--------|
| `src/main/plugins/PluginManager.ts` | Add `installFromNpm()`, `uninstall()` |
| `src/main/plugins/NpmHelper.ts` | Wrapper around child_process npm commands |

#### 3.5 NpmHelper

```typescript
// src/main/plugins/NpmHelper.ts

export class NpmHelper {
  /**
   * Install a package to the plugins directory.
   * Uses Electron's bundled Node but calls npm via npx/global npm.
   */
  static async install(
    packageName: string,
    pluginsDir: string,
    version?: string
  ): Promise<NpmInstallResult> {
    const spec = version ? `${packageName}@${version}` : packageName;

    // Strategy 1: Use global npm if available
    // Strategy 2: Use npx (comes with Node)
    // Strategy 3: Use Electron's bundled node with a vendored npm

    const result = await execAsync(
      `npm install ${spec} --prefix "${pluginsDir}" --no-save --ignore-scripts`,
      { timeout: 120_000 }
    );

    return { success: true, installedPath: ... };
  }

  static async uninstall(packageName: string, pluginsDir: string): Promise<void> { ... }

  /** Check what version is installed */
  static async getInstalledVersion(packageName: string, pluginsDir: string): Promise<string | null> { ... }
}
```

**Key decisions for npm install:**

- `--no-save`: Don't create/modify package.json in plugins dir
- `--ignore-scripts`: Security - don't run postinstall scripts by default (user can override)
- Timeout: 2 minutes for install operations
- Dependencies: Each plugin gets its own `node_modules` if installed standalone, or shares via the plugins dir `node_modules/` if installed via npm

### Phase 3: UI Integration

**New files:**

| File | Purpose |
|------|---------|
| `src/renderer/pages/PluginsPage.tsx` | Plugin management UI |
| `src/renderer/components/PluginCard.tsx` | Individual plugin display card |

#### 3.6 PluginsPage UI

```
┌─────────────────────────────────────────────────────────┐
│  Plugins                                    [+ Add]     │
│─────────────────────────────────────────────────────────│
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Weather Tools                        v1.0.0    │   │
│  │  Fetch weather data from OpenWeatherMap API     │   │
│  │  Author: community                             │   │
│  │  Tools: get_weather, get_forecast               │   │
│  │  Source: npm (hosea-plugin-weather)             │   │
│  │                                                 │   │
│  │  [Enabled ✓]              [Reload] [Uninstall]  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  My Custom Tools                      v0.1.0    │   │
│  │  Internal company tools                         │   │
│  │  Tools: query_internal_api                      │   │
│  │  Source: local                                  │   │
│  │                                                 │   │
│  │  [Enabled ✓]              [Reload] [Uninstall]  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│─────────────────────────────────────────────────────────│
│  Add Plugin                                             │
│                                                         │
│  [npm package name...        ] [Install]                │
│                  - or -                                  │
│  [Select local folder...     ] [Load]                   │
└─────────────────────────────────────────────────────────┘
```

#### 3.7 IPC Handlers

```typescript
// In src/main/index.ts

ipcMain.handle('plugin:list', async () => {
  return pluginManager.getInstalledPlugins();
});

ipcMain.handle('plugin:install-npm', async (_, packageName: string, version?: string) => {
  return pluginManager.installFromNpm(packageName, version);
});

ipcMain.handle('plugin:install-local', async (_, folderPath: string) => {
  return pluginManager.installFromLocal(folderPath);
});

ipcMain.handle('plugin:uninstall', async (_, name: string) => {
  await pluginManager.uninstall(name);
  catalog.invalidateCache();
});

ipcMain.handle('plugin:enable', async (_, name: string) => {
  await pluginManager.setEnabled(name, true);
  catalog.invalidateCache();
});

ipcMain.handle('plugin:disable', async (_, name: string) => {
  await pluginManager.setEnabled(name, false);
  catalog.invalidateCache();
});

ipcMain.handle('plugin:reload', async (_, name: string) => {
  return pluginManager.reloadPlugin(name);
});
```

#### 3.8 Preload Bridge

```typescript
// In src/preload/index.ts - add to HoseaAPI

plugins: {
  list: () => ipcRenderer.invoke('plugin:list'),
  installNpm: (pkg: string, version?: string) => ipcRenderer.invoke('plugin:install-npm', pkg, version),
  installLocal: (path: string) => ipcRenderer.invoke('plugin:install-local', path),
  uninstall: (name: string) => ipcRenderer.invoke('plugin:uninstall', name),
  enable: (name: string) => ipcRenderer.invoke('plugin:enable', name),
  disable: (name: string) => ipcRenderer.invoke('plugin:disable', name),
  reload: (name: string) => ipcRenderer.invoke('plugin:reload', name),
}
```

---

## 4. Security Considerations

### 4.1 Threat Model

Plugins run in Electron's main process with full Node.js access. This is the same trust level as MCP servers (stdio transport). Users must understand they are running third-party code.

### 4.2 Mitigations (v1)

| Risk | Mitigation |
|------|------------|
| Malicious plugin | User consent dialog before loading any plugin |
| Tool abuse | All plugin tools default to `safeByDefault: false` (require approval) |
| npm postinstall scripts | `--ignore-scripts` flag on install |
| Startup crash from bad plugin | Try/catch around each plugin load, disable on failure |
| Name collisions | Validate tool names don't collide with built-in tools |
| Plugin modifies globals | Validate exports don't contain prototype modifications |

### 4.3 Future Mitigations (v2)

- Run plugins in a `worker_thread` or `child_process` with IPC bridge
- Capability-based permissions (plugin declares what it needs: filesystem, network, etc.)
- Plugin signing / checksum verification
- Community-curated allowlist of trusted packages

---

## 5. Plugin Development Guide (User-Facing)

### Minimal Plugin Example

```javascript
// ~/.hosea/plugins/hello-world/index.js

module.exports = {
  name: 'hello-world',
  version: '1.0.0',
  displayName: 'Hello World',
  description: 'A simple example plugin',

  tools: [
    {
      displayName: 'Say Hello',
      tool: {
        definition: {
          type: 'function',
          function: {
            name: 'say_hello',
            description: 'Returns a greeting for the given name',
            parameters: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Name to greet' }
              },
              required: ['name']
            }
          }
        },
        execute: async (args) => {
          return { greeting: `Hello, ${args.name}!` };
        }
      }
    }
  ]
};
```

### Plugin with Dependencies (npm)

```javascript
// Published as: hosea-plugin-weather

const axios = require('axios');

module.exports = {
  name: 'weather-tools',
  version: '1.0.0',
  displayName: 'Weather Tools',
  description: 'Get weather data from OpenWeatherMap',
  author: 'Community',

  activate: async (ctx) => {
    ctx.log.info('Weather plugin activated');
  },

  tools: [
    {
      displayName: 'Get Weather',
      category: 'web',
      tool: {
        definition: {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather for a city',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string', description: 'City name' },
                apiKey: { type: 'string', description: 'OpenWeatherMap API key' }
              },
              required: ['city', 'apiKey']
            }
          }
        },
        execute: async ({ city, apiKey }) => {
          const res = await axios.get(
            `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${apiKey}&units=metric`
          );
          return {
            city: res.data.name,
            temp: res.data.main.temp,
            description: res.data.weather[0].description
          };
        }
      }
    }
  ]
};
```

### Plugin with Activation Context

```javascript
const fs = require('fs');
const path = require('path');

let dataDir;

module.exports = {
  name: 'notes-tools',
  version: '1.0.0',
  displayName: 'Notes',
  description: 'Persistent note-taking tools',

  activate: async (ctx) => {
    dataDir = ctx.dataDir;
    // Ensure data directory exists
    fs.mkdirSync(dataDir, { recursive: true });
    ctx.log.info(`Notes plugin ready, data at: ${dataDir}`);
  },

  deactivate: async () => {
    dataDir = null;
  },

  tools: [
    {
      displayName: 'Save Note',
      tool: {
        definition: {
          type: 'function',
          function: {
            name: 'save_note',
            description: 'Save a named note to persistent storage',
            parameters: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                content: { type: 'string' }
              },
              required: ['title', 'content']
            }
          }
        },
        execute: async ({ title, content }) => {
          const filePath = path.join(dataDir, `${title}.md`);
          fs.writeFileSync(filePath, content, 'utf8');
          return { saved: true, path: filePath };
        }
      }
    }
  ]
};
```

---

## 6. Integration with Existing Systems

### 6.1 Tool Catalog

Plugin tools appear in the existing tool catalog alongside built-in tools. The `source` field is set to `'custom'` so the UI can distinguish them.

In the Agent Editor, plugin tools show up in the tool selection list with a "Plugin" badge. Users enable/disable them per agent just like any other tool.

### 6.2 Tool Permissions

Plugin tools default to `safeByDefault: false`. This means every plugin tool call requires user approval via the existing permission system. Plugin authors can set `safeByDefault: true` for read-only tools, but the UI should warn users about this.

### 6.3 MCP Coexistence

Plugins and MCP servers serve different use cases:
- **Plugins**: In-process, low-latency, direct access to Node.js APIs, simpler to write
- **MCP**: Out-of-process, language-agnostic, protocol-based, better isolation

Both register tools into the same `UnifiedToolCatalog`. No conflicts as long as tool names are unique.

### 6.4 Category System

Plugins can specify a `category` per tool. Unknown categories get mapped to `'other'`. To add custom category display names, the `CATEGORY_DISPLAY_NAMES` map will accept a `plugins` category:

```typescript
export const CATEGORY_DISPLAY_NAMES: Record<HoseaToolCategory, string> = {
  // ... existing
  plugins: 'Plugins',
};
```

---

## 7. File Changes Summary

### New Files

| File | Phase | Description |
|------|-------|-------------|
| `src/main/plugins/PluginManager.ts` | 1 | Core plugin lifecycle management |
| `src/main/plugins/PluginValidator.ts` | 1 | Plugin contract validation |
| `src/main/plugins/NpmHelper.ts` | 2 | npm install/uninstall wrapper |
| `src/main/tools/providers/UserPluginProvider.ts` | 1 | IToolProvider for plugin tools |
| `src/shared/plugin-types.ts` | 1 | Shared type definitions |
| `src/renderer/pages/PluginsPage.tsx` | 3 | Plugin management UI |
| `src/renderer/components/PluginCard.tsx` | 3 | Plugin card component |

### Modified Files

| File | Phase | Change |
|------|-------|--------|
| `src/main/AgentService.ts` | 1 | Init PluginManager, register UserPluginProvider |
| `src/main/index.ts` | 1 | Add plugin IPC handlers |
| `src/preload/index.ts` | 1 | Expose plugin API |
| `src/main/tools/UnifiedToolCatalog.ts` | 1 | Add `'plugins'` category, extend `source` type |
| `src/renderer/App.tsx` | 3 | Add Plugins page route |

---

## 8. Open Questions

1. **ESM plugins**: Should we support ES module plugins via `await import()` in addition to CJS `require()`? The app bundles as CJS, but plugin authors may prefer ESM. Could support both with a detection heuristic.

2. **Plugin data isolation**: Should each plugin get its own `dataDir` (proposed), or share a common data directory? Per-plugin is cleaner but more complex.

3. **Auto-update plugins**: Should npm-installed plugins auto-update? Could check for updates on app launch and prompt the user.

4. **Plugin settings**: Should plugins be able to declare configuration schema (e.g., API keys) that the UI renders as a settings form? This would be powerful but adds complexity.

5. **Tool namespacing**: Should plugin tool names be auto-prefixed (e.g., `weather__get_forecast`) to avoid collisions? Or rely on validation-time collision checks? Prefixing is safer but makes tool names uglier for the LLM.
