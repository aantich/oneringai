/**
 * Everworker Desktop - AI Agent Desktop Application
 *
 * Electron main process - handles window management and IPC with the agent.
 */

import { app, BrowserWindow, ipcMain, shell, dialog, Menu, protocol, net } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { AgentService } from './AgentService.js';
import { BrowserService } from './BrowserService.js';
import { AutoUpdaterService } from './AutoUpdaterService.js';
import { EWAuthService } from './EWAuthService.js';
import { OllamaService } from './OllamaService.js';
import { sendTelemetryPing } from './telemetry.js';
import type { Rectangle } from './browser/types.js';

/**
 * Get the data directory for Everworker Desktop
 * - macOS/Linux: ~/.everworker/hosea
 * - Windows: %USERPROFILE%\.everworker\hosea (e.g., C:\Users\name\.everworker\hosea)
 */
function getDataDir(): string {
  const home = homedir();
  return join(home, '.everworker', 'hosea');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine if in development mode
const isDev = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;
let agentService: AgentService | null = null;
let browserService: BrowserService | null = null;
const ewAuthService = new EWAuthService();
let autoUpdaterService: AutoUpdaterService | null = null;
let ollamaService: OllamaService | null = null;

// Simple JSON-based settings (avoids ESM-only electron-store dependency)
function getSettingsPath(): string {
  return join(getDataDir(), 'settings.json');
}

function readSettings(): Record<string, unknown> {
  const p = getSettingsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch {
    return {};
  }
}

function writeSettings(data: Record<string, unknown>): void {
  const dir = getDataDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSettingsPath(), JSON.stringify(data, null, 2), 'utf-8');
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Everworker Desktop',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: join(__dirname, '../preload/index.cjs'),
    },
    // macOS specific
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
  });

  // Load the app
  if (isDev) {
    // In development, load from Vite dev server
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, load from built files
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Wrap an async IPC handler with error protection
 */
function safeHandler<T>(
  handler: (...args: unknown[]) => Promise<T>,
  defaultValue: T
): (...args: unknown[]) => Promise<T> {
  return async (...args: unknown[]) => {
    try {
      return await handler(...args);
    } catch (error) {
      console.error('[EW Desktop] IPC handler error:', error);
      return defaultValue;
    }
  };
}

/**
 * Wrap an IPC handler that requires heavy initialization (Phase 2).
 * Awaits agentService.whenReady() before executing the handler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readyHandler<F extends (...args: any[]) => Promise<any>>(handler: F): F {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (async (...args: any[]) => {
    await agentService!.whenReady();
    return handler(...args);
  }) as F;
}

async function setupIPC(): Promise<void> {
  // Initialize agent service with fast essential init only (dirs + config + log level)
  // Heavy initialization (connectors, tools, agents) is deferred to after window shows
  const dataDir = getDataDir();
  console.log('Everworker Desktop data directory:', dataDir);
  agentService = await AgentService.createFast(dataDir, isDev);

  // Initialize browser service (pass null window for now, set later when window is created)
  browserService = new BrowserService(null);

  // Connect AgentService to BrowserService for tool registration
  agentService.setBrowserService(browserService);

  // Set up stream emitter for HoseaUIPlugin to emit Dynamic UI content
  // This is called when browser tools execute and need to show the browser view
  agentService.setStreamEmitter((instanceId, chunk) => {
    mainWindow?.webContents.send('agent:stream-chunk', instanceId, chunk);
  });

  // Set up main window sender for push events (e.g., connector changes)
  agentService.setMainWindowSender((channel, ...args) => {
    mainWindow?.webContents.send(channel, ...args);
  });

  // ============ Proactive Overlay Detection ============
  // When the browser detects a popup/modal/overlay, proactively notify the agent
  // so it can decide how to handle it (dismiss, interact, etc.)
  // ============ Browser User Control Handoff ============
  // When agent appears stuck on browser tools (Trigger 2), auto-pause
  browserService.on('browser:agent-stuck', (instanceId: string) => {
    console.log(`[EW Desktop] Agent appears stuck on ${instanceId}, auto-pausing`);
    agentService!.takeUserControl(instanceId, 'Agent appears stuck. You may need to assist.');
  });

  browserService.on('browser:overlay-detected', (instanceId: string, overlayData: unknown) => {
    console.log(`[EW Desktop] Overlay detected for ${instanceId}:`, overlayData);

    // Send as a special stream chunk that the agent will see
    mainWindow?.webContents.send('agent:stream-chunk', instanceId, {
      type: 'overlay_detected',
      overlay: overlayData,
      hint: 'An overlay/popup appeared on the page. You can use browser_dismiss_overlay to close it, or browser_click to interact with specific buttons.',
    });

    // Also send a browser state update so UI knows about the overlay
    mainWindow?.webContents.send('browser:state-change', instanceId, {
      hasOverlay: true,
      overlay: overlayData,
    });
  });

  // Agent operations (require heavy init)
  ipcMain.handle('agent:initialize', readyHandler(async (_event, connectorName: string, model: string) => {
    return agentService!.initialize(connectorName, model);
  }));

  ipcMain.handle('agent:send', readyHandler(async (_event, message: string) => {
    return agentService!.send(message);
  }));

  ipcMain.handle('agent:stream', readyHandler(async (_event, message: string) => {
    // For streaming, we send chunks via the main window
    try {
      const stream = agentService!.stream(message);
      for await (const chunk of stream) {
        mainWindow?.webContents.send('agent:stream-chunk', chunk);
      }
      mainWindow?.webContents.send('agent:stream-end');
      return { success: true };
    } catch (error) {
      console.error('[EW Desktop] Stream error:', error);
      mainWindow?.webContents.send('agent:stream-end');
      return { success: false, error: String(error) };
    }
  }));

  ipcMain.handle('agent:cancel', readyHandler(async () => {
    return agentService!.cancel();
  }));

  ipcMain.handle('agent:status', async () => {
    return agentService!.getStatus();
  });

  ipcMain.handle('agent:approve-plan', readyHandler(async (_event, planId: string) => {
    return agentService!.approvePlan(planId);
  }));

  ipcMain.handle('agent:reject-plan', readyHandler(async (_event, planId: string, reason?: string) => {
    return agentService!.rejectPlan(planId, reason);
  }));

  // Multi-tab instance operations (require heavy init)
  ipcMain.handle('agent:create-instance', readyHandler(async (_event, agentConfigId: string) => {
    return agentService!.createInstance(agentConfigId);
  }));

  ipcMain.handle('agent:destroy-instance', readyHandler(async (_event, instanceId: string) => {
    return agentService!.destroyInstance(instanceId);
  }));

  ipcMain.handle('agent:stream-instance', readyHandler(async (_event, instanceId: string, message: string) => {
    // For streaming, we send chunks via the main window with instanceId
    try {
      const stream = agentService!.streamInstance(instanceId, message);
      for await (const chunk of stream) {
        mainWindow?.webContents.send('agent:stream-chunk', instanceId, chunk);
      }
      // Save session if enabled (after full turn completes)
      await agentService!.saveInstanceSession(instanceId);
      mainWindow?.webContents.send('agent:stream-end', instanceId);
      return { success: true };
    } catch (error) {
      console.error('[EW Desktop] Stream instance error:', error);
      // Still save session on error (preserves partial conversation)
      await agentService!.saveInstanceSession(instanceId).catch(() => {});
      // Send error chunk BEFORE stream-end so UI knows what happened
      const errorMessage = error instanceof Error ? error.message : String(error);
      mainWindow?.webContents.send('agent:stream-chunk', instanceId, {
        type: 'error',
        content: errorMessage,
      });
      mainWindow?.webContents.send('agent:stream-end', instanceId);
      return { success: false, error: errorMessage };
    }
  }));

  ipcMain.handle('agent:cancel-instance', readyHandler(async (_event, instanceId: string) => {
    return agentService!.cancelInstance(instanceId);
  }));

  // Voice pseudo-streaming
  ipcMain.handle('agent:set-voiceover', readyHandler(async (_event, instanceId: string, enabled: boolean) => {
    return agentService!.setVoiceover(instanceId, enabled);
  }));

  // Session saving toggle
  ipcMain.handle('agent:set-session-save', readyHandler(async (_event, instanceId: string, enabled: boolean) => {
    return agentService!.setSessionSave(instanceId, enabled);
  }));

  ipcMain.handle('agent:get-voice-config', readyHandler(async (_event, agentConfigId: string) => {
    const agent = agentService!.getAgent(agentConfigId);
    if (!agent) return null;
    return {
      voiceEnabled: agent.voiceEnabled,
      voiceConnector: agent.voiceConnector,
      voiceModel: agent.voiceModel,
      voiceVoice: agent.voiceVoice,
      voiceFormat: agent.voiceFormat,
      voiceSpeed: agent.voiceSpeed,
    };
  }));

  // Browser user control handoff (Trigger 1: user clicks "Take Control")
  ipcMain.handle('agent:take-user-control', readyHandler(async (_event, instanceId: string) => {
    return agentService!.takeUserControl(instanceId);
  }));

  ipcMain.handle('agent:hand-back-to-agent', readyHandler(async (_event, instanceId: string) => {
    return agentService!.handBackToAgent(instanceId);
  }));

  ipcMain.handle('agent:status-instance', async (_event, instanceId: string) => {
    return agentService!.getInstanceStatus(instanceId);
  });

  ipcMain.handle('agent:list-instances', async () => {
    return agentService!.listInstances();
  });

  // Context entry pinning (require heavy init)
  ipcMain.handle('agent:pin-context-key', readyHandler(async (_event, agentConfigId: string, key: string, pinned: boolean) => {
    return agentService!.setPinnedContextKey(agentConfigId, key, pinned);
  }));

  ipcMain.handle('agent:get-pinned-context-keys', async (_event, agentConfigId: string) => {
    return agentService!.getPinnedContextKeys(agentConfigId);
  });

  // Connector operations (list is safe before heavy init, add/delete require it)
  ipcMain.handle('connector:list', async () => {
    return agentService!.listConnectors();
  });

  ipcMain.handle('connector:add', readyHandler(async (_event, config: unknown) => {
    return agentService!.addConnector(config);
  }));

  ipcMain.handle('connector:delete', readyHandler(async (_event, name: string) => {
    return agentService!.deleteConnector(name);
  }));

  ipcMain.handle('connector:update', readyHandler(async (_event, name: string, updates: { apiKey?: string; baseURL?: string }) => {
    return agentService!.updateConnector(name, updates);
  }));

  ipcMain.handle('connector:fetch-models', readyHandler(async (_event, vendor: string, apiKey?: string, baseURL?: string, existingConnectorName?: string) => {
    return agentService!.fetchAvailableModels(vendor, apiKey, baseURL, existingConnectorName);
  }));

  // Model operations
  ipcMain.handle('model:list', async () => {
    return agentService!.listModels();
  });

  ipcMain.handle('model:details', async (_event, modelId: string) => {
    return agentService!.getModelDetails(modelId);
  });

  ipcMain.handle('model:vendors', async () => {
    return agentService!.listVendors();
  });

  // Strategy operations
  ipcMain.handle('strategy:list', async () => {
    return agentService!.getStrategies();
  });

  // Session operations (require heavy init)
  ipcMain.handle('session:save', readyHandler(async () => {
    return agentService!.saveSession();
  }));

  ipcMain.handle('session:load', readyHandler(async (_event, sessionId: string) => {
    return agentService!.loadSession(sessionId);
  }));

  ipcMain.handle('session:list', readyHandler(async () => {
    return agentService!.listSessions();
  }));

  ipcMain.handle('session:new', readyHandler(async () => {
    return agentService!.newSession();
  }));

  // Session history operations
  ipcMain.handle('history:list-all', readyHandler(async () => {
    return agentService!.listAllSessions();
  }));

  ipcMain.handle('history:resume', readyHandler(async (_event, agentConfigId: string, sessionId: string, oldInstanceId: string) => {
    return agentService!.resumeSession(agentConfigId, sessionId, oldInstanceId);
  }));

  ipcMain.handle('history:delete', readyHandler(async (_event, instanceId: string, sessionId: string) => {
    return agentService!.deleteSession(instanceId, sessionId);
  }));

  // Tool operations
  ipcMain.handle('tool:list', async () => {
    return agentService!.listTools();
  });

  ipcMain.handle('tool:toggle', readyHandler(async (_event, toolName: string, enabled: boolean) => {
    return agentService!.toggleTool(toolName, enabled);
  }));

  ipcMain.handle('tool:registry', async () => {
    return agentService!.getAvailableTools();
  });

  ipcMain.handle('tool:categories', async () => {
    return agentService!.getToolCategories();
  });

  ipcMain.handle('tool:getSchema', async (_event, toolName: string) => {
    return agentService!.getToolSchema(toolName);
  });

  // Agent configuration operations
  ipcMain.handle('agent-config:list', async () => {
    return agentService!.listAgents();
  });

  ipcMain.handle('agent-config:get', async (_event, id: string) => {
    return agentService!.getAgent(id);
  });

  ipcMain.handle('agent-config:create', readyHandler(async (_event, config: unknown) => {
    return agentService!.createAgent(config as any);
  }));

  ipcMain.handle('agent-config:update', readyHandler(async (_event, id: string, updates: unknown) => {
    return agentService!.updateAgent(id, updates as any);
  }));

  ipcMain.handle('agent-config:delete', readyHandler(async (_event, id: string) => {
    return agentService!.deleteAgent(id);
  }));

  ipcMain.handle('agent-config:set-active', readyHandler(async (_event, id: string) => {
    return agentService!.setActiveAgent(id);
  }));

  ipcMain.handle('agent-config:get-active', async () => {
    return agentService!.getActiveAgent();
  });

  ipcMain.handle('agent-config:create-default', readyHandler(async (_event, connectorName: string, model: string) => {
    return agentService!.createDefaultAgent(connectorName, model);
  }));

  // Universal Connector operations (vendor templates)
  ipcMain.handle('universal-connector:list-vendors', async () => {
    return agentService!.listVendorTemplates();
  });

  ipcMain.handle('universal-connector:get-vendor', async (_event, vendorId: string) => {
    return agentService!.getVendorTemplateById(vendorId) || null;
  });

  ipcMain.handle('universal-connector:get-vendor-template', async (_event, vendorId: string) => {
    return agentService!.getFullVendorTemplate(vendorId) || null;
  });

  ipcMain.handle('universal-connector:get-vendor-logo', async (_event, vendorId: string) => {
    return agentService!.getVendorLogoById(vendorId) || null;
  });

  ipcMain.handle('universal-connector:get-categories', async () => {
    return agentService!.getVendorCategories();
  });

  ipcMain.handle('universal-connector:list-vendors-by-category', async (_event, category: string) => {
    return agentService!.getVendorsByCategory(category);
  });

  ipcMain.handle('universal-connector:list', readyHandler(async () => {
    return agentService!.listUniversalConnectors();
  }));

  ipcMain.handle('universal-connector:get', readyHandler(async (_event, name: string) => {
    return agentService!.getUniversalConnector(name);
  }));

  ipcMain.handle('universal-connector:create', readyHandler(async (_event, config: unknown) => {
    return agentService!.createUniversalConnector(config as any);
  }));

  ipcMain.handle('universal-connector:update', readyHandler(async (_event, name: string, updates: unknown) => {
    return agentService!.updateUniversalConnector(name, updates as any);
  }));

  ipcMain.handle('universal-connector:delete', readyHandler(async (_event, name: string) => {
    return agentService!.deleteUniversalConnector(name);
  }));

  ipcMain.handle('universal-connector:test-connection', readyHandler(async (_event, name: string) => {
    return agentService!.testUniversalConnection(name);
  }));

  // Built-in OAuth operations (Connections page)
  ipcMain.handle('built-in-oauth:list', async () => {
    return agentService!.getBuiltInOAuthApps();
  });

  ipcMain.handle('built-in-oauth:authorize', readyHandler(async (_event, vendorId: string) => {
    return agentService!.builtInOAuthAuthorize(vendorId, mainWindow);
  }));

  ipcMain.handle('built-in-oauth:get-status', async (_event, vendorId: string) => {
    return agentService!.getBuiltInOAuthStatus(vendorId);
  });

  ipcMain.handle('built-in-oauth:disconnect', readyHandler(async (_event, vendorId: string) => {
    return agentService!.builtInOAuthDisconnect(vendorId);
  }));

  ipcMain.handle('built-in-oauth:get-default-ew-url', async () => {
    return agentService!.getDefaultEWUrl();
  });

  // OAuth flow operations
  ipcMain.handle('oauth:start-flow', readyHandler(async (_event, connectorName: string) => {
    return agentService!.startOAuthFlow(connectorName, mainWindow);
  }));
  ipcMain.handle('oauth:cancel-flow', async () => {
    agentService!.cancelOAuthFlow();
  });
  ipcMain.handle('oauth:token-status', readyHandler(async (_event, connectorName: string) => {
    return agentService!.getOAuthTokenStatus(connectorName);
  }));
  ipcMain.handle('oauth:get-redirect-uri', async () => {
    return agentService!.getOAuthRedirectUri();
  });

  // MCP Server operations
  ipcMain.handle('mcp-server:list', async () => {
    return agentService!.listMCPServers();
  });

  ipcMain.handle('mcp-server:get', async (_event, name: string) => {
    return agentService!.getMCPServer(name);
  });

  ipcMain.handle('mcp-server:create', readyHandler(async (_event, config: unknown) => {
    return agentService!.createMCPServer(config as any);
  }));

  ipcMain.handle('mcp-server:update', readyHandler(async (_event, name: string, updates: unknown) => {
    return agentService!.updateMCPServer(name, updates as any);
  }));

  ipcMain.handle('mcp-server:delete', readyHandler(async (_event, name: string) => {
    return agentService!.deleteMCPServer(name);
  }));

  ipcMain.handle('mcp-server:connect', readyHandler(async (_event, name: string) => {
    return agentService!.connectMCPServer(name);
  }));

  ipcMain.handle('mcp-server:disconnect', readyHandler(async (_event, name: string) => {
    return agentService!.disconnectMCPServer(name);
  }));

  ipcMain.handle('mcp-server:get-tools', async (_event, name: string) => {
    return agentService!.getMCPServerTools(name);
  });

  ipcMain.handle('mcp-server:refresh-tools', readyHandler(async (_event, name: string) => {
    return agentService!.refreshMCPServerTools(name);
  }));

  // Everworker Backend operations (require heavy init)
  ipcMain.handle('everworker:get-config', readyHandler(async () => {
    return agentService!.getEWConfig();
  }));

  ipcMain.handle('everworker:set-config', readyHandler(async (_event, config: unknown) => {
    return agentService!.setEWConfig(config as any);
  }));

  ipcMain.handle('everworker:test-connection', readyHandler(async () => {
    return agentService!.testEWConnection();
  }));

  ipcMain.handle('everworker:sync-connectors', readyHandler(async () => {
    return agentService!.syncEWConnectors();
  }));

  // Everworker Multi-Profile operations (require heavy init)
  ipcMain.handle('everworker:get-profiles', readyHandler(async () => {
    return agentService!.getEWProfiles();
  }));

  ipcMain.handle('everworker:add-profile', readyHandler(async (_event, data: { name: string; url: string; token: string }) => {
    return agentService!.addEWProfile(data);
  }));

  ipcMain.handle('everworker:update-profile', readyHandler(async (_event, id: string, updates: { name?: string; url?: string; token?: string }) => {
    return agentService!.updateEWProfile(id, updates);
  }));

  ipcMain.handle('everworker:delete-profile', readyHandler(async (_event, id: string) => {
    return agentService!.deleteEWProfile(id);
  }));

  ipcMain.handle('everworker:switch-profile', readyHandler(async (_event, id: string | null) => {
    return agentService!.switchEWProfile(id);
  }));

  ipcMain.handle('everworker:test-profile', readyHandler(async (_event, id: string) => {
    return agentService!.testEWProfileConnection(id);
  }));

  ipcMain.handle('everworker:sync-active', readyHandler(async () => {
    return agentService!.syncActiveEWProfile();
  }));

  // EW Browser Auth
  ipcMain.handle('everworker:check-auth-support', async (_event, url: string) => {
    return ewAuthService.checkAuthSupport(url);
  });

  ipcMain.handle('everworker:start-auth', async (_event, url: string) => {
    return ewAuthService.authenticate({ ewUrl: url, parentWindow: mainWindow });
  });

  ipcMain.handle('everworker:cancel-auth', async () => {
    ewAuthService.cancel();
  });

  ipcMain.handle('everworker:token-status', async (_event, profileId?: string) => {
    return agentService!.getTokenStatus(profileId);
  });

  // Config operations
  ipcMain.handle('config:get', async () => {
    return agentService!.getConfig();
  });

  ipcMain.handle('config:set', async (_event, key: string, value: unknown) => {
    return agentService!.setConfig(key, value);
  });

  // App version
  ipcMain.handle('app:get-version', () => {
    return app.getVersion();
  });

  // Dev mode check
  ipcMain.handle('app:get-is-dev', () => isDev);

  // What's New
  ipcMain.handle('whatsnew:get-last-seen', () => {
    const settings = readSettings();
    return (settings.lastSeenWhatsNew as string) || null;
  });

  ipcMain.handle('whatsnew:mark-seen', (_event, version: string) => {
    const settings = readSettings();
    settings.lastSeenWhatsNew = version;
    writeSettings(settings);
    return { success: true };
  });

  // License acceptance
  ipcMain.handle('license:get-status', () => {
    const settings = readSettings();
    return {
      accepted: settings.licenseAcceptedVersion === '2.0',
      acceptedVersion: (settings.licenseAcceptedVersion as string) || null,
      acceptedAt: (settings.licenseAcceptedAt as number) || null,
    };
  });

  ipcMain.handle('license:accept', () => {
    const settings = readSettings();
    settings.licenseAcceptedVersion = '2.0';
    settings.licenseAcceptedAt = Date.now();
    writeSettings(settings);
    return { success: true };
  });

  // Telemetry operations
  ipcMain.handle('telemetry:get-status', () => {
    const settings = readSettings();
    return {
      enabled: settings.telemetryEnabled !== false,
      installationId: (settings.installationId as string) || null,
    };
  });

  ipcMain.handle('telemetry:set-enabled', (_event, enabled: boolean) => {
    const settings = readSettings();
    settings.telemetryEnabled = enabled;
    writeSettings(settings);
    return { success: true };
  });

  // Log level operations
  ipcMain.handle('log:get-level', async () => {
    return agentService!.getLogLevel();
  });

  ipcMain.handle('log:set-level', async (_event, level: string) => {
    return agentService!.setLogLevel(level as any);
  });

  // Internals monitoring (Look Inside)
  // Returns IContextSnapshot from core library
  ipcMain.handle('internals:get-all', async (_event, instanceId?: string) => {
    return agentService!.getSnapshotForInstance(instanceId || null);
  });

  ipcMain.handle('internals:get-context-stats', async () => {
    return agentService!.getContextStats();
  });

  ipcMain.handle('internals:get-memory-entries', async () => {
    return agentService!.getMemoryEntries();
  });

  ipcMain.handle('internals:get-prepared-context', async (_event, instanceId?: string) => {
    if (instanceId) {
      return agentService!.getPreparedContextForInstance(instanceId);
    }
    return agentService!.getPreparedContext();
  });

  ipcMain.handle('internals:get-memory-value', async (_event, keyOrInstanceId: string, keyIfInstance?: string) => {
    // Support both old signature (key) and new signature (instanceId, key)
    if (keyIfInstance !== undefined) {
      return agentService!.getMemoryValueForInstance(keyOrInstanceId, keyIfInstance);
    }
    return agentService!.getMemoryValue(keyOrInstanceId);
  });

  ipcMain.handle('internals:force-compact', readyHandler(async (_event, instanceId?: string) => {
    if (instanceId) {
      return agentService!.forceCompactionForInstance(instanceId);
    }
    return agentService!.forceCompaction();
  }));

  // Multimedia - Image Generation (require heavy init for connector access)
  ipcMain.handle('multimedia:get-available-image-models', readyHandler(async (_event, connectorName?: string) => {
    return agentService!.getAvailableImageModels(connectorName);
  }));

  ipcMain.handle('multimedia:get-image-model-capabilities', readyHandler(async (_event, modelName: string) => {
    return agentService!.getImageModelCapabilities(modelName);
  }));

  ipcMain.handle('multimedia:calculate-image-cost', readyHandler(async (_event, modelName: string, imageCount: number, quality: string) => {
    return agentService!.calculateImageCost(modelName, imageCount, quality as 'standard' | 'hd');
  }));

  ipcMain.handle('multimedia:generate-image', readyHandler(async (_event, options: unknown) => {
    return agentService!.generateImage(options as {
      model: string;
      prompt: string;
      size?: string;
      quality?: string;
      style?: string;
      n?: number;
      [key: string]: unknown;
    });
  }));

  // Multimedia - Video Generation (require heavy init)
  ipcMain.handle('multimedia:get-available-video-models', readyHandler(async (_event, connectorName?: string) => {
    return agentService!.getAvailableVideoModels(connectorName);
  }));

  ipcMain.handle('multimedia:get-video-model-capabilities', readyHandler(async (_event, modelName: string) => {
    return agentService!.getVideoModelCapabilities(modelName);
  }));

  ipcMain.handle('multimedia:calculate-video-cost', readyHandler(async (_event, modelName: string, durationSeconds: number) => {
    return agentService!.calculateVideoCost(modelName, durationSeconds);
  }));

  ipcMain.handle('multimedia:generate-video', readyHandler(async (_event, options: unknown) => {
    return agentService!.generateVideo(options as {
      model: string;
      prompt: string;
      connector?: string;
      duration?: number;
      resolution?: string;
      aspectRatio?: '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
      image?: string;
      seed?: number;
      vendorOptions?: Record<string, unknown>;
    });
  }));

  ipcMain.handle('multimedia:get-video-status', readyHandler(async (_event, jobId: string) => {
    return agentService!.getVideoStatus(jobId);
  }));

  ipcMain.handle('multimedia:download-video', readyHandler(async (_event, jobId: string) => {
    return agentService!.downloadVideo(jobId);
  }));

  ipcMain.handle('multimedia:cancel-video-job', readyHandler(async (_event, jobId: string) => {
    return agentService!.cancelVideoJob(jobId);
  }));

  // Multimedia - TTS (require heavy init)
  ipcMain.handle('multimedia:get-available-tts-models', readyHandler(async (_event, connectorName?: string) => {
    return agentService!.getAvailableTTSModels(connectorName);
  }));

  ipcMain.handle('multimedia:get-tts-model-capabilities', readyHandler(async (_event, modelName: string) => {
    return agentService!.getTTSModelCapabilities(modelName);
  }));

  ipcMain.handle('multimedia:calculate-tts-cost', readyHandler(async (_event, modelName: string, charCount: number) => {
    return agentService!.calculateTTSCost(modelName, charCount);
  }));

  ipcMain.handle('multimedia:synthesize-speech', readyHandler(async (_event, options: unknown) => {
    return agentService!.synthesizeSpeech(options as {
      model: string;
      text: string;
      voice: string;
      connector?: string;
      format?: string;
      speed?: number;
      vendorOptions?: Record<string, unknown>;
    });
  }));

  // Dialog operations
  ipcMain.handle('dialog:show-open-dialog', async (_event, options: {
    properties?: Array<'openFile' | 'openDirectory' | 'multiSelections' | 'showHiddenFiles'>;
    title?: string;
    defaultPath?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
  }) => {
    if (!mainWindow) {
      return { canceled: true, filePaths: [] };
    }
    return dialog.showOpenDialog(mainWindow, options);
  });

  // Shell operations
  ipcMain.handle('shell:open-external', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // ============ Routine IPC Handlers ============

  ipcMain.handle('routine:list', readyHandler(async (_event, options?: { tags?: string[]; search?: string }) => {
    return agentService!.listRoutines(options);
  }));

  ipcMain.handle('routine:get', readyHandler(async (_event, id: string) => {
    if (!id) return null;
    return agentService!.getRoutine(id);
  }));

  ipcMain.handle('routine:save', readyHandler(async (_event, input: unknown) => {
    return agentService!.saveRoutine(input as any);
  }));

  ipcMain.handle('routine:delete', readyHandler(async (_event, id: string) => {
    return agentService!.deleteRoutine(id);
  }));

  ipcMain.handle('routine:duplicate', readyHandler(async (_event, id: string) => {
    return agentService!.duplicateRoutine(id);
  }));

  ipcMain.handle('routine:validate', readyHandler(async (_event, input: unknown) => {
    return agentService!.validateRoutine(input as any);
  }));

  ipcMain.handle('routine:execute', readyHandler(async (_event, instanceId: string, routineId: string) => {
    return agentService!.executeRoutineOnInstance(instanceId, routineId);
  }));

  ipcMain.handle('routine:cancel-execution', readyHandler(async (_event, instanceId: string) => {
    agentService!.cancelRoutineExecution(instanceId);
  }));

  // ============ Browser Automation IPC Handlers ============

  ipcMain.handle('browser:create', async (_event, instanceId: string) => {
    if (!browserService) {
      return { success: false, error: 'Browser service not initialized' };
    }
    return browserService.createBrowser(instanceId);
  });

  ipcMain.handle('browser:destroy', async (_event, instanceId: string) => {
    if (!browserService) {
      return { success: false, error: 'Browser service not initialized' };
    }
    return browserService.destroyBrowser(instanceId);
  });

  ipcMain.handle('browser:navigate', async (_event, instanceId: string, url: string, options?: { waitUntil?: string; timeout?: number }) => {
    if (!browserService) {
      return { success: false, url: '', title: '', loadTime: 0, error: 'Browser service not initialized' };
    }
    // Cast waitUntil to the correct union type
    const navigateOptions = options ? {
      ...options,
      waitUntil: options.waitUntil as 'load' | 'domcontentloaded' | 'networkidle' | undefined,
    } : undefined;
    return browserService.navigate(instanceId, url, navigateOptions);
  });

  ipcMain.handle('browser:get-state', async (_event, instanceId: string) => {
    if (!browserService) {
      return { success: false, url: '', title: '', isLoading: false, canGoBack: false, canGoForward: false, viewport: { width: 0, height: 0 }, error: 'Browser service not initialized' };
    }
    return browserService.getState(instanceId);
  });

  ipcMain.handle('browser:go-back', async (_event, instanceId: string) => {
    if (!browserService) {
      return { success: false, url: '', title: '', error: 'Browser service not initialized' };
    }
    return browserService.goBack(instanceId);
  });

  ipcMain.handle('browser:go-forward', async (_event, instanceId: string) => {
    if (!browserService) {
      return { success: false, url: '', title: '', error: 'Browser service not initialized' };
    }
    return browserService.goForward(instanceId);
  });

  ipcMain.handle('browser:reload', async (_event, instanceId: string) => {
    if (!browserService) {
      return { success: false, url: '', title: '', error: 'Browser service not initialized' };
    }
    return browserService.reload(instanceId);
  });

  ipcMain.handle('browser:attach', async (_event, instanceId: string, bounds: Rectangle) => {
    if (!browserService) {
      return { success: false, error: 'Browser service not initialized' };
    }
    return browserService.attachToWindow(instanceId, bounds);
  });

  ipcMain.handle('browser:detach', async (_event, instanceId: string) => {
    if (!browserService) {
      return { success: false, error: 'Browser service not initialized' };
    }
    return browserService.detachFromWindow(instanceId);
  });

  ipcMain.handle('browser:update-bounds', async (_event, instanceId: string, bounds: Rectangle) => {
    if (!browserService) {
      return { success: false, error: 'Browser service not initialized' };
    }
    return browserService.updateBounds(instanceId, bounds);
  });

  ipcMain.handle('browser:get-instance-info', async (_event, instanceId: string) => {
    if (!browserService) {
      return null;
    }
    return browserService.getInstanceInfo(instanceId);
  });

  ipcMain.handle('browser:list-instances', async () => {
    if (!browserService) {
      return [];
    }
    return browserService.getAllInstances();
  });

  ipcMain.handle('browser:has-browser', async (_event, instanceId: string) => {
    if (!browserService) {
      return false;
    }
    return browserService.hasBrowser(instanceId);
  });

  // ============ Ollama IPC Handlers ============

  ollamaService = new OllamaService();

  // Wire push events to renderer
  ollamaService.setCallbacks({
    onStateChanged: (state) => {
      mainWindow?.webContents.send('ollama:state-changed', state);
    },
    onDownloadProgress: (progress) => {
      mainWindow?.webContents.send('ollama:download-progress', progress);
    },
    onPullProgress: (progress) => {
      mainWindow?.webContents.send('ollama:pull-progress', progress);
    },
  });

  // Give AgentService a reference
  agentService!.setOllamaService(ollamaService);

  ipcMain.handle('ollama:get-state', async () => {
    return ollamaService!.getState();
  });

  ipcMain.handle('ollama:detect', async () => {
    return ollamaService!.detect();
  });

  ipcMain.handle('ollama:download', async () => {
    try {
      await ollamaService!.download();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ollama:start', async () => {
    try {
      await ollamaService!.start();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ollama:stop', async () => {
    try {
      await ollamaService!.stop();
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ollama:list-models', async () => {
    try {
      return ollamaService!.listModels();
    } catch {
      return [];
    }
  });

  ipcMain.handle('ollama:pull-model', async (_event, name: string) => {
    try {
      await ollamaService!.pullModel(name);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ollama:delete-model', async (_event, name: string) => {
    try {
      await ollamaService!.deleteModel(name);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('ollama:set-auto-start', async (_event, enabled: boolean) => {
    await ollamaService!.setAutoStart(enabled);
    return { success: true };
  });

  // DEV ONLY: Reset Ollama state for testing the download flow
  if (isDev) {
    ipcMain.handle('ollama:reset-for-testing', async () => {
      ollamaService!.resetForTesting();
      return { success: true };
    });
  }

  ipcMain.handle('ollama:ensure-connector', readyHandler(async () => {
    try {
      const connConfig = ollamaService!.getConnectorConfig();
      const result = await agentService!.addConnector(connConfig);
      return result;
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }));

  // Initialize auto-updater (only in production)
  if (!isDev) {
    autoUpdaterService = new AutoUpdaterService();
    autoUpdaterService.initialize();
  }
}

/**
 * Create application menu with Check for Updates option
 */
function createAppMenu(): void {
  const isMac = process.platform === 'darwin';

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        {
          label: 'Check for Updates...',
          click: () => {
            if (autoUpdaterService) {
              autoUpdaterService.checkForUpdates();
            } else {
              dialog.showMessageBox({
                type: 'info',
                title: 'Updates',
                message: 'Auto-updates are only available in the production build.',
              });
            }
          },
        },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' as const },
          { role: 'delete' as const },
          { role: 'selectAll' as const },
        ] : [
          { role: 'delete' as const },
          { type: 'separator' as const },
          { role: 'selectAll' as const },
        ]),
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' as const },
        { role: 'togglefullscreen' as const },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
          { type: 'separator' as const },
          { role: 'window' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Learn More',
          click: async () => {
            await shell.openExternal('https://github.com/Integrail/oneringai');
          },
        },
        {
          label: 'Report Issue',
          click: async () => {
            await shell.openExternal('https://github.com/Integrail/oneringai/issues');
          },
        },
        // Check for Updates on non-Mac platforms
        ...(!isMac ? [
          { type: 'separator' as const },
          {
            label: 'Check for Updates...',
            click: () => {
              if (autoUpdaterService) {
                autoUpdaterService.checkForUpdates();
              } else {
                dialog.showMessageBox({
                  type: 'info',
                  title: 'Updates',
                  message: 'Auto-updates are only available in the production build.',
                });
              }
            },
          },
        ] : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Register custom protocol for serving local media files (images, video, audio)
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([{
  scheme: 'local-media',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
}]);

// App lifecycle
app.whenReady().then(async () => {
  // Handle local-media:// protocol - serves files from the media output directory
  const allowedMediaDir = join(tmpdir(), 'oneringai-media');
  protocol.handle('local-media', async (request) => {
    const url = new URL(request.url);
    // Standard URL parsing may capture the first path segment as hostname
    // e.g. local-media:///var/folders/... → hostname:"var", pathname:"/folders/..."
    // Reconstruct the full absolute path
    const filePath = url.hostname
      ? decodeURIComponent(`/${url.hostname}${url.pathname}`)
      : decodeURIComponent(url.pathname);
    // Security: only serve files from the media output directory
    if (!filePath.startsWith(allowedMediaDir)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(`file://${filePath}`);
  });

  // Phase 1: Fast essential init + IPC handler registration
  await setupIPC();

  // Add service readiness query handler
  ipcMain.handle('service:is-ready', () => agentService!.isReady);

  // Show window immediately (before heavy initialization)
  await createWindow();

  // Set main window reference on browser service after window is created
  if (browserService && mainWindow) {
    browserService.setMainWindow(mainWindow);
  }

  // Set main window on auto-updater and check for updates (5 second delay)
  if (autoUpdaterService && mainWindow) {
    autoUpdaterService.setMainWindow(mainWindow);
    autoUpdaterService.checkOnStartup(5000);
  }

  // Create application menu
  createAppMenu();

  // Phase 2: Heavy initialization in background (connectors, tools, agents)
  // Window is already visible showing "Starting Everworker Desktop..." spinner
  agentService!.initializeHeavy().then(() => {
    // Notify renderer that service is fully ready
    mainWindow?.webContents.send('service:ready');
    console.log('[EW Desktop] Service fully initialized, notified renderer');

    // Send telemetry ping (fire-and-forget, after heavy init so it doesn't delay startup)
    try {
      const settings = readSettings();
      sendTelemetryPing(settings, writeSettings);
    } catch {
      // Telemetry should never break the app
    }
  });

  app.on('activate', async () => {
    // macOS: re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
      // Update browser service with new window
      if (browserService && mainWindow) {
        browserService.setMainWindow(mainWindow);
      }
    }
  });
});

app.on('window-all-closed', () => {
  // Quit on all platforms except macOS
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Cleanup
  if (ollamaService) {
    await ollamaService.destroy();
  }
  if (browserService) {
    await browserService.destroyAll();
  }
  agentService?.destroy();
});

// ============ Global Error Handlers ============
// These prevent the app from crashing due to unhandled errors in IPC handlers or tools

process.on('uncaughtException', (error, origin) => {
  console.error('[EW Desktop] Uncaught exception:', error);
  console.error('[EW Desktop] Origin:', origin);
  // Don't crash - log and continue unless it's truly fatal
  // Send error to renderer if possible
  try {
    mainWindow?.webContents.send('error:uncaught', {
      type: 'uncaughtException',
      message: error.message,
      stack: error.stack,
    });
  } catch {
    // Ignore - window may not exist
  }
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[EW Desktop] Unhandled rejection:', reason);
  // Don't crash - log and continue
  // Send error to renderer if possible
  try {
    mainWindow?.webContents.send('error:uncaught', {
      type: 'unhandledRejection',
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  } catch {
    // Ignore - window may not exist
  }
});
