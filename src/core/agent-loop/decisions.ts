/** Shared decisions; adapters explicitly retain their provider-state differences. */
export function classifyManagedResponse(input: {
  toolCalls: number; hasText: boolean; hasOpaqueState: boolean;
  status?: string; stopReason?: string;
}): 'tools' | 'refusal' | 'failed' | 'empty' | 'final' {
  if (input.toolCalls) return 'tools';
  if (input.stopReason === 'refusal') return 'refusal';
  if (input.status === 'failed') return 'failed';
  return input.hasText || input.hasOpaqueState ? 'final' : 'empty';
}

export function shouldRetryEmptyResponse(
  classification: ReturnType<typeof classifyManagedResponse>, enabled: boolean,
  attempts: number, maximum: number,
): boolean { return classification === 'empty' && enabled && attempts < maximum; }
