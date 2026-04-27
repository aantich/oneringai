/**
 * New lifecycle predicates registered in STANDARD_PREDICATES.
 *
 * These back the v25 task/event reconciliation pipeline. Verify the registry
 * still loads, the predicates appear with the expected metadata, and they're
 * consumable via PredicateRegistry.standard().
 */

import { describe, it, expect } from 'vitest';
import {
  STANDARD_PREDICATES,
  PredicateRegistry,
} from '@/memory/predicates/index.js';

describe('STANDARD_PREDICATES — lifecycle additions', () => {
  const reg = PredicateRegistry.standard();

  it.each(['prepares_for', 'delegated_to', 'cancelled_due_to'] as const)(
    'has %s registered',
    (name) => {
      const def = STANDARD_PREDICATES.find((p) => p.name === name);
      expect(def, `${name} missing from STANDARD_PREDICATES`).toBeDefined();
      expect(def!.description.length).toBeGreaterThan(0);
      expect(reg.get(name)).toBeDefined();
    },
  );

  it('prepares_for is task→event with correct inverse', () => {
    const def = STANDARD_PREDICATES.find((p) => p.name === 'prepares_for')!;
    expect(def.subjectTypes).toEqual(['task']);
    expect(def.objectTypes).toEqual(['event']);
    expect(def.inverse).toBe('prepared_by');
    expect(def.payloadKind).toBe('relational');
  });

  it('delegated_to is task→person', () => {
    const def = STANDARD_PREDICATES.find((p) => p.name === 'delegated_to')!;
    expect(def.subjectTypes).toEqual(['task']);
    expect(def.objectTypes).toEqual(['person']);
    expect(def.payloadKind).toBe('relational');
  });

  it('cancelled_due_to allows task or event subjects', () => {
    const def = STANDARD_PREDICATES.find((p) => p.name === 'cancelled_due_to')!;
    expect(def.subjectTypes).toEqual(['task', 'event']);
    expect(def.payloadKind).toBe('relational');
  });

  it('does not reuse `completed_by` as a top-level predicate (already covered by `completed` inverse)', () => {
    const def = STANDARD_PREDICATES.find((p) => p.name === 'completed_by');
    expect(def, 'completed_by should not be registered separately — it is `completed` reversed').toBeUndefined();
    // The `completed` predicate exposes it as inverse, which is enough for retrieval.
    const completed = STANDARD_PREDICATES.find((p) => p.name === 'completed')!;
    expect(completed.inverse).toBe('completed_by');
  });
});
