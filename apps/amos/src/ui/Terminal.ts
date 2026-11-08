/**
 * Terminal - Terminal UI utilities for AMOS
 *
 * Handles input/output, colors, spinners, and prompts.
 */

import * as readline from 'node:readline';
import chalk from 'chalk';

export class Terminal {
  private rl: readline.Interface | null = null;
  private inputClosed = false;
  private colorEnabled: boolean = true;

  /**
   * Initialize readline interface
   */
  initialize(): void {
    if (this.rl || this.inputClosed) return;
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.rl = rl;
    rl.once('close', () => {
      this.inputClosed = true;
      if (this.rl === rl) this.rl = null;
    });
  }

  /**
   * Close readline interface
   */
  close(): void {
    this.inputClosed = true;
    this.rl?.close();
    this.rl = null;
  }

  /**
   * Set color output enabled
   */
  setColorEnabled(enabled: boolean): void {
    this.colorEnabled = enabled;
  }

  /**
   * Print a message
   */
  print(message: string): void {
    console.log(message);
  }

  /**
   * Print an error message
   */
  printError(message: string): void {
    console.log(this.colorEnabled ? chalk.red(`Error: ${message}`) : `Error: ${message}`);
  }

  /**
   * Print a success message
   */
  printSuccess(message: string): void {
    console.log(this.colorEnabled ? chalk.green(message) : message);
  }

  /**
   * Print an info message
   */
  printInfo(message: string): void {
    console.log(this.colorEnabled ? chalk.blue(message) : message);
  }

  /**
   * Print a warning message
   */
  printWarning(message: string): void {
    console.log(this.colorEnabled ? chalk.yellow(message) : message);
  }

  /**
   * Print dim text
   */
  printDim(message: string): void {
    console.log(this.colorEnabled ? chalk.dim(message) : message);
  }

  /**
   * Print bold text
   */
  printBold(message: string): void {
    console.log(this.colorEnabled ? chalk.bold(message) : message);
  }

  /**
   * Write text without newline
   */
  write(text: string): void {
    process.stdout.write(text);
  }

  /**
   * Clear the screen
   */
  clear(): void {
    console.clear();
  }

  /**
   * Prompt for input
   */
  async prompt(question: string): Promise<string> {
    if (this.rl) return (await this.readline(question)) ?? '';
    if (this.inputClosed || process.stdin.readableEnded || process.stdin.destroyed) return '';
    // Preserve the temporary-interface fallback before initialize().
    const temporary = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await this.readQuestion(temporary, question);
      if (answer === null) this.inputClosed = true;
      return answer ?? '';
    } finally { temporary.close(); }
  }

  /**
   * Prompt for confirmation (y/n)
   */
  async confirm(question: string): Promise<boolean> {
    const answer = await this.prompt(`${question} (y/n): `);
    return answer.toLowerCase().startsWith('y');
  }

  /**
   * Present options and let user select
   */
  async select<T extends string>(question: string, options: T[]): Promise<T> {
    this.print(question);
    options.forEach((opt, i) => {
      this.print(`  ${i + 1}. ${opt}`);
    });

    while (true) {
      const answer = await this.prompt('Enter number or value: ');

      // Try as number
      const num = parseInt(answer);
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        return options[num - 1];
      }

      // Try as value
      const found = options.find(
        (o) => o.toLowerCase() === answer.toLowerCase()
      );
      if (found) {
        return found;
      }

      this.printError(`Invalid selection. Enter 1-${options.length} or the option value.`);
    }
  }

  /**
   * Show a spinner
   */
  showSpinner(message: string): SpinnerHandle {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    let running = true;

    const interval = setInterval(() => {
      if (!running) return;
      process.stdout.write(`\r${this.colorEnabled ? chalk.cyan(frames[i]) : frames[i]} ${message}`);
      i = (i + 1) % frames.length;
    }, 80);

    return {
      stop: (finalMessage?: string) => {
        running = false;
        clearInterval(interval);
        process.stdout.write('\r' + ' '.repeat(message.length + 3) + '\r');
        if (finalMessage) {
          this.print(finalMessage);
        }
      },
      update: (newMessage: string) => {
        message = newMessage;
      },
    };
  }

  /**
   * Display a progress bar
   */
  showProgress(current: number, total: number, message: string = ''): void {
    const width = 30;
    const percent = total > 0
      ? Math.max(0, Math.min(current / total, 1))
      : 1;
    const filled = Math.round(width * percent);
    const empty = width - filled;

    const bar = this.colorEnabled
      ? chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty))
      : '█'.repeat(filled) + '░'.repeat(empty);

    const percentStr = `${Math.round(percent * 100)}%`.padStart(4);
    process.stdout.write(`\r${bar} ${percentStr} ${message}`);

    if (current >= total) {
      console.log();
    }
  }

  /**
   * Read line from stdin (for REPL)
   */
  async readline(promptStr: string): Promise<string | null> {
    return this.rl ? this.readQuestion(this.rl, promptStr) : null;
  }

  private readQuestion(rl: readline.Interface, promptStr: string): Promise<string | null> {
    return new Promise((resolve) => {
      const closeHandler = () => resolve(null);
      rl.once('close', closeHandler);
      rl.question(promptStr, (answer) => {
        rl.removeListener('close', closeHandler);
        resolve(answer);
      });
    });
  }

  /**
   * Format as box
   */
  box(content: string, title?: string): string {
    const lines = content.split('\n');
    const maxLen = Math.max(...lines.map((l) => l.length), title?.length || 0);
    const width = maxLen + 4;

    const top = '╔' + '═'.repeat(width - 2) + '╗';
    const bottom = '╚' + '═'.repeat(width - 2) + '╝';
    const empty = '║' + ' '.repeat(width - 2) + '║';

    const result: string[] = [top];

    if (title) {
      const padding = (width - 2 - title.length) / 2;
      const left = ' '.repeat(Math.floor(padding));
      const right = ' '.repeat(Math.ceil(padding));
      result.push('║' + left + title + right + '║');
      result.push('╠' + '═'.repeat(width - 2) + '╣');
    }

    for (const line of lines) {
      const padding = width - 4 - line.length;
      result.push('║ ' + line + ' '.repeat(padding + 1) + '║');
    }

    result.push(bottom);

    return result.join('\n');
  }

  /**
   * Format as table
   */
  table(headers: string[], rows: string[][]): string {
    const colWidths = headers.map((h, i) => {
      const maxRow = Math.max(...rows.map((r) => (r[i] || '').length));
      return Math.max(h.length, maxRow);
    });

    const separator = '─'.repeat(colWidths.reduce((a, b) => a + b + 3, 1));

    const formatRow = (cells: string[]) => {
      return '│ ' + cells.map((c, i) => c.padEnd(colWidths[i])).join(' │ ') + ' │';
    };

    const lines = [
      '┌' + separator.slice(0, -1) + '┐',
      formatRow(headers),
      '├' + separator.slice(0, -1) + '┤',
      ...rows.map(formatRow),
      '└' + separator.slice(0, -1) + '┘',
    ];

    return lines.join('\n');
  }
}

interface SpinnerHandle {
  stop: (finalMessage?: string) => void;
  update: (message: string) => void;
}
