import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStore, migrateLocalItems } from './localStore';
import { ITEMS_KEY, STORES_KEY, SettingsConflictError, TICKS_KEY, clearAppKeys, parseOverrides, parseTicks } from './store';
import { MemoryStorage } from './testStorage';
import { TICK_QUEUE_KEY } from './tickQueue';

describe('LocalStore', () => {
  it('seeds once on first run and keeps saved changes', async () => {
    const storage = new MemoryStorage();
    const store = new LocalStore(storage);
    const { items } = await store.loadItems();
    expect(items.length).toBeGreaterThan(20);

    const first = items[0]!;
    await store.updateItem(first.id, { stock: 7 });
    const again = await new LocalStore(storage).loadItems();
    expect(again.items).toHaveLength(items.length);
    expect(again.items.find((i) => i.id === first.id)?.stock).toBe(7);
  });

  it('seeds in the language picked on first run, and never changes old data (spec 011)', async () => {
    const storage = new MemoryStorage();
    let lang: 'he' | 'en' = 'en';
    const store = new LocalStore(storage, () => lang);
    const { items } = await store.loadItems();
    expect(items.find((i) => i.name === 'Rice')).toBeTruthy();
    expect((await store.loadShops())[0]!.name).toBe('Grocery');
    expect((await store.loadSettings()).trips.map((t) => t.name)).toEqual(['Big shop', 'Weekend', 'Bakery']);

    lang = 'he';
    const again = new LocalStore(storage, () => lang);
    expect((await again.loadItems()).items.map((i) => i.name)).toEqual(items.map((i) => i.name));
    expect((await again.loadSettings()).trips[0]!.name).toBe('Big shop');

    // Old demo data without saved settings keeps the Hebrew defaults.
    const old = new MemoryStorage();
    old.setItem(ITEMS_KEY, '[]');
    expect((await new LocalStore(old, () => 'en').loadSettings()).trips[0]!.name).toBe('קנייה גדולה');
  });

  it('updates only the patched fields, so two edits of different fields both stay', async () => {
    const storage = new MemoryStorage();
    const [a] = (await new LocalStore(storage).loadItems()).items;
    const phone1 = new LocalStore(storage);
    const phone2 = new LocalStore(storage);
    const other = (await phone1.loadShops()).find((x) => x.id !== a!.storeId)!.id;
    await phone1.updateItem(a!.id, { storeId: other });
    const after = await phone2.updateItem(a!.id, { price: 99 });
    expect(after).toMatchObject({ storeId: other, price: 99, name: a!.name });
  });

  it('adjusts stock relative to the stored value, never below 0', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a] = (await store.loadItems()).items;
    await store.updateItem(a!.id, { stock: 2, ranOut: true });
    await store.adjustStock(a!.id, 1);
    expect(await store.adjustStock(a!.id, 1)).toMatchObject({ stock: 4, ranOut: false });
    expect((await store.adjustStock(a!.id, -10)).stock).toBe(0);
  });

  it('finishes a trip by adding units and clearing ranOut, all or nothing', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a, b] = (await store.loadItems()).items;
    await store.updateItem(a!.id, { stock: 1, ranOut: true });
    const done = await store.finishTrip('main', [
      { itemId: a!.id, delta: 5 },
      { itemId: b!.id, delta: 0 },
    ]);
    expect(done.map((i) => [i.stock, i.ranOut])).toEqual([
      [6, false],
      [0, false],
    ]);
    await expect(store.finishTrip('main', [{ itemId: a!.id, delta: 1 }, { itemId: 'missing', delta: 1 }])).rejects.toThrow();
    expect((await store.loadItems()).items.find((i) => i.id === a!.id)?.stock).toBe(6);
  });
});

describe('LocalStore stores', () => {
  it('seeds the default stores and points seed items to them', async () => {
    const store = new LocalStore(new MemoryStorage());
    const shops = await store.loadShops();
    const { items } = await store.loadItems();
    expect(shops.map((s) => s.sort)).toEqual([0, 1, 2, 3]);
    expect(items.every((i) => shops.some((s) => s.id === i.storeId))).toBe(true);
    // Spec 013: the role stores are set on the first run.
    const roles = (await store.loadSettings()).roleStores;
    expect(Object.values(roles).sort()).toEqual(shops.map((s) => s.id).sort());
  });

  it('adds, renames, reorders and refuses a taken name', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [first, second] = await store.loadShops();
    const added = await store.addShop({ id: 'n', name: ' חדשה ', emoji: '🧀', sort: 6, active: true });
    expect(added.name).toBe('חדשה');
    await expect(store.addShop({ id: 'm', name: first!.name, emoji: '', sort: 7, active: true })).rejects.toThrow();
    await expect(store.updateShop('n', { name: second!.name })).rejects.toThrow();
    expect((await store.updateShop('n', { name: 'גבינות' })).name).toBe('גבינות');
    const order = await store.reorderShops(['n', second!.id]);
    expect(order.slice(0, 3).map((s) => s.id)).toEqual(['n', second!.id, first!.id]);
    await expect(store.reorderShops(['n', 'n'])).rejects.toThrow();
  });

  it('archives a store and moves its items in one step', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [from, to] = await store.loadShops();
    const before = (await store.loadItems()).items.filter((i) => i.storeId === from!.id);
    await expect(store.archiveShop(from!.id, from!.id)).rejects.toThrow();
    const { shop, items } = await store.archiveShop(from!.id, to!.id);
    expect(shop.active).toBe(false);
    expect(items.map((i) => i.id)).toEqual(before.map((i) => i.id));
    expect((await store.loadItems()).items.filter((i) => i.storeId === from!.id)).toEqual([]);
    await expect(store.archiveShop(to!.id, from!.id)).rejects.toThrow();
    expect((await store.updateShop(from!.id, { active: true })).active).toBe(true);
  });

  it('migrates old demo items with a free-text store', async () => {
    const storage = new MemoryStorage();
    const old = (name: string, store: string) => ({ id: name, name, store, category: '', cadence: 'bulk', weeklyUse: 1, unit: '', packSize: 1, price: null, stock: 0, ranOut: false, active: true });
    storage.setItem(ITEMS_KEY, JSON.stringify([old('a', 'ירקן'), old('b', ' ירקן '), old('c', 'פינתי'), old('d', '')]));
    const store = new LocalStore(storage);
    const shops = await store.loadShops();
    expect(shops.map((s) => [s.name, s.emoji, s.sort])).toEqual([
      ['ירקן', '🥕', 0],
      ['פינתי', '', 1],
    ]);
    const { items } = await store.loadItems();
    expect(items.map((i) => i.storeId)).toEqual([shops[0]!.id, shops[0]!.id, shops[1]!.id, null]);
    expect(items.some((i) => 'store' in i)).toBe(false);
    expect(JSON.parse(storage.getItem(STORES_KEY)!)).toHaveLength(2);
    expect(migrateLocalItems(items, shops).changed).toBe(false);
  });
});

describe('LocalStore ticks', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ticks and unticks per trip, twice is the same as once', async () => {
    const store = new LocalStore(new MemoryStorage());
    expect(await store.loadTicks('main')).toEqual(new Set());
    await store.setTick('main', 'a', true);
    await store.setTick('main', 'a', true);
    await store.setTick('main', 'b', true);
    await store.setTick('shabbat', 'a', true);
    await store.setTick('main', 'b', false);
    await store.setTick('main', 'c', false);
    expect(await store.loadTicks('main')).toEqual(new Set(['a']));
    expect(await store.loadTicks('shabbat')).toEqual(new Set(['a']));
    expect(await store.loadTicks('friday')).toEqual(new Set());
  });

  it('keeps ticks in storage, so another tab or a reload sees them', async () => {
    const storage = new MemoryStorage();
    await new LocalStore(storage).setTick('friday', 'x', true);
    expect(await new LocalStore(storage).loadTicks('friday')).toEqual(new Set(['x']));
  });

  it('finishing a trip clears only that trip, and a failed finish clears nothing', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a] = (await store.loadItems()).items;
    await store.setTick('main', a!.id, true);
    await store.setTick('shabbat', a!.id, true);
    await expect(store.finishTrip('main', [{ itemId: 'missing', delta: 1 }])).rejects.toThrow();
    expect(await store.loadTicks('main')).toEqual(new Set([a!.id]));
    await store.finishTrip('main', [{ itemId: a!.id, delta: 1 }]);
    expect(await store.loadTicks('main')).toEqual(new Set());
    expect(await store.loadTicks('shabbat')).toEqual(new Set([a!.id]));
  });

  it('calls back with the trip ticks when another tab changes them', async () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    const storage = new MemoryStorage();
    const store = new LocalStore(storage);
    const seen: Set<string>[] = [];
    const stop = store.subscribeTicks('main', (ticks) => seen.push(ticks));
    const fire = (key: string | null) => target.dispatchEvent(Object.assign(new Event('storage'), { key }));

    // Another tab writes to the shared storage, then the browser fires the event here.
    await new LocalStore(storage).setTick('main', 'a', true);
    fire(TICKS_KEY);
    fire('household-shop.items');
    expect(seen).toEqual([new Set(['a'])]);

    stop();
    fire(TICKS_KEY);
    expect(seen).toHaveLength(1);
  });

  it('reads broken or old stored ticks safely', () => {
    expect(parseTicks(null)).toEqual({});
    expect(parseTicks({ main: ['a', 1], 'Bad Trip': ['b'], friday: 'c' })).toEqual({ main: ['a'] });
  });

  it('rejects a tick on an unknown trip and drops the ticks of a removed trip', async () => {
    const store = new LocalStore(new MemoryStorage());
    await expect(store.setTick('gone', 'a', true)).rejects.toThrow();
    await store.setTick('main', 'a', true);
    await store.setTick('friday', 'b', true);
    const settings = await store.loadSettings();
    await store.saveSettings({ ...settings, trips: settings.trips.filter((t) => t.id !== 'friday') });
    expect(await store.loadTicks('main')).toEqual(new Set(['a']));
    expect(await store.loadTicks('friday')).toEqual(new Set());
    await expect(store.finishTrip('friday', [])).rejects.toThrow();
  });
});

describe('LocalStore amount for this trip, one-time products and history (spec 012)', () => {
  it('keeps overrides per trip, removes them, and checks the rules', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a] = (await store.loadItems()).items;
    await store.setOverride('main', a!.id, 4);
    expect(await store.loadOverrides('main')).toEqual(new Map([[a!.id, 4]]));
    expect(await store.loadOverrides('shabbat')).toEqual(new Map());
    await store.setOverride('main', a!.id, null);
    expect(await store.loadOverrides('main')).toEqual(new Map());
    await expect(store.setOverride('main', a!.id, 0)).rejects.toThrow();
    await expect(store.setOverride('main', a!.id, 100)).rejects.toThrow();
    await expect(store.setOverride('main', 'missing', 2)).rejects.toThrow();
    await expect(store.setOverride('gone', a!.id, 2)).rejects.toThrow();
  });

  it('finishing clears the trip overrides and writes the history, newest first', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a, b] = (await store.loadItems()).items;
    await store.setOverride('main', a!.id, 3);
    await store.setOverride('shabbat', a!.id, 2);
    await store.finishTrip('main', [{ itemId: a!.id, delta: 3 * a!.packSize, packs: 3 }]);
    expect(await store.loadOverrides('main')).toEqual(new Map());
    expect(await store.loadOverrides('shabbat')).toEqual(new Map([[a!.id, 2]]));
    await store.finishTrip('shabbat', [{ itemId: b!.id, delta: b!.packSize }]);
    const history = await store.loadHistory();
    expect(history.map((p) => p.trip)).toEqual(['shabbat', 'main']);
    expect(history[1]).toMatchObject({ tripName: expect.any(String), finishedBy: null });
    expect(history[1]!.lines).toEqual([expect.objectContaining({ itemId: a!.id, name: a!.name, packs: 3, price: a!.price })]);
    expect(history[0]!.lines[0]!.packs).toBe(1);
  });

  it('finishing with no lines writes no history but clears overrides', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a] = (await store.loadItems()).items;
    await store.setOverride('main', a!.id, 3);
    await store.finishTrip('main', []);
    expect(await store.loadHistory()).toEqual([]);
    expect(await store.loadOverrides('main')).toEqual(new Map());
  });

  it('marks a ticked one-time product bought: inactive, stock unchanged', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a] = (await store.loadItems()).items;
    await store.updateItem(a!.id, { onceTrip: 'main', trips: ['main'], stock: 0 });
    const [done] = await store.finishTrip('main', [{ itemId: a!.id, delta: a!.packSize, packs: 1 }]);
    expect(done).toMatchObject({ active: false, stock: 0, onceTrip: 'main' });
  });

  it('drops the overrides of a removed trip', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a] = (await store.loadItems()).items;
    await store.setOverride('friday', a!.id, 2);
    await store.setOverride('main', a!.id, 2);
    const settings = await store.loadSettings();
    await store.saveSettings({ ...settings, trips: settings.trips.filter((t) => t.id !== 'friday') });
    expect(await store.loadOverrides('friday')).toEqual(new Map());
    expect(await store.loadOverrides('main')).toEqual(new Map([[a!.id, 2]]));
  });

  it('reads broken stored overrides safely', () => {
    expect(parseOverrides({ main: { a: 2, b: 0, c: 1.5, d: '3' }, 'Bad Trip': { e: 1 }, friday: [1] })).toEqual({ main: { a: 2 } });
  });
});

describe('LocalStore setItemsStore (spec 013)', () => {
  it('moves the given items to an active store in one write, and refuses an archived one', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a, b, c] = (await store.loadItems()).items;
    const [s0, s1] = await store.loadShops();
    const moved = await store.setItemsStore([a!.id, b!.id], s1!.id);
    expect(moved.map((i) => i.storeId)).toEqual([s1!.id, s1!.id]);
    expect((await store.loadItems()).items.find((i) => i.id === c!.id)?.storeId).toBe(c!.storeId);
    await store.archiveShop(s0!.id, null);
    await expect(store.setItemsStore([a!.id], s0!.id)).rejects.toThrow();
    expect(await store.setItemsStore([], s0!.id)).toEqual([]);
  });
});

describe('clearAppKeys', () => {
  it('removes every household-shop.* key but the language, and nothing else', () => {
    const storage = new MemoryStorage();
    for (const key of ['household-shop.ticks', TICK_QUEUE_KEY, 'household-shop.cache.items.x', 'household-shop.active-household', 'household-shop.lang', 'other']) storage.setItem(key, '1');
    clearAppKeys(storage);
    expect(storage.length).toBe(2);
    expect(storage.getItem('other')).toBe('1');
    expect(storage.getItem('household-shop.lang')).toBe('1');
  });
});

describe('LocalStore settings version', () => {
  it('refuses a save from a tab that has not seen the newer settings', async () => {
    const storage = new MemoryStorage();
    const tab1 = new LocalStore(storage);
    const tab2 = new LocalStore(storage);
    const s1 = await tab1.loadSettings();
    const s2 = await tab2.loadSettings();
    await tab1.saveSettings({ ...s1, margin: 0.2 });
    await expect(tab2.saveSettings({ ...s2, margin: 0.3 })).rejects.toBeInstanceOf(SettingsConflictError);
    // A tick reads the trips but must not count as seeing the new settings.
    await tab2.setTick('main', 'x', true);
    await expect(tab2.saveSettings({ ...s2, margin: 0.3 })).rejects.toBeInstanceOf(SettingsConflictError);
    const fresh = await tab2.loadSettings();
    expect(fresh.margin).toBe(0.2);
    await tab2.saveSettings({ ...fresh, margin: 0.3 });
    expect((await tab1.loadSettings()).margin).toBe(0.3);
  });
});

describe('LocalStore active store rule', () => {
  it('needs an active store for a new or moved item, and keeps an archived one', async () => {
    const store = new LocalStore(new MemoryStorage());
    const [a] = (await store.loadItems()).items;
    const shops = await store.loadShops();
    const other = shops.find((s) => s.id !== a!.storeId)!;
    await store.archiveShop(other.id, null);
    const item = { ...a!, id: 'new', name: 'פריט חדש' };
    await expect(store.addItem({ ...item, storeId: other.id })).rejects.toThrow('store not active');
    await expect(store.addItem({ ...item, storeId: 'missing' })).rejects.toThrow('store not active');
    await expect(store.updateItem(a!.id, { storeId: other.id })).rejects.toThrow('store not active');
    expect((await store.addItem({ ...item, storeId: null })).storeId).toBeNull();

    // An item keeps its store after that store is archived, and other edits still work.
    const storage = new MemoryStorage();
    const old = new LocalStore(storage);
    const [b] = (await old.loadItems()).items;
    storage.setItem(STORES_KEY, JSON.stringify((await old.loadShops()).map((x) => ({ ...x, active: x.id !== b!.storeId }))));
    expect(await old.updateItem(b!.id, { price: 5 })).toMatchObject({ storeId: b!.storeId, price: 5 });
  });
});
