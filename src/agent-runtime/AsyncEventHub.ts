import { AgentEventHistoryExpiredError, AgentEventSubscriberOverflowError } from './errors.js';
import { cloneAndFreezeJson, deepFreeze } from './internal.js';
import type { AgentEventSubscriptionOptions, AgentRunEvent, AgentRunEventType, JsonObject } from './types.js';

interface Subscriber {
  queue: AgentRunEvent[];
  queueBytes: number;
  readonly maxQueueBytes: number;
  wake?: () => void;
  error?: Error;
}

export class AsyncEventHub {
  private journal: AgentRunEvent[] = [];
  private journalBytes = 0;
  private sequence = 0;
  private subscribers = new Set<Subscriber>();
  private completed = false;
  private expired = false;
  private truncationDiagnostic?: AgentRunEvent;
  private droppedDeltas = 0;
  private droppedEvents = 0;

  constructor(
    private readonly runId: string,
    private readonly sessionId: string,
    private readonly maxJournalBytes: number,
    private readonly maxSubscriberBytes: number = maxJournalBytes,
    initialSequence = 0,
    private readonly maxSequence = Number.MAX_SAFE_INTEGER,
  ) {
    this.sequence = initialSequence;
    if (!Number.isSafeInteger(maxJournalBytes) || maxJournalBytes < 1024) {
      throw new RangeError('maxJournalBytes must be a safe integer of at least 1024');
    }
    if (!Number.isSafeInteger(maxSubscriberBytes) || maxSubscriberBytes <= 0) {
      throw new RangeError('maxSubscriberBytes must be a positive safe integer');
    }
  }

  get retainedBytes(): number {
    return this.journalBytes;
  }

  publish(type: AgentRunEventType, data: JsonObject, timestamp: string = new Date().toISOString()): AgentRunEvent {
    if (this.completed) throw new Error('Cannot publish to a completed event hub');
    if (this.sequence >= this.maxSequence) throw new AgentEventHistoryExpiredError(this.runId);
    const boundedData = boundEventData(type, data, this.maxJournalBytes);
    const event = deepFreeze({
      runId: this.runId,
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      timestamp,
      type,
      data: cloneAndFreezeJson(boundedData, 'Agent event data') as JsonObject,
    }) as AgentRunEvent;
    this.append(event);
    this.pushToSubscribers(event);
    this.compactJournal();
    return event;
  }

  complete(): void {
    if (this.completed) return;
    this.completed = true;
    for (const subscriber of this.subscribers) subscriber.wake?.();
  }

  expire(): void {
    this.expired = true;
    this.journal = [];
    this.journalBytes = 0;
  }

  subscribe(options: AgentEventSubscriptionOptions = {}): AsyncIterable<AgentRunEvent> {
    if (this.expired) throw new AgentEventHistoryExpiredError(this.runId);
    const self = this;
    return {
      async *[Symbol.asyncIterator]() {
        if (self.expired) throw new AgentEventHistoryExpiredError(self.runId);
        const afterSequence = options.afterSequence;
        if (afterSequence !== undefined && (!Number.isSafeInteger(afterSequence) || afterSequence < 0)) {
          throw new RangeError('afterSequence must be a non-negative safe integer');
        }
        if (afterSequence !== undefined && afterSequence > self.sequence) {
          throw new RangeError(`afterSequence ${afterSequence} is ahead of run sequence ${self.sequence}`);
        }
        const firstRetained = self.journal[0]?.sequence;
        if (afterSequence !== undefined && firstRetained !== undefined && afterSequence < firstRetained - 1) {
          throw new AgentEventHistoryExpiredError(self.runId);
        }
        const snapshotSequence = self.sequence;
        const snapshot = self.journal.filter((event) => event.sequence > (afterSequence ?? 0));
        const subscriber: Subscriber = {
          queue: [],
          queueBytes: 0,
          maxQueueBytes: self.maxSubscriberBytes,
        };
        self.subscribers.add(subscriber);
        try {
          for (const event of snapshot) yield event;
          while (true) {
            const next = subscriber.queue.shift();
            if (next) {
              subscriber.queueBytes -= eventSize(next);
              if (next.sequence > snapshotSequence) yield next;
              continue;
            }
            if (subscriber.error) throw subscriber.error;
            if (self.completed) return;
            await new Promise<void>((resolve) => {
              subscriber.wake = resolve;
              // Recheck after installing the wake callback so a publication
              // between the empty-queue check and this point cannot be lost.
              if (subscriber.queue.length > 0 || subscriber.error || self.completed) {
                subscriber.wake = undefined;
                resolve();
              }
            });
            subscriber.wake = undefined;
          }
        } finally {
          self.subscribers.delete(subscriber);
        }
      },
    };
  }

  private append(event: AgentRunEvent): void {
    this.journal.push(event);
    this.journalBytes += eventSize(event);
  }

  private pushToSubscribers(event: AgentRunEvent): void {
    const size = eventSize(event);
    for (const subscriber of this.subscribers) {
      if (subscriber.error) continue;
      if (subscriber.queueBytes + size > subscriber.maxQueueBytes) {
        subscriber.error = new AgentEventSubscriberOverflowError(this.runId);
        subscriber.wake?.();
        continue;
      }
      subscriber.queue.push(event);
      subscriber.queueBytes += size;
      subscriber.wake?.();
    }
  }

  private compactJournal(): void {
    let dropped = this.trimToBudget();
    if (dropped === 0) return;

    do {
      this.replaceTruncationDiagnostic();
      dropped = this.trimToBudget();
    } while (dropped > 0);
  }

  private trimToBudget(): number {
    let dropped = 0;
    while (this.journalBytes > this.maxJournalBytes) {
      const incremental = this.journal.findIndex((event) => (
        event !== this.truncationDiagnostic
        && (event.type.endsWith('.delta') || event.type === 'tool.progress')
      ));
      const index = incremental >= 0
        ? incremental
        : this.journal.findIndex((event) => event !== this.truncationDiagnostic);
      if (index < 0) break;
      const [removed] = this.journal.splice(index, 1);
      if (!removed) break;
      this.journalBytes -= eventSize(removed);
      this.droppedEvents++;
      if (removed.type.endsWith('.delta')) this.droppedDeltas++;
      dropped++;
    }
    return dropped;
  }

  private replaceTruncationDiagnostic(): void {
    if (this.truncationDiagnostic) {
      const index = this.journal.indexOf(this.truncationDiagnostic);
      if (index >= 0) {
        const [removed] = this.journal.splice(index, 1);
        if (removed) this.journalBytes -= eventSize(removed);
      }
    }
    const diagnostic = deepFreeze({
      runId: this.runId,
      sessionId: this.sessionId,
      sequence: ++this.sequence,
      timestamp: new Date().toISOString(),
      type: 'diagnostic' as const,
      data: {
        code: 'EVENTS_DROPPED',
        droppedEvents: this.droppedEvents,
        droppedDeltas: this.droppedDeltas,
      },
    }) as AgentRunEvent;
    this.truncationDiagnostic = diagnostic;
    this.append(diagnostic);
    this.pushToSubscribers(diagnostic);
  }
}

function eventSize(event: AgentRunEvent): number {
  return Buffer.byteLength(JSON.stringify(event), 'utf8');
}

function boundEventData(_type: AgentRunEventType, data: JsonObject, maxJournalBytes: number): JsonObject {
  const maxPayloadBytes = Math.min(64 * 1024, Math.max(256, Math.floor(maxJournalBytes / 4)));
  const serialized = JSON.stringify(data);
  if (Buffer.byteLength(serialized, 'utf8') <= maxPayloadBytes) return data;

  const text = data.text;
  if (typeof text === 'string') {
    return {
      text: truncateUtf8(text, Math.max(0, maxPayloadBytes - 64)),
      truncated: true,
    };
  }

  const result: JsonObject = { truncated: true };
  for (const key of ['id', 'name', 'status', 'path', 'change', 'level', 'code']) {
    const value = data[key];
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      result[key] = value;
    }
  }
  result.payloadPreview = truncateUtf8(serialized, Math.max(0, maxPayloadBytes - 256));
  return result;
}

function truncateUtf8(text: string, maxBytes: number): string {
  if (maxBytes <= 0) return '';
  let truncated = Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8');
  if (truncated.endsWith('\uFFFD')) truncated = truncated.slice(0, -1);
  return truncated;
}
