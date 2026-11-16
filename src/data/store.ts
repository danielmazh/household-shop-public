import type { Item, ItemPatch, Purchase, Shop, ShopPatch, StockDelta } from '../domain/types';
import { TRIP_ID_RE, type Settings, type TripId } from '../domain/schedule';

export interface ItemsResult {
  items: Item[];
  /** True when the server could not be reached and the items come from the local cache. */
  fromCache: boolean;
}

export interface ArchiveResult {
  /** The archived store, now with active false. */
  shop: Shop;
  /** The items moved to the other store, as stored. */
  items: Item[];
}

/** Storage for one household. The UI talks only to this interface. */
export interface Store {
  readonly kind: 'local' | 'supabase';
  loadItems(): Promise<ItemsResult>;
  // Writes throw when they fail, for example when offline.
  // Each returns the item(s) as stored after the write.
  /** Inserts a new item. */
  addItem(item: Item): Promise<Item>;
  /** Writes only the fields in `patch`. Use `itemPatch(before, after)` to build it. */
  updateItem(id: string, patch: ItemPatch): Promise<Item>;
  /** Puts every item in `ids` on store `storeId` (or no store) in one write (spec 013, role store change). */
  setItemsStore(ids: string[], storeId: string | null): Promise<Item[]>;
  /** stock = clamp(stock + delta). Adding stock clears ranOut. */
  adjustStock(id: string, delta: number): Promise<Item>;
  /**
   * Adds bought units to stock and clears ranOut (one-time products become
   * inactive instead), clears the ticks and overrides of `trip`, and writes
   * the purchase history when there are lines (spec 012). All or nothing.
   */
  finishTrip(trip: TripId, lines: StockDelta[]): Promise<Item[]>;
  // Amount for this trip (spec 012), shared by the household.
  /** Item id -> packs set for `trip`. Empty when none, or when the server has no overrides yet. */
  loadOverrides(trip: TripId): Promise<Map<string, number>>;
  /** Sets the packs of one item on `trip` (1 to 99), or removes the override with null. */
  setOverride(trip: TripId, itemId: string, packs: number | null): Promise<void>;
  /** Calls back with the overrides of `trip` when another device or tab changes them. */
  subscribeOverrides(trip: TripId, onChange: (overrides: Map<string, number>) => void): () => void;
  /** Finished trips, newest first, at most HISTORY_LIMIT (spec 012). */
  loadHistory(): Promise<Purchase[]>;
  /** Ids of the items ticked on `trip`, shared by every member. */
  loadTicks(trip: TripId): Promise<Set<string>>;
  /**
   * Ticks or unticks one item. Doing it twice is fine. In shared mode a change
   * that cannot reach the server is queued on this device and sent later.
   */
  setTick(trip: TripId, itemId: string, ticked: boolean): Promise<void>;
  /** Number of queued tick changes of `trip` not yet sent. Always 0 in demo mode. */
  pendingTicks(trip: TripId): number;
  /** Queued tick changes of `trip` plus the one in flight. Finish waits until it is 0. Always 0 in demo mode. */
  unsentTicks(trip: TripId): number;
  /** Sends queued tick changes now. Does nothing in demo mode, offline, or with an empty queue. */
  flushTicks(): Promise<void>;
  /** Calls back when the tick queue or the tick in flight changes, or the server refuses a queued change. */
  subscribeTickQueue(listener: TickQueueListener): () => void;
  /** The household settings. Also remembers their version for the next save. */
  loadSettings(): Promise<Settings>;
  /**
   * Saves settings. Ticks of a trip that is no longer in `settings.trips` are deleted.
   * Throws SettingsConflictError when another device or tab saved since the
   * last load; loadSettings then returns the newer settings.
   */
  saveSettings(settings: Settings): Promise<void>;
  /** Calls back with the settings when another device or tab saves them. */
  subscribeSettings(onChange: (settings: Settings) => void): () => void;
  // Stores (spec 007). Writes throw when they fail, like item writes.
  /** Every store of the household, archived ones too, in store order. */
  loadShops(): Promise<Shop[]>;
  /** Inserts a new store. Use `nextShopSort` for its sort. Throws on a taken name. */
  addShop(shop: Shop): Promise<Shop>;
  /** Renames, changes the emoji, or restores (`active: true`) a store. */
  updateShop(id: string, patch: ShopPatch): Promise<Shop>;
  /** Gives the stores in `ids` sort 0, 1, 2, ... in one step. Returns every store in the new order. */
  reorderShops(ids: string[]): Promise<Shop[]>;
  /**
   * Moves every item of store `id` to `moveTo` (another active store, or null
   * for no store) and archives store `id`, all or nothing.
   */
  archiveShop(id: string, moveTo: string | null): Promise<ArchiveResult>;
  /** Calls back with every store when another device or tab changes them. */
  subscribeShops(onChange: (shops: Shop[]) => void): () => void;
  /** Calls back with the full item list when another device or tab changes it. */
  subscribe(onChange: (items: Item[]) => void): () => void;
  /** Calls back with the ticks of `trip` when another device or tab changes them. */
  subscribeTicks(trip: TripId, onChange: (ticks: Set<string>) => void): () => void;
}

export interface TickQueueListener {
  onChange?: () => void;
  onReject?: (error: unknown) => void;
}

export const ITEMS_KEY = 'household-shop.items';
export const SETTINGS_KEY = 'household-shop.settings';
/** Demo mode: goes up by one on each settings save, like households.settings_version. */
export const SETTINGS_VERSION_KEY = 'household-shop.settingsVersion';

/** The settings changed on another device or tab since they were loaded, so the save was refused. */
export class SettingsConflictError extends Error {
  constructor() {
    super('settings changed elsewhere');
    this.name = 'SettingsConflictError';
  }
}
/** Demo mode stores: Shop[]. */
export const STORES_KEY = 'household-shop.stores';
/** Demo mode ticks: { [trip]: itemId[] }. */
export const TICKS_KEY = 'household-shop.ticks';

export type TicksByTrip = Record<TripId, string[]>;

/** Demo mode overrides: { [trip]: { [itemId]: packs } } (spec 012). */
export const OVERRIDES_KEY = 'household-shop.overrides';
/** Demo mode purchase history: Purchase[] (spec 012). */
export const HISTORY_KEY = 'household-shop.history';

export type OverridesByTrip = Record<TripId, Record<string, number>>;

/** Reads stored overrides, dropping anything that is not a whole number of packs 1 to 99 under a valid trip id. */
export function parseOverrides(value: unknown): OverridesByTrip {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out: OverridesByTrip = {};
  for (const [trip, map] of Object.entries(source)) {
    if (!TRIP_ID_RE.test(trip) || !map || typeof map !== 'object' || Array.isArray(map)) continue;
    const kept: Record<string, number> = {};
    for (const [id, packs] of Object.entries(map as Record<string, unknown>)) {
      if (Number.isInteger(packs) && (packs as number) >= 1 && (packs as number) <= 99) kept[id] = packs as number;
    }
    out[trip] = kept;
  }
  return out;
}

/** Reads stored ticks, dropping anything that is not a list of strings under a valid trip id. */
export function parseTicks(value: unknown): TicksByTrip {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const out: TicksByTrip = {};
  for (const [trip, ids] of Object.entries(source)) {
    if (TRIP_ID_RE.test(trip) && Array.isArray(ids)) out[trip] = ids.filter((id): id is string => typeof id === 'string');
  }
  return out;
}

export function readJson(storage: Storage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Every key this app writes starts with this prefix. */
export const KEY_PREFIX = 'household-shop.';

/** The language of this device (spec 010). Sign-out keeps it (spec 011). */
export const LANG_KEY = 'household-shop.lang';

/** Removes every household-shop.* key except the language, for sign-out. */
export function clearAppKeys(storage: Storage) {
  const keys: string[] = [];
  for (let n = 0; n < storage.length; n++) {
    const key = storage.key(n);
    if (key?.startsWith(KEY_PREFIX) && key !== LANG_KEY) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}
