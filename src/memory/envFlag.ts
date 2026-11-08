import { env } from '../infrastructure/runtime/environment.js';
/**
 * Process-env boolean flag with one-shot caching. Used by the memory layer's
 * warning subsystems (`ONERINGAI_SUPPRESS_CAP_WARNINGS`,
 * `ONERINGAI_SUPPRESS_ORDER_WARNINGS`) to read each suppression env var once
 * per process rather than re-checking on every adapter call. Tests reset the
 * cache so the next call re-reads after swapping the var.
 */
export interface EnvFlag {
  isSet(): boolean;
  reset(): void;
}

export function makeEnvFlag(name: string): EnvFlag {
  let cached: boolean | undefined;
  return {
    isSet(): boolean {
      if (cached !== undefined) return cached;
      cached = env(name) === '1';
      return cached;
    },
    reset(): void {
      cached = undefined;
    },
  };
}
