import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Store } from '../data/store';
import { finishTrip, groupByStore, listTrip, planList, type TripLine } from '../domain/planner';
import type { Settings, TripId } from '../domain/schedule';
import type { Item, Shop, StockDelta } from '../domain/types';
import { itemEmoji } from './emoji';
import { CheckIcon, ChevronDownIcon, CloseIcon, PlusIcon, SearchIcon } from './icons';
import { getLang, t } from './i18n';
import { canonicalCategory } from '../domain/categories';
import { formatMoney, itemsLabel, noStore, packsText } from './labels';
import type { Frame } from './parts';
import { AmountSheet } from './AmountSheet';
import { useOverrides, type OverrideSource } from './useOverrides';

interface Props {
  frame: Frame;
  /** Store to show first (spec 014): 'all', a store id, or '' for products with no store. */
  store: string;
  items: Item[];
  /** Every store of the household; the list follows their order. */
  shops: Shop[];
  settings: Settings;
  /** False when a write cannot work now (offline in shared mode). */
  canWrite: boolean;
  /** Shared ticks: read, live updates and the offline queue. */
  ticks: Pick<Store, 'loadTicks' | 'subscribeTicks' | 'unsentTicks' | 'subscribeTickQueue'>;
  /** Saves one tick. False when it failed (the error banner is shown). */
  onTick: (trip: TripId, id: string, ticked: boolean) => Promise<boolean>;
  onFinish: (trip: TripId, lines: StockDelta[]) => Promise<boolean>;
  /** Shared amounts for this trip (spec 012). */
  overrides: OverrideSource;
  /** Saves the amount of one item for this trip, or null to go back. False when it failed. */
  onOverride: (trip: TripId, itemId: string, packs: number | null) => Promise<boolean>;
  /** Puts a catalog item on this trip now (marks it ranOut). */
  onAddToTrip: (item: Item) => Promise<boolean>;
  /** Opens the new item form with this name; the item comes back on this trip. */
  onNewItem: (name: string) => void;
  onClose: () => void;
}

const withTick = (set: ReadonlySet<string>, id: string, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

const sum = (values: (number | null)[]) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((s, v) => s + v, 0) : null;
};

/** Keeps the screen on while shopping, where the browser supports it. */
function useWakeLock() {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let live = true;
    const ask = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
        const got = await nav.wakeLock?.request('screen');
        if (!got) return;
        if (live) lock = got;
        else void got.release();
      } catch {
        // Not allowed now (battery saver, hidden tab): the screen sleeps as usual.
      }
    };
    // The lock ends when the app is hidden; ask again when it comes back.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    void ask();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, []);
}

/**
 * Shop mode (spec 009, one list since spec 014): the list full screen, with
 * store chips. "סיימתי" finishes every ticked line, in all stores.
 */
export function ShopView({ frame, store: firstStore, items, shops, settings, canWrite, ticks, onTick, onFinish, overrides: overrideSource, onOverride, onAddToTrip, onNewItem, onClose }: Props) {
  useWakeLock();
  const trip = listTrip(settings);
  const [overrides, putOverride] = useOverrides(overrideSource, trip);
  // Line whose amount sheet is open, by item id.
  const [amountOf, setAmountOf] = useState<string | null>(null);
  const [storeFilter, setStoreFilter] = useState(firstStore);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [cartOpen, setCartOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  // Tick changes of this trip not yet confirmed: queued on this device or in flight.
  const [queued, setQueued] = useState(0);
  // Ticks saved from this view and not yet confirmed: itemId -> wanted value.
  // A refetch that lands before the write keeps showing them.
  const pending = useRef(new Map<string, { on: boolean }>());

  useEffect(() => {
    let live = true;
    const show = (stored: Set<string>) => {
      if (!live) return;
      let next: ReadonlySet<string> = stored;
      for (const [id, { on }] of pending.current) next = withTick(next, id, on);
      setTicked(next);
    };
    const load = () => ticks.loadTicks(trip).then(show, () => undefined);
    void load();
    const unsubscribe = ticks.subscribeTicks(trip, show);
    setQueued(ticks.unsentTicks(trip));
    const unsubscribeQueue = ticks.subscribeTickQueue({
      onChange: () => {
        if (live) setQueued(ticks.unsentTicks(trip));
      },
      // A dropped change: show the server state again.
      onReject: () => void load(),
    });
    // Realtime can miss changes while the phone sleeps or is offline.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', load);
    return () => {
      live = false;
      unsubscribe();
      unsubscribeQueue();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', load);
    };
  }, [ticks, trip]);

  const lines = useMemo(() => planList(items, settings, overrides), [items, settings, overrides]);
  const amountLine = amountOf ? lines.find((l) => l.item.id === amountOf) : undefined;
  const allGroups = useMemo(() => groupByStore(lines, shops), [lines, shops]);
  // Store chips: stores with lines not yet in the cart. A filter on a store with nothing left shows all.
  const left = (g: (typeof allGroups)[number]) => g.categories.reduce((n, c) => n + c.lines.filter((l) => !ticked.has(l.item.id)).length, 0);
  const chips = allGroups.filter((g) => left(g) > 0);
  const filter = storeFilter === 'all' || chips.some((g) => (g.storeId ?? '') === storeFilter) ? storeFilter : 'all';
  const groups = filter === 'all' ? allGroups : allGroups.filter((g) => (g.storeId ?? '') === filter);
  const shownStore = filter === 'all' ? null : allGroups.find((g) => (g.storeId ?? '') === filter);
  const inCart = lines.filter((l) => ticked.has(l.item.id));
  const leftCost = sum(lines.filter((l) => !ticked.has(l.item.id)).map((l) => l.cost));

  /** Optimistic: shown at once, rolled back if the save fails and nothing newer was asked. */
  const toggle = async (id: string) => {
    const on = !ticked.has(id);
    const mine = { on };
    pending.current.set(id, mine);
    setTicked((prev) => withTick(prev, id, on));
    const ok = await onTick(trip, id, on);
    if (pending.current.get(id) !== mine) return;
    pending.current.delete(id);
    if (!ok) setTicked((prev) => withTick(prev, id, !on));
  };

  const finish = async () => {
    if (await onFinish(trip, finishTrip(lines, ticked))) onClose();
  };

  const finishHint = !canWrite
    ? t('finishOffline')
    : queued > 0
      ? t('waitingTicks')
      : inCart.length === 0 && lines.length > 0
        ? t('tickWhatTaken')
        : null;

  return frame({
    focus: true,
    hero: (
      <div class="shop-head">
        <button type="button" class="icon-btn on-hero" aria-label={t('exitShop')} onClick={onClose}>
          <CloseIcon size={24} />
        </button>
        <div class="hero-title">
          <h1>{shownStore ? `${shownStore.store?.emoji ?? ''} ${shownStore.store?.name ?? noStore()}`.trim() : t('simpleTitle')}</h1>
          <p class="sub">
            {lines.length === 0 ? t('noItems') : t('leftOf')(lines.length - inCart.length, lines.length)}
            {leftCost !== null && t('costLeft')(formatMoney(leftCost))}
          </p>
        </div>
      </div>
    ),
    children: (
      <>
        {adding ? (
          <QuickAdd items={items} onList={new Set(lines.map((l) => l.item.id))} onPick={onAddToTrip} onNew={onNewItem} onDone={() => setAdding(false)} />
        ) : (
          <button type="button" class="btn secondary full" onClick={() => setAdding(true)}>
            <PlusIcon size={22} />
            {t('addToList')}
          </button>
        )}
        {chips.length > 1 && (
          <div class="chip-row store-filter" role="group" aria-label={t('whichStore')}>
            <button type="button" class="chip" aria-pressed={filter === 'all'} onClick={() => setStoreFilter('all')}>
              {t('allStores')}
            </button>
            {chips.map((g) => (
              <button key={g.storeId ?? ''} type="button" class="chip" aria-pressed={filter === (g.storeId ?? '')} onClick={() => setStoreFilter(g.storeId ?? '')}>
                {g.store?.emoji && <span aria-hidden="true">{g.store.emoji}</span>} {g.store?.name ?? noStore()} <span class="count">{left(g)}</span>
              </button>
            ))}
          </div>
        )}
        {lines.length === 0 && <p class="card muted center">{t('emptyShop')}</p>}
        {groups.map((g) => {
          const cats = g.categories.map((c) => ({ category: c.category, lines: c.lines.filter((l) => !ticked.has(l.item.id)) })).filter((c) => c.lines.length > 0);
          const rows = cats.flatMap((c) => c.lines);
          if (rows.length === 0) return null;
          return (
            <section class="card store-card" key={g.storeId ?? ''} aria-label={g.store?.name ?? noStore()}>
              <div class="store-head">
                <div class="title">
                  <h2>
                    {g.store?.emoji} {g.store?.name ?? noStore()}
                  </h2>
                  <span class="count">{itemsLabel(rows.length)}</span>
                </div>
                {g.total !== null && <span class="total">{formatMoney(g.total)}</span>}
              </div>
              {cats.map((c) => (
                <div key={c.category} class="cat-group">
                  <h3 class="cat-head">{canonicalCategory(c.category, getLang())}</h3>
                  <ul>
                    {c.lines.map((line) => (
                      <Line key={line.item.id} line={line} on={false} onToggle={() => void toggle(line.item.id)} onAmount={() => setAmountOf(line.item.id)} />
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })}
        {inCart.length > 0 && (
          <section class="card store-card cart" aria-label={t('inCart')}>
            <button type="button" class="store-head cart-head" aria-expanded={cartOpen} onClick={() => setCartOpen(!cartOpen)}>
              <span class="title">
                <h2>🛒 {t('inCartN')(inCart.length)}</h2>
              </span>
              <ChevronDownIcon />
            </button>
            {cartOpen && (
              <ul>
                {inCart.map((line) => (
                  <Line key={line.item.id} line={line} on onToggle={() => void toggle(line.item.id)} />
                ))}
              </ul>
            )}
          </section>
        )}
        {amountLine && (
          <AmountSheet
            line={amountLine}
            canWrite={canWrite}
            onSave={async (packs) => {
              const ok = await onOverride(trip, amountLine.item.id, packs);
              if (ok) putOverride(amountLine.item.id, packs);
              return ok;
            }}
            onClose={() => setAmountOf(null)}
          />
        )}
      </>
    ),
    dock: (
      <>
        <button
          type="button"
          class="btn primary full"
          disabled={inCart.length === 0 || !canWrite || queued > 0}
          aria-describedby={finishHint ? 'finish-hint' : undefined}
          onClick={() => void finish()}
        >
          <CheckIcon size={22} />
          {inCart.length > 0 ? `${t('done')} • ${itemsLabel(inCart.length)}` : t('done')}
        </button>
        {finishHint && (
          <p class="hint" id="finish-hint">
            {finishHint}
          </p>
        )}
      </>
    ),
  });
}

function Line({ line: { item, packs, overridden }, on, onToggle, onAmount }: { line: TripLine; on: boolean; onToggle: () => void; onAmount?: () => void }) {
  const amount = packsText(packs, item);
  return (
    <li class={on ? 'line done' : 'line'} data-item={item.name}>
      <label class="row">
        <span class="tile" aria-hidden="true">
          {itemEmoji(item)}
        </span>
        <span class="row-text">
          <span class="row-name">
            <span class="name clamp2">{item.name}</span>
            {item.ranOut && <span class="badge tag">{t('ranOutTag')}</span>}
          </span>
          {onAmount ? (
            <AmountButton amount={amount} overridden={overridden} name={item.name} onClick={onAmount} />
          ) : (
            <span class="row-sub amount">
              {amount}
              {overridden && <span class="changed"> · {t('amountChanged')}</span>}
            </span>
          )}
        </span>
        <span class="tick">
          <input type="checkbox" checked={on} onChange={onToggle} aria-label={`${item.name}, ${amount}`} />
          <span class="ring" aria-hidden="true">
            <CheckIcon size={18} />
          </span>
        </span>
      </label>
    </li>
  );
}

/**
 * The amount of a trip line as a button (spec 012): a tap opens "כמה לקנות הפעם".
 * Inside the line's label, so it stops the click from ticking the line.
 */
export function AmountButton({ amount, overridden, name, onClick }: { amount: string; overridden: boolean; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="row-sub amount amount-btn"
      aria-label={t('amountOf')(name, amount)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
    >
      {amount}
      {overridden && <span class="changed"> · {t('amountChanged')}</span>}
    </button>
  );
}

/** Search the catalog from the store: a tap puts the item on this trip. No match: a new item. */
function QuickAdd({ items, onList, onPick, onNew, onDone }: { items: Item[]; onList: Set<string>; onPick: (item: Item) => Promise<boolean>; onNew: (name: string) => void; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLocaleLowerCase('he');
  const found = q ? items.filter((i) => i.active && !onList.has(i.id) && i.name.toLocaleLowerCase('he').includes(q)).slice(0, 6) : [];
  const exists = items.some((i) => i.name.trim().toLocaleLowerCase('he') === q);
  return (
    <section class="card quick-add" aria-label={t('addToList')}>
      <label class="search">
        <span class="visually-hidden">{t('searchAdd')}</span>
        <SearchIcon size={22} />
        <input type="search" placeholder={t('addPh')} value={query} autoFocus onInput={(e) => setQuery(e.currentTarget.value)} />
      </label>
      <ul class="rows">
        {found.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              class="row-btn"
              aria-label={t('addToListOf')(item.name)}
              onClick={() =>
                void onPick(item).then((ok) => {
                  if (ok) onDone();
                })
              }
            >
              <span class="tile" aria-hidden="true">
                {itemEmoji(item)}
              </span>
              <span class="row-text">
                <span class="name">{item.name}</span>
              </span>
              <PlusIcon size={22} />
            </button>
          </li>
        ))}
      </ul>
      <div class="btn-row">
        {q && !exists && (
          <button type="button" class="btn brand" onClick={() => onNew(query.trim())}>
            <PlusIcon size={22} />
            {t('newProductColon')} <bdi>{query.trim()}</bdi>
          </button>
        )}
        <button type="button" class="btn text" onClick={onDone}>
          {t('close')}
        </button>
      </div>
    </section>
  );
}
