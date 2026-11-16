import { applyStockDelta, itemCountError } from '../domain/catalog';
import { HISTORY_LIMIT, purchaseLines, sortPurchases } from '../domain/history';
import { OVERRIDE_LIMITS, afterFinish, defaultTarget } from '../domain/planner';
import { seedCatalog, seedRoleStores, seedShops } from '../domain/seed';
import { defaultSettings, normalizeSettings, toStoredSettings, type Settings, type TripId } from '../domain/schedule';
import { nextShopSort, reorderShops, sortShops, validateShop } from '../domain/stores';
import type { Item, ItemPatch, Lang, Purchase, Shop, ShopPatch, StockDelta } from '../domain/types';
import {
  HISTORY_KEY,
  ITEMS_KEY,
  OVERRIDES_KEY,
  SETTINGS_KEY,
  SETTINGS_VERSION_KEY,
  SettingsConflictError,
  STORES_KEY,
  TICKS_KEY,
  parseOverrides,
  parseTicks,
  readJson,
  type OverridesByTrip,
  type ArchiveResult,
  type ItemsResult,
  type Store,
  type TicksByTrip,
} from './store';

const normalName = (name: string) => name.trim().toLocaleLowerCase('he');

/**
 * Old demo data kept the store as free text on each item (`store: string`).
 * Gives each such item the id of the store with that name, making the store
 * when it is missing (with the seed emoji for a seed name). Items that
 * already have `storeId` stay as they are.
 */
export function migrateLocalItems(
  raw: readonly unknown[],
  shops: readonly Shop[],
  newId: () => string = () => crypto.randomUUID(),
): { items: Item[]; shops: Shop[]; changed: boolean } {
  const out = [...shops];
  const seedEmoji = new Map([...seedShops(() => ''), ...seedShops(() => '', 'en')].map((s) => [s.name, s.emoji]));
  let changed = false;
  const items = raw.map((value) => {
    const r = value as Record<string, unknown>;
    if ('storeId' in r) return r as unknown as Item;
    changed = true;
    const { store, ...other } = r;
    const rest = other as Omit<Item, 'storeId'>;
    const name = typeof store === 'string' ? store.trim() : '';
    if (!name) return { ...rest, storeId: null };
    let shop = out.find((s) => normalName(s.name) === normalName(name));
    if (!shop) {
      shop = { id: newId(), name, emoji: seedEmoji.get(name) ?? '', sort: nextShopSort(out), active: true };
      out.push(shop);
    }
    return { ...rest, storeId: shop.id };
  });
  return { items, shops: out, changed };
}

/** Demo mode: everything lives in localStorage on this device. Same write rules as the server. */
export class LocalStore implements Store {
  readonly kind = 'local';
  /** Settings version seen by the last loadSettings, or null before the first load. */
  private settingsVersion: number | null = null;

  /** `lang` is read at the first seed (spec 011), after the user picked a language. */
  constructor(
    private readonly storage: Storage = localStorage,
    private readonly lang: () => Lang = () => 'he',
  ) {}

  /** Spec 011: a new demo home gets the trips of the chosen language. Old data keeps its settings. */
  private seedSettings() {
    if (this.storage.getItem(SETTINGS_KEY) !== null || this.storage.getItem(ITEMS_KEY) !== null) return;
    this.storage.setItem(SETTINGS_KEY, JSON.stringify(toStoredSettings(defaultSettings(this.lang()))));
  }

  /** Items and stores. Seeds both on first run and migrates old demo data. */
  private state(): { items: Item[]; shops: Shop[] } {
    this.seedSettings();
    const rawItems = readJson(this.storage, ITEMS_KEY);
    const rawShops = readJson(this.storage, STORES_KEY);
    const known = Array.isArray(rawShops) ? (rawShops as Shop[]) : null;
    if (!Array.isArray(rawItems)) {
      const lang = this.lang();
      const shops = known ?? seedShops(undefined, lang);
      const items = seedCatalog(shops, undefined, lang);
      this.writeShops(shops);
      this.write(items);
      // Spec 013: a new demo home has its role stores set.
      const settings = this.readSettings();
      if (!known && Object.keys(settings.roleStores).length === 0) {
        this.storage.setItem(SETTINGS_KEY, JSON.stringify(toStoredSettings({ ...settings, roleStores: seedRoleStores(shops, lang) })));
      }
      return { items, shops };
    }
    const migrated = migrateLocalItems(rawItems, known ?? []);
    const { shops } = migrated;
    // Spec 009: demo items from before `target` get it once.
    const settings = this.readSettings();
    const noTarget = migrated.items.some((i) => i.target === undefined || i.target === null);
    const items = noTarget ? migrated.items.map((i) => (i.target == null ? { ...i, target: defaultTarget(i, settings) } : i)) : migrated.items;
    if (migrated.changed || noTarget || !known) {
      this.writeShops(shops);
      this.write(items);
    }
    return { items, shops };
  }

  private read(): Item[] {
    return this.state().items;
  }

  private write(items: Item[]) {
    this.storage.setItem(ITEMS_KEY, JSON.stringify(items));
  }

  private writeShops(shops: Shop[]) {
    this.storage.setItem(STORES_KEY, JSON.stringify(shops));
  }

  /** Reads the list once, changes the given items, writes once. Throws if an id is unknown. */
  private change(ids: string[], update: (item: Item, index: number) => Item): Item[] {
    const items = this.read();
    const changed = ids.map((id, n) => {
      const index = items.findIndex((i) => i.id === id);
      if (index < 0) throw new Error(`item not found: ${id}`);
      items[index] = update(items[index]!, n);
      return items[index];
    });
    this.write(items);
    return changed;
  }

  async loadItems(): Promise<ItemsResult> {
    return { items: this.read(), fromCache: false };
  }

  /**
   * Same rule as the database: a new item, or an item moved to another store,
   * needs an active store. An item may keep a store that was archived later.
   */
  private checkStore(storeId: string | null, before: string | null | undefined) {
    if (storeId === null || storeId === before) return;
    if (!this.state().shops.some((s) => s.id === storeId && s.active)) throw new Error('store not active');
  }

  async addItem(item: Item): Promise<Item> {
    const items = this.read();
    if (items.some((i) => i.id === item.id)) throw new Error('item exists');
    this.checkStore(item.storeId, undefined);
    // Same item limits as the database.
    const limit = itemCountError(item, items);
    if (limit) throw new Error(limit);
    this.write([...items, item]);
    return item;
  }

  async updateItem(id: string, patch: ItemPatch): Promise<Item> {
    const items = this.read();
    return this.change([id], (item) => {
      const next = { ...item, ...patch };
      this.checkStore(next.storeId, item.storeId);
      const limit = itemCountError(next, items);
      if (limit) throw new Error(limit);
      return next;
    })[0]!;
  }

  async setItemsStore(ids: string[], storeId: string | null): Promise<Item[]> {
    if (ids.length === 0) return [];
    this.checkStore(storeId, undefined);
    return this.change(ids, (item) => ({ ...item, storeId }));
  }

  async adjustStock(id: string, delta: number): Promise<Item> {
    return this.change([id], (item) => applyStockDelta(item, delta))[0]!;
  }

  /** Same rule as the database: a tick or a finish needs a trip of the current settings. */
  private async requireTrip(trip: TripId) {
    if (!this.readSettings().trips.some((t) => t.id === trip)) throw new Error(`unknown trip: ${trip}`);
  }

  /** Like finish_household_trip: stock (or bought for one-time products), ticks, overrides and history. */
  async finishTrip(trip: TripId, lines: StockDelta[]): Promise<Item[]> {
    await this.requireTrip(trip);
    const { items: before, shops } = this.state();
    const done = this.change(
      lines.map((l) => l.itemId),
      (item, n) => afterFinish(item, lines[n]!.delta),
    );
    if (lines.length > 0) {
      const tripName = this.readSettings().trips.find((t) => t.id === trip)?.name ?? null;
      const purchase: Purchase = {
        id: crypto.randomUUID(),
        trip,
        tripName,
        finishedBy: null,
        finishedAt: new Date().toISOString(),
        lines: purchaseLines(lines, before, shops),
      };
      this.storage.setItem(HISTORY_KEY, JSON.stringify([purchase, ...this.readHistory()].slice(0, HISTORY_LIMIT)));
    }
    this.writeTicks({ ...this.readTicks(), [trip]: [] });
    const overrides = this.readOverrides();
    if (overrides[trip]) {
      delete overrides[trip];
      this.writeOverrides(overrides);
    }
    return done;
  }

  // Amount for this trip and history (spec 012) ------------------------------------

  private readOverrides(): OverridesByTrip {
    return parseOverrides(readJson(this.storage, OVERRIDES_KEY));
  }

  private writeOverrides(overrides: OverridesByTrip) {
    this.storage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
  }

  async loadOverrides(trip: TripId): Promise<Map<string, number>> {
    return new Map(Object.entries(this.readOverrides()[trip] ?? {}));
  }

  /** Same rules as set_trip_override: a trip of the settings, a known item, 1 to 99 packs. */
  async setOverride(trip: TripId, itemId: string, packs: number | null): Promise<void> {
    await this.requireTrip(trip);
    const all = this.readOverrides();
    const map = { ...all[trip] };
    if (packs === null) delete map[itemId];
    else {
      if (!Number.isInteger(packs) || packs < OVERRIDE_LIMITS.min || packs > OVERRIDE_LIMITS.max) throw new Error('invalid packs');
      if (!this.read().some((i) => i.id === itemId)) throw new Error(`item not found: ${itemId}`);
      map[itemId] = packs;
    }
    this.writeOverrides({ ...all, [trip]: map });
  }

  subscribeOverrides(trip: TripId, onChange: (overrides: Map<string, number>) => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === OVERRIDES_KEY || e.key === null) void this.loadOverrides(trip).then(onChange);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  private readHistory(): Purchase[] {
    const raw = readJson(this.storage, HISTORY_KEY);
    return Array.isArray(raw) ? (raw as Purchase[]).filter((p) => p && typeof p.id === 'string' && Array.isArray(p.lines)) : [];
  }

  async loadHistory(): Promise<Purchase[]> {
    return sortPurchases(this.readHistory()).slice(0, HISTORY_LIMIT);
  }

  private readTicks(): TicksByTrip {
    return parseTicks(readJson(this.storage, TICKS_KEY));
  }

  private writeTicks(ticks: TicksByTrip) {
    this.storage.setItem(TICKS_KEY, JSON.stringify(ticks));
  }

  async loadTicks(trip: TripId): Promise<Set<string>> {
    return new Set(this.readTicks()[trip] ?? []);
  }

  async setTick(trip: TripId, itemId: string, ticked: boolean): Promise<void> {
    const all = this.readTicks();
    await this.requireTrip(trip);
    const ids = new Set(all[trip]);
    if (ticked) ids.add(itemId);
    else ids.delete(itemId);
    this.writeTicks({ ...all, [trip]: [...ids] });
  }

  // Demo mode writes to this device only, so there is no tick queue.
  pendingTicks(): number {
    return 0;
  }

  unsentTicks(): number {
    return 0;
  }

  async flushTicks(): Promise<void> {}

  subscribeTickQueue(): () => void {
    return () => undefined;
  }

  // Stores ------------------------------------------------------------------

  async loadShops(): Promise<Shop[]> {
    return sortShops(this.state().shops);
  }

  /** Same rules as the database: unique name, length limits. */
  private checkShop(shop: Shop, all: Shop[]) {
    const errors = validateShop(shop, all);
    if (Object.keys(errors).length) throw new Error(Object.values(errors).join(', '));
  }

  async addShop(shop: Shop): Promise<Shop> {
    const { shops } = this.state();
    if (shops.some((s) => s.id === shop.id)) throw new Error('store exists');
    const saved = { ...shop, name: shop.name.trim() };
    this.checkShop(saved, shops);
    this.writeShops([...shops, saved]);
    return saved;
  }

  async updateShop(id: string, patch: ShopPatch): Promise<Shop> {
    const { shops } = this.state();
    const index = shops.findIndex((s) => s.id === id);
    if (index < 0) throw new Error(`store not found: ${id}`);
    const saved = { ...shops[index]!, ...patch, ...(patch.name === undefined ? {} : { name: patch.name.trim() }) };
    this.checkShop(saved, shops);
    shops[index] = saved;
    this.writeShops(shops);
    return saved;
  }

  async reorderShops(ids: string[]): Promise<Shop[]> {
    const { shops } = this.state();
    if (new Set(ids).size !== ids.length || ids.some((id) => !shops.some((s) => s.id === id))) throw new Error('invalid store order');
    const next = reorderShops(shops, ids);
    this.writeShops(next);
    return next;
  }

  async archiveShop(id: string, moveTo: string | null): Promise<ArchiveResult> {
    const { items, shops } = this.state();
    const shop = shops.find((s) => s.id === id);
    if (!shop) throw new Error(`store not found: ${id}`);
    if (moveTo !== null && (moveTo === id || !shops.some((s) => s.id === moveTo && s.active))) throw new Error('invalid target store');
    const moved: Item[] = [];
    const nextItems = items.map((i) => {
      if (i.storeId !== id) return i;
      const m = { ...i, storeId: moveTo };
      moved.push(m);
      return m;
    });
    const archived = { ...shop, active: false };
    this.write(nextItems);
    this.writeShops(shops.map((s) => (s.id === id ? archived : s)));
    return { shop: archived, items: moved };
  }

  subscribeShops(onChange: (shops: Shop[]) => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORES_KEY) void this.loadShops().then(onChange);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  // Settings ------------------------------------------------------------------

  private readSettings(): Settings {
    this.seedSettings();
    return normalizeSettings(readJson(this.storage, SETTINGS_KEY));
  }

  private readVersion(): number {
    const n = Number(this.storage.getItem(SETTINGS_VERSION_KEY));
    return Number.isInteger(n) && n >= 0 ? n : 0;
  }

  async loadSettings(): Promise<Settings> {
    this.settingsVersion = this.readVersion();
    return this.readSettings();
  }

  /** Like the database: a stale save is refused, and ticks of a removed trip are deleted. */
  async saveSettings(settings: Settings): Promise<void> {
    const stored = this.readVersion();
    if (this.settingsVersion !== null && this.settingsVersion !== stored) throw new SettingsConflictError();
    this.storage.setItem(SETTINGS_KEY, JSON.stringify(toStoredSettings(settings)));
    // The version is written last: other tabs reload on its storage event.
    this.settingsVersion = stored + 1;
    this.storage.setItem(SETTINGS_VERSION_KEY, String(this.settingsVersion));
    const ticks = this.readTicks();
    const kept: TicksByTrip = {};
    for (const t of settings.trips) {
      const ids = ticks[t.id];
      if (ids) kept[t.id] = ids;
    }
    if (Object.keys(kept).length !== Object.keys(ticks).length) this.writeTicks(kept);
    // Overrides of a removed trip go too (spec 012).
    const overrides = this.readOverrides();
    const keptOverrides: OverridesByTrip = {};
    for (const t of settings.trips) if (overrides[t.id]) keptOverrides[t.id] = overrides[t.id]!;
    if (Object.keys(keptOverrides).length !== Object.keys(overrides).length) this.writeOverrides(keptOverrides);
  }

  /** Another tab saved settings: its version write fires the `storage` event here. */
  subscribeSettings(onChange: (settings: Settings) => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_VERSION_KEY || e.key === null) void this.loadSettings().then(onChange);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  subscribe(onChange: (items: Item[]) => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ITEMS_KEY) onChange(this.read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }

  /** Other tabs write ticks to the same storage; the `storage` event tells this tab. */
  subscribeTicks(trip: TripId, onChange: (ticks: Set<string>) => void): () => void {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TICKS_KEY || e.key === null) onChange(new Set(this.readTicks()[trip] ?? []));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }
}
