import { applyStockDelta } from './catalog';
import { compareCategories, findCategory } from './categories';
import type { Item, Shop, StockDelta } from './types';
import { sortShops } from './stores';
import type { Settings, Trip, TripId } from './schedule';

const EPS = 1e-9;

export interface TripLine {
  item: Item;
  /** Packs to buy: the override for this trip when there is one, else `computed`. */
  packs: number;
  /** packs * price, or null when the item has no price. */
  cost: number | null;
  /** Packs the app computed, before any override (spec 012). */
  computed: number;
  /** True when a household member set the amount for this trip. */
  overridden: boolean;
}

/** Amounts set for one trip (spec 012): item id -> packs. */
export type Overrides = ReadonlyMap<string, number>;

/** Limits of an override, same as the trip_overrides check in migration 0006. */
export const OVERRIDE_LIMITS = { min: 1, max: 99 } as const;

/** True for a one-time product (spec 012). */
export const isOnce = (item: Item): boolean => !!item.onceTrip;

/** The trip a one-time product goes on: its own trip, or `next` when that trip is gone. */
export const onceTripOf = (item: Item, settings: Settings, next: TripId): TripId =>
  item.onceTrip && settings.trips.some((t) => t.id === item.onceTrip) ? item.onceTrip : next;

/** Packs of a one-time product: its target in whole packs, at least 1. Stock does not count. */
export const oncePacks = (item: Item): number => Math.max(1, Math.round((item.target ?? item.packSize) / item.packSize));

/**
 * Packs to buy for one item. With `target` (spec 009): fill stock up to it.
 * Without: the spec 002 rule, a share of a week of use plus the margin.
 */
export function packsFor(item: Item, share: number, margin: number): number {
  const target = item.target ?? item.weeklyUse * share * (1 + margin);
  const needUnits = Math.max(0, target - item.stock);
  const packs = Math.max(0, Math.ceil(needUnits / item.packSize - EPS));
  return item.ranOut && packs === 0 ? 1 : packs;
}

/**
 * First `target` for an item that has none, in units: the old per-trip need
 * rounded up to whole packs, at least 1 pack. Same rule as migration 0004.
 */
export function defaultTarget(item: Item, settings: Settings): number {
  const days = Math.max(1, itemTrips(item, settings.trips).reduce((n, t) => n + t.days.length, 0));
  return item.packSize * Math.max(1, Math.ceil((item.weeklyUse * (1 + settings.margin)) / days / item.packSize - EPS));
}

/** Packs at home, for display: whole packs, with one decimal when a pack is open. */
export const packsAtHome = (item: Item): number => Math.round((item.stock / item.packSize) * 10) / 10;

/** Packs to keep at home, for display and editing. */
export const targetPacks = (item: Item, settings: Settings): number => Math.round((item.target ?? defaultTarget(item, settings)) / item.packSize);

/** Trips this item is bought on: its own list, or for older items the trips that carry its cadence. */
export function itemTrips(item: Item, trips: readonly Trip[]): Trip[] {
  const own = item.trips;
  return own ? trips.filter((t) => own.includes(t.id)) : trips.filter((t) => t.carries.includes(item.cadence));
}

/**
 * Share of a week of use bought on one day of this trip: 1 / (days in the
 * week the item is bought). A ranOut item, or an item on no trip, goes on the
 * next trip too; with no trip it gets a whole week.
 */
export function itemShare(item: Item, trip: TripId, settings: Settings, next: TripId): number {
  if (isOnce(item)) return onceTripOf(item, settings, next) === trip ? 1 : 0;
  const own = itemTrips(item, settings.trips);
  const days = own.reduce((n, t) => n + t.days.length, 0);
  if (own.some((t) => t.id === trip)) return 1 / days;
  if (trip === next && (item.ranOut || own.length === 0)) return own.length > 0 ? 1 / days : 1;
  return 0;
}

/**
 * Builds the list for a trip. Inactive items never appear.
 * A ranOut item, or an item whose cadence no trip carries, goes on the next
 * trip even when that trip does not carry its cadence; then it gets the share
 * it has on its own trips (1 when no trip carries it).
 * A one-time product goes on its own trip with its own packs (spec 012).
 * `overrides` replace the packs of items on this trip; others are ignored.
 */
export function planTrip(items: readonly Item[], trip: TripId, settings: Settings, next: TripId, overrides: Overrides = new Map()): TripLine[] {
  const lines: TripLine[] = [];
  for (const item of items) {
    if (!item.active) continue;
    const share = itemShare(item, trip, settings, next);
    if (share === 0) continue;
    const computed = isOnce(item) ? oncePacks(item) : packsFor(item, share, settings.margin);
    const set = overrides.get(item.id);
    const packs = set ?? computed;
    if (packs > 0) lines.push({ item, packs, cost: item.price === null ? null : packs * item.price, computed, overridden: set !== undefined });
  }
  return lines;
}

/**
 * Spec 014: the trip id that holds the one list's ticks, amounts and finish.
 * The first trip in settings; settings are no longer edited, so it stays.
 */
export const listTrip = (settings: Settings): TripId => settings.trips[0]!.id;

/**
 * Spec 014: the one list. Every active product that needs buying now: stock
 * below "keep at home", marked ranOut, or an active one-time product. Days and
 * trip kinds do not count. `overrides` replace the packs of lines on the list.
 */
export function planList(items: readonly Item[], settings: Settings, overrides: Overrides = new Map()): TripLine[] {
  const lines: TripLine[] = [];
  for (const item of items) {
    if (!item.active) continue;
    const computed = isOnce(item) ? oncePacks(item) : packsFor(item, 1, settings.margin);
    if (computed <= 0) continue;
    const set = overrides.get(item.id);
    const packs = set ?? computed;
    lines.push({ item, packs, cost: item.price === null ? null : packs * item.price, computed, overridden: set !== undefined });
  }
  return lines;
}

export interface CategoryGroup {
  category: string;
  lines: TripLine[];
}

export interface StoreGroup {
  storeId: string | null;
  /** The store, or null for items with no store or an unknown store id. */
  store: Shop | null;
  categories: CategoryGroup[];
  /** Sum of known line costs, or null when no line has a price. */
  total: number | null;
}

const byHebrew = (a: string, b: string) => a.localeCompare(b, 'he');

/**
 * Groups lines by store in the household's store order (spec 007), then by
 * category in shopping order (spec 013; free-text categories last, by name).
 * Lines with no known store come last.
 */
export function groupByStore(lines: readonly TripLine[], shops: readonly Shop[]): StoreGroup[] {
  const order = sortShops(shops);
  const byId = new Map(order.map((s, n) => [s.id, { shop: s, rank: n }]));
  const rank = (id: string | null) => (id !== null ? (byId.get(id)?.rank ?? order.length) : order.length + 1);
  const stores = new Map<string | null, Map<string, TripLine[]>>();
  for (const line of lines) {
    const cats = stores.get(line.item.storeId) ?? new Map<string, TripLine[]>();
    stores.set(line.item.storeId, cats);
    // Old and new names of one category share a group, under the Hebrew canonical name (spec 013).
    const cat = findCategory(line.item.category)?.he ?? line.item.category.trim();
    const list = cats.get(cat) ?? [];
    cats.set(cat, list);
    list.push(line);
  }
  return [...stores.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || byHebrew(a ?? '', b ?? ''))
    .map(([storeId, cats]) => {
      const categories = [...cats.entries()]
        .sort(([a], [b]) => compareCategories(a, b))
        .map(([category, list]) => ({ category, lines: [...list].sort((x, y) => byHebrew(x.item.name, y.item.name)) }));
      const costs = categories.flatMap((c) => c.lines).flatMap((l) => (l.cost === null ? [] : [l.cost]));
      return { storeId, store: storeId === null ? null : (byId.get(storeId)?.shop ?? null), categories, total: costs.length ? costs.reduce((s, c) => s + c, 0) : null };
    });
}

/**
 * True when the item is on this trip's stock count: carried here, or sent here as the next trip.
 * One-time products are never counted (spec 012).
 */
export function countsOnTrip(item: Item, trip: TripId, settings: Settings, next: TripId): boolean {
  return item.active && !isOnce(item) && itemShare(item, trip, settings, next) > 0;
}

/**
 * Units and packs bought for each ticked line. The store adds the units to
 * stock and clears ranOut; a one-time product is marked bought instead.
 */
export function finishTrip(lines: readonly TripLine[], ticked: ReadonlySet<string>): StockDelta[] {
  return lines.filter((l) => ticked.has(l.item.id)).map(({ item, packs }) => ({ itemId: item.id, delta: packs * item.packSize, packs }));
}

/** The stored item after a finish: one-time products become inactive and keep their stock (same as finish_household_trip). */
export function afterFinish(item: Item, delta: number): Item {
  if (isOnce(item)) return { ...item, ranOut: false, active: false };
  return { ...applyStockDelta(item, delta), ranOut: false };
}

/** Lines in store order, then shopping order, as one flat list (spec 013, home list). */
export const sortedLines = (lines: readonly TripLine[], shops: readonly Shop[]): TripLine[] =>
  groupByStore(lines, shops).flatMap((g) => g.categories.flatMap((c) => c.lines));
