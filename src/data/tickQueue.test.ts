import { describe, expect, it } from 'vitest';
import { applyQueue, enqueue, flushQueue, isAuthExpiredError, isNetworkError, parseQueues, pendingFor, removeSent, type QueuedTick, type TickQueue } from './tickQueue';

const tick = (itemId: string, ticked = true, trip: QueuedTick['trip'] = 'main'): QueuedTick => ({ trip, itemId, ticked });

/** In-memory queue io with a scripted send. */
function io(start: TickQueue, send: (e: QueuedTick, q: { queue: TickQueue }) => Promise<void>) {
  const state = { queue: start, sent: [] as QueuedTick[] };
  return {
    state,
    io: {
      read: () => state.queue,
      write: (q: TickQueue) => {
        state.queue = q;
      },
      send: async (e: QueuedTick) => {
        await send(e, state);
        state.sent.push(e);
      },
    },
  };
}

const rlsError = { code: '42501', message: 'new row violates row-level security policy' };
const fetchError = { code: '', message: 'TypeError: Failed to fetch' };

describe('tick queue', () => {
  it('keeps only the last state per trip and item, at the end', () => {
    let q: TickQueue = [];
    q = enqueue(q, tick('a'));
    q = enqueue(q, tick('b'));
    q = enqueue(q, tick('a', true, 'friday'));
    q = enqueue(q, tick('a', false));
    expect(q).toEqual([tick('b'), tick('a', true, 'friday'), tick('a', false)]);
    expect(pendingFor(q, 'main')).toBe(2);
    expect(pendingFor(q, 'shabbat')).toBe(0);
  });

  it('puts queued state on top of the server set for one trip', () => {
    const q = [tick('a', false), tick('b'), tick('c', true, 'shabbat')];
    expect(applyQueue(new Set(['a', 'x']), q, 'main')).toEqual(new Set(['x', 'b']));
    expect(applyQueue(new Set(['a']), q, 'shabbat')).toEqual(new Set(['a', 'c']));
  });

  it('removes a sent entry only if it is still the latest state', () => {
    const q = [tick('a', false)];
    expect(removeSent(q, tick('a', true))).toBe(q);
    expect(removeSent(q, tick('a', false))).toEqual([]);
  });

  it('parses stored queues and drops bad entries', () => {
    expect(parseQueues(null)).toEqual({});
    expect(parseQueues([tick('a')])).toEqual({});
    expect(parseQueues({ h1: [tick('a'), { trip: 'Not a trip', itemId: 'b', ticked: true }, { trip: 'main', itemId: 1 }, 'x'], h2: 'bad', h3: [] })).toEqual({
      h1: [tick('a')],
    });
  });

  it('tells network errors from server rejects', () => {
    expect(isNetworkError(new Error('offline'))).toBe(true);
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(fetchError)).toBe(true);
    expect(isNetworkError(rlsError)).toBe(false);
    expect(isNetworkError({ code: '23503', message: 'foreign key' })).toBe(false);
    expect(isNetworkError(new Error('No household loaded'))).toBe(false);
  });
});

describe('flushQueue', () => {
  it('sends in order and empties the queue', async () => {
    const { io: q, state } = io([tick('a'), tick('b', false), tick('c', true, 'friday')], async () => undefined);
    expect(await flushQueue(q)).toEqual({ sent: 3, rejected: [], stopped: false, authExpired: false });
    expect(state.sent.map((e) => e.itemId)).toEqual(['a', 'b', 'c']);
    expect(state.queue).toEqual([]);
  });

  it('stops on a network error and keeps the rest', async () => {
    const { io: q, state } = io([tick('a'), tick('b'), tick('c')], async (e) => {
      if (e.itemId === 'b') throw fetchError;
    });
    const result = await flushQueue(q);
    expect(result).toEqual({ sent: 1, rejected: [], stopped: true, authExpired: false });
    expect(state.queue).toEqual([tick('b'), tick('c')]);
  });

  it('keeps the queue when the token expired (PGRST301 or PGRST303)', async () => {
    for (const code of ['PGRST301', 'PGRST303']) {
      const expired = { code, message: 'JWT expired' };
      const { io: q, state } = io([tick('a'), tick('b')], async (e) => {
        if (e.itemId === 'a') throw expired;
      });
      expect(await flushQueue(q)).toEqual({ sent: 0, rejected: [], stopped: true, authExpired: true });
      expect(state.queue).toEqual([tick('a'), tick('b')]);
    }
    expect(isAuthExpiredError(rlsError)).toBe(false);
  });

  it('drops a rejected entry and goes on', async () => {
    const { io: q, state } = io([tick('a'), tick('b'), tick('c')], async (e) => {
      if (e.itemId === 'b') throw rlsError;
    });
    const result = await flushQueue(q);
    expect(result.sent).toBe(2);
    expect(result.rejected).toEqual([{ entry: tick('b'), error: rlsError }]);
    expect(state.queue).toEqual([]);
    expect(state.sent.map((e) => e.itemId)).toEqual(['a', 'c']);
  });

  it('sends a change made while the old state was in flight', async () => {
    const { io: q, state } = io([tick('a')], async (e, s) => {
      if (e.ticked) s.queue = enqueue(s.queue, tick('a', false));
    });
    await flushQueue(q);
    expect(state.sent).toEqual([tick('a'), tick('a', false)]);
    expect(state.queue).toEqual([]);
  });
});
