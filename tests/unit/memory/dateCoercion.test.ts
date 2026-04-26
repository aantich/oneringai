/**
 * dateCoercion — write-boundary helpers.
 *
 * Direct unit tests for the coercion utilities. Integration coverage (that the
 * MemorySystem write entry points actually invoke these) lives in the relevant
 * MemorySystem test files.
 */

import { describe, expect, it } from 'vitest';
import {
    coerceFactTemporalFields,
    coerceMetadataDates,
    looksLikeIsoDate,
    maybeCoerceToDate,
    toDate,
} from '@/memory/dateCoercion.js';

describe('looksLikeIsoDate', () => {
    it('matches date-only', () => {
        expect(looksLikeIsoDate('2026-04-30')).toBe(true);
    });
    it('matches ISO datetime with Z', () => {
        expect(looksLikeIsoDate('2026-04-30T13:00:00Z')).toBe(true);
    });
    it('matches ISO datetime without seconds', () => {
        expect(looksLikeIsoDate('2026-04-30T13:00Z')).toBe(true);
    });
    it('matches ISO with millis (3 digits)', () => {
        expect(looksLikeIsoDate('2026-04-30T13:00:00.123Z')).toBe(true);
    });
    it('matches ISO with extended fractional precision (Microsoft Graph style)', () => {
        expect(looksLikeIsoDate('2026-04-30T13:00:00.0000000Z')).toBe(true);
        expect(looksLikeIsoDate('2026-04-30T13:00:00.0000000')).toBe(true);
    });
    it('matches ISO with offset (colon)', () => {
        expect(looksLikeIsoDate('2026-04-30T13:00:00+02:00')).toBe(true);
    });
    it('matches ISO with offset (no colon)', () => {
        expect(looksLikeIsoDate('2026-04-30T13:00:00-0530')).toBe(true);
    });
    it('matches ISO with space separator', () => {
        expect(looksLikeIsoDate('2026-04-30 13:00:00')).toBe(true);
    });
    it('rejects free-form labels', () => {
        expect(looksLikeIsoDate('never')).toBe(false);
        expect(looksLikeIsoDate('soon')).toBe(false);
        expect(looksLikeIsoDate('2026')).toBe(false);
    });
    it('rejects partial / mangled dates', () => {
        expect(looksLikeIsoDate('2026-4-30')).toBe(false);
        expect(looksLikeIsoDate('04/30/2026')).toBe(false);
        expect(looksLikeIsoDate('')).toBe(false);
    });
    it('rejects non-string', () => {
        expect(looksLikeIsoDate(undefined)).toBe(false);
        expect(looksLikeIsoDate(null)).toBe(false);
        expect(looksLikeIsoDate(0)).toBe(false);
        expect(looksLikeIsoDate(new Date())).toBe(false);
    });
});

describe('maybeCoerceToDate', () => {
    it('passes Date through unchanged (identity)', () => {
        const d = new Date('2026-04-30T13:00:00Z');
        expect(maybeCoerceToDate(d)).toBe(d);
    });
    it('coerces ISO string to Date', () => {
        const out = maybeCoerceToDate('2026-04-30T13:00:00Z');
        expect(out).toBeInstanceOf(Date);
        expect((out as Date).toISOString()).toBe('2026-04-30T13:00:00.000Z');
    });
    it('leaves non-ISO strings alone', () => {
        expect(maybeCoerceToDate('never')).toBe('never');
        expect(maybeCoerceToDate('hello world')).toBe('hello world');
    });
    it('leaves numbers alone (do not interpret as epoch ms)', () => {
        expect(maybeCoerceToDate(0)).toBe(0);
        expect(maybeCoerceToDate(1700000000000)).toBe(1700000000000);
    });
    it('leaves null / undefined alone', () => {
        expect(maybeCoerceToDate(null)).toBe(null);
        expect(maybeCoerceToDate(undefined)).toBe(undefined);
    });
});

describe('toDate (strict)', () => {
    it('returns the same Date instance when given a Date', () => {
        const d = new Date('2026-04-30T13:00:00Z');
        expect(toDate(d)).toBe(d);
    });
    it('parses ISO strings to Date', () => {
        const out = toDate('2026-04-30T13:00:00Z');
        expect(out).toBeInstanceOf(Date);
        expect((out as Date).toISOString()).toBe('2026-04-30T13:00:00.000Z');
    });
    it('parses date-only strings to Date', () => {
        const out = toDate('2026-04-30');
        expect(out).toBeInstanceOf(Date);
    });
    it('parses finite numbers as epoch ms', () => {
        const out = toDate(1700000000000);
        expect(out).toBeInstanceOf(Date);
        expect((out as Date).getTime()).toBe(1700000000000);
    });
    it('returns undefined for non-ISO strings', () => {
        expect(toDate('never')).toBe(undefined);
        expect(toDate('hello')).toBe(undefined);
    });
    it('returns undefined for invalid Date instances', () => {
        expect(toDate(new Date('not-a-date'))).toBe(undefined);
    });
    it('returns undefined for null / undefined / objects', () => {
        expect(toDate(null)).toBe(undefined);
        expect(toDate(undefined)).toBe(undefined);
        expect(toDate({})).toBe(undefined);
        expect(toDate([])).toBe(undefined);
    });
    it('returns undefined for non-finite numbers', () => {
        expect(toDate(Number.NaN)).toBe(undefined);
        expect(toDate(Number.POSITIVE_INFINITY)).toBe(undefined);
    });
});

describe('coerceMetadataDates', () => {
    it('returns undefined unchanged', () => {
        expect(coerceMetadataDates(undefined)).toBe(undefined);
    });
    it('returns same reference when nothing changes', () => {
        const md = { state: 'active', count: 3, when: new Date('2026-04-30Z') };
        expect(coerceMetadataDates(md)).toBe(md);
    });
    it('coerces top-level ISO string fields to Date', () => {
        const md = { startTime: '2026-04-30T13:00:00Z', state: 'active' };
        const out = coerceMetadataDates(md)!;
        expect(out.startTime).toBeInstanceOf(Date);
        expect((out.startTime as Date).toISOString()).toBe('2026-04-30T13:00:00.000Z');
        expect(out.state).toBe('active');
    });
    it('leaves business-data strings unchanged when they are not ISO dates', () => {
        const md = { expiresAt: 'never', state: 'active', notes: '2026 is the year' };
        expect(coerceMetadataDates(md)).toBe(md);
    });
    it('coerces inside nested plain objects', () => {
        const md = {
            jarvis: {
                priority: {
                    deadline: '2026-04-30',
                    weight: 0.8,
                },
            },
        };
        const out = coerceMetadataDates(md)!;
        const deadline = ((out.jarvis as Record<string, unknown>).priority as Record<string, unknown>)
            .deadline;
        expect(deadline).toBeInstanceOf(Date);
        expect((deadline as Date).toISOString()).toBe('2026-04-30T00:00:00.000Z');
    });
    it('coerces inside arrays of objects', () => {
        const md = {
            stateHistory: [
                { state: 'pending', at: '2026-04-29T10:00:00Z' },
                { state: 'active', at: '2026-04-30T11:00:00Z' },
            ],
        };
        const out = coerceMetadataDates(md)!;
        const hist = out.stateHistory as Array<Record<string, unknown>>;
        expect(hist[0]!.at).toBeInstanceOf(Date);
        expect(hist[1]!.at).toBeInstanceOf(Date);
    });
    it('preserves Date instances unchanged', () => {
        const d = new Date('2026-04-30T13:00:00Z');
        const md = { startTime: d };
        const out = coerceMetadataDates(md)!;
        expect(out.startTime).toBe(d);
    });
    it('coerces deeply nested ISO strings without a depth cap', () => {
        // No cap: dates at any depth must be coerced, otherwise BSON range
        // queries on deeply-nested paths silently break.
        let cur: Record<string, unknown> = { leaf: '2026-04-30' };
        for (let i = 0; i < 50; i++) cur = { nested: cur };
        const out = coerceMetadataDates(cur);
        // Walk back down to the leaf and assert it's a Date.
        let probe: unknown = out;
        for (let i = 0; i < 50; i++) probe = (probe as Record<string, unknown>).nested;
        expect((probe as Record<string, unknown>).leaf).toBeInstanceOf(Date);
    });
});

describe('coerceFactTemporalFields', () => {
    it('coerces observedAt / validFrom / validUntil from ISO strings', () => {
        const out = coerceFactTemporalFields({
            observedAt: '2026-04-30T13:00:00Z',
            validFrom: '2026-01-01',
            validUntil: '2026-12-31',
        });
        expect(out.observedAt).toBeInstanceOf(Date);
        expect(out.validFrom).toBeInstanceOf(Date);
        expect(out.validUntil).toBeInstanceOf(Date);
    });
    it('passes Dates through unchanged', () => {
        const d = new Date('2026-04-30T13:00:00Z');
        const out = coerceFactTemporalFields({ observedAt: d });
        expect(out.observedAt).toBe(d);
    });
    it('coerces dates nested in metadata', () => {
        const out = coerceFactTemporalFields({
            metadata: { startTime: '2026-04-30T13:00:00Z', tag: 'foo' },
        });
        const md = out.metadata as Record<string, unknown>;
        expect(md.startTime).toBeInstanceOf(Date);
        expect(md.tag).toBe('foo');
    });
    it('returns same reference when nothing changes', () => {
        const input = {
            subjectId: 'e1',
            predicate: 'attended',
            observedAt: new Date('2026-04-30Z'),
        };
        expect(coerceFactTemporalFields(input)).toBe(input);
    });
    it('coerces ISO strings inside `value` (e.g. state_changed shape)', () => {
        const out = coerceFactTemporalFields({
            subjectId: 'task_1',
            predicate: 'state_changed',
            value: { from: 'pending', to: 'in_progress', at: '2026-04-30T13:00:00Z' },
            observedAt: '2026-04-30T13:00:00Z',
        });
        const value = out.value as Record<string, unknown>;
        expect(value.from).toBe('pending');
        expect(value.to).toBe('in_progress');
        expect(value.at).toBeInstanceOf(Date);
        expect((value.at as Date).toISOString()).toBe('2026-04-30T13:00:00.000Z');
        expect(out.observedAt).toBeInstanceOf(Date);
    });
    it('leaves non-date strings inside `value` alone (regex-guarded)', () => {
        const out = coerceFactTemporalFields({
            subjectId: 'e1',
            predicate: 'has_status',
            value: { status: 'active', label: 'never' },
        });
        const value = out.value as Record<string, unknown>;
        expect(value.status).toBe('active');
        expect(value.label).toBe('never');
    });
    it('leaves primitive scalar `value` (string / number / boolean) alone', () => {
        // ISO-string value at the top level — coerced to Date (was a footgun before).
        const out1 = coerceFactTemporalFields({
            subjectId: 'e1',
            predicate: 'occurred_on',
            value: '2026-04-30T13:00:00Z',
        });
        expect(out1.value).toBeInstanceOf(Date);
        // Plain string value — left alone.
        const out2 = coerceFactTemporalFields({
            subjectId: 'e1',
            predicate: 'prefers',
            value: 'tea',
        });
        expect(out2.value).toBe('tea');
        // Number value — left alone.
        const out3 = coerceFactTemporalFields({
            subjectId: 'e1',
            predicate: 'interaction_count',
            value: 7,
        });
        expect(out3.value).toBe(7);
    });
});
