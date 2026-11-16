import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Store } from '../data/store';
import { canonicalCategory, compareCategories, findCategory } from '../domain/categories';
import type { Settings, TripId } from '../domain/schedule';
import { listTrip } from '../domain/planner';
import type { Item, StockDelta } from '../domain/types';
import type { SyncStatus } from './App';
import { itemEmoji } from './emoji';
import { CheckIcon, PlusIcon } from './icons';
import { getLang, t } from './i18n';
import { itemsLabel } from './labels';
import type { Frame } from './parts';

interface Props {
  frame: Frame;
  status: SyncStatus;
  items: Item[];
  settings: Settings;
  canWrite: boolean;
  ticks: Pick<Store, 'loadTicks' | 'subscribeTicks'>;
  onTick: (trip: TripId, id: string, ticked: boolean) => Promise<boolean>;
  /** Puts an existing product on the list (ranOut). */
  onAdd: (item: Item) => Promise<boolean>;
  /** Makes a new product from a name and puts it on the list. */
  onNew: (name: string) => Promise<boolean>;
  onFinish: (trip: TripId, lines: StockDelta[]) => Promise<boolean>;
  /** Opens the product form for this item. */
  onEdit: (item: Item) => void;
}

const norm = (s: string) => s.trim().toLocaleLowerCase('he');

/**
 * "רשימה פשוטה" (spec 013): one shared list by category, an add field, tap to
 * tick, and "סיימתי". The list is the "נגמר" products plus one-time products.
 * Ticks and finish use the next trip, so history and other phones stay in step.
 */
export function SimpleHome({ frame, status, items, settings, canWrite, ticks, onTick, onAdd, onNew, onFinish, onEdit }: Props) {
  // Spec 014: the one list trip, the same id as the full list.
  const trip = listTrip(settings);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    const show = (s: Set<string>) => live && setTicked(s);
    void ticks.loadTicks(trip).then(show, () => undefined);
    const stop = ticks.subscribeTicks(trip, show);
    return () => {
      live = false;
      stop();
    };
  }, [ticks, trip]);

  const list = useMemo(
    () => items.filter((i) => i.active && (i.ranOut || !!i.onceTrip)).sort((a, b) => compareCategories(a.category, b.category) || a.name.localeCompare(b.name, 'he')),
    [items],
  );
  const groups = useMemo(() => {
    const out: { category: string; items: Item[] }[] = [];
    for (const item of list) {
      const key = findCategory(item.category)?.he ?? item.category.trim();
      const last = out.at(-1);
      if (last && last.category === key) last.items.push(item);
      else out.push({ category: key, items: [item] });
    }
    return out;
  }, [list]);

  const q = norm(query);
  const onList = new Set(list.map((i) => i.id));
  const found = q ? items.filter((i) => i.active && !onList.has(i.id) && norm(i.name).includes(q)).slice(0, 6) : [];
  const done = list.filter((i) => ticked.has(i.id));

  const toggle = async (id: string) => {
    const on = !ticked.has(id);
    setTicked((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
    if (!(await onTick(trip, id, on))) void ticks.loadTicks(trip).then(setTicked, () => undefined);
  };

  const add = async (e: Event) => {
    e.preventDefault();
    if (!q || busy) return;
    setBusy(true);
    const same = items.find((i) => norm(i.name) === q);
    const ok = same ? (onList.has(same.id) ? true : await onAdd(same)) : await onNew(query.trim());
    setBusy(false);
    if (ok) {
      setQuery('');
      input.current?.focus();
    }
  };

  const finish = async () => {
    const lines = done.map((i) => ({ itemId: i.id, delta: i.packSize, packs: 1 }));
    if (await onFinish(trip, lines)) setTicked(new Set());
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
        <div class="hero-title">
          <h1>{t('simpleTitle')}</h1>
          <p class="sub">{list.length === 0 ? t('nothingToBuy') : itemsLabel(list.length)}</p>
        </div>
      </>
    ),
    children: (
      <>
        <form class="card quick-add" onSubmit={(e) => void add(e)} aria-label={t('simpleAdd')}>
          <div class="simple-add">
            <label class="search">
              <span class="visually-hidden">{t('simpleAddPh')}</span>
              <input ref={input} type="search" placeholder={t('simpleAddPh')} value={query} onInput={(e) => setQuery(e.currentTarget.value)} />
            </label>
            <button type="submit" class="btn brand" disabled={!q || busy || !canWrite}>
              <PlusIcon size={22} />
              {t('simpleAdd')}
            </button>
          </div>
          {found.length > 0 && (
            <ul class="rows">
              {found.map((item) => (
                <li key={item.id}>
                  <button type="button" class="row-btn" aria-label={t('addToListOf')(item.name)} disabled={!canWrite} onClick={() => void onAdd(item).then((ok) => ok && setQuery(''))}>
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
          )}
        </form>
        {list.length === 0 ? (
          <p class="card muted center">{t('simpleEmpty')}</p>
        ) : (
          <section class="card store-card" aria-label={t('simpleTitle')}>
            {groups.map((g) => (
              <div key={g.category} class="cat-group">
                <h3 class="cat-head">{canonicalCategory(g.category, getLang())}</h3>
                <ul>
                  {g.items.map((item) => {
                    const on = ticked.has(item.id);
                    return (
                      <li key={item.id} class={on ? 'line done' : 'line'} data-item={item.name}>
                        <label class="row">
                          <span class="tile" aria-hidden="true">
                            {itemEmoji(item)}
                          </span>
                          <span class="row-text">
                            <button type="button" class="name clamp2 name-btn" aria-label={t('editOf')(item.name)} onClick={() => onEdit(item)}>
                              {item.name}
                            </button>
                          </span>
                          <span class="tick">
                            <input type="checkbox" checked={on} onChange={() => void toggle(item.id)} aria-label={item.name} />
                            <span class="ring" aria-hidden="true">
                              <CheckIcon size={18} />
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </section>
        )}
      </>
    ),
    dock:
      done.length > 0 ? (
        <button type="button" class="btn primary full" disabled={!canWrite} onClick={() => void finish()}>
          <CheckIcon size={22} />
          {`${t('done')} • ${itemsLabel(done.length)}`}
        </button>
      ) : undefined,
  });
}
