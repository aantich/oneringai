import { InvalidConfigError } from '../../domain/errors/AIErrors.js';
export function assertFileLogging(): void { throw new InvalidConfigError('File logging requires a Node host'); }
export function openLogFile(_filePath: string): never {
  throw new InvalidConfigError('File logging requires a Node host; use the existing console destination in the browser');
}
