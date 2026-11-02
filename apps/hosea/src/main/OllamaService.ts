import { getHoseaDataDir } from './runtimeConfig.js';
/**
 * OllamaService - Manages Ollama lifecycle for local AI support
 *
 * Handles detection, download, start/stop, model pulling, and connector creation.
 * No external dependencies — uses Node built-ins for binary download and process management.
 */

import { spawn, exec, execSync, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, chmodSync, unlinkSync, statSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir, homedir, totalmem, platform, arch } from 'node:os';
import { get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';
import type { IncomingMessage } from 'node:http';

// ============ Types ============

export type OllamaStatus =
  | 'not_installed'
  | 'downloading'
  | 'installed'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error';

export interface OllamaModel {
  name: string;
  size: number;
  digest: string;
  modifiedAt: string;
}

export interface OllamaState {
  status: OllamaStatus;
  isExternalInstance: boolean;
  externalBinaryPath?: string;
  version: string;
  autoStart: boolean;
  models: OllamaModel[];
  error?: string;
  downloadProgress?: { percent: number; downloaded: number; total: number };
  pullProgress?: { model: string; percent: number; status: string };
  systemInfo: {
    totalRAMGB: number;
    platform: string;
    arch: string;
    recommendedModel: string;
    recommendedModelReason: string;
  };
}

interface OllamaConfig {
  version: string;
  autoStart: boolean;
  isExternalInstance: boolean;
  connectorName: string;
  binaryPath: string;
  externalBinaryPath?: string;
}

const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const OLLAMA_BASE_URL = `http://${OLLAMA_HOST}:${OLLAMA_PORT}`;
const CONNECTOR_NAME = 'ollama-local';
const HEALTH_CHECK_TIMEOUT_MS = 2000;
const START_TIMEOUT_MS = 30000;
const STOP_TIMEOUT_MS = 5000;

// ============ Helpers ============

function getOllamaDir(): string {
  return join(getHoseaDataDir(), 'ollama');
}

function getConfigPath(): string {
  return join(getHoseaDataDir(), 'ollama-config.json');
}

function getRecommendedModel(): { model: string; reason: string } {
  const ramGB = Math.round(totalmem() / (1024 * 1024 * 1024));
  if (ramGB < 12) {
    return { model: 'qwen3:8b', reason: `Recommended for your system with ${ramGB}GB RAM — fits comfortably with room for other apps` };
  }
  if (ramGB < 24) {
    return { model: 'qwen3:14b', reason: `Recommended for your system with ${ramGB}GB RAM — good balance of quality and speed` };
  }
  return { model: 'qwen3:30b', reason: `Recommended for your system with ${ramGB}GB RAM — highest quality local model` };
}

function getSystemInfo() {
  const ramGB = Math.round(totalmem() / (1024 * 1024 * 1024));
  const rec = getRecommendedModel();
  return {
    totalRAMGB: ramGB,
    platform: platform(),
    arch: arch(),
    recommendedModel: rec.model,
    recommendedModelReason: rec.reason,
  };
}

/**
 * Fetch JSON from Ollama's local API
 */
async function ollamaFetch<T>(path: string, options?: {
  method?: string;
  body?: unknown;
  timeout?: number;
}): Promise<T> {
  const { method = 'GET', body, timeout = HEALTH_CHECK_TIMEOUT_MS } = options || {};

  return new Promise((resolve, reject) => {
    const url = new URL(path, OLLAMA_BASE_URL);
    const req = httpGet(url, { method, timeout }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch {
          reject(new Error(`Invalid JSON response from ${path}`));
        }
      });
    });

    if (body) {
      req.destroy();
      // Need to use http.request for POST
      const { request } = require('node:http') as typeof import('node:http');
      const postReq = request(url, { method, timeout, headers: { 'Content-Type': 'application/json' } }, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`Invalid JSON response from ${path}`));
          }
        });
      });
      postReq.on('error', reject);
      postReq.on('timeout', () => { postReq.destroy(); reject(new Error('Request timeout')); });
      postReq.write(JSON.stringify(body));
      postReq.end();
      return;
    }

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

/**
 * Check if Ollama is running by hitting its health endpoint
 */
async function isOllamaRunning(): Promise<boolean> {
  try {
    await ollamaFetch('/api/tags', { timeout: HEALTH_CHECK_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find external Ollama binary on disk
 */
function findExternalBinary(): string | null {
  const p = platform();

  // Common paths to check
  const candidates: string[] = [];
  if (p === 'darwin' || p === 'linux') {
    candidates.push('/usr/local/bin/ollama', '/usr/bin/ollama');
  }
  if (p === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    candidates.push(join(localAppData, 'Ollama', 'ollama.exe'));
  }

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  // Fallback: try `which`/`where`
  try {
    const cmd = p === 'win32' ? 'where ollama' : 'which ollama';
    const result = execSync(cmd, { timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
    if (result && existsSync(result.split('\n')[0])) {
      return result.split('\n')[0];
    }
  } catch {
    // Not found
  }

  return null;
}

// ============ OllamaService ============

export class OllamaService {
  private config: OllamaConfig;
  private status: OllamaStatus = 'not_installed';
  private isExternalInstance = false;
  private externalBinaryPath?: string;
  private models: OllamaModel[] = [];
  private error?: string;
  private process: ChildProcess | null = null;
  private downloadProgress?: { percent: number; downloaded: number; total: number };
  private pullProgress?: { model: string; percent: number; status: string };

  // Callback for pushing state changes to renderer
  private onStateChanged?: (state: OllamaState) => void;
  private onDownloadProgress?: (progress: { percent: number; downloaded: number; total: number }) => void;
  private onPullProgress?: (progress: { model: string; percent: number; status: string }) => void;

  constructor() {
    this.config = {
      version: '',
      autoStart: true,
      isExternalInstance: false,
      connectorName: CONNECTOR_NAME,
      binaryPath: '',
    };
  }

  /**
   * Set callbacks for state change notifications
   */
  setCallbacks(callbacks: {
    onStateChanged?: (state: OllamaState) => void;
    onDownloadProgress?: (progress: { percent: number; downloaded: number; total: number }) => void;
    onPullProgress?: (progress: { model: string; percent: number; status: string }) => void;
  }): void {
    this.onStateChanged = callbacks.onStateChanged;
    this.onDownloadProgress = callbacks.onDownloadProgress;
    this.onPullProgress = callbacks.onPullProgress;
  }

  /**
   * Initialize: load config, detect existing Ollama, auto-start if configured.
   * Called during AgentService.initializeHeavy().
   */
  async initialize(): Promise<void> {
    await this.loadConfig();
    await this.detect();

    // Auto-start if configured and we have a binary but it's not running
    if (this.config.autoStart && this.status === 'installed') {
      try {
        await this.start();
      } catch (err) {
        console.warn('[OllamaService] Auto-start failed:', err);
      }
    }

    // If running, refresh model list
    if (this.status === 'running') {
      await this.refreshModels();
    }
  }

  /**
   * Two-phase detection:
   * 1. Check if running
   * 2. Check if installed (external or managed)
   */
  async detect(): Promise<OllamaState> {
    console.log('[OllamaService] Running detection...');

    // Phase 1: Check if already running
    if (await isOllamaRunning()) {
      this.status = 'running';
      // Determine if it's our managed process or external
      if (!this.process) {
        this.isExternalInstance = true;
        this.config.isExternalInstance = true;
      }
      // Try to get version
      try {
        const versionData = await ollamaFetch<{ version?: string }>('/api/version', { timeout: HEALTH_CHECK_TIMEOUT_MS });
        this.config.version = versionData?.version || '';
      } catch { /* non-critical */ }
      console.log('[OllamaService] Detected running instance (external:', !this.process, ', version:', this.config.version, ')');
      this.emitState();
      return this.getState();
    }

    // Phase 2: Check for external binary
    const externalPath = findExternalBinary();
    if (externalPath) {
      this.isExternalInstance = true;
      this.externalBinaryPath = externalPath;
      this.config.isExternalInstance = true;
      this.config.externalBinaryPath = externalPath;
      this.status = 'installed';
      console.log('[OllamaService] Found external binary at:', externalPath);
      this.emitState();
      return this.getState();
    }

    // Not found anywhere
    this.status = 'not_installed';
    console.log('[OllamaService] Ollama not found');
    this.emitState();
    return this.getState();
  }

  /**
   * Install Ollama using the official installer for the current platform.
   * - macOS: runs the official install script (curl | sh) which installs Ollama.app + CLI
   * - Windows: downloads OllamaSetup.exe and launches the installer wizard
   * - Linux: not auto-installed (users should run `curl -fsSL https://ollama.com/install.sh | sh` themselves)
   */
  async download(): Promise<void> {
    if (this.status === 'downloading') {
      throw new Error('Install already in progress');
    }

    const p = platform();
    console.log(`[OllamaService] Starting install for platform: ${p}`);

    if (p === 'linux') {
      throw new Error('Automatic installation is not supported on Linux. Please run: curl -fsSL https://ollama.com/install.sh | sh');
    }

    this.status = 'downloading';
    this.error = undefined;
    this.downloadProgress = { percent: 0, downloaded: 0, total: 0 };
    this.emitState();

    try {
      if (p === 'darwin') {
        await this.installMacOS();
      } else if (p === 'win32') {
        await this.installWindows();
      } else {
        throw new Error(`Unsupported platform: ${p}`);
      }

      // After install, re-detect to pick up the new binary
      console.log('[OllamaService] Install completed, running detection...');
      await this.detect();
      this.downloadProgress = undefined;
      this.emitState();
    } catch (err) {
      console.error('[OllamaService] Install failed:', err instanceof Error ? err.message : String(err));
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.downloadProgress = undefined;
      this.emitState();
      throw err;
    }
  }

  /**
   * macOS: Run the official Ollama install script.
   * Installs Ollama.app to /Applications and symlinks CLI to /usr/local/bin/ollama.
   * The script auto-starts Ollama after installation.
   */
  private async installMacOS(): Promise<void> {
    console.log('[OllamaService] macOS: Running official install script...');
    this.downloadProgress = { percent: 10, downloaded: 0, total: 0 };
    this.emitState();

    return new Promise<void>((resolve, reject) => {
      const child = exec('curl -fsSL https://ollama.com/install.sh | sh', {
        timeout: 300000, // 5 min timeout for download + install
        env: { ...process.env, OLLAMA_NO_START: '' }, // allow auto-start
      }, (error, stdout, stderr) => {
        if (error) {
          console.error('[OllamaService] macOS install script failed:', error.message);
          console.error('[OllamaService] stderr:', stderr);
          reject(new Error(`Install script failed: ${error.message}`));
          return;
        }
        console.log('[OllamaService] macOS install script output:', stdout);
        if (stderr) console.log('[OllamaService] macOS install stderr:', stderr);
        resolve();
      });

      // Parse progress from the script's status messages
      child.stderr?.on('data', (data: Buffer) => {
        const line = data.toString();
        console.log('[OllamaService] install:', line.trim());
        if (line.includes('Downloading')) {
          this.downloadProgress = { percent: 30, downloaded: 0, total: 0 };
          this.emitState();
        } else if (line.includes('Installing')) {
          this.downloadProgress = { percent: 70, downloaded: 0, total: 0 };
          this.emitState();
        } else if (line.includes('Starting') || line.includes('complete')) {
          this.downloadProgress = { percent: 90, downloaded: 0, total: 0 };
          this.emitState();
        }
      });

      child.stdout?.on('data', (data: Buffer) => {
        const line = data.toString();
        console.log('[OllamaService] install:', line.trim());
        if (line.includes('Downloading')) {
          this.downloadProgress = { percent: 30, downloaded: 0, total: 0 };
          this.emitState();
        } else if (line.includes('Installing')) {
          this.downloadProgress = { percent: 70, downloaded: 0, total: 0 };
          this.emitState();
        } else if (line.includes('Starting') || line.includes('complete')) {
          this.downloadProgress = { percent: 90, downloaded: 0, total: 0 };
          this.emitState();
        }
      });
    });
  }

  /**
   * Windows: Download OllamaSetup.exe and launch the installer.
   * User completes the standard Windows installer wizard.
   * After install completes, user clicks Retry in the UI and we re-detect.
   */
  private async installWindows(): Promise<void> {
    console.log('[OllamaService] Windows: Downloading OllamaSetup.exe...');
    const installerPath = join(tmpdir(), 'OllamaSetup.exe');
    const url = 'https://ollama.com/download/OllamaSetup.exe';

    // Download the installer
    await this.downloadFile(url, installerPath);

    console.log('[OllamaService] Windows: Launching installer at', installerPath);
    // Launch the installer — user goes through the wizard
    const { shell } = await import('electron');
    await shell.openPath(installerPath);

    // We can't know when the user finishes the wizard.
    // Set status to 'installed' optimistically — user will click Retry or re-detect.
    // The detect() call after this will verify.
    console.log('[OllamaService] Windows: Installer launched. User will complete the wizard.');
  }

  /**
   * Start the Ollama server process
   */
  async start(): Promise<void> {
    if (this.status === 'running') return;

    // On macOS, try `open -a Ollama` first (starts the app which manages its own server)
    if (platform() === 'darwin' && existsSync('/Applications/Ollama.app')) {
      console.log('[OllamaService] Starting Ollama.app via open -a Ollama...');
      this.status = 'starting';
      this.error = undefined;
      this.emitState();
      try {
        execSync('open -a Ollama --args hidden', { timeout: 10000 });
        // Wait for the server to become ready
        await this.waitForHealthy();
        this.status = 'running';
        this.isExternalInstance = true;
        await this.refreshModels();
        await this.saveConfig();
        this.emitState();
        return;
      } catch (err) {
        console.warn('[OllamaService] Failed to start via Ollama.app, falling back to CLI:', err instanceof Error ? err.message : String(err));
        // Fall through to CLI-based start
      }
    }

    // Determine which binary to use
    let binaryPath: string;
    if (this.externalBinaryPath) {
      binaryPath = this.externalBinaryPath;
    } else {
      // Try to find it
      const found = findExternalBinary();
      if (found) {
        binaryPath = found;
      } else {
        throw new Error('Ollama binary not found. Please install it first.');
      }
    }

    this.status = 'starting';
    this.error = undefined;
    this.emitState();

    try {
      this.process = spawn(binaryPath, ['serve'], {
        env: {
          ...process.env,
          OLLAMA_HOST: `${OLLAMA_HOST}:${OLLAMA_PORT}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      this.process.stdout?.on('data', (data: Buffer) => {
        console.log('[Ollama]', data.toString().trim());
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        console.log('[Ollama:err]', data.toString().trim());
      });

      this.process.on('exit', (code, signal) => {
        console.log(`[OllamaService] Ollama process exited: code=${code}, signal=${signal}`);
        this.process = null;

        if (this.status === 'running' || this.status === 'starting') {
          // Unexpected exit — try one auto-restart
          this.status = 'stopped';
          this.emitState();

          // Auto-restart once
          console.log('[OllamaService] Attempting auto-restart...');
          this.start().catch((err) => {
            console.error('[OllamaService] Auto-restart failed:', err);
            this.status = 'error';
            this.error = 'Ollama crashed and auto-restart failed';
            this.emitState();
          });
        }
      });

      this.process.on('error', (err) => {
        console.error('[OllamaService] Process error:', err);
        this.status = 'error';
        this.error = err.message;
        this.process = null;
        this.emitState();
      });

      await this.waitForHealthy();
      this.status = 'running';
      await this.refreshModels();
      this.emitState();
    } catch (err) {
      this.status = 'error';
      this.error = err instanceof Error ? err.message : String(err);
      this.emitState();
      throw err;
    }
  }

  /**
   * Poll until the Ollama server responds to health checks.
   */
  private async waitForHealthy(): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < START_TIMEOUT_MS) {
      if (await isOllamaRunning()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('Ollama failed to start within 30 seconds');
  }

  /**
   * Stop the Ollama server process
   */
  async stop(): Promise<void> {
    if (!this.process) {
      this.status = 'stopped';
      this.emitState();
      return;
    }

    // Remove auto-restart behavior by setting status first
    this.status = 'stopped';

    try {
      this.process.kill('SIGTERM');

      // Wait for exit
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          // Force kill after timeout
          try { this.process?.kill('SIGKILL'); } catch { /* ignore */ }
          resolve();
        }, STOP_TIMEOUT_MS);

        this.process?.on('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } catch {
      // Force kill
      try { this.process?.kill('SIGKILL'); } catch { /* ignore */ }
    }

    this.process = null;
    this.emitState();
  }

  /**
   * List installed models
   */
  async listModels(): Promise<OllamaModel[]> {
    await this.refreshModels();
    return this.models;
  }

  /**
   * Pull a model with streaming progress
   */
  async pullModel(name: string): Promise<void> {
    if (this.status !== 'running') {
      throw new Error('Ollama is not running');
    }

    this.pullProgress = { model: name, percent: 0, status: 'starting' };
    this.emitState();

    return new Promise((resolve, reject) => {
      const url = new URL('/api/pull', OLLAMA_BASE_URL);
      const { request } = require('node:http') as typeof import('node:http');

      const req = request(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (res: IncomingMessage) => {
        let buffer = '';

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          // NDJSON: split by newlines
          const lines = buffer.split('\n');
          buffer = lines.pop() || ''; // Keep incomplete line

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line) as {
                status: string;
                digest?: string;
                total?: number;
                completed?: number;
                error?: string;
              };

              if (data.error) {
                this.pullProgress = undefined;
                this.emitState();
                reject(new Error(data.error));
                return;
              }

              let percent = 0;
              if (data.total && data.completed) {
                percent = Math.round((data.completed / data.total) * 100);
              }

              this.pullProgress = { model: name, percent, status: data.status };
              this.onPullProgress?.(this.pullProgress);
              this.emitState();
            } catch {
              // Ignore parse errors for incomplete lines
            }
          }
        });

        res.on('end', () => {
          this.pullProgress = undefined;
          this.refreshModels().then(() => {
            this.emitState();
            resolve();
          });
        });

        res.on('error', (err) => {
          this.pullProgress = undefined;
          this.emitState();
          reject(err);
        });
      });

      req.on('error', (err) => {
        this.pullProgress = undefined;
        this.emitState();
        reject(err);
      });

      req.write(JSON.stringify({ name, stream: true }));
      req.end();
    });
  }

  /**
   * Delete a model
   */
  async deleteModel(name: string): Promise<void> {
    if (this.status !== 'running') {
      throw new Error('Ollama is not running');
    }

    return new Promise((resolve, reject) => {
      const url = new URL('/api/delete', OLLAMA_BASE_URL);
      const { request } = require('node:http') as typeof import('node:http');

      const req = request(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      }, (res: IncomingMessage) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          if (res.statusCode === 200) {
            this.refreshModels().then(() => {
              this.emitState();
              resolve();
            });
          } else {
            reject(new Error(`Failed to delete model: ${data}`));
          }
        });
      });

      req.on('error', reject);
      req.write(JSON.stringify({ name }));
      req.end();
    });
  }

  /**
   * Set auto-start preference
   */
  async setAutoStart(enabled: boolean): Promise<void> {
    this.config.autoStart = enabled;
    await this.saveConfig();
  }

  /**
   * Get current state for IPC
   */
  getState(): OllamaState {
    return {
      status: this.status,
      isExternalInstance: this.isExternalInstance,
      externalBinaryPath: this.externalBinaryPath,
      version: this.config.version,
      autoStart: this.config.autoStart,
      models: this.models,
      error: this.error,
      downloadProgress: this.downloadProgress,
      pullProgress: this.pullProgress,
      systemInfo: getSystemInfo(),
    };
  }

  /**
   * Get the connector name used for the managed Ollama instance
   */
  getConnectorName(): string {
    return CONNECTOR_NAME;
  }

  /**
   * Create the ollama-local connector via AgentService
   * Returns connector config for AgentService.addConnector()
   */
  getConnectorConfig(): {
    name: string;
    vendor: string;
    auth: { type: 'none' };
    baseURL: string;
  } {
    return {
      name: CONNECTOR_NAME,
      vendor: 'ollama',
      auth: { type: 'none' },
      baseURL: `${OLLAMA_BASE_URL}/v1`,
    };
  }

  /**
   * Graceful shutdown on app quit
   */
  async destroy(): Promise<void> {
    // Only stop if we own the process
    if (this.process && !this.isExternalInstance) {
      await this.stop();
    }
    this.process = null;
  }

  /**
   * DEV ONLY: Reset state to 'not_installed' so the download flow can be tested
   * without actually uninstalling Ollama. Does NOT stop a running process or delete binaries.
   */
  resetForTesting(): void {
    this.status = 'not_installed';
    this.isExternalInstance = false;
    this.externalBinaryPath = undefined;
    this.models = [];
    this.error = undefined;
    this.downloadProgress = undefined;
    this.pullProgress = undefined;
    this.emitState();
    console.log('[OllamaService] State reset for testing — showing as not_installed');
  }

  // ============ Private Methods ============

  private async loadConfig(): Promise<void> {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) return;

    try {
      const data = await readFile(configPath, 'utf-8');
      const saved = JSON.parse(data) as Partial<OllamaConfig>;
      Object.assign(this.config, saved);
      this.isExternalInstance = this.config.isExternalInstance;
      this.externalBinaryPath = this.config.externalBinaryPath;
    } catch {
      // Ignore corrupt config
    }
  }

  private async saveConfig(): Promise<void> {
    const configPath = getConfigPath();
    const dir = getHoseaDataDir();
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    await writeFile(configPath, JSON.stringify(this.config, null, 2));
  }

  private async refreshModels(): Promise<void> {
    try {
      const resp = await ollamaFetch<{ models: Array<{
        name: string;
        size: number;
        digest: string;
        modified_at: string;
      }> }>('/api/tags', { timeout: 5000 });

      this.models = (resp.models || []).map((m) => ({
        name: m.name,
        size: m.size,
        digest: m.digest,
        modifiedAt: m.modified_at,
      }));
    } catch {
      // If we can't reach Ollama, keep existing model list
    }
  }

  private async downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const follow = (currentUrl: string) => {
        const getter = currentUrl.startsWith('https') ? httpsGet : httpGet;
        getter(currentUrl, (res: IncomingMessage) => {
          // Handle redirects
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            follow(res.headers.location);
            return;
          }

          if (res.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${res.statusCode}`));
            return;
          }

          const total = parseInt(res.headers['content-length'] || '0', 10);
          let downloaded = 0;

          const fileStream = createWriteStream(destPath);

          res.on('data', (chunk: Buffer) => {
            downloaded += chunk.length;
            const progress = {
              percent: total > 0 ? Math.round((downloaded / total) * 100) : 0,
              downloaded,
              total,
            };
            this.downloadProgress = progress;
            this.onDownloadProgress?.(progress);
          });

          res.pipe(fileStream);

          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });

          fileStream.on('error', (err) => {
            try { unlinkSync(destPath); } catch { /* ignore */ }
            reject(err);
          });
        }).on('error', reject);
      };

      follow(url);
    });
  }

  private emitState(): void {
    this.onStateChanged?.(this.getState());
  }
}
