import { useMemo, useState } from 'preact/hooks';
import { groupByStore, listTrip, packsAtHome, planList, sortedLines, targetPacks } from '../domain/planner';
import type { Settings, TripId } from '../domain/schedule';
import type { Item, Shop } from '../domain/types';
import type { SyncStatus } from './App';
import { itemEmoji } from './emoji';
import { BasketIcon, ChevronDownIcon, CloseIcon, PlusIcon, SearchIcon } from './icons';
import { t } from './i18n';
import { formatMoney, formatNumber, itemsLabel, noStore, packsText } from './labels';
import type { Frame } from './parts';
import { AmountSheet } from './AmountSheet';
import { AmountButton } from './ShopView';
import { useOverrides, type OverrideSource } from './useOverrides';

interface Props {
  frame: Frame;
  status: SyncStatus;
  items: Item[];
  /** Stores, for the list order (spec 013). */
  shops: Shop[];
  settings: Settings;
  canWrite: boolean;
  /** Opens shop mode (spec 014): 'all', a store id, or '' for products with no store. */
  onShop: (store: string) => void;
  /** "מה נגמר?" (2026-11-12): a tap puts the product on the shopping list, no amount question. */
  onAddToList: (item: Item) => Promise<boolean>;
  /** Puts back what the last mark of this item changed in this session. */
  onUndo: (item: Item) => Promise<boolean>;
  /** Ids of items marked in this session, newest first. */
  marked: string[];
  onNewItem: (name: string) => void;
  /** Opens the product form for this item. */
  onEdit: (item: Item) => void;
  /** Shared amounts per trip (spec 012). */
  overrides: OverrideSource;
  /** Saves the amount of one item for one trip, or null to go back. False when it failed. */
  onOverride: (trip: TripId, itemId: string, packs: number | null) => Promise<boolean>;
}

const HELP_KEY = 'household-shop.help-closed';

const readHelpClosed = () => {
  try {
    return localStorage.getItem(HELP_KEY) === '1';
  } catch {
    return false;
  }
};

/** The 4 steps of the app, shown on first run and in settings (spec 009). */
export function HowItWorks({ onClose }: { onClose?: () => void }) {
  return (
    <section class="card how" aria-labelledby="how-title">
      <div class="how-head">
        <h2 class="card-title" id="how-title">
          {t('howTitle')}
        </h2>
        {onClose && (
          <button type="button" class="icon-btn" aria-label={t('closeHow')} onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </div>
      <ol class="how-steps">
        {t('howSteps').map(([lead, rest]) => (
          <li key={lead}>
            <strong>{lead}</strong> {rest}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Home (spec 009; one list since spec 014): the list by store, "מה נגמר?", and what was marked. */
export function HomeView({ frame, status, items, shops, settings, canWrite, onShop, onAddToList, onUndo, marked, onNewItem, onEdit, overrides: overrideSource, onOverride }: Props) {
  // Spec 014: one list; days and trips do not count. Amounts live on the list trip id.
  const trip = listTrip(settings);
  const [overrides, putOverride] = useOverrides(overrideSource, trip);
  const lines = useMemo(() => planList(items, settings, overrides), [items, settings, overrides]);
  const byStore = useMemo(() => groupByStore(lines, shops), [lines, shops]);
  const [amountOf, setAmountOf] = useState<string | null>(null);
  const amountLine = amountOf ? lines.find((l) => l.item.id === amountOf) : undefined;
  const costs = lines.flatMap((l) => (l.cost === null ? [] : [l.cost]));
  const total = costs.length ? costs.reduce((s, c) => s + c, 0) : null;

  const [query, setQuery] = useState('');
  const [peek, setPeek] = useState(false);
  const [helpClosed, setHelpClosed] = useState(readHelpClosed);
  const q = query.trim().toLocaleLowerCase('he');
  // One-time products are not used up at home (spec 012).
  const found = q ? items.filter((i) => i.active && !i.onceTrip && i.name.toLocaleLowerCase('he').includes(q)).slice(0, 8) : [];
  const exact = found.some((i) => i.name.trim().toLocaleLowerCase('he') === q);
  const add = async (item: Item) => {
    if (await onAddToList(item)) setQuery('');
  };

  const byId = new Map(items.map((i) => [i.id, i]));
  const markedNow = marked.flatMap((id) => byId.get(id) ?? []);
  const ranOut = items.filter((i) => i.active && i.ranOut && !marked.includes(i.id));
  const recent = [...markedNow, ...ranOut];

  const closeHelp = () => {
    setHelpClosed(true);
    try {
      localStorage.setItem(HELP_KEY, '1');
    } catch {
      // Private mode: the card shows again next time.
    }
  };

  return frame({
    hero: (
      <>
        <p class="status">
          <strong>{status.name}</strong>
          <span class="state">
            <span class={status.warn ? 'dot warn' : 'dot'} aria-hidden="true" />
            {status.state}
          </span>
        </p>
        <section class="next-card" aria-labelledby="next-title">
          <h1 id="next-title">
            <span aria-hidden="true">🧺</span> {t('simpleTitle')}
          </h1>
          <p class="sub">
            {lines.length === 0 ? t('nothingToBuy') : itemsLabel(lines.length)}
            {total !== null && t('about')(formatMoney(total))}
          </p>
          <button type="button" class="btn primary full go" onClick={() => onShop('all')}>
            <BasketIcon size={22} />
            {t('goShopping')}
          </button>
          {byStore.length > 1 && (
            <div class="other-trips pill-scroll" role="group" aria-label={t('whichStore')}>
              {byStore.map((g) => {
                const n = g.categories.reduce((sum, c) => sum + c.lines.length, 0);
                const name = g.store?.name ?? noStore();
                return (
                  <button key={g.storeId ?? ''} type="button" class="chip on-hero" aria-label={t('shopAt')(name, n)} onClick={() => onShop(g.storeId ?? '')}>
                    {g.store?.emoji && <span aria-hidden="true">{g.store.emoji}</span>} {name} <span class="when">{n}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </>
    ),
    children: (
      <>
        {!helpClosed && <HowItWorks onClose={closeHelp} />}

        <section class="card" aria-labelledby="gone-title">
          <h2 class="card-title" id="gone-title">
            {t('whatRanOut')}
          </h2>
          <label class="search">
            <span class="visually-hidden">{t('searchGone')}</span>
            <SearchIcon size={22} />
            <input type="search" placeholder={t('searchGonePh')} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
          </label>
          {found.length > 0 && (
            <ul class="rows">
              {found.map((item) => (
                <li key={item.id}>
                  <button type="button" class="row-btn" aria-label={item.ranOut ? t('onListOfItem')(item.name) : t('addToListOf')(item.name)} disabled={!canWrite || item.ranOut} onClick={() => void add(item)}>
                    <span class="tile" aria-hidden="true">
                      {itemEmoji(item)}
                    </span>
                    <span class="row-text">
                      <span class="name">{item.name}</span>
                      <span class="row-sub">{t('atHomeOf')(formatNumber(packsAtHome(item)), targetPacks(item, settings))}</span>
                    </span>
                    <span class="chip">{item.ranOut ? t('onListChip') : t('toListChip')}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q && !exact && (
            <button type="button" class="btn brand full" onClick={() => onNewItem(query.trim())}>
              <PlusIcon size={22} />
              {t('newToList')} <bdi>{query.trim()}</bdi>
            </button>
          )}
        </section>

        {recent.length > 0 && (
          <section class="card" aria-labelledby="recent-title">
            <h2 class="card-title" id="recent-title">
              {t('recentTitle')}
            </h2>
            <ul class="rows">
              {recent.map((item) => (
                <li key={item.id} class="row">
                  <span class="tile" aria-hidden="true">
                    {itemEmoji(item)}
                  </span>
                  <span class="row-text">
                    <span class="name">{item.name}</span>
                    <span class="row-sub">
                      {item.ranOut ? t('ranOut') : t('atHomeOf')(formatNumber(packsAtHome(item)), targetPacks(item, settings))}
                    </span>
                  </span>
                  {marked.includes(item.id) && (
                    <button type="button" class="btn text sm" aria-label={t('undoMarkOf')(item.name)} disabled={!canWrite} onClick={() => void onUndo(item)}>
                      {t('undo')}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {lines.length > 0 && (
          <section class="card" aria-label={t('onList')}>
            <button type="button" class="peek-head" aria-expanded={peek} onClick={() => setPeek(!peek)}>
              <span class="card-title">{t('onList')}</span>
              <ChevronDownIcon />
            </button>
            {peek && (
              <ul class="rows peek">
                {sortedLines(lines, shops).map((l) => (
                  <li key={l.item.id} class="row">
                    <button type="button" class="tile tile-btn" tabIndex={-1} aria-hidden="true" onClick={() => onEdit(l.item)}>
                      {itemEmoji(l.item)}
                    </button>
                    <span class="row-text">
                      <button type="button" class="name name-btn" aria-label={t('editOf')(l.item.name)} onClick={() => onEdit(l.item)}>
                        {l.item.name}
                      </button>
                      <AmountButton amount={packsText(l.packs, l.item)} overridden={l.overridden} name={l.item.name} onClick={() => setAmountOf(l.item.id)} />
                    </span>
                  </li>
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

        {/* Not rendered since 2026-11-12: the operator wants one tap to the list, not "השתמשתי" with an amount. UseSheet is still used by the catalog. */}
      </>
    ),
  });
}
