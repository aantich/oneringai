/**
 * Hook to collect and manage form state for interactive UI blocks.
 *
 * Tracks values by component `id`. Components register their default values
 * on mount, and update values on user interaction.
 */

import { useState, useCallback, useRef } from 'react';

export interface FormState {
  /** Current form values keyed by component id */
  values: Record<string, unknown>;
  /** Set a single field value */
  setValue: (id: string, value: unknown) => void;
  /** Get all current values (snapshot) */
  getValues: () => Record<string, unknown>;
  /** Register a default value (only sets if not already present) */
  registerDefault: (id: string, value: unknown) => void;
}

export function useFormState(): FormState {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const valuesRef = useRef(values);
  valuesRef.current = values;

  const setValue = useCallback((id: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  }, []);

  const getValues = useCallback(() => {
    return { ...valuesRef.current };
  }, []);

  const registerDefault = useCallback((id: string, value: unknown) => {
    setValues((prev) => {
      if (id in prev) return prev;
      return { ...prev, [id]: value };
    });
  }, []);

  return { values, setValue, getValues, registerDefault };
}
