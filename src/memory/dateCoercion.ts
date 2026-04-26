/**
 * Date coercion at write boundaries.
 *
 * Background: callers (LLM extraction, REST sync, hand-rolled scripts) routinely
 * hand the library temporal values as ISO strings rather than `Date` objects.
 * If a string lands in MongoDB, BSON cross-type comparison silently breaks
 * range queries — `{ 'metadata.startTime': { $gte: <Date> } }` returns zero
 * matches for string-typed values, even when the moments overlap. The fix
 * is to enforce `Date` at every write site.
 *
 * Two coercers:
 *   - `coerceMetadataDates(metadata)` — used on `IEntity.metadata` and on
 *     `IFact.metadata`. Walks the object recursively (depth-limited) and
 *     coerces any string value that *looks like* an ISO 8601 date. Conservative
 *     by design: a string that doesn't match the ISO regex is left untouched,
 *     so business-data strings like `expiresAt: 'never'` stay strings.
 *   - `coerceFactTemporalFields(input)` — used on `IFact` write inputs and
 *     patches. The fact-level temporal fields (`observedAt`, `validFrom`,
 *     `validUntil`) are *typed* as `Date | undefined`, so we coerce
 *     unconditionally — any string there is contract violation we silently
 *     repair.
 *
 * Helpers are pure / side-effect-free and return the original reference when
 * no coercion was needed (preserves identity for downstream change detection).
 */

/**
 * ISO 8601 detector. Matches:
 *   - Date only: `2026-04-30`
 *   - DateTime: `2026-04-30T13:00:00`, with `T` or space separator
 *   - With seconds + fractional: `2026-04-30T13:00:00.123` (any fractional precision,
 *     including the 7-digit precision Microsoft Graph emits)
 *   - With timezone: `Z`, `+HH:MM`, `+HHMM`, `-HH:MM`
 *
 * Does NOT match arbitrary numeric strings, free-form labels, or partial dates.
 */
const ISO_8601_REGEX =
    /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Conservative ISO-string detection — returns true only for unambiguous date literals. */
export function looksLikeIsoDate(value: unknown): value is string {
    return typeof value === 'string' && ISO_8601_REGEX.test(value);
}

/**
 * Coerce a single value to Date if it's an unambiguous date string. Otherwise
 * returns the value unchanged. `Date` instances pass through. `null` /
 * `undefined` / non-date strings / numbers / objects are returned as-is.
 */
export function maybeCoerceToDate(value: unknown): unknown {
    if (value instanceof Date) return value;
    if (looksLikeIsoDate(value)) {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d;
    }
    return value;
}

/**
 * Strict variant of `maybeCoerceToDate` for callers that want a `Date | undefined`
 * back. Returns:
 *   - the same `Date` if input is a `Date`
 *   - a parsed `Date` if input is an ISO-shaped string AND parses to a valid moment
 *   - a parsed `Date` if input is a finite number (treated as epoch ms)
 *   - `undefined` otherwise
 *
 * Use at write boundaries inside the library AND in app code that bridges signal
 * payloads (where calendar/email adapters may legitimately ship Date OR ISO
 * string) into typed domain fields.
 */
export function toDate(value: unknown): Date | undefined {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? undefined : value;
    }
    if (looksLikeIsoDate(value)) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? undefined : d;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? undefined : d;
    }
    return undefined;
}

/**
 * Walk a metadata object recursively, coercing every ISO-date-looking string
 * to a `Date`. Returns the same reference when nothing changes (lets callers'
 * deep-equality + dirty checks short-circuit).
 *
 * Recurses into plain objects and array elements. Skips Date / RegExp /
 * Buffer / TypedArray (anything that's not a plain object literal).
 *
 * No depth cap: metadata in this library is JSON-shaped (round-trips through
 * BSON, which itself rejects cycles and caps at 100 levels). A silent depth
 * cap here would leave deeply-nested ISO strings uncoerced and reintroduce
 * the BSON cross-type range-query bug this helper exists to prevent.
 */
export function coerceMetadataDates<T extends Record<string, unknown> | undefined>(
    metadata: T,
): T {
    if (!metadata || typeof metadata !== 'object') return metadata;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metadata)) {
        const nv = coerceValueRecursive(v);
        if (nv !== v) changed = true;
        out[k] = nv;
    }
    return (changed ? out : metadata) as T;
}

function coerceValueRecursive(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (value instanceof Date) return value;
    if (typeof value === 'string') return maybeCoerceToDate(value);
    if (Array.isArray(value)) {
        let changed = false;
        const out = value.map((item) => {
            const nv = coerceValueRecursive(item);
            if (nv !== item) changed = true;
            return nv;
        });
        return changed ? out : value;
    }
    if (typeof value === 'object' && value.constructor === Object) {
        return coerceMetadataDates(value as Record<string, unknown>);
    }
    return value;
}

/**
 * Fact-level temporal fields. Typed as `Date | undefined` on `IFact`, so we
 * coerce without an ISO regex guard — any string here is type contract violation.
 */
const FACT_TEMPORAL_FIELDS = ['observedAt', 'validFrom', 'validUntil'] as const;

/**
 * Coerce the temporal fields on an `IFact` write input or patch. Operates on
 * a copy when changes are made, original ref when not. Also coerces nested
 * `metadata` AND `value` — common patterns put dates inside `value` (e.g.
 * `state_changed` facts shaped like `{from, to, at}`), and leaving those
 * uncoerced reintroduces the BSON range-query bug we exist to prevent.
 * `value` recursion uses the same conservative ISO-regex guard as metadata,
 * so business strings like `'never'` or `'soon'` stay strings.
 */
export function coerceFactTemporalFields<T extends Record<string, unknown>>(input: T): T {
    if (!input || typeof input !== 'object') return input;
    let changed = false;
    let out: Record<string, unknown> | null = null;
    for (const k of FACT_TEMPORAL_FIELDS) {
        const v = input[k];
        if (v === undefined || v === null) continue;
        if (v instanceof Date) continue;
        if (typeof v === 'string') {
            const d = new Date(v);
            if (!Number.isNaN(d.getTime())) {
                if (!out) out = { ...input };
                out[k] = d;
                changed = true;
            }
        }
    }
    if ('metadata' in input) {
        const md = input.metadata as Record<string, unknown> | undefined;
        const coerced = coerceMetadataDates(md);
        if (coerced !== md) {
            if (!out) out = { ...input };
            out.metadata = coerced;
            changed = true;
        }
    }
    if ('value' in input) {
        const v = input.value;
        const coerced = coerceValueRecursive(v);
        if (coerced !== v) {
            if (!out) out = { ...input };
            out.value = coerced;
            changed = true;
        }
    }
    return (changed && out ? out : input) as T;
}
