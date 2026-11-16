import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Store } from '../data';
import { SupabaseStore } from '../data';
import { SettingsConflictError } from '../data/store';
import { makeSuggest } from '../data/ai';
import { itemPatch, markRanOut } from '../domain/catalog';
import { ROLES, itemsForRoleChange, roleTargets, type Role } from '../domain/categories';
import type { Settings, TripId } from '../domain/schedule';
import type { Item, ItemPatch, Shop, ShopPatch, StockDelta } from '../domain/types';
import { AuthGate } from './AuthGate';
import { CatalogView, blankItem } from './CatalogView';
import { AlertIcon, BasketIcon, CloseIcon, GearIcon, GridIcon, SpinnerIcon, WifiIcon, WifiOffIcon } from './icons';
import { getLang, langChosen, useLang, t } from './i18n';
import { LanguageScreen } from './LanguageScreen';
import { writeErrorNotice } from './labels';
import { Layout, type Frame, type FrameProps } from './parts';
import { SettingsView, type Account } from './SettingsView';
import { HomeView } from './HomeView';
import { ItemForm } from './ItemForm';
import { ShopView } from './ShopView';
import { SimpleHome } from './SimpleHome';
import { useSimple } from './simple';
import { categoryNames, roleStoreFor } from '../domain/categories';

// Spec 009: home, products and settings. Shop mode is a full screen opened from home.
type Tab = 'home' | 'catalog' | 'settings';

const TABS: [Tab, () => string, () => JSX.Element][] = [
  ['home', () => t('tabHome'), () => <BasketIcon size={24} />],
  ['catalog', () => t('tabProducts'), () => <GridIcon size={24} />],
  ['settings', () => t('tabSettings'), () => <GearIcon size={24} />],
];

export function App({ store }: { store: Store }) {
  // Spec 010: a language change redraws the whole app.
  useLang();
  // Spec 011: a new device picks a language before sign-in or demo mode.
  if (!langChosen()) return <LanguageScreen />;
  if (store instanceof SupabaseStore) {
    return (
      <AuthGate store={store}>
        {(account) => <Shell key={account.householdId} store={store} account={account} />}
      </AuthGate>
    );
  }
  return <Shell store={store} />;
}

/** Store writes the screens use. Each resolves to false when it failed (the banner shows). */
export interface ShopActions {
  add: (shop: Shop) => Promise<boolean>;
  update: (id: string, patch: ShopPatch) => Promise<boolean>;
  reorder: (ids: string[]) => Promise<boolean>;
  /** moveTo: another store, null for no store, or BY_ROLE: each product to its default store (2026-11-15). */
  archive: (id: string, moveTo: string | null) => Promise<boolean>;
}

/** Archive target: every product goes to the default store of its category. Store ids are UUIDs, so this never clashes. */
export const BY_ROLE = 'by-role';

interface BannerText {
  title: string;
  body: string;
}

/** Sync status in the header: name of the household and one short state. */
export interface SyncStatus {
  name: string;
  state: string;
  warn: boolean;
}

function Shell({ store, account }: { store: Store; account?: Account }) {
  const [tab, setTab] = useState<Tab>('home');
  // Spec 013: simple list on this device.
  const simple = useSimple();
  // Shop mode on this store ('all', a store id, or '' for no store), or null (spec 014).
  const [shopping, setShopping] = useState<string | null>(null);
  // New item form opened from home or shop mode, with the typed name.
  const [newItem, setNewItem] = useState<{ name: string; forTrip: boolean } | null>(null);
  // Product opened for editing from a home list row.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Items marked used or gone in this session, newest first, with what to put back on undo.
  const [marked, setMarked] = useState<{ id: string; stock: number; ranOut: boolean }[]>([]);
  const [items, setItems] = useState<Item[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [shops, setShops] = useState<Shop[]>([]);
  const [fromCache, setFromCache] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [error, setError] = useState<BannerText | null>(null);
  const [offlineClosed, setOfflineClosed] = useState(false);
  const [backOnline, setBackOnline] = useState(false);
  const [queued, setQueued] = useState(0);
  const settingsRef = useRef<Settings | null>(null);
  settingsRef.current = settings;

  const reload = useCallback(async () => {
    const [result, s, list] = await Promise.all([store.loadItems(), store.loadSettings(), store.loadShops()]);
    setItems(result.items);
    setShops(list);
    setFromCache(result.fromCache);
    setSettings(s);
  }, [store]);

  const countQueue = useCallback(() => {
    const trips = settingsRef.current?.trips ?? [];
    setQueued(trips.reduce((n, t) => n + store.pendingTicks(t.id), 0));
  }, [store]);

  useEffect(countQueue, [countQueue, settings]);

  useEffect(() => {
    void reload();
    const unsubscribe = store.subscribe((next) => {
      setItems(next);
      setFromCache(false);
    });
    const unsubscribeShops = store.subscribeShops(setShops);
    const unsubscribeSettings = store.subscribeSettings(setSettings);
    // Offline ticks: send the queue when the network or the app comes back.
    const unsubscribeQueue = store.subscribeTickQueue({
      onChange: countQueue,
      onReject: () => setError({ title: t('tickNotSavedTitle'), body: t('tickNotSavedBody') }),
    });
    const goOnline = () => {
      setOnline(true);
      setOfflineClosed(false);
      if (store.kind === 'supabase') setBackOnline(true);
      void store.flushTicks();
      void reload();
    };
    const goOffline = () => {
      setOnline(false);
      setBackOnline(false);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void store.flushTicks();
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    document.addEventListener('visibilitychange', onVisible);
    void store.flushTicks();
    return () => {
      unsubscribe();
      unsubscribeShops();
      unsubscribeSettings();
      unsubscribeQueue();
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [store, reload, countQueue]);

  // The "back online" note goes away by itself.
  useEffect(() => {
    if (!backOnline) return;
    const t = window.setTimeout(() => setBackOnline(false), 4000);
    return () => window.clearTimeout(t);
  }, [backOnline]);

  const failed = useCallback((cause?: unknown) => setError(writeErrorNotice(cause, navigator.onLine)), []);

  /** Runs a write, then puts the stored items it returns into the list. The error stays until a write works or the user closes it. */
  const write = useCallback(
    async (run: () => Promise<Item | Item[]>) => {
      try {
        const result = await run();
        const changed = Array.isArray(result) ? result : [result];
        const byId = new Map(changed.map((i) => [i.id, i]));
        setItems((prev) => {
          const list = prev ?? [];
          const known = new Set(list.map((i) => i.id));
          return [...list.map((i) => byId.get(i.id) ?? i), ...changed.filter((i) => !known.has(i.id))];
        });
        setError(null);
        return true;
      } catch (cause) {
        failed(cause);
        return false;
      }
    },
    [failed],
  );

  const addItem = useCallback((item: Item) => write(() => store.addItem(item)), [store, write]);
  const updateItem = useCallback(
    (id: string, patch: ItemPatch) => (Object.keys(patch).length === 0 ? Promise.resolve(true) : write(() => store.updateItem(id, patch))),
    [store, write],
  );
  const adjustStock = useCallback((id: string, delta: number) => write(() => store.adjustStock(id, delta)), [store, write]);
  const remember = (item: Item) => setMarked((prev) => [{ id: item.id, stock: item.stock, ranOut: item.ranOut }, ...prev.filter((m) => m.id !== item.id)]);
  const allGone = async (item: Item) => {
    const ok = await updateItem(item.id, itemPatch(item, markRanOut(item)));
    if (ok) remember(item);
    return ok;
  };
  // Using what is left counts as "all gone", so it goes on the next trip.
  const usePacks = async (item: Item, packs: number) => {
    if (packs * item.packSize >= item.stock - 1e-9) return allGone(item);
    const ok = await adjustStock(item.id, -packs * item.packSize);
    if (ok) remember(item);
    return ok;
  };
  // Home "מה נגמר?" (2026-11-12): on the list now, stock as it is. Undo puts ranOut back.
  const addToList = async (item: Item) => {
    const ok = await updateItem(item.id, { ranOut: true });
    if (ok) remember(item);
    return ok;
  };
  const undoMark = async (item: Item) => {
    const before = marked.find((m) => m.id === item.id);
    if (!before) return true;
    const ok = await updateItem(item.id, itemPatch(item, { ...item, stock: before.stock, ranOut: before.ranOut }));
    if (ok) setMarked((prev) => prev.filter((m) => m.id !== item.id));
    return ok;
  };
  const finishTrip = useCallback((trip: TripId, lines: StockDelta[]) => write(() => store.finishTrip(trip, lines)), [store, write]);
  const loadHistory = useCallback(() => store.loadHistory(), [store]);
  const setOverride = useCallback(
    async (trip: TripId, id: string, packs: number | null) => {
      try {
        await store.setOverride(trip, id, packs);
        setError(null);
        return true;
      } catch (cause) {
        failed(cause);
        return false;
      }
    },
    [store, failed],
  );
  const setTick = useCallback(
    async (trip: TripId, id: string, ticked: boolean) => {
      try {
        await store.setTick(trip, id, ticked);
        setError(null);
        return true;
      } catch (cause) {
        failed(cause);
        return false;
      }
    },
    [store, failed],
  );

  const saveSettings = useCallback(
    async (next: Settings) => {
      try {
        await store.saveSettings(next);
        setSettings(next);
        setError(null);
        return true;
      } catch (cause) {
        if (!(cause instanceof SettingsConflictError)) {
          setError({ title: t('settingsFailedTitle'), body: t('tryAgainSoon') });
          return false;
        }
        // Someone saved first: show their settings, then the user can try again.
        setSettings(await store.loadSettings());
        setError({ title: t('settingsConflictTitle'), body: t('settingsConflictBody') });
        return false;
      }
    },
    [store],
  );

  /** Spec 013: saves the role store, then moves the products of that role with no store or the old one. */
  const setRoleStore = async (role: Role, storeId: string | null) => {
    if (!settings || !items) return false;
    const old = settings.roleStores[role] ?? null;
    const moving = itemsForRoleChange(items, role, old, storeId);
    if (!(await saveSettings({ ...settings, roleStores: { ...settings.roleStores, [role]: storeId } }))) return false;
    return moving.length === 0 ? true : write(() => store.setItemsStore(moving.map((i) => i.id), storeId));
  };

  const shopWrite = useCallback(
    async (run: () => Promise<void>) => {
      try {
        await run();
        setError(null);
        return true;
      } catch (cause) {
        failed(cause);
        return false;
      }
    },
    [failed],
  );

  const replaceShop = (shop: Shop) => setShops((prev) => (prev.some((s) => s.id === shop.id) ? prev.map((s) => (s.id === shop.id ? shop : s)) : [...prev, shop]));

  const shopActions: ShopActions = {
    add: (shop) => shopWrite(async () => replaceShop(await store.addShop(shop))),
    update: (id, patch) => shopWrite(async () => replaceShop(await store.updateShop(id, patch))),
    reorder: async (ids) => {
      // Shown at once; the stored order comes back from the store, or a reload on failure.
      setShops((prev) => ids.flatMap((id) => prev.filter((s) => s.id === id)).map((s, sort) => ({ ...s, sort })).concat(prev.filter((s) => !ids.includes(s.id))));
      const ok = await shopWrite(async () => setShops(await store.reorderShops(ids)));
      if (!ok) void store.loadShops().then(setShops, () => undefined);
      return ok;
    },
    archive: (id, moveTo) =>
      shopWrite(async () => {
        if (moveTo === BY_ROLE) {
          // Move per default store first, then archive the empty store. Not one transaction: a failure leaves the store active with fewer items.
          const activeIds = new Set(shops.filter((s) => s.active).map((s) => s.id));
          for (const [to, ids] of roleTargets(items ?? [], id, settings?.roleStores ?? {}, activeIds)) {
            const moved = await store.setItemsStore(ids, to);
            const byId = new Map(moved.map((i) => [i.id, i]));
            setItems((prev) => (prev ?? []).map((i) => byId.get(i.id) ?? i));
          }
          moveTo = null;
        }
        const result = await store.archiveShop(id, moveTo);
        replaceShop(result.shop);
        const byId = new Map(result.items.map((i) => [i.id, i]));
        setItems((prev) => (prev ?? []).map((i) => byId.get(i.id) ?? i));
        // A role whose default store was archived gets no default store, so new products do not go to a closed store.
        if (settings && ROLES.some((r) => settings.roleStores[r] === id)) {
          const roleStores = Object.fromEntries(Object.entries(settings.roleStores).map(([r, s]) => [r, s === id ? null : s]));
          await saveSettings({ ...settings, roleStores });
        }
      }),
  };

  // The local demo store works offline, so only the shared store needs the network.
  const needsNetwork = store.kind === 'supabase';
  // AI help needs a signed-in user, so it is off in demo mode.
  const suggest = useMemo(() => (store instanceof SupabaseStore ? makeSuggest(() => store.accessToken()) : undefined), [store]);
  const offline = fromCache || (needsNetwork && !online);
  const status: SyncStatus = !needsNetwork
    ? { name: t('demoMode'), state: t('savedOnDevice'), warn: false }
    : { name: account?.householdName ?? '', state: offline ? t('offlineState') : queued > 0 ? t('waitingToSend') : t('synced'), warn: offline || queued > 0 };

  const banners = (
    <>
      {offline && !offlineClosed && (
        <div class="banner offline" role="status">
          <span class="lead">
            <WifiOffIcon size={24} />
          </span>
          <p class="msg">
            <strong>{t('offlineTitle')}</strong>
            <span>{t('offlineBody')}</span>
          </p>
          <button type="button" class="icon-btn" aria-label={t('closeNotice')} onClick={() => setOfflineClosed(true)}>
            <CloseIcon />
          </button>
        </div>
      )}
      {error && (
        <div class="banner error" role="alert">
          <span class="lead">
            <AlertIcon size={24} />
          </span>
          <p class="msg">
            <strong>{error.title}</strong>
            <span>{error.body}</span>
          </p>
          <button type="button" class="icon-btn" aria-label={t('closeNotice')} onClick={() => setError(null)}>
            <CloseIcon />
          </button>
        </div>
      )}
      <div role="status" class={backOnline && !offline ? '' : 'visually-hidden'}>
        {backOnline && !offline && (
          <div class="banner online">
            <span class="lead">
              <WifiIcon size={24} />
            </span>
            <p class="msg">
              <strong>{t('backOnlineTitle')}</strong>
              <span>{queued > 0 ? t('sendingTicks') : t('allTicksSent')}</span>
            </p>
            <button type="button" class="icon-btn" aria-label={t('closeNotice')} onClick={() => setBackOnline(false)}>
              <CloseIcon />
            </button>
          </div>
        )}
      </div>
    </>
  );

  const tabs = (
    <nav class="tabbar" aria-label={t('mainNav')}>
      {TABS.map(([id, label, icon]) => (
        <button key={id} type="button" class={tab === id ? 'tab active' : 'tab'} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>
          {icon()}
          <span>{label()}</span>
        </button>
      ))}
    </nav>
  );

  const frame: Frame = (p: FrameProps) => <Layout {...p} banners={banners} tabs={tabs} />;

  if (!items || !settings) return <Loading frame={frame} />;

  const canWrite = !needsNetwork || (online && !fromCache);

  const editingItem = editingId ? items.find((i) => i.id === editingId) : undefined;
  if (editingItem) {
    return (
      <ItemForm
        frame={frame}
        item={editingItem}
        isNew={false}
        items={items}
        shops={shops}
        trips={settings.trips}
        settings={settings}
        suggest={suggest}
        simple={simple}
        onCancel={() => setEditingId(null)}
        onSave={async (saved) => {
          // Send only what changed, so another phone's edit of other fields stays.
          const ok = await updateItem(saved.id, itemPatch(editingItem, saved));
          if (ok) setEditingId(null);
          return ok;
        }}
      />
    );
  }

  if (newItem) {
    const item = blankItem(newItem.name);
    return (
      <ItemForm
        frame={frame}
        item={item}
        isNew
        items={items}
        shops={shops}
        trips={settings.trips}
        settings={settings}
        suggest={suggest}
        simple={simple}
        onCancel={() => setNewItem(null)}
        onSave={async (saved) => {
          // From shop mode and from home "מה נגמר?" the new item goes on the list now.
          const ok = await addItem(newItem.forTrip ? { ...saved, ranOut: true } : saved);
          if (ok) setNewItem(null);
          return ok;
        }}
      />
    );
  }

  if (shopping !== null) {
    return (
      <ShopView
        frame={frame}
        store={shopping}
        items={items}
        shops={shops}
        settings={settings}
        canWrite={canWrite}
        ticks={store}
        onTick={setTick}
        overrides={store}
        onOverride={setOverride}
        onFinish={async (trip, lines) => {
          const ok = await finishTrip(trip, lines);
          if (ok) setMarked([]);
          return ok;
        }}
        onAddToTrip={(item) => updateItem(item.id, { ranOut: true })}
        onNewItem={(name) => setNewItem({ name, forTrip: true })}
        onClose={() => setShopping(null)}
      />
    );
  }

  /** Simple mode: a new product from a name. AI category when it is on, else כללי; store from the role map; on the list. */
  const newSimpleItem = async (name: string) => {
    const lang = getLang();
    let found: { name: string; category: string; emoji: string } | null = null;
    if (suggest) {
      try {
        found = await suggest({ name, unit: t('defaultUnit'), packSize: 1, categories: [], lang });
      } catch {
        found = null;
      }
    }
    const category = found?.category || categoryNames(lang).at(-1)!;
    const role = roleStoreFor(category, settings.roleStores);
    const storeId = shops.some((s) => s.id === role && s.active) ? role : null;
    const finalName = found && !items.some((i) => i.name.trim().toLocaleLowerCase('he') === found!.name.trim().toLocaleLowerCase('he')) ? found.name : name;
    return addItem({ ...blankItem(finalName), category, storeId, ...(found?.emoji ? { emoji: found.emoji } : {}), ranOut: true });
  };

  if (tab === 'home' && simple) {
    return (
      <SimpleHome
        frame={frame}
        status={status}
        items={items}
        settings={settings}
        canWrite={canWrite}
        ticks={store}
        onTick={setTick}
        onAdd={(item) => updateItem(item.id, { ranOut: true })}
        onNew={newSimpleItem}
        onEdit={(item) => setEditingId(item.id)}
        onFinish={finishTrip}
      />
    );
  }

  if (tab === 'home') {
    return (
      <HomeView
        frame={frame}
        status={status}
        items={items}
        shops={shops}
        settings={settings}
        canWrite={canWrite}
        onShop={setShopping}
        onAddToList={addToList}
        onUndo={undoMark}
        marked={marked.map((m) => m.id)}
        onNewItem={(name) => setNewItem({ name, forTrip: true })}
        onEdit={(item) => setEditingId(item.id)}
        overrides={store}
        onOverride={setOverride}
      />
    );
  }
  if (tab === 'catalog') {
    return (
      <CatalogView
        frame={frame}
        items={items}
        shops={shops}
        settings={settings}
        canWrite={canWrite}
        suggest={suggest}
        onAdd={addItem}
        onUpdate={updateItem}
        onAdjust={adjustStock}
        onUse={usePacks}
        onAllGone={allGone}
        simple={simple}
      />
    );
  }
  return <SettingsView frame={frame} settings={settings} items={items} shops={shops} shopActions={shopActions} onSave={saveSettings} onRoleStore={setRoleStore} loadHistory={loadHistory} account={account} />;
}

/** Skeleton in the shape of the trip screen while the data loads. */
function Loading({ frame }: { frame: Frame }) {
  return frame({
    hero: (
      <div aria-hidden="true" class="stack">
        <div class="hero-top">
          <span class="sk h-20 w-30" />
          <span class="sk h-44 w-30" />
        </div>
        <div class="sk-lines">
          <span class="sk h-32 w-40" />
          <span class="sk h-16 w-30" />
        </div>
        <div class="trip-pills">
          <span class="sk h-44" />
          <span class="sk h-44" />
          <span class="sk h-44" />
        </div>
      </div>
    ),
    children: (
      <section class="stack" aria-busy="true">
        <p class="loading-note" role="status">
          <SpinnerIcon />
          {t('loadingList')}
        </p>
        <div class="card" aria-hidden="true">
          <div class="progress-nums">
            <span class="sk h-32 w-30" />
            <span class="sk h-32 w-30" />
          </div>
          <span class="sk bar" />
        </div>
        <div class="card store-card" aria-hidden="true">
          <span class="sk h-20 w-40" />
          {[0, 1, 2].map((n) => (
            <div class="row" key={n}>
              <span class="sk tile-sk" />
              <span class="sk-lines">
                <span class="sk h-16 w-60" />
                <span class="sk h-12 w-40" />
              </span>
              <span class="tick">
                <span class="sk ring-sk" />
              </span>
            </div>
          ))}
        </div>
      </section>
    ),
  });
}
