import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsConflictError } from './store';
import { SupabaseStore, toPurchase, toRowPatch } from './supabaseStore';
import { MemoryStorage } from './testStorage';
import { TICK_QUEUE_KEY } from './tickQueue';
import { normalizeSettings, toStoredSettings } from '../domain/schedule';

describe('toRowPatch', () => {
  it('maps only the given fields to columns and trims the name', () => {
    expect(toRowPatch({ name: ' חלב ', weeklyUse: 3, ranOut: false, price: null, storeId: 's1' })).toEqual({
      name: 'חלב',
      store_id: 's1',
      weekly_use: 3,
      ran_out: false,
      price: null,
    });
    expect(toRowPatch({})).toEqual({});
    expect(toRowPatch({ onceTrip: 'main' })).toEqual({ once_trip: 'main' });
  });
});

describe('toPurchase (spec 012)', () => {
  it('maps a purchases row with its lines', () => {
    const p = toPurchase({
      id: 'p1',
      trip: 'main',
      trip_name: 'Big shop',
      finished_by_name: 'dana',
      finished_at: '2026-11-05T10:00:00+00:00',
      purchase_lines: [
        { item_id: 'b', item_name: 'Rice', packs: '2', units: '4', unit: 'kg', store_name: 'Market', price_each: '9.5' },
        { item_id: null, item_name: 'Eggs', packs: 1, units: 12, unit: null, store_name: null, price_each: null },
      ],
    });
    expect(p).toEqual({
      id: 'p1',
      trip: 'main',
      tripName: 'Big shop',
      finishedBy: 'dana',
      finishedAt: '2026-11-05T10:00:00+00:00',
      lines: [
        { itemId: null, name: 'Eggs', packs: 1, units: 12, unit: '', storeName: null, price: null },
        { itemId: 'b', name: 'Rice', packs: 2, units: 4, unit: 'kg', storeName: 'Market', price: 9.5 },
      ],
    });
  });

  it('reads a row with no lines', () => {
    expect(toPurchase({ id: 'p', trip: 'main', trip_name: null, finished_by_name: null, finished_at: 'x', purchase_lines: null }).lines).toEqual([]);
  });
});

// Fake supabase-js client: records tick writes and answers from `server`.
const server = vi.hoisted(() => ({
  ticks: new Set<string>(),
  calls: [] as string[],
  /** Error to return for the next tick writes, by item id. */
  fail: new Map<string, { code: string; message: string }>(),
  /** Error to return for tick reads. */
  selectError: null as { code: string; message: string } | null,
  /** Data every rpc call returns. */
  rpcData: null as unknown,
  /** Functions the fake database does not have (before migration 0006). */
  rpcMissing: new Set<string>(),
  /** The households row a read returns. */
  household: null as unknown,
  /** While set, tick writes wait for it, like a slow network. */
  gate: null as Promise<void> | null,
  /** Tick writes in the order they left this device, before the server answers. */
  sent: [] as string[],
  refreshes: 0,
  session: { user: { id: 'u1', email: 'a@example.invalid' } } as unknown,
  sessionError: null as unknown,
  /** Answers for the next members reads, oldest first; then the last one again. */
  members: [] as { data: unknown; error: unknown }[],
}));

vi.mock('@supabase/supabase-js', () => {
  const tickQuery = () => {
    const filters: Record<string, string> = {};
    let op: { kind: 'select' | 'upsert' | 'delete'; row?: { item_id: string } } = { kind: 'select' };
    const run = () => {
      if (op.kind === 'select') {
        if (server.selectError) return { data: null, error: server.selectError };
        return { data: [...server.ticks].map((item_id) => ({ item_id })), error: null };
      }
      const id = op.row?.item_id ?? filters.item_id ?? `trip=${filters.trip}`;
      server.calls.push(`${op.kind}:${id}`);
      const error = server.fail.get(id);
      if (error) return { data: null, error };
      if (op.kind === 'upsert') server.ticks.add(id);
      else server.ticks.delete(id);
      return { data: null, error: null };
    };
    const query = {
      select: () => query,
      upsert: (row: { item_id: string }) => ((op = { kind: 'upsert', row }), query),
      delete: () => ((op = { kind: 'delete' }), query),
      eq: (column: string, value: string) => ((filters[column] = value), query),
      then: (resolve: (r: unknown) => void) => {
        if (op.kind !== 'select') server.sent.push(`${op.kind}:${op.row?.item_id ?? filters.item_id ?? `trip=${filters.trip}`}`);
        if (server.gate) void server.gate.then(() => resolve(run()));
        else resolve(run());
      },
    };
    return query;
  };
  const rpc = (fn: string, args: unknown) => {
    server.calls.push(`rpc:${fn}:${JSON.stringify(args)}`);
    if (server.rpcMissing.has(fn)) return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'not found' } });
    return Promise.resolve({ data: server.rpcData, error: null });
  };
  const membersQuery = () => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => Promise.resolve(server.members.length > 1 ? server.members.shift() : server.members[0]),
    };
    return query;
  };
  const householdQuery = () => {
    const query = {
      select: () => query,
      eq: () => query,
      single: () => Promise.resolve({ data: server.household, error: null }),
    };
    return query;
  };
  return {
    createClient: () => ({
      from: (table: string) => (table === 'households' ? householdQuery() : table === 'members' ? membersQuery() : tickQuery()),
      rpc,
      auth: {
        initialize: () => Promise.resolve({ error: server.sessionError }),
        getSession: () => Promise.resolve({ data: { session: server.session }, error: server.sessionError }),
        refreshSession: () => {
          server.refreshes++;
          server.fail.clear();
          return Promise.resolve({ error: null });
        },
      },
    }),
  };
});

describe('SupabaseStore tick queue', () => {
  const household = { id: 'h1', name: 'בית', joinCode: 'ABC', settings: {} };
  let online = true;

  const makeStore = (storage = new MemoryStorage()) => {
    const store = new SupabaseStore('https://example.invalid', 'anon', storage);
    (store as unknown as { current: unknown }).current = household;
    return { store, storage };
  };

  beforeEach(() => {
    online = true;
    vi.stubGlobal('navigator', {
      get onLine() {
        return online;
      },
    });
    server.ticks.clear();
    server.calls.length = 0;
    server.fail.clear();
    server.selectError = null;
    server.gate = null;
    server.sent.length = 0;
    server.refreshes = 0;
    server.rpcData = [];
    server.rpcMissing.clear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('queues offline ticks, shows them, and sends the last state in order', async () => {
    const { store, storage } = makeStore();
    server.ticks.add('x');
    online = false;
    await store.setTick('main', 'a', true);
    await store.setTick('main', 'b', true);
    await store.setTick('main', 'a', false);
    await store.setTick('main', 'a', true);
    expect(server.calls).toEqual([]);
    expect(store.pendingTicks('main')).toBe(2);
    expect(JSON.parse(storage.getItem(TICK_QUEUE_KEY)!)).toEqual({
      h1: [
        { trip: 'main', itemId: 'b', ticked: true },
        { trip: 'main', itemId: 'a', ticked: true },
      ],
    });

    online = true;
    await store.flushTicks();
    expect(server.calls).toEqual(['upsert:b', 'upsert:a']);
    expect(store.pendingTicks('main')).toBe(0);
    expect(storage.getItem(TICK_QUEUE_KEY)).toBeNull();
    expect(await store.loadTicks('main')).toEqual(new Set(['x', 'a', 'b']));
  });

  it('merges queued state over server ticks on load', async () => {
    const { store } = makeStore();
    server.ticks.add('a');
    online = false;
    await store.setTick('main', 'a', false);
    await store.setTick('main', 'b', true);
    // loadTicks reaches the fake server even with onLine false; the queue stays on top.
    expect(await store.loadTicks('main')).toEqual(new Set(['b']));
    expect(await store.loadTicks('shabbat')).toEqual(new Set(['a']));
  });

  it('loads the last known ticks plus the queue when offline, and throws a server reject', async () => {
    const { store } = makeStore();
    server.ticks.add('a');
    await store.loadTicks('main');
    server.selectError = { code: '', message: 'TypeError: Failed to fetch' };
    online = false;
    await store.setTick('main', 'b', true);
    expect(await store.loadTicks('main')).toEqual(new Set(['a', 'b']));
    await expect(store.loadTicks('shabbat')).rejects.toBeTruthy();
    server.selectError = { code: '42501', message: 'denied' };
    await expect(store.loadTicks('main')).rejects.toBeTruthy();
  });

  it('queues a tick that fails with a network error and keeps it on a second failure', async () => {
    const { store } = makeStore();
    server.fail.set('a', { code: '', message: 'TypeError: Failed to fetch' });
    await store.setTick('main', 'a', true);
    await store.flushTicks();
    expect(store.pendingTicks('main')).toBe(1);

    server.fail.clear();
    await store.flushTicks();
    expect(store.pendingTicks('main')).toBe(0);
    expect(server.ticks.has('a')).toBe(true);
  });

  it('throws a server reject when sending at once', async () => {
    const { store } = makeStore();
    const rls = { code: '42501', message: 'row-level security' };
    server.fail.set('a', rls);
    await expect(store.setTick('main', 'a', true)).rejects.toBe(rls);
    expect(store.pendingTicks('main')).toBe(0);
  });

  it('drops a queued change the server rejects and reports it', async () => {
    const { store } = makeStore();
    const rejects: unknown[] = [];
    let changes = 0;
    store.subscribeTickQueue({ onChange: () => changes++, onReject: (e) => rejects.push(e) });
    online = false;
    await store.setTick('main', 'a', true);
    await store.setTick('main', 'b', true);
    const rls = { code: '42501', message: 'row-level security' };
    server.fail.set('a', rls);
    online = true;
    await store.flushTicks();
    expect(rejects).toEqual([rls]);
    expect(server.ticks).toEqual(new Set(['b']));
    expect(store.pendingTicks('main')).toBe(0);
    expect(changes).toBe(4);
  });

  it('flushes after another successful call and blocks finish while ticks wait', async () => {
    const { store } = makeStore();
    online = false;
    await store.setTick('friday', 'a', true);
    await expect(store.finishTrip('friday', [{ itemId: 'a', delta: 1 }])).rejects.toThrow('ticks pending');
    online = true;
    await store.loadTicks('main');
    await vi.waitFor(() => expect(store.pendingTicks('friday')).toBe(0));
    expect(server.calls).toEqual(['upsert:a']);
  });

  it('sends one tick request at a time, so a quick untick never ends ticked', async () => {
    const { store } = makeStore();
    let open!: () => void;
    server.gate = new Promise((r) => (open = r));
    const first = store.setTick('main', 'a', true);
    const second = store.setTick('main', 'a', false);
    await new Promise((r) => setTimeout(r, 0));
    // The untick waits in the queue while the tick is in flight.
    expect(server.sent).toEqual(['upsert:a']);
    expect(store.unsentTicks('main')).toBe(2);
    server.gate = null;
    open();
    await Promise.all([first, second]);
    await store.flushTicks();
    expect(server.calls).toEqual(['upsert:a', 'delete:a']);
    expect(server.ticks.has('a')).toBe(false);
    expect(store.unsentTicks('main')).toBe(0);
  });

  it('finish waits for the tick in flight', async () => {
    const { store } = makeStore();
    let open!: () => void;
    server.gate = new Promise((r) => (open = r));
    const tick = store.setTick('main', 'a', true);
    expect(store.unsentTicks('main')).toBe(1);
    expect(store.pendingTicks('main')).toBe(0);
    const finish = store.finishTrip('main', [{ itemId: 'a', delta: 1 }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(server.calls).toEqual([]);
    server.gate = null;
    open();
    await Promise.all([tick, finish]);
    expect(server.calls).toEqual(['upsert:a', 'rpc:finish_household_trip:{"hid":"h1","trip_id":"main","lines":[{"item_id":"a","delta":1}]}']);
  });

  it('finish sends packs and calls the server even with no lines, to clear overrides (spec 012)', async () => {
    const { store } = makeStore();
    await store.finishTrip('main', [{ itemId: 'a', delta: 12, packs: 2 }]);
    expect(await store.finishTrip('main', [])).toEqual([]);
    expect(server.calls).toEqual([
      'rpc:finish_household_trip:{"hid":"h1","trip_id":"main","lines":[{"item_id":"a","delta":12,"packs":2}]}',
      'rpc:finish_household_trip:{"hid":"h1","trip_id":"main","lines":[]}',
    ]);
  });

  it('finishes the old way on a database before migration 0006', async () => {
    const { store } = makeStore();
    server.rpcMissing.add('finish_household_trip');
    await store.finishTrip('main', [{ itemId: 'a', delta: 1, packs: 1 }]);
    expect(await store.finishTrip('main', [])).toEqual([]);
    expect(server.calls).toEqual([
      'rpc:finish_household_trip:{"hid":"h1","trip_id":"main","lines":[{"item_id":"a","delta":1,"packs":1}]}',
      'rpc:finish_trip:{"trip":"main","lines":[{"item_id":"a","delta":1}]}',
      'rpc:finish_household_trip:{"hid":"h1","trip_id":"main","lines":[]}',
      'delete:trip=main',
    ]);
  });

  it('sets and removes an override through the rpc', async () => {
    const { store } = makeStore();
    await store.setOverride('main', 'a', 3);
    await store.setOverride('main', 'a', null);
    expect(server.calls).toEqual(['rpc:set_trip_override:{"hid":"h1","trip_id":"main","item":"a","amount":3}', 'rpc:set_trip_override:{"hid":"h1","trip_id":"main","item":"a","amount":null}']);
  });

  it('keeps a tick on an expired token, refreshes the session and sends it', async () => {
    const { store } = makeStore();
    const rejects: unknown[] = [];
    store.subscribeTickQueue({ onReject: (e) => rejects.push(e) });
    server.fail.set('a', { code: 'PGRST301', message: 'JWT expired' });
    await store.setTick('main', 'a', true);
    await vi.waitFor(() => expect(store.pendingTicks('main')).toBe(0));
    expect(server.refreshes).toBe(1);
    expect(server.ticks.has('a')).toBe(true);
    expect(rejects).toEqual([]);
  });

  it('keeps queues per household', async () => {
    const { store, storage } = makeStore();
    storage.setItem(TICK_QUEUE_KEY, JSON.stringify({ other: [{ trip: 'main', itemId: 'z', ticked: true }] }));
    online = false;
    await store.setTick('main', 'a', true);
    expect(store.pendingTicks('main')).toBe(1);
    online = true;
    await store.flushTicks();
    expect(server.calls).toEqual(['upsert:a']);
    expect(JSON.parse(storage.getItem(TICK_QUEUE_KEY)!)).toEqual({ other: [{ trip: 'main', itemId: 'z', ticked: true }] });
  });
});

describe('SupabaseStore stores', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    server.calls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  it('restores a store with the restore_store RPC, never by writing active', async () => {
    const store = new SupabaseStore('https://example.invalid', 'anon', new MemoryStorage());
    (store as unknown as { current: unknown }).current = { id: 'h1', name: 'בית', joinCode: 'ABC', settings: {} };
    server.rpcData = { id: 's1', household_id: 'h1', name: 'ירקן', emoji: '', sort: 0, active: true };
    const shop = await store.updateShop('s1', { active: true });
    expect(server.calls).toEqual(['rpc:restore_store:{"store_id":"s1"}']);
    expect(shop).toEqual({ id: 's1', name: 'ירקן', emoji: '', sort: 0, active: true });
  });
});

describe('SupabaseStore settings', () => {
  const settings = normalizeSettings(null);
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    server.calls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  const makeStore = (version: number) => {
    const store = new SupabaseStore('https://example.invalid', 'anon', new MemoryStorage());
    const h = { id: 'h1', name: 'בית', joinCode: 'ABC', settings, settingsVersion: version };
    Object.assign(store as unknown as object, { current: h, list: [h] });
    return store;
  };

  it('saves with the known version and keeps the new one', async () => {
    const store = makeStore(3);
    server.rpcData = 4;
    const next = { ...settings, margin: 0.2 };
    await store.saveSettings(next);
    expect(server.calls).toEqual([`rpc:save_settings:${JSON.stringify({ hid: 'h1', settings: toStoredSettings(next), expected_version: 3 })}`]);
    expect(store.household?.settingsVersion).toBe(4);
    expect(await store.loadSettings()).toEqual(next);
  });

  it('refuses a stale save, then loads the newer settings', async () => {
    const store = makeStore(3);
    server.rpcData = null;
    const newer = { ...settings, margin: 0.3 };
    server.household = { id: 'h1', name: 'בית', join_code: 'ABC', settings: newer, settings_version: 5 };
    await expect(store.saveSettings({ ...settings, margin: 0.2 })).rejects.toBeInstanceOf(SettingsConflictError);
    expect(await store.loadSettings()).toEqual(newer);
    expect(store.household?.settingsVersion).toBe(5);
  });
});

describe('SupabaseStore create household', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', { onLine: true });
    server.calls.length = 0;
  });
  afterEach(() => vi.unstubAllGlobals());

  const row = { households: { id: 'new', name: 'בית', join_code: 'ABCDEFGH', settings: null, settings_version: 0 } };
  const fetchFailed = { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } };

  it('uses the id from the RPC and retries the load, never the create', async () => {
    const store = new SupabaseStore('https://example.invalid', 'anon', new MemoryStorage());
    server.rpcData = 'new';
    server.members = [fetchFailed, { data: [row], error: null }];
    const h = await store.createHousehold('בית');
    expect(h.id).toBe('new');
    expect(server.calls.filter((c) => c.startsWith('rpc:create_household'))).toHaveLength(1);
    expect(store.createPending).toBe(false);
  });

  it('after a failed load, a second create only loads the household', async () => {
    const store = new SupabaseStore('https://example.invalid', 'anon', new MemoryStorage());
    server.rpcData = 'new';
    server.members = [fetchFailed];
    await expect(store.createHousehold('בית')).rejects.toBeTruthy();
    expect(store.createPending).toBe(true);
    server.members = [{ data: [row], error: null }];
    expect((await store.createHousehold('בית')).id).toBe('new');
    expect(server.calls.filter((c) => c.startsWith('rpc:create_household'))).toHaveLength(1);
  });
});

describe('SupabaseStore offline start', () => {
  const replaceState = vi.fn();
  const start = (href: string, onLine: boolean) => {
    vi.stubGlobal('navigator', { onLine });
    vi.stubGlobal('window', { location: { href }, history: { state: null, replaceState } });
    replaceState.mockClear();
    server.calls.length = 0;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    server.session = { user: { id: 'u1', email: 'a@example.invalid' } };
    server.sessionError = null;
  });

  it('opens on the cache when the token expired and the auth server cannot be reached', async () => {
    const storage = new MemoryStorage();
    start('https://app.example/', true);
    const online = new SupabaseStore('https://example.invalid', 'anon', storage);
    expect(await online.userEmail()).toBe('a@example.invalid');
    storage.setItem('household-shop.cache.households', JSON.stringify([{ id: 'h1', name: 'בית', joinCode: 'ABCDEFGH', settings: null }]));
    storage.setItem('household-shop.cache.items.h1', JSON.stringify([{ id: 'i1' }]));

    start('https://app.example/', false);
    server.session = null;
    server.sessionError = { name: 'AuthRetryableFetchError', message: 'Failed to fetch' };
    const store = new SupabaseStore('https://example.invalid', 'anon', storage);
    expect(await store.userEmail()).toBe('a@example.invalid');
    expect((await store.loadHousehold())?.id).toBe('h1');
    expect(await store.loadItems()).toEqual({ items: [{ id: 'i1' }], fromCache: true });
    // A tick waits in the queue until the session is back.
    await store.setTick('main', 'x', true);
    expect(store.pendingTicks('main')).toBe(1);
    // Online again, but the refresh still fails: nothing goes out without the user.
    vi.stubGlobal('navigator', { onLine: true });
    await store.setTick('main', 'y', true);
    await store.flushTicks();
    expect(await store.loadItems()).toEqual({ items: [{ id: 'i1' }], fromCache: true });
    expect(store.pendingTicks('main')).toBe(2);
    expect(server.calls).toEqual([]);
    // The session is back: the queue goes out.
    server.session = { user: { id: 'u1', email: 'a@example.invalid' } };
    server.sessionError = null;
    await store.flushTicks();
    expect(server.calls).toEqual(['upsert:x', 'upsert:y']);
  });

  it('asks to sign in when the server says the session is gone', async () => {
    const storage = new MemoryStorage();
    storage.setItem('household-shop.cache.email', 'a@example.invalid');
    storage.setItem('household-shop.cache.households', JSON.stringify([{ id: 'h1' }]));
    start('https://app.example/', true);
    server.session = null;
    server.sessionError = { name: 'AuthApiError', message: 'Invalid Refresh Token' };
    expect(await new SupabaseStore('https://example.invalid', 'anon', storage).userEmail()).toBeNull();
  });

  it('reads a sign-in error from the address once and cleans the address', async () => {
    start('https://app.example/#error=access_denied&error_code=otp_expired', true);
    server.session = null;
    const store = new SupabaseStore('https://example.invalid', 'anon', new MemoryStorage());
    await store.userEmail();
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://app.example/');
    expect(store.takeAuthError()).toBe('otp_expired');
    expect(store.takeAuthError()).toBeNull();
  });
});
