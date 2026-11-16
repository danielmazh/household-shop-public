import { TRIP_ID_RE, type TripId } from '../domain/schedule';

/**
 * Offline ticks (spec 003). Shared mode keeps tick changes that could not reach
 * the server in localStorage and sends them later, in order.
 * Stored as { [householdId]: QueuedTick[] }, oldest first.
 */
export const TICK_QUEUE_KEY = 'household-shop.tickQueue';

export interface QueuedTick {
  trip: TripId;
  itemId: string;
  ticked: boolean;
}

export type TickQueue = readonly QueuedTick[];
export type TickQueues = Record<string, TickQueue>;

const sameKey = (a: QueuedTick, b: QueuedTick) => a.trip === b.trip && a.itemId === b.itemId;
const sameEntry = (a: QueuedTick, b: QueuedTick) => sameKey(a, b) && a.ticked === b.ticked;

function isEntry(value: unknown): value is QueuedTick {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.trip === 'string' && TRIP_ID_RE.test(v.trip) && typeof v.itemId === 'string' && typeof v.ticked === 'boolean';
}

/** Reads stored queues, dropping anything malformed. */
export function parseQueues(value: unknown): TickQueues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, TickQueue> = {};
  for (const [household, list] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const entries = list.filter(isEntry).map(({ trip, itemId, ticked }) => ({ trip, itemId, ticked }));
    if (entries.length) out[household] = entries;
  }
  return out;
}

/** Adds a change. Only the last state per (trip, item) is kept, at the end of the queue. */
export function enqueue(queue: TickQueue, entry: QueuedTick): TickQueue {
  return [...queue.filter((e) => !sameKey(e, entry)), { ...entry }];
}

/** True when the queue holds a change for the same (trip, item). */
export function hasKey(queue: TickQueue, entry: QueuedTick): boolean {
  return queue.some((e) => sameKey(e, entry));
}

/** Removes `entry` once it is sent, unless a newer state for the same (trip, item) replaced it. */
export function removeSent(queue: TickQueue, entry: QueuedTick): TickQueue {
  const index = queue.findIndex((e) => sameEntry(e, entry));
  return index < 0 ? queue : [...queue.slice(0, index), ...queue.slice(index + 1)];
}

/** Number of queued changes for `trip`. */
export function pendingFor(queue: TickQueue, trip: TripId): number {
  return queue.filter((e) => e.trip === trip).length;
}

/** Server ticks of `trip` with the queued changes on top, so the UI does not jump back. */
export function applyQueue(server: ReadonlySet<string>, queue: TickQueue, trip: TripId): Set<string> {
  const out = new Set(server);
  for (const e of queue) {
    if (e.trip !== trip) continue;
    if (e.ticked) out.add(e.itemId);
    else out.delete(e.itemId);
  }
  return out;
}

/**
 * True when the error means the server was not reached: offline, fetch failed,
 * or a supabase-js error with no code (it uses an empty code for fetch errors).
 * A server answer (RLS, validation, auth) has a code and is a reject.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code: unknown }).code;
    return code === '' || code === undefined || code === null;
  }
  if (error instanceof Error) return error.message === 'offline' || /failed to fetch|networkerror|load failed/i.test(error.message);
  return false;
}

/**
 * True when the server refused the access token because it expired
 * (PostgREST PGRST301 or PGRST303). The change is fine: refresh the session and send it again.
 */
export function isAuthExpiredError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === 'PGRST301' || code === 'PGRST303' || (typeof message === 'string' && /jwt expired/i.test(message));
}

/** Keep the change and try again later: the server was not reached, or the token expired. */
export const isRetryError = (error: unknown) => isNetworkError(error) || isAuthExpiredError(error);

export interface FlushIo {
  read(): TickQueue;
  write(queue: TickQueue): void;
  send(entry: QueuedTick): Promise<void>;
}

export interface FlushResult {
  sent: number;
  rejected: { entry: QueuedTick; error: unknown }[];
  /** True when a network error or an expired token stopped the flush. The rest stays queued. */
  stopped: boolean;
  /** True when the stop was an expired token. */
  authExpired: boolean;
}

/**
 * Sends queued changes oldest first. Reads the queue before each send, so
 * changes made during the flush are sent too. A network error or an expired
 * token stops the flush and keeps the entry; a server reject drops the entry
 * and goes on.
 */
export async function flushQueue(io: FlushIo): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, rejected: [], stopped: false, authExpired: false };
  for (;;) {
    const head = io.read()[0];
    if (!head) return result;
    try {
      await io.send(head);
      result.sent++;
    } catch (error) {
      if (isRetryError(error)) {
        result.stopped = true;
        result.authExpired = isAuthExpiredError(error);
        return result;
      }
      result.rejected.push({ entry: head, error });
    }
    io.write(removeSent(io.read(), head));
  }
}
