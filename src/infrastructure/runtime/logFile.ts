import * as fs from 'node:fs';
import { dirname } from 'node:path';
export function assertFileLogging(): void { /* Available in Node. */ }
export function openLogFile(filePath: string): fs.WriteStream {
  const directory = dirname(filePath);
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  return fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
}
