/**
 * Background Process Manager
 *
 * Centralized management of background shell processes.
 * Provides a ring buffer for output, metadata tracking, and
 * incremental reads via sequence numbers.
 *
 * Used by the bash tool (to spawn) and bg_process_* tools (to monitor/control).
 */

import type { ChildProcess } from 'node:child_process';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname } from 'node:path';

// ============ Output Ring Buffer ============

/**
 * Fixed-capacity ring buffer for process output lines.
 * O(1) append, efficient tail and incremental reads.
 */
export class OutputRingBuffer {
  private buffer: string[] = [];
  private writeIndex = 0;
  private full = false;
  private readonly capacity: number;

  /** Total lines ever written (monotonically increasing sequence number) */
  private _totalWritten = 0;

  /** Partial line not yet terminated by \n */
  private partial = '';

  constructor(capacity = 2000) {
    this.capacity = capacity;
  }

  /**
   * Append a raw chunk from stdout/stderr.
   * Splits on newlines; buffers the trailing partial line until the next chunk.
   */
  append(chunk: string): void {
    const text = this.partial + chunk;
    const lines = text.split('\n');

    // Last element is either '' (chunk ended with \n) or a partial line
    this.partial = lines.pop()!;

    for (const line of lines) {
      this.pushLine(line);
    }
  }

  /** Flush any remaining partial line (call on process exit) */
  flush(): void {
    if (this.partial.length > 0) {
      this.pushLine(this.partial);
      this.partial = '';
    }
  }

  private pushLine(line: string): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(line);
    } else {
      this.buffer[this.writeIndex] = line;
      this.full = true;
    }
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    this._totalWritten++;
  }

  /**
   * Get the last N lines in chronological order.
   *
   * Note: when full=false, buffer is a simple growing array and writeIndex
   * tracks where the next push will go. The non-full branch uses direct
   * indexing which is correct even at the transition point (buffer.length === capacity)
   * because full gets set on the NEXT pushLine call after the array fills.
   */
  tail(n?: number): string[] {
    const size = this.size;
    const count = Math.min(n ?? size, size);
    if (count === 0) return [];

    const result: string[] = [];
    const start = this.full
      ? (this.writeIndex - count + this.capacity) % this.capacity
      : Math.max(0, this.buffer.length - count);

    for (let i = 0; i < count; i++) {
      const idx = this.full
        ? (start + i) % this.capacity
        : start + i;
      result.push(this.buffer[idx]!);
    }
    return result;
  }

  /**
   * Get lines written since a sequence number (for incremental reads).
   * Returns the new lines and the next sequence number to use.
   */
  since(seq: number): { lines: string[]; nextSequence: number } {
    const total = this._totalWritten;
    if (seq >= total) {
      return { lines: [], nextSequence: total };
    }

    // How many lines back from current do we need?
    const linesBack = total - seq;
    // But we can only go back as far as our buffer holds
    const available = Math.min(linesBack, this.size);
    return { lines: this.tail(available), nextSequence: total };
  }

  get totalWritten(): number { return this._totalWritten; }
  get size(): number { return this.full ? this.capacity : this.buffer.length; }
}

// ============ Process Info ============

export type BackgroundProcessStatus = 'running' | 'exited' | 'killed' | 'errored';

export interface BackgroundProcessInfo {
  id: string;
  /** The command that was launched */
  command: string;
  /** PID of the shell process */
  pid: number | undefined;
  status: BackgroundProcessStatus;
  exitCode: number | null;
  signal: string | null;
  /** ISO timestamp when started */
  startedAt: string;
  /** ISO timestamp when exited (null if still running) */
  exitedAt: string | null;
  /** Total output lines ever produced */
  totalOutputLines: number;
  /** Path to persistent log file (if logging to file) */
  logFile: string | null;
}

/** Options for registering a background process */
export interface RegisterOptions {
  /** Path to write a persistent log file. Directory is created if needed. */
  logFile?: string;
}

// ============ Manager ============

interface ManagedProcess {
  id: string;
  command: string;
  /** ChildProcess reference. Nulled after exit to prevent memory leaks. */
  process: ChildProcess | null;
  /** PID captured at registration time (before process is nulled) */
  pid: number | undefined;
  output: OutputRingBuffer;
  status: BackgroundProcessStatus;
  exitCode: number | null;
  signal: string | null;
  startedAt: string;
  exitedAt: string | null;
  /** Pending SIGKILL timeout (from kill()). Cleared on process exit. */
  killTimeoutId: ReturnType<typeof setTimeout> | null;
  /** Persistent log file write stream (if logging to file) */
  logStream: WriteStream | null;
  /** Path to the log file (if logging to file) */
  logFile: string | null;
}

/** Max concurrent running processes */
const MAX_RUNNING = 20;
/** Max total entries (running + completed) before evicting oldest completed */
const MAX_TOTAL = 50;

/**
 * Singleton manager for all background shell processes.
 */
class BackgroundProcessManagerImpl {
  private processes: Map<string, ManagedProcess> = new Map();
  private idCounter = 0;

  /**
   * Register a spawned process for tracking.
   * Called by the bash tool after spawning with run_in_background.
   */
  register(command: string, childProcess: ChildProcess, options: RegisterOptions = {}): { id: string } | { error: string } {
    // Check running count
    let running = 0;
    for (const p of this.processes.values()) {
      if (p.status === 'running') running++;
    }
    if (running >= MAX_RUNNING) {
      return { error: `Too many background processes (max: ${MAX_RUNNING}). Kill some before starting new ones.` };
    }

    // Evict oldest completed if at capacity
    this.evictIfNeeded();

    const id = `bg_${++this.idCounter}`;
    const output = new OutputRingBuffer(2000);

    // Set up optional log file
    let logStream: WriteStream | null = null;
    const logFile = options.logFile ?? null;
    if (logFile) {
      try {
        mkdirSync(dirname(logFile), { recursive: true });
        logStream = createWriteStream(logFile, { flags: 'a' });
        logStream.write(`[${new Date().toISOString()}] Starting: ${command}\n`);
      } catch (err) {
        // Non-fatal: log file failure shouldn't prevent process from running
        logStream = null;
      }
    }

    const managed: ManagedProcess = {
      id,
      command,
      process: childProcess,
      pid: childProcess.pid,
      output,
      status: 'running',
      exitCode: null,
      signal: null,
      startedAt: new Date().toISOString(),
      exitedAt: null,
      killTimeoutId: null,
      logStream,
      logFile,
    };

    // Wire up output collection (tee to ring buffer + optional log file)
    childProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      output.append(text);
      if (managed.logStream) {
        managed.logStream.write(text);
      }
    });
    childProcess.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      output.append(text);
      if (managed.logStream) {
        managed.logStream.write(text);
      }
    });

    // Wire up exit tracking
    childProcess.on('close', (code, sig) => {
      output.flush();
      managed.exitCode = code;
      managed.signal = sig;
      managed.status = sig ? 'killed' : 'exited';
      managed.exitedAt = new Date().toISOString();
      // Close log stream
      if (managed.logStream) {
        managed.logStream.write(`\n[${managed.exitedAt}] Process exited (code=${code}, signal=${sig})\n`);
        managed.logStream.end();
        managed.logStream = null;
      }
      // Release ChildProcess reference to prevent memory leak
      managed.process = null;
      // Clear any pending SIGKILL timeout
      if (managed.killTimeoutId !== null) {
        clearTimeout(managed.killTimeoutId);
        managed.killTimeoutId = null;
      }
    });

    childProcess.on('error', (err) => {
      output.append(`[spawn error] ${err.message}\n`);
      output.flush();
      managed.status = 'errored';
      managed.exitedAt = new Date().toISOString();
      // Close log stream
      if (managed.logStream) {
        managed.logStream.write(`\n[${managed.exitedAt}] Process errored: ${err.message}\n`);
        managed.logStream.end();
        managed.logStream = null;
      }
      // Release ChildProcess reference to prevent memory leak
      managed.process = null;
      if (managed.killTimeoutId !== null) {
        clearTimeout(managed.killTimeoutId);
        managed.killTimeoutId = null;
      }
    });

    this.processes.set(id, managed);
    return { id };
  }

  /**
   * Get process info (without output).
   */
  getInfo(id: string): BackgroundProcessInfo | null {
    const p = this.processes.get(id);
    if (!p) return null;
    return {
      id: p.id,
      command: p.command,
      pid: p.pid,
      status: p.status,
      exitCode: p.exitCode,
      signal: p.signal,
      startedAt: p.startedAt,
      exitedAt: p.exitedAt,
      totalOutputLines: p.output.totalWritten,
      logFile: p.logFile,
    };
  }

  /**
   * Read output lines.
   * - tail(n): last N lines
   * - since(seq): lines since sequence number (for incremental polling)
   */
  readOutput(id: string, opts: { tail?: number; since?: number } = {}): {
    success: boolean;
    lines?: string[];
    nextSequence?: number;
    totalLines?: number;
    error?: string;
  } {
    const p = this.processes.get(id);
    if (!p) return { success: false, error: `Background process '${id}' not found` };

    if (opts.since !== undefined) {
      const result = p.output.since(opts.since);
      return { success: true, lines: result.lines, nextSequence: result.nextSequence, totalLines: p.output.totalWritten };
    }

    const lines = p.output.tail(opts.tail ?? 50);
    return { success: true, lines, nextSequence: p.output.totalWritten, totalLines: p.output.totalWritten };
  }

  /**
   * Kill a background process. Sends SIGTERM, then SIGKILL after 3s.
   */
  kill(id: string): { success: boolean; error?: string } {
    const p = this.processes.get(id);
    if (!p) return { success: false, error: `Background process '${id}' not found` };
    if (p.status !== 'running') return { success: false, error: `Process '${id}' is not running (status: ${p.status})` };

    // Send SIGTERM (process may already be null in a race, guard it)
    if (p.process) {
      try {
        // Kill entire process group (negative PID) to catch child trees
        if (p.pid) {
          process.kill(-p.pid, 'SIGTERM');
        } else {
          p.process.kill('SIGTERM');
        }
      } catch {
        try { p.process.kill('SIGTERM'); } catch { /* already dead */ }
      }
    }

    // Force kill after 3 seconds if still alive.
    // Timeout is stored on managed and cleared in close/error handlers.
    p.killTimeoutId = setTimeout(() => {
      p.killTimeoutId = null;
      if (p.status === 'running' && p.process) {
        try {
          if (p.pid) {
            process.kill(-p.pid, 'SIGKILL');
          } else {
            p.process.kill('SIGKILL');
          }
        } catch { /* already dead */ }
      }
    }, 3000);

    return { success: true };
  }

  /**
   * List all tracked processes (running first, then most recent completed).
   */
  list(): BackgroundProcessInfo[] {
    const infos: BackgroundProcessInfo[] = [];
    for (const p of this.processes.values()) {
      infos.push({
        id: p.id,
        command: p.command,
        pid: p.pid,
        status: p.status,
        exitCode: p.exitCode,
        signal: p.signal,
        startedAt: p.startedAt,
        exitedAt: p.exitedAt,
        totalOutputLines: p.output.totalWritten,
        logFile: p.logFile,
      });
    }

    // Running first, then by start time descending
    infos.sort((a, b) => {
      if (a.status === 'running' && b.status !== 'running') return -1;
      if (a.status !== 'running' && b.status === 'running') return 1;
      return b.startedAt.localeCompare(a.startedAt);
    });

    return infos;
  }

  /**
   * Kill all running processes (cleanup on shutdown).
   */
  killAll(): void {
    for (const p of this.processes.values()) {
      if (p.status === 'running' && p.process) {
        try {
          if (p.pid) {
            process.kill(-p.pid, 'SIGTERM');
          } else {
            p.process.kill('SIGTERM');
          }
        } catch { /* ignore */ }
      }
      // Close any open log streams
      if (p.logStream) {
        try { p.logStream.end(); } catch { /* ignore */ }
        p.logStream = null;
      }
    }
  }

  /** Evict oldest completed entries when over capacity */
  private evictIfNeeded(): void {
    if (this.processes.size < MAX_TOTAL) return;

    const completed: string[] = [];
    for (const [id, p] of this.processes) {
      if (p.status !== 'running') {
        completed.push(id);
      }
    }

    // Remove oldest completed (Map preserves insertion order, so first = oldest)
    const toRemove = this.processes.size - MAX_TOTAL + 1; // +1 to make room
    for (let i = 0; i < toRemove && i < completed.length; i++) {
      this.processes.delete(completed[i]!);
    }
  }
}

/** Singleton instance */
export const BackgroundProcessManager = new BackgroundProcessManagerImpl();
