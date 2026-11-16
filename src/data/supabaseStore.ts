import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normalizeSettings, toStoredSettings, type Settings, type TripId } from '../domain/schedule';
import { sortShops } from '../domain/stores';
import { HISTORY_LIMIT } from '../domain/history';
import type { Cadence, Item, ItemPatch, Lang, Purchase, Shop, ShopPatch, StockDelta } from '../domain/types';
import { readAuthUrl } from './authUrl';
import { SettingsConflictError, clearAppKeys, readJson, type ArchiveResult, type ItemsResult, type Store, type TickQueueListener } from './store';
import {
  TICK_QUEUE_KEY,
  applyQueue,
  enqueue,
  flushQueue,
  hasKey,
  isNetworkError,
  isRetryError,
  parseQueues,
  pendingFor,
  type QueuedTick,
  type TickQueue,
} from './tickQueue';

export interface Household {
  id: string;
  name: string;
  joinCode: string;
  settings: Settings;
  /** households.settings_version: the next save sends it and the server refuses a stale one. */
  settingsVersion: number;
}

interface HouseholdRow {
  id: string;
  name: string;
  join_code: string;
  settings: unknown;
  settings_version?: number | null;
}

const HOUSEHOLD_COLUMNS = 'id, name, join_code, settings, settings_version';

const versionOf = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);

interface ItemRow {
  id: string;
  household_id: string;
  name: string;
  category: string;
  cadence: Cadence;
  trips: string[] | null;
  emoji?: string | null;
  store_id: string | null;
  weekly_use: number | string;
  target?: number | string | null;
  unit: string;
  pack_size: number | string;
  price: number | string | null;
  stock: number | string;
  ran_out: boolean;
  active: boolean;
  /** Spec 012, migration 0006. Missing on a database before 0006. */
  once_trip?: string | null;
}

/** purchases row with its lines (spec 012). */
export interface PurchaseRow {
  id: string;
  trip: string;
  trip_name: string | null;
  finished_by_name: string | null;
  finished_at: string;
  purchase_lines: {
    item_id: string | null;
    item_name: string;
    packs: number | string;
    units: number | string;
    unit: string | null;
    store_name: string | null;
    price_each: number | string | null;
  }[] | null;
}

/** A purchases row with its lines, as the history screen shows it. Lines in name order. */
export const toPurchase = (r: PurchaseRow): Purchase => ({
  id: r.id,
  trip: r.trip,
  tripName: r.trip_name ?? null,
  finishedBy: r.finished_by_name ?? null,
  finishedAt: r.finished_at,
  lines: (r.purchase_lines ?? [])
    .map((l) => ({
      itemId: l.item_id ?? null,
      name: l.item_name,
      packs: Number(l.packs),
      units: Number(l.units),
      unit: l.unit ?? '',
      storeName: l.store_name ?? null,
      price: l.price_each === null || l.price_each === undefined ? null : Number(l.price_each),
    }))
    .sort((a, b) => a.name.localeCompare(b.name)),
});

/** PostgREST could not find the function: the database does not have migration 0006 yet. */
const missingFunction = (error: unknown) => {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return code === 'PGRST202' || code === '42883';
};

const ACTIVE_KEY = 'household-shop.active-household';
const HOUSEHOLDS_CACHE = 'household-shop.cache.households';
/** Email of the last session, so an offline start with an expired token can open the cache. */
const EMAIL_CACHE = 'household-shop.cache.email';
const TICKS_CACHE = 'household-shop.cache.ticks';
const itemsCacheKey = (householdId: string) => `household-shop.cache.items.${householdId}`;
const storesCacheKey = (householdId: string) => `household-shop.cache.stores.${householdId}`;

interface StoreRow {
  id: string;
  household_id: string;
  name: string;
  emoji: string;
  sort: number;
  active: boolean;
}

const toShop = (r: StoreRow): Shop => ({ id: r.id, name: r.name, emoji: r.emoji, sort: r.sort, active: r.active });


/** Loads tried after create_household, with a growing pause between them. */
const LOAD_TRIES = 3;
const RETRY_DELAY_MS = 300;

/** Debounce for realtime refetch: a finished trip changes many rows at once. */
const REFETCH_DELAY_MS = 300;

const toHousehold = (r: HouseholdRow): Household => ({
  id: r.id,
  name: r.name,
  joinCode: r.join_code,
  settings: normalizeSettings(r.settings),
  settingsVersion: versionOf(r.settings_version),
});

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  name: r.name,
  category: r.category,
  cadence: r.cadence,
  trips: r.trips ?? null,
  emoji: r.emoji ?? null,
  storeId: r.store_id,
  weeklyUse: Number(r.weekly_use),
  target: r.target === null || r.target === undefined ? null : Number(r.target),
  unit: r.unit,
  packSize: Number(r.pack_size),
  price: r.price === null ? null : Number(r.price),
  stock: Number(r.stock),
  ranOut: r.ran_out,
  active: r.active,
  onceTrip: r.once_trip ?? null,
});

const COLUMNS: Record<keyof ItemPatch, keyof ItemRow> = {
  name: 'name',
  category: 'category',
  cadence: 'cadence',
  trips: 'trips',
  emoji: 'emoji',
  storeId: 'store_id',
  weeklyUse: 'weekly_use',
  target: 'target',
  unit: 'unit',
  packSize: 'pack_size',
  price: 'price',
  stock: 'stock',
  ranOut: 'ran_out',
  active: 'active',
  onceTrip: 'once_trip',
};

/** Item fields to row columns. Only the keys present in `patch`. */
export function toRowPatch(patch: ItemPatch): Partial<ItemRow> {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const column = COLUMNS[key as keyof ItemPatch];
    if (!column || value === undefined) continue;
    row[column] = key === 'name' ? String(value).trim() : value;
  }
  return row as Partial<ItemRow>;
}

const offlineError = () => new Error('offline');

/** supabase-js could not reach the auth server (offline, fetch failed). */
const authUnreachable = (error: unknown) => !!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AuthRetryableFetchError';

/** Shared households in Supabase, with a localStorage cache for offline reading. */
export class SupabaseStore implements Store {
  readonly kind = 'supabase';
  private readonly client: SupabaseClient;
  private current: Household | null = null;
  private list: Household[] = [];
  private readonly queueListeners = new Set<TickQueueListener>();
  private flushing: Promise<void> | null = null;
  /**
   * The direct tick send not yet answered. Only one tick request runs at a
   * time: while it runs, new ticks go to the queue and the flush waits for it.
   */
  private inFlight: { householdId: string; entry: QueuedTick; done: Promise<void> } | null = null;
  private createdId: string | null = null;
  /** Error code when a sign-in link could not be used (expired, used, or opened in another browser). */
  private authError: string | null = null;
  /**
   * True after an offline start with an expired token: the app shows the
   * cache, and nothing is sent until the session is refreshed.
   */
  private offlineSession = false;

  constructor(url: string, anonKey: string, private readonly storage: Storage = localStorage) {
    this.client = createClient(url, anonKey, {
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    });
  }

  // Auth ------------------------------------------------------------------

  /**
   * Waits for the PKCE code exchange of a magic-link return (supabase-js does it
   * on start), reads a sign-in error once, cleans the address bar, and returns
   * the signed-in email. Offline with an expired token it returns the last
   * email when this device has the household cached, so the app opens on the
   * cache. Sign-in is asked only when the server answered that the session is gone.
   */
  async userEmail(): Promise<string | null> {
    const { error } = await this.client.auth.initialize();
    const link = readAuthUrl(window.location.href);
    if (link.error) this.authError = link.error;
    else if (error && link.hadCode) this.authError = 'exchange_failed';
    if (link.clean) window.history.replaceState(window.history.state, '', link.clean);
    const { data, error: sessionError } = await this.client.auth.getSession();
    const email = data.session?.user.email ?? null;
    if (email) {
      this.offlineSession = false;
      this.storage.setItem(EMAIL_CACHE, email);
      return email;
    }
    const cachedEmail = this.storage.getItem(EMAIL_CACHE);
    const unreachable = !navigator.onLine || authUnreachable(sessionError) || authUnreachable(error);
    if (cachedEmail && unreachable && this.hasCachedHousehold()) {
      this.offlineSession = true;
      return cachedEmail;
    }
    return null;
  }

  private hasCachedHousehold(): boolean {
    const cached = readJson(this.storage, HOUSEHOLDS_CACHE);
    return Array.isArray(cached) && cached.length > 0;
  }

  /**
   * False while an offline start has no valid session yet. Each call tries
   * the session again (supabase-js refreshes it when the network is back).
   */
  private async sessionReady(): Promise<boolean> {
    if (!this.offlineSession) return true;
    try {
      const { data } = await this.client.auth.getSession();
      if (data.session) this.offlineSession = false;
    } catch {
      // Still offline.
    }
    return !this.offlineSession;
  }

  /** The sign-in error code to show once, or null. Reading it clears it. */
  takeAuthError(): string | null {
    const e = this.authError;
    this.authError = null;
    return e;
  }

  /**
   * Calls back after sign-in or sign-out. The callback runs in a later task:
   * supabase-js holds a lock during this event, and Supabase calls made inside
   * it can deadlock.
   */
  onAuthChange(callback: () => void): () => void {
    const { data } = this.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setTimeout(callback, 0);
    });
    return () => data.subscription.unsubscribe();
  }

  /** Token of the current session for our own API (AI help), or null when signed out. */
  async accessToken(): Promise<string | null> {
    const { data } = await this.client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  /** Sends the sign-in email. `lang` goes into the user metadata of a new user, for the email template (spec 011). */
  async signIn(email: string, lang: Lang = 'he'): Promise<void> {
    this.authError = null;
    // The Google Play review account has no mailbox: its "code" is its password (see verifyCode).
    if (isReviewEmail(email)) return;
    const emailRedirectTo = new URL(import.meta.env.BASE_URL, window.location.origin).href;
    const { error } = await this.client.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo, data: { lang } } });
    if (error) throw error;
  }

  /**
   * Keeps `lang` in the user metadata, so the next sign-in email is in the
   * language of this device (spec 011). Best effort: a failure changes nothing.
   */
  async saveLang(lang: Lang): Promise<void> {
    try {
      const { data } = await this.client.auth.getSession();
      const user = data.session?.user;
      if (!user || user.user_metadata?.lang === lang) return;
      await this.client.auth.updateUser({ data: { lang } });
    } catch {
      // Offline or the session is gone: the next sign-in tries again.
    }
  }

  /**
   * Signs in with the code from the sign-in email. Works where the link
   * cannot: an installed iOS app, where the link opens in Safari.
   */
  async verifyCode(email: string, code: string): Promise<void> {
    if (isReviewEmail(email)) {
      const { error } = await this.client.auth.signInWithPassword({ email: email.trim(), password: code.trim() });
      if (error) throw error;
      return;
    }
    const { error } = await this.client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    if (error) throw error;
  }

  /**
   * Ends the session on this device only. The local session and every
   * household-shop.* key are removed even when the server call fails.
   */
  async signOut(): Promise<void> {
    try {
      await this.client.auth.signOut({ scope: 'local' });
    } finally {
      this.current = null;
      this.list = [];
      this.offlineSession = false;
      clearAppKeys(this.storage);
    }
  }

  // Households --------------------------------------------------------------

  /** The active household, after loadHousehold. */
  get household(): Household | null {
    return this.current;
  }

  /** All households of the user, oldest membership first, after loadHousehold. */
  get households(): readonly Household[] {
    return this.list;
  }

  private setActive(h: Household | null) {
    this.current = h;
    if (h) this.storage.setItem(ACTIVE_KEY, h.id);
    else this.storage.removeItem(ACTIVE_KEY);
  }

  private async fetchHouseholds(): Promise<Household[]> {
    const { data: auth } = await this.client.auth.getSession();
    const uid = auth.session?.user.id;
    if (!uid) throw new Error('not signed in');
    const { data, error } = await this.client
      .from('members')
      .select(`created_at, households (${HOUSEHOLD_COLUMNS})`)
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    if (error) throw error;
    const rows = data as unknown as { households: HouseholdRow | null }[];
    return rows.flatMap((r) => (r.households ? [toHousehold(r.households)] : []));
  }

  /**
   * Loads the user's households and picks the active one: the one saved on
   * this device, else the oldest membership. Null when the user has none.
   * Falls back to the cache when offline.
   */
  async loadHousehold(): Promise<Household | null> {
    try {
      this.list = await this.fetchHouseholds();
      this.storage.setItem(HOUSEHOLDS_CACHE, JSON.stringify(this.list));
    } catch (error) {
      const cached = readJson(this.storage, HOUSEHOLDS_CACHE);
      if (!Array.isArray(cached) || cached.length === 0) throw error;
      this.list = (cached as Household[]).map((h) => ({ ...h, settings: normalizeSettings(h.settings), settingsVersion: versionOf(h.settingsVersion) }));
    }
    const saved = this.storage.getItem(ACTIVE_KEY);
    this.setActive(this.list.find((h) => h.id === saved) ?? this.list[0] ?? null);
    return this.current;
  }

  /** Makes another of the user's households active on this device. */
  switchHousehold(id: string): Household {
    const h = this.list.find((x) => x.id === id);
    if (!h) throw new Error('unknown household');
    this.setActive(h);
    return h;
  }

  /** True when a household was created but could not be loaded yet. The next createHousehold only loads it. */
  get createPending(): boolean {
    return this.createdId !== null;
  }

  /**
   * Creates a household with the default catalog and makes it active. Max 5
   * per user. Safe to retry: when the create worked and only the load failed,
   * a second call loads that household and never creates another one.
   */
  async createHousehold(name: string, lang: Lang = 'he'): Promise<Household> {
    if (this.createdId === null) {
      // Spec 011: `lang` only for English, so Hebrew works with a database before 0005.
      const args = lang === 'en' ? { household_name: name.trim(), lang } : { household_name: name.trim() };
      const { data, error } = await this.client.rpc('create_household', args);
      if (error) throw error;
      if (typeof data !== 'string') throw new Error('no household id');
      this.createdId = data;
    }
    const id = this.createdId;
    this.storage.setItem(ACTIVE_KEY, id);
    let last: unknown;
    for (let attempt = 0; attempt < LOAD_TRIES; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      try {
        // Not loadHousehold: its cache fallback would not have the new household.
        this.list = await this.fetchHouseholds();
        this.storage.setItem(HOUSEHOLDS_CACHE, JSON.stringify(this.list));
        const h = this.list.find((x) => x.id === id);
        if (h) {
          this.createdId = null;
          this.setActive(h);
          return h;
        }
        last = new Error('household not found');
      } catch (error) {
        last = error;
      }
    }
    throw last;
  }

  /** Joins with a code and makes that household active. Null when the code is wrong or there were too many tries. */
  async joinHousehold(code: string): Promise<Household | null> {
    const { data, error } = await this.client.rpc('join_household', { code: code.trim().toUpperCase() });
    if (error) throw error;
    if (!data) return null;
    this.storage.setItem(ACTIVE_KEY, data as string);
    return this.loadHousehold();
  }

  /** New join code for the active household. The old one stops working. */
  async rotateJoinCode(): Promise<Household> {
    const h = this.requireHousehold();
    const { data, error } = await this.client.rpc('rotate_join_code', { hid: h.id });
    if (error) throw error;
    const next = { ...h, joinCode: data as string };
    this.putHousehold(next);
    return next;
  }

  /**
   * Leaves the active household. The last member to leave deletes it.
   * Then the oldest remaining household becomes active (or none).
   */
  async leaveHousehold(): Promise<Household | null> {
    const h = this.requireHousehold();
    const { error } = await this.client.rpc('leave_household', { hid: h.id });
    if (error) throw error;
    this.storage.removeItem(itemsCacheKey(h.id));
    this.storage.removeItem(storesCacheKey(h.id));
    this.writeQueue(h.id, []);
    this.setActive(null);
    return this.loadHousehold();
  }

  private requireHousehold(): Household {
    if (!this.current) throw new Error('No household loaded');
    return this.current;
  }

  // Items -------------------------------------------------------------------

  private readCache(householdId: string): Item[] {
    const cached = readJson(this.storage, itemsCacheKey(householdId));
    return Array.isArray(cached) ? (cached as Item[]) : [];
  }

  private mergeCache(householdId: string, changed: Item[]) {
    const byId = new Map(this.readCache(householdId).map((i) => [i.id, i]));
    for (const item of changed) byId.set(item.id, item);
    this.storage.setItem(itemsCacheKey(householdId), JSON.stringify([...byId.values()]));
  }

  async loadItems(): Promise<ItemsResult> {
    const h = this.requireHousehold();
    if (!(await this.sessionReady())) return { items: this.readCache(h.id), fromCache: true };
    const { data, error } = await this.client.from('items').select('*').eq('household_id', h.id);
    if (error) return { items: this.readCache(h.id), fromCache: true };
    const items = (data as ItemRow[]).map(toItem);
    this.storage.setItem(itemsCacheKey(h.id), JSON.stringify(items));
    this.afterSuccess();
    return { items, fromCache: false };
  }

  /** Runs a write for the active household and caches the rows it returns. */
  private async write(run: (h: Household) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Item[]> {
    if (!navigator.onLine || !(await this.sessionReady())) throw offlineError();
    const h = this.requireHousehold();
    const { data, error } = await run(h);
    if (error) throw error;
    const items = (Array.isArray(data) ? (data as ItemRow[]) : [data as ItemRow]).map(toItem);
    this.mergeCache(h.id, items);
    this.afterSuccess();
    return items;
  }

  async addItem(item: Item): Promise<Item> {
    const [saved] = await this.write((h) =>
      this.client
        .from('items')
        .insert({ ...toRowPatch(item), id: item.id, household_id: h.id })
        .select()
        .single(),
    );
    return saved!;
  }

  async updateItem(id: string, patch: ItemPatch): Promise<Item> {
    const row = toRowPatch(patch);
    const [saved] = await this.write((h) => {
      const query = this.client.from('items');
      // Nothing changed: read the row back instead of sending an empty update.
      return Object.keys(row).length === 0
        ? query.select().eq('id', id).eq('household_id', h.id).single()
        : query.update(row).eq('id', id).eq('household_id', h.id).select().single();
    });
    return saved!;
  }

  async setItemsStore(ids: string[], storeId: string | null): Promise<Item[]> {
    if (ids.length === 0) return [];
    return this.write((h) => this.client.from('items').update({ store_id: storeId }).eq('household_id', h.id).in('id', ids).select());
  }

  async adjustStock(id: string, delta: number): Promise<Item> {
    const [saved] = await this.write(() => this.client.rpc('adjust_stock', { item_id: id, delta }));
    return saved!;
  }

  /**
   * Waits for the tick in flight and the queue first, so a late tick cannot
   * come back after the trip is cleared. finish_trip clears the trip's ticks;
   * with no lines the ticks are deleted directly.
   */
  async finishTrip(trip: TripId, lines: StockDelta[]): Promise<Item[]> {
    if (this.inFlight) await this.inFlight.done;
    await this.flushTicks();
    // The UI disables finish meanwhile; offline the queue stays, so this refuses.
    if (this.unsentTicks(trip) > 0) throw new Error('ticks pending');
    // Spec 012: one call also clears the overrides and writes history, even with no lines.
    const payload = lines.map((l) => ({ item_id: l.itemId, delta: l.delta, ...(l.packs === undefined ? {} : { packs: l.packs }) }));
    try {
      const done = await this.write((h) => this.client.rpc('finish_household_trip', { hid: h.id, trip_id: trip, lines: payload }));
      this.storage.removeItem(`${TICKS_CACHE}.${this.requireHousehold().id}.${trip}`);
      return done;
    } catch (error) {
      // A database before migration 0006: finish the old way below.
      if (!missingFunction(error)) throw error;
    }
    if (lines.length > 0) {
      return this.write(() => this.client.rpc('finish_trip', { trip, lines: lines.map((l) => ({ item_id: l.itemId, delta: l.delta })) }));
    }
    if (!navigator.onLine || !(await this.sessionReady())) throw offlineError();
    const h = this.requireHousehold();
    const { error } = await this.client.from('ticks').delete().eq('household_id', h.id).eq('trip', trip);
    if (error) throw error;
    this.storage.removeItem(`${TICKS_CACHE}.${h.id}.${trip}`);
    this.afterSuccess();
    return [];
  }

  // Amount for this trip and history (spec 012) ----------------------------------

  /** Overrides of `trip`. Offline, or before migration 0006: none. */
  async loadOverrides(trip: TripId): Promise<Map<string, number>> {
    const h = this.requireHousehold();
    if (!(await this.sessionReady())) return new Map();
    const { data, error } = await this.client.from('trip_overrides').select('item_id, packs').eq('household_id', h.id).eq('trip', trip);
    if (error) return new Map();
    return new Map((data as { item_id: string; packs: number }[]).map((r) => [r.item_id, Number(r.packs)]));
  }

  async setOverride(trip: TripId, itemId: string, packs: number | null): Promise<void> {
    if (!navigator.onLine || !(await this.sessionReady())) throw offlineError();
    const h = this.requireHousehold();
    const { error } = await this.client.rpc('set_trip_override', { hid: h.id, trip_id: trip, item: itemId, amount: packs });
    if (error) throw error;
    this.afterSuccess();
  }

  /** Delete events come unfiltered (like ticks) and are matched by household_id, part of the key. */
  subscribeOverrides(trip: TripId, onChange: (overrides: Map<string, number>) => void): () => void {
    const h = this.requireHousehold();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refetch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void this.loadOverrides(trip).then((o) => {
          if (this.current?.id === h.id) onChange(o);
        });
      }, REFETCH_DELAY_MS);
    };
    const channel = this.client
      .channel(`overrides:${h.id}:${trip}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trip_overrides', filter: `household_id=eq.${h.id}` }, refetch)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trip_overrides', filter: `household_id=eq.${h.id}` }, refetch)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'trip_overrides' }, (payload) => {
        if ((payload.old as { household_id?: string }).household_id === h.id) refetch();
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void this.client.removeChannel(channel);
    };
  }

  /** The last finished trips with their lines. Throws when it cannot be read (offline, or before 0006). */
  async loadHistory(): Promise<Purchase[]> {
    const h = this.requireHousehold();
    if (!(await this.sessionReady())) throw offlineError();
    const { data, error } = await this.client
      .from('purchases')
      .select('id, trip, trip_name, finished_by_name, finished_at, purchase_lines (item_id, item_name, packs, units, unit, store_name, price_each)')
      .eq('household_id', h.id)
      .order('finished_at', { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw error;
    this.afterSuccess();
    return (data as PurchaseRow[]).map(toPurchase);
  }

  // Stores ------------------------------------------------------------------

  /** Every store of the household in store order. Offline: the last known list. */
  async loadShops(): Promise<Shop[]> {
    const h = this.requireHousehold();
    const ready = await this.sessionReady();
    const { data, error } = ready ? await this.client.from('stores').select('*').eq('household_id', h.id) : { data: null, error: offlineError() };
    if (error) {
      const cached = readJson(this.storage, storesCacheKey(h.id));
      return Array.isArray(cached) ? sortShops(cached as Shop[]) : [];
    }
    const shops = sortShops((data as StoreRow[]).map(toShop));
    this.storage.setItem(storesCacheKey(h.id), JSON.stringify(shops));
    this.afterSuccess();
    return shops;
  }

  /** Runs a store write and puts the returned rows into the cache. */
  private async writeShops(run: (h: Household) => PromiseLike<{ data: unknown; error: unknown }>): Promise<Shop[]> {
    if (!navigator.onLine || !(await this.sessionReady())) throw offlineError();
    const h = this.requireHousehold();
    const { data, error } = await run(h);
    if (error) throw error;
    const shops = (Array.isArray(data) ? (data as StoreRow[]) : [data as StoreRow]).map(toShop);
    const cached = readJson(this.storage, storesCacheKey(h.id));
    const byId = new Map((Array.isArray(cached) ? (cached as Shop[]) : []).map((s) => [s.id, s]));
    for (const shop of shops) byId.set(shop.id, shop);
    this.storage.setItem(storesCacheKey(h.id), JSON.stringify(sortShops([...byId.values()])));
    this.afterSuccess();
    return shops;
  }

  async addShop(shop: Shop): Promise<Shop> {
    const [saved] = await this.writeShops((h) =>
      this.client
        .from('stores')
        // A new store is always active (the column default). Clients never write stores.active.
        .insert({ id: shop.id, household_id: h.id, name: shop.name.trim(), emoji: shop.emoji, sort: shop.sort })
        .select()
        .single(),
    );
    return saved!;
  }

  /**
   * Restores with the restore_store RPC (the store limit applies there), then
   * writes name and emoji. Clients may not write stores.active directly.
   */
  async updateShop(id: string, patch: ShopPatch): Promise<Shop> {
    const row: { name?: string; emoji?: string } = {};
    if (patch.name !== undefined) row.name = patch.name.trim();
    if (patch.emoji !== undefined) row.emoji = patch.emoji;
    let saved: Shop | undefined;
    if (patch.active === true) [saved] = await this.writeShops(() => this.client.rpc('restore_store', { store_id: id }));
    if (Object.keys(row).length > 0 || !saved) {
      [saved] = await this.writeShops((h) => {
        const query = this.client.from('stores');
        // Nothing to write: read the row back instead of sending an empty update.
        return Object.keys(row).length === 0
          ? query.select().eq('id', id).eq('household_id', h.id).single()
          : query.update(row).eq('id', id).eq('household_id', h.id).select().single();
      });
    }
    return saved!;
  }

  /** One RPC, so the new order is saved all or nothing. */
  async reorderShops(ids: string[]): Promise<Shop[]> {
    await this.writeShops(() => this.client.rpc('reorder_stores', { store_ids: ids }));
    return this.loadShops();
  }

  /** archive_store moves the items and archives the store in one transaction. */
  async archiveShop(id: string, moveTo: string | null): Promise<ArchiveResult> {
    const items = await this.write(() => this.client.rpc('archive_store', { store_id: id, move_to_store_id: moveTo }));
    const [shop] = await this.writeShops((h) => this.client.from('stores').select().eq('id', id).eq('household_id', h.id).single());
    return { shop: shop!, items };
  }

  subscribeShops(onChange: (shops: Shop[]) => void): () => void {
    const h = this.requireHousehold();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refetch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void this.loadShops().then((shops) => {
          if (this.current?.id === h.id) onChange(shops);
        });
      }, REFETCH_DELAY_MS);
    };
    const channel = this.client
      .channel(`stores:${h.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stores', filter: `household_id=eq.${h.id}` }, refetch)
      .subscribe();
    return () => {
      clearTimeout(timer);
      void this.client.removeChannel(channel);
    };
  }

  // Ticks -------------------------------------------------------------------

  /** Server ticks with this device's queued changes on top. */
  async loadTicks(trip: TripId): Promise<Set<string>> {
    const h = this.requireHousehold();
    const cacheKey = `${TICKS_CACHE}.${h.id}.${trip}`;
    let server: Set<string>;
    try {
      if (!(await this.sessionReady())) throw offlineError();
      const { data, error } = await this.client.from('ticks').select('item_id').eq('household_id', h.id).eq('trip', trip);
      if (error) throw error;
      server = new Set((data as { item_id: string }[]).map((r) => r.item_id));
      this.storage.setItem(cacheKey, JSON.stringify([...server]));
      this.afterSuccess();
    } catch (error) {
      // Offline: show the last known ticks plus the queued changes.
      const cached = readJson(this.storage, cacheKey);
      if (!isNetworkError(error) || !Array.isArray(cached)) throw error;
      server = new Set(cached.filter((id): id is string => typeof id === 'string'));
    }
    return applyQueue(server, this.queueOf(h.id), trip);
  }

  /**
   * Sends at once when online and nothing is queued, flushing or in flight.
   * Otherwise the change is queued and sent after the request in flight, so
   * requests never pass each other. A network error or an expired token
   * queues the change; a server reject throws.
   */
  async setTick(trip: TripId, itemId: string, ticked: boolean): Promise<void> {
    const h = this.requireHousehold();
    const entry: QueuedTick = { trip, itemId, ticked };
    if (!navigator.onLine || this.inFlight || this.flushing || this.queueOf(h.id).length > 0) {
      this.writeQueue(h.id, enqueue(this.queueOf(h.id), entry));
      void this.flushTicks();
      return;
    }
    const send = (async (): Promise<unknown> => {
      try {
        await this.sendTick(h.id, entry);
        return null;
      } catch (error) {
        if (!isRetryError(error)) return error;
        // Keep it for later, ahead of newer changes, unless one of them is for the same item.
        const queue = this.queueOf(h.id);
        if (!hasKey(queue, entry)) this.writeQueue(h.id, [entry, ...queue]);
        return null;
      }
    })();
    const flight = { householdId: h.id, entry, done: send.then(() => undefined) };
    this.inFlight = flight;
    this.notifyQueue();
    let rejected: unknown;
    try {
      rejected = await send;
    } finally {
      if (this.inFlight === flight) this.inFlight = null;
      this.notifyQueue();
    }
    if (rejected) throw rejected;
    if (this.queueOf(h.id).length > 0) void this.flushTicks();
  }

  /** Insert or delete one row. ticked_by is set by the server. A tick that already exists is kept. */
  private async sendTick(householdId: string, { trip, itemId, ticked }: QueuedTick): Promise<void> {
    if (!navigator.onLine || !(await this.sessionReady())) throw offlineError();
    const ticks = this.client.from('ticks');
    const { error } = ticked
      ? await ticks.upsert({ household_id: householdId, trip, item_id: itemId }, { ignoreDuplicates: true })
      : await ticks.delete().eq('household_id', householdId).eq('trip', trip).eq('item_id', itemId);
    if (error) throw error;
  }

  // Tick queue (offline ticks, spec 003) -------------------------------------------

  private queueOf(householdId: string): TickQueue {
    return parseQueues(readJson(this.storage, TICK_QUEUE_KEY))[householdId] ?? [];
  }

  private writeQueue(householdId: string, queue: TickQueue) {
    const all = parseQueues(readJson(this.storage, TICK_QUEUE_KEY));
    const before = JSON.stringify(all[householdId] ?? []);
    if (queue.length) all[householdId] = queue;
    else delete all[householdId];
    if (Object.keys(all).length) this.storage.setItem(TICK_QUEUE_KEY, JSON.stringify(all));
    else this.storage.removeItem(TICK_QUEUE_KEY);
    if (JSON.stringify(queue) !== before) this.notifyQueue();
  }

  private notifyQueue() {
    for (const l of this.queueListeners) l.onChange?.();
  }

  pendingTicks(trip: TripId): number {
    return this.current ? pendingFor(this.queueOf(this.current.id), trip) : 0;
  }

  unsentTicks(trip: TripId): number {
    const f = this.inFlight;
    const flying = f && f.householdId === this.current?.id && f.entry.trip === trip ? 1 : 0;
    return this.pendingTicks(trip) + flying;
  }

  /** Sends the active household's queue in order. One flush at a time; a second call joins it. */
  flushTicks(): Promise<void> {
    this.flushing ??= this.runFlush().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** Waits for the tick in flight, then sends. An expired token gets one session refresh and one more try. */
  private async runFlush(): Promise<void> {
    if (this.inFlight) await this.inFlight.done;
    const h = this.current;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!h || !navigator.onLine || this.queueOf(h.id).length === 0) return;
      const { rejected, authExpired } = await flushQueue({
        read: () => this.queueOf(h.id),
        write: (queue) => this.writeQueue(h.id, queue),
        send: (entry) => this.sendTick(h.id, entry),
      });
      for (const { error } of rejected) for (const l of this.queueListeners) l.onReject?.(error);
      if (!authExpired || !(await this.refreshSession())) return;
    }
  }

  /** True when the session was refreshed. */
  private async refreshSession(): Promise<boolean> {
    try {
      const { error } = await this.client.auth.refreshSession();
      return !error;
    } catch {
      return false;
    }
  }

  /** After any call that reached the server: try the queue too. */
  private afterSuccess() {
    if (this.current && !this.flushing && this.queueOf(this.current.id).length > 0) void this.flushTicks();
  }

  subscribeTickQueue(listener: TickQueueListener): () => void {
    this.queueListeners.add(listener);
    return () => this.queueListeners.delete(listener);
  }

  // Settings and realtime -------------------------------------------------------

  async loadSettings(): Promise<Settings> {
    return this.requireHousehold().settings;
  }

  /**
   * save_settings saves only when the version matches, so a stale copy never
   * overwrites newer settings. On a conflict the newer settings are loaded
   * first, then SettingsConflictError is thrown.
   */
  async saveSettings(settings: Settings): Promise<void> {
    if (!navigator.onLine || !(await this.sessionReady())) throw offlineError();
    const h = this.requireHousehold();
    const { data, error } = await this.client.rpc('save_settings', { hid: h.id, settings: toStoredSettings(settings), expected_version: h.settingsVersion });
    if (error) throw error;
    this.afterSuccess();
    if (data === null) {
      await this.refreshHousehold(h.id).catch(() => undefined);
      throw new SettingsConflictError();
    }
    this.putHousehold({ ...h, settings, settingsVersion: versionOf(data) });
  }

  /** Reads one household row again and keeps it. */
  private async refreshHousehold(id: string): Promise<Household> {
    const { data, error } = await this.client.from('households').select(HOUSEHOLD_COLUMNS).eq('id', id).single();
    if (error) throw error;
    const h = toHousehold(data as HouseholdRow);
    this.putHousehold(h);
    return h;
  }

  /** Replaces a household in the list and the cache, and the active one when it is the same. */
  private putHousehold(h: Household) {
    this.list = this.list.map((x) => (x.id === h.id ? h : x));
    this.storage.setItem(HOUSEHOLDS_CACHE, JSON.stringify(this.list));
    if (this.current?.id === h.id) this.setActive(h);
  }

  /** Realtime on the household row; calls back only when the settings version changed. */
  subscribeSettings(onChange: (settings: Settings) => void): () => void {
    const h = this.requireHousehold();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refetch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const before = this.current?.id === h.id ? this.current.settingsVersion : null;
        this.refreshHousehold(h.id).then(
          (next) => {
            if (this.current?.id === h.id && next.settingsVersion !== before) onChange(next.settings);
          },
          () => undefined, // Keep what is shown; the next change or reload tries again.
        );
      }, REFETCH_DELAY_MS);
    };
    const channel = this.client
      .channel(`households:${h.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'households', filter: `id=eq.${h.id}` }, refetch)
      .subscribe();
    return () => {
      clearTimeout(timer);
      void this.client.removeChannel(channel);
    };
  }

  subscribe(onChange: (items: Item[]) => void): () => void {
    const h = this.requireHousehold();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refetch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void this.loadItems().then((r) => {
          if (this.current?.id === h.id) onChange(r.items);
        });
      }, REFETCH_DELAY_MS);
    };
    const channel = this.client
      .channel(`items:${h.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items', filter: `household_id=eq.${h.id}` }, refetch)
      .subscribe();
    return () => {
      clearTimeout(timer);
      void this.client.removeChannel(channel);
    };
  }

  /**
   * Realtime cannot filter delete events, so deletes come unfiltered and are
   * matched here by household_id, which is part of the key they carry.
   */
  subscribeTicks(trip: TripId, onChange: (ticks: Set<string>) => void): () => void {
    const h = this.requireHousehold();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refetch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        this.loadTicks(trip).then(
          (ticks) => {
            if (this.current?.id === h.id) onChange(ticks);
          },
          () => undefined, // Keep what is shown; the next change or reload tries again.
        );
      }, REFETCH_DELAY_MS);
    };
    const channel = this.client
      .channel(`ticks:${h.id}:${trip}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticks', filter: `household_id=eq.${h.id}` }, refetch)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'ticks' }, (payload) => {
        if ((payload.old as { household_id?: string }).household_id === h.id) refetch();
      })
      .subscribe();
    return () => {
      clearTimeout(timer);
      void this.client.removeChannel(channel);
    };
  }
}

/**
 * Google Play review account (2026-11-12). Google's reviewers cannot read a
 * sign-in email, so this one address signs in with a numeric password typed
 * into the code field. The user is created by hand in Supabase with that
 * password; the password itself lives only in the Play Console form and in
 * ~/.config/household-shop/play-review.env.
 */
export const REVIEW_EMAIL = 'play-review@household-shop.pages.dev';
export const isReviewEmail = (email: string) => email.trim().toLowerCase() === REVIEW_EMAIL;
