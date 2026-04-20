/**
 * Minimal readline-based terminal wrapper. One shared Interface kept open
 * across modes so every prompt reuses the same raw-mode state.
 */

import * as readline from 'node:readline';
import chalk from 'chalk';

export class UI {
  readonly rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  close(): void {
    this.rl.close();
  }

  print(msg = ''): void {
    console.log(msg);
  }
  info(msg: string): void {
    console.log(chalk.cyan(msg));
  }
  success(msg: string): void {
    console.log(chalk.green(msg));
  }
  warn(msg: string): void {
    console.log(chalk.yellow(msg));
  }
  error(msg: string): void {
    console.log(chalk.red(`Error: ${msg}`));
  }
  dim(msg: string): void {
    console.log(chalk.dim(msg));
  }
  heading(msg: string): void {
    console.log(chalk.bold.magenta(`\n${msg}`));
    console.log(chalk.dim('─'.repeat(Math.min(msg.length, 60))));
  }
  write(text: string): void {
    process.stdout.write(text);
  }

  async prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => resolve(answer));
    });
  }

  /**
   * Multi-line input — lines collected until the user enters a line equal to
   * `sentinel` (default `END`). Returns the joined text (sentinel excluded).
   */
  async multiline(prompt: string, sentinel = 'END'): Promise<string> {
    this.dim(`${prompt} (finish with a line containing only: ${sentinel})`);
    const lines: string[] = [];
    for (;;) {
      const line = await this.prompt('');
      if (line === sentinel) break;
      lines.push(line);
    }
    return lines.join('\n');
  }

  async confirm(question: string): Promise<boolean> {
    const ans = await this.prompt(`${question} (y/n): `);
    return ans.trim().toLowerCase().startsWith('y');
  }
}

/** Fixed-width table renderer — tolerant to very long cells (truncates). */
export function renderTable(headers: string[], rows: string[][], maxCol = 48): string {
  const colWidths = headers.map((h, i) => {
    const rowMax = Math.max(0, ...rows.map((r) => (r[i] ?? '').length));
    return Math.min(Math.max(h.length, rowMax), maxCol);
  });
  const trim = (s: string, w: number): string =>
    s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w);
  const line = (cells: string[]): string =>
    cells.map((c, i) => trim(c, colWidths[i]!)).join('  ');
  const out: string[] = [chalk.bold(line(headers)), chalk.dim(colWidths.map((w) => '─'.repeat(w)).join('  '))];
  for (const r of rows) out.push(line(r));
  return out.join('\n');
}

/**
 * Parse `/cmd key=value key2="quoted value" positional` into
 * { positional: string[], flags: Record<string, string> }. Quotes preserved
 * around values only.
 */
export function parseArgs(raw: string): { positional: string[]; flags: Record<string, string> } {
  const tokens: string[] = [];
  let cur = '';
  let inQuote: '"' | "'" | null = null;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;
    if (inQuote) {
      if (c === inQuote) {
        inQuote = null;
        continue;
      }
      cur += c;
    } else if (c === '"' || c === "'") {
      inQuote = c;
    } else if (c === ' ' || c === '\t') {
      if (cur.length) {
        tokens.push(cur);
        cur = '';
      }
    } else {
      cur += c;
    }
  }
  if (cur.length) tokens.push(cur);

  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (const t of tokens) {
    const eq = t.indexOf('=');
    if (eq > 0) {
      flags[t.slice(0, eq)] = t.slice(eq + 1);
    } else {
      positional.push(t);
    }
  }
  return { positional, flags };
}
