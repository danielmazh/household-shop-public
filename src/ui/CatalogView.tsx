import { useState } from 'preact/hooks';
import { itemPatch } from '../domain/catalog';
import { listTrip, packsAtHome, targetPacks } from '../domain/planner';
import type { Settings } from '../domain/schedule';
import type { Item, ItemPatch, Shop } from '../domain/types';
import type { Suggest } from '../data/ai';
import { itemEmoji } from './emoji';
import { ClipboardIcon, GridIcon, ListIcon, PlusIcon, SearchIcon } from './icons';
import { ItemForm } from './ItemForm';
import { getLang, locale, t } from './i18n';
import { canonicalCategory, compareCategories } from '../domain/categories';
import { formatNumber, noCategory } from './labels';
import { RadioPills, type Frame } from './parts';
import { StockCount } from './StockCount';
import { UseSheet } from './UseSheet';
import { useToday } from './when';

interface Props {
  frame: Frame;
  items: Item[];
  shops: Shop[];
  settings: Settings;
  canWrite: boolean;
  /** AI help in the item form. Unset in demo mode. */
  suggest?: Suggest;
  onAdd: (item: Item) => Promise<boolean>;
  onUpdate: (id: string, patch: ItemPatch) => Promise<boolean>;
  onAdjust: (id: string, delta: number) => Promise<boolean>;
  onUse: (item: Item, packs: number) => Promise<boolean>;
  onAllGone: (item: Item) => Promise<boolean>;
  /** Simple mode (spec 013): no stock count, the category instead of stock, and "לרשימה". */
  simple?: boolean;
}

/** A new item with defaults; the form sets target and trips. */
export const blankItem = (name = ''): Item => ({
  id: crypto.randomUUID(),
  name,
  category: '',
  cadence: 'bulk',
  trips: null,
  storeId: null,
  weeklyUse: 1,
  unit: t('defaultUnit'),
  packSize: 1,
  price: null,
  target: 1,
  stock: 0,
  ranOut: false,
  active: true,
});

const ALL = '';

/** Spec 013: list (default) or gallery, remembered on this device. */
type View = 'list' | 'gallery';
const VIEW_KEY = 'household-shop.catalog-view';
const readView = (): View => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'gallery' ? 'gallery' : 'list';
  } catch {
    return 'list';
  }
};
const saveView = (view: View) => {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
};

/** True when the item name or category contains the query. Ignores case and outer spaces. */
function matches(item: Item, query: string): boolean {
  const q = query.trim().toLocaleLowerCase('he');
  if (!q) return true;
  return item.name.toLocaleLowerCase('he').includes(q) || item.category.toLocaleLowerCase('he').includes(q);
}

const byName = (a: Item, b: Item) => a.name.localeCompare(b.name, locale());

export function CatalogView({ frame, items, shops, settings, canWrite, suggest, onAdd, onUpdate, onAdjust, onUse, onAllGone, simple = false }: Props) {
  const [editing, setEditing] = useState<{ item: Item; isNew: boolean } | null>(null);
  const [counting, setCounting] = useState(false);
  const [using, setUsing] = useState<string | null>(null);
  const today = useToday();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState(ALL);
  const [view, setView] = useState<View>(readView);
  const toggleView = () => {
    const next = view === 'list' ? 'gallery' : 'list';
    setView(next);
    saveView(next);
  };
  const gridClass = view === 'list' ? 'grid list-view' : 'grid';

  if (editing) {
    return (
      <ItemForm
        frame={frame}
        item={editing.item}
        isNew={editing.isNew}
        items={items}
        shops={shops}
        trips={settings.trips}
        settings={settings}
        suggest={suggest}
        simple={simple}
        onCancel={() => setEditing(null)}
        onSave={async (item) => {
          // Send only what changed, so another phone's edit of other fields stays.
          const ok = editing.isNew ? await onAdd(item) : await onUpdate(item.id, itemPatch(editing.item, item));
          if (ok) setEditing(null);
          return ok;
        }}
      />
    );
  }

  if (counting) return <StockCount frame={frame} items={items} settings={settings} canWrite={canWrite} onAdjust={onAdjust} onDone={() => setCounting(false)} />;

  const usingItem = using ? items.find((i) => i.id === using) : undefined;
  // Spec 013: filter pills in shopping order.
  const categories = [...new Set(items.filter((i) => i.active).map((i) => i.category || noCategory()))].sort(compareCategories);
  const inCategory = (i: Item) => category === ALL || (i.category || noCategory()) === category;
  const shown = items.filter((i) => matches(i, query) && inCategory(i));
  const active = shown.filter((i) => i.active).sort(byName);
  const inactive = shown.filter((i) => !i.active).sort(byName);
  const activeCount = items.filter((i) => i.active).length;

  const card = (item: Item) => {
    if (item.onceTrip) return onceCard(item);
    if (simple) return simpleCard(item);
    const home = packsAtHome(item);
    const target = targetPacks(item, settings);
    const full = !item.ranOut && home >= target;
    return (
    <li key={item.id} class="card product" data-item={item.name}>
      <button type="button" class="product-open" aria-label={t('editOf')(item.name)} onClick={() => setEditing({ item, isNew: false })}>
        <span class={item.ranOut ? 'big-tile warn' : 'big-tile'} aria-hidden="true">
          {itemEmoji(item)}
        </span>
        <span class="name clamp2">{item.name}</span>
        <span class="row-sub">{item.ranOut ? t('ranOutNext') : t('atHomeOf')(formatNumber(home), target)}</span>
        <span class={full ? 'level full' : 'level'} aria-hidden="true">
          <span style={{ inlineSize: `${Math.min(100, target > 0 ? (home / target) * 100 : 100)}%` }} />
        </span>
      </button>
      {!item.active ? (
        <button type="button" class="ranout" onClick={() => void onUpdate(item.id, { active: true })}>
          {t('activate')}
        </button>
      ) : (
        <button type="button" class="ranout" aria-label={t('usedItem')(item.name)} disabled={!canWrite} onClick={() => setUsing(item.id)}>
          {t('used')}
        </button>
      )}
    </li>
    );
  };

  /** Simple mode card (spec 013): the category, and one tap puts it on the list. */
  const simpleCard = (item: Item) => (
    <li key={item.id} class="card product" data-item={item.name}>
      <button type="button" class="product-open" aria-label={t('editOf')(item.name)} onClick={() => setEditing({ item, isNew: false })}>
        <span class="big-tile" aria-hidden="true">
          {itemEmoji(item)}
        </span>
        <span class="name clamp2">{item.name}</span>
        <span class="row-sub">{canonicalCategory(item.category, getLang())}</span>
      </button>
      {!item.active ? (
        <button type="button" class="ranout" onClick={() => void onUpdate(item.id, { active: true })}>
          {t('activate')}
        </button>
      ) : (
        <button type="button" class={item.ranOut ? 'ranout marked' : 'ranout'} aria-label={t('addToListOf')(item.name)} disabled={!canWrite || item.ranOut} onClick={() => void onUpdate(item.id, { ranOut: true })}>
          {item.ranOut ? t('onTheList') : t('toList')}
        </button>
      )}
    </li>
  );

  /** One-time product (spec 012): its trip, or "נקנה" with "שוב" once bought. */
  const onceCard = (item: Item) => {
    // Spec 014: one list, no trip name.
    const tripName = '';
    const again = () => {
      const next = listTrip(settings);
      void onUpdate(item.id, { active: true, onceTrip: next, trips: [next], ranOut: false });
    };
    return (
      <li key={item.id} class="card product" data-item={item.name}>
        <button type="button" class="product-open" aria-label={t('editOf')(item.name)} onClick={() => setEditing({ item, isNew: false })}>
          <span class="big-tile" aria-hidden="true">
            {itemEmoji(item)}
          </span>
          <span class="name clamp2">{item.name}</span>
          <span class="row-sub">{item.active ? t('onceOn')(tripName) : t('onceBought')}</span>
        </button>
        {!item.active && (
          <button type="button" class="ranout" aria-label={t('againOf')(item.name)} disabled={!canWrite} onClick={again}>
            {t('again')}
          </button>
        )}
      </li>
    );
  };

  return frame({
    wide: true,
    hero: (
      <>
        <div class="hero-top">
          <div class="hero-title">
            <h1>{t('products')}</h1>
            <p class="sub">{t('productsCount')(activeCount)}</p>
          </div>
          <div class="hero-actions">
            <button type="button" class="icon-btn on-hero" aria-label={view === 'list' ? t('viewGallery') : t('viewList')} title={view === 'list' ? t('viewGallery') : t('viewList')} onClick={toggleView}>
              {view === 'list' ? <GridIcon /> : <ListIcon />}
            </button>
            {!simple && (
              <button type="button" class="icon-btn on-hero" aria-label={t('stockCount')} title={t('stockCount')} onClick={() => setCounting(true)}>
                <ClipboardIcon />
              </button>
            )}
            <button type="button" class="btn sm primary" onClick={() => setEditing({ item: blankItem(), isNew: true })}>
              <PlusIcon />
              {t('newProductBtn')}
            </button>
          </div>
        </div>
        <label class="search">
          <span class="visually-hidden">{t('searchCatLabel')}</span>
          <SearchIcon size={22} />
          <input type="search" placeholder={t('searchCatPh')} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
        </label>
      </>
    ),
    children: (
      <>
        {categories.length > 0 && (
          <RadioPills
          label={t('filterCat')}
          class="pill-scroll"
          options={[{ value: ALL, label: t('all') }, ...categories.map((c) => ({ value: c, label: c }))]}
          value={category}
          onChange={setCategory}
          />
        )}
        {items.length === 0 ? (
          <section class="card empty-card">
            <span class="big-tile" aria-hidden="true">
              🛒
            </span>
            <h2 class="card-title">{t('noProductsYet')}</h2>
            <p class="muted">{t('addFirst')}</p>
            <button type="button" class="btn primary full" onClick={() => setEditing({ item: blankItem(), isNew: true })}>
              <PlusIcon size={22} />
              {t('newProduct')}
            </button>
          </section>
        ) : (
          shown.length === 0 && (
            <section class="card empty-card">
              <p class="muted">{t('noneFound')}</p>
              {query.trim() && (
                <button type="button" class="btn primary full" onClick={() => setEditing({ item: blankItem(query.trim()), isNew: true })}>
                  <PlusIcon size={22} />
                  {t('add')} <bdi>{query.trim()}</bdi>
                </button>
              )}
            </section>
          )
        )}
        {active.length > 0 && (
          <ul class={gridClass} aria-label={t('products')}>
            {active.map(card)}
          </ul>
        )}
        {inactive.length > 0 && (
          <>
            <h2 class="section-label">{t('inactiveCount')(inactive.length)}</h2>
            <ul class={gridClass} aria-label={t('inactiveList')}>
              {inactive.map(card)}
            </ul>
          </>
        )}
        {usingItem && <UseSheet item={usingItem} settings={settings} today={today} canWrite={canWrite} onUse={onUse} onAllGone={onAllGone} onClose={() => setUsing(null)} />}
      </>
    ),
  });
}
