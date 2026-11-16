import { describe, expect, it } from 'vitest';
import { applyStockDelta } from './catalog';
import { afterFinish, countsOnTrip, defaultTarget, finishTrip, oncePacks, groupByStore, itemShare, itemTrips, listTrip, packsAtHome, packsFor, planList, planTrip, targetPacks, type TripLine } from './planner';
import { DEFAULT_SETTINGS } from './schedule';
import type { Item, Shop } from './types';

let n = 0;
const item = (patch: Partial<Item> = {}): Item => ({
  id: `i${++n}`,
  name: `item ${n}`,
  category: 'cat',
  cadence: 'bulk',
  trips: null,
  storeId: null,
  weeklyUse: 1,
  unit: 'unit',
  packSize: 1,
  price: null,
  stock: 0,
  ranOut: false,
  active: true,
  ...patch,
});

const noMargin = { ...DEFAULT_SETTINGS, margin: 0 };
const packsOn = (items: Item[], trip: string, settings = noMargin, next = trip) =>
  planTrip(items, trip, settings, next).map((l) => [l.item.id, l.packs]);

describe('packsFor', () => {
  it('applies the safety margin', () => {
    expect(packsFor(item({ weeklyUse: 10 }), 1, 0)).toBe(10);
    expect(packsFor(item({ weeklyUse: 10 }), 1, 0.5)).toBe(15);
  });

  it('rounds up to whole packs', () => {
    expect(packsFor(item({ weeklyUse: 13, packSize: 6 }), 1, 0)).toBe(3);
    expect(packsFor(item({ weeklyUse: 12, packSize: 6 }), 1, 0)).toBe(2);
  });

  it('does not add a pack for float noise', () => {
    // 0.1 * 3 / 0.1 = 3.0000000000000004 in floating point
    expect(packsFor(item({ weeklyUse: 0.1, packSize: 0.1 }), 1, 2)).toBe(3);
  });

  it('subtracts stock and gives 0 when stock covers the target', () => {
    expect(packsFor(item({ weeklyUse: 10, packSize: 4, stock: 3 }), 1, 0)).toBe(2);
    expect(packsFor(item({ weeklyUse: 10, stock: 10 }), 1, 0)).toBe(0);
    expect(packsFor(item({ weeklyUse: 10, stock: 50 }), 1, 0.1)).toBe(0);
  });

  it('forces one pack when ranOut and nothing else is needed', () => {
    expect(packsFor(item({ weeklyUse: 0, ranOut: true }), 1, 0)).toBe(1);
    expect(packsFor(item({ weeklyUse: 5, ranOut: true }), 1, 0)).toBe(5);
  });
});

describe('planTrip', () => {
  it('uses the share of each cadence on each trip', () => {
    const bulk = item({ cadence: 'bulk', weeklyUse: 4 });
    const fresh = item({ cadence: 'fresh', weeklyUse: 4 });
    const shabbat = item({ cadence: 'shabbat', weeklyUse: 4 });
    const friday = item({ cadence: 'friday', weeklyUse: 4 });
    const all = [bulk, fresh, shabbat, friday];
    expect(packsOn(all, 'main')).toEqual([[bulk.id, 4], [fresh.id, 2]]);
    expect(packsOn(all, 'shabbat')).toEqual([[fresh.id, 2], [shabbat.id, 4]]);
    expect(packsOn(all, 'friday')).toEqual([[friday.id, 4]]);
  });

  it('applies the margin from settings', () => {
    expect(packsOn([item({ cadence: 'fresh', weeklyUse: 10 })], 'main', DEFAULT_SETTINGS)[0]?.[1]).toBe(6);
  });

  it('skips inactive items and items with nothing to buy', () => {
    expect(packsOn([item({ active: false }), item({ stock: 5 })], 'main')).toEqual([]);
    expect(packsOn([item({ active: false, ranOut: true })], 'main')).toEqual([]);
  });

  it('puts a ranOut item of any cadence on the next trip only', () => {
    const wine = item({ cadence: 'shabbat', weeklyUse: 1, ranOut: true });
    expect(packsOn([wine], 'main', noMargin, 'main')).toEqual([[wine.id, 1]]);
    expect(packsOn([wine], 'friday', noMargin, 'main')).toEqual([]);
    const milk = item({ cadence: 'fresh', weeklyUse: 4, ranOut: true });
    expect(packsOn([milk], 'friday', noMargin, 'friday')).toEqual([[milk.id, 2]]);
  });

  it('puts a cadence no trip carries on the next trip only, with a full week', () => {
    const settings = { ...noMargin, trips: noMargin.trips.filter((t) => t.id !== 'friday') };
    const challah = item({ cadence: 'friday', weeklyUse: 2 });
    expect(packsOn([challah], 'main', settings, 'main')).toEqual([[challah.id, 2]]);
    expect(packsOn([challah], 'shabbat', settings, 'main')).toEqual([]);
  });

  it('adds line cost when the item has a price', () => {
    const [priced, unpriced] = planTrip([item({ weeklyUse: 3, price: 2.5 }), item()], 'main', noMargin, 'main');
    expect(priced?.cost).toBe(7.5);
    expect(unpriced?.cost).toBeNull();
  });
});

describe('groupByStore', () => {
  const line = (patch: Partial<Item>, packs: number, cost: number | null): TripLine => ({ item: item(patch), packs, cost, computed: packs, overridden: false });

  const shop = (id: string, name: string, sort: number): Shop => ({ id, name, emoji: '', sort, active: true });
  const shops = [shop('a', 'א', 2), shop('b', 'ב', 1)];

  it('groups by store in store order, then category, with totals of known prices', () => {
    const groups = groupByStore(
      [
        line({ storeId: 'b', category: 'y', name: 'z' }, 1, 3),
        line({ storeId: 'a', category: 'x' }, 1, null),
        line({ storeId: 'b', category: 'x' }, 2, 4),
        line({ storeId: 'b', category: 'y', name: 'a' }, 1, null),
      ],
      shops,
    );
    expect(groups.map((g) => g.store?.name)).toEqual(['ב', 'א']);
    expect(groups[1]?.total).toBeNull();
    expect(groups[0]?.total).toBe(7);
    expect(groups[0]?.categories.map((c) => c.category)).toEqual(['x', 'y']);
    expect(groups[0]?.categories[1]?.lines.map((l) => l.item.name)).toEqual(['a', 'z']);
  });

  it('puts an unknown store, then no store, last', () => {
    const groups = groupByStore([line({ storeId: null }, 1, null), line({ storeId: 'x' }, 1, null), line({ storeId: 'a' }, 1, null)], shops);
    expect(groups.map((g) => [g.storeId, g.store?.name ?? null])).toEqual([
      ['a', 'א'],
      ['x', null],
      [null, null],
    ]);
  });
});

describe('finishTrip', () => {
  it('returns packs * packSize for ticked items only', () => {
    const a = item({ stock: 1, packSize: 6, ranOut: true });
    const b = item({ stock: 2 });
    const lines: TripLine[] = [
      { item: a, packs: 2, cost: null, computed: 2, overridden: false },
      { item: b, packs: 1, cost: null, computed: 1, overridden: false },
    ];
    expect(finishTrip(lines, new Set([a.id]))).toEqual([{ itemId: a.id, delta: 12, packs: 2 }]);
  });

  it('takes the item off the plan after finishing', () => {
    const a = item({ weeklyUse: 3, packSize: 2, ranOut: true });
    const lines = planTrip([a], 'main', DEFAULT_SETTINGS, 'main');
    const [line] = finishTrip(lines, new Set([a.id]));
    const after = applyStockDelta(a, line!.delta);
    expect(planTrip([after], 'main', DEFAULT_SETTINGS, 'main')).toEqual([]);
  });
});

describe('items with their own trips', () => {
  const trips = [
    { id: 'main', name: 'גדולה', emoji: '', days: [0], carries: ['bulk' as const] },
    { id: 'fresh', name: 'טריות', emoji: '', days: [1, 4], carries: ['fresh' as const] },
  ];
  const s = { ...DEFAULT_SETTINGS, margin: 0, trips };
  const cucumber = item({ trips: ['fresh'], cadence: 'bulk', weeklyUse: 6 });

  it('buys on its own trips, split by trip days, and ignores its cadence', () => {
    expect(itemTrips(cucumber, trips).map((t) => t.id)).toEqual(['fresh']);
    expect(itemShare(cucumber, 'fresh', s, 'main')).toBe(0.5);
    expect(itemShare(cucumber, 'main', s, 'main')).toBe(0);
    expect(planTrip([cucumber], 'fresh', s, 'fresh').map((l) => l.packs)).toEqual([3]);
  });

  it('goes on the next trip with a whole week when its trips are gone', () => {
    const lost = item({ trips: ['gone'], weeklyUse: 2 });
    expect(itemShare(lost, 'main', s, 'main')).toBe(1);
    expect(itemShare(lost, 'fresh', s, 'main')).toBe(0);
  });

  it('falls back to its cadence when it has no trips list', () => {
    expect(itemTrips(item({ trips: null, cadence: 'fresh' }), trips).map((t) => t.id)).toEqual(['fresh']);
  });
});

describe('keep at home (spec 009)', () => {
  it('fills stock up to the target, ignoring weekly use and margin', () => {
    // The operator example: keep 3 packs of rice, 2 at home, buy 1.
    expect(packsFor(item({ target: 3, stock: 2, weeklyUse: 50 }), 0.5, 0.5)).toBe(1);
    expect(packsFor(item({ target: 3, stock: 3 }), 1, 0)).toBe(0);
    expect(packsFor(item({ target: 3, stock: 5 }), 1, 0)).toBe(0);
  });

  it('counts in whole packs', () => {
    expect(packsFor(item({ target: 24, stock: 5, packSize: 12 }), 1, 0)).toBe(2);
    expect(packsFor(item({ target: 24, stock: 12, packSize: 12 }), 1, 0)).toBe(1);
  });

  it('buys one pack for a ranOut item even at target', () => {
    expect(packsFor(item({ target: 0, stock: 0, ranOut: true }), 1, 0)).toBe(1);
  });

  it('keeps the old rule when target is null', () => {
    expect(packsFor(item({ target: null, weeklyUse: 10 }), 1, 0)).toBe(10);
  });

  it('defaultTarget matches migration 0004', () => {
    const s = { ...DEFAULT_SETTINGS, margin: 0.1 };
    expect(defaultTarget(item({ trips: ['main'], weeklyUse: 10, packSize: 12 }), s)).toBe(12);
    expect(defaultTarget(item({ trips: ['main', 'shabbat'], weeklyUse: 6 }), s)).toBe(4);
    expect(defaultTarget(item({ trips: [], weeklyUse: 2 }), s)).toBe(3);
    expect(defaultTarget(item({ trips: ['main'], weeklyUse: 1 }), s)).toBe(2);
  });

  it('shows stock and target in packs', () => {
    expect(packsAtHome(item({ stock: 18, packSize: 12 }))).toBe(1.5);
    expect(targetPacks(item({ target: 24, packSize: 12 }), DEFAULT_SETTINGS)).toBe(2);
  });
});

describe('amount for this trip (spec 012)', () => {
  const rice = item({ trips: ['main'], target: 3, stock: 1, price: 5 });

  it('replaces the computed packs and the cost', () => {
    const [line] = planTrip([rice], 'main', noMargin, 'main', new Map([[rice.id, 6]]));
    expect(line).toMatchObject({ packs: 6, computed: 2, overridden: true, cost: 30 });
  });

  it('is back to the computed amount without the override', () => {
    const [line] = planTrip([rice], 'main', noMargin, 'main', new Map());
    expect(line).toMatchObject({ packs: 2, computed: 2, overridden: false, cost: 10 });
  });

  it('keeps the line when stock covers the target but an override is set', () => {
    const full = item({ trips: ['main'], target: 2, stock: 2 });
    expect(planTrip([full], 'main', noMargin, 'main')).toEqual([]);
    expect(planTrip([full], 'main', noMargin, 'main', new Map([[full.id, 1]])).map((l) => l.packs)).toEqual([1]);
  });

  it('is ignored for an item that is not on this trip', () => {
    expect(planTrip([rice], 'friday', noMargin, 'main', new Map([[rice.id, 4]]))).toEqual([]);
  });

  it('is what finish buys', () => {
    const lines = planTrip([rice], 'main', noMargin, 'main', new Map([[rice.id, 4]]));
    expect(finishTrip(lines, new Set([rice.id]))).toEqual([{ itemId: rice.id, delta: 4, packs: 4 }]);
  });
});

describe('one-time products (spec 012)', () => {
  const fan = item({ trips: ['main'], onceTrip: 'main', target: 2, packSize: 1, stock: 5 });

  it('goes on its own trip only, with its packs, whatever the stock', () => {
    expect(packsOn([fan], 'main', noMargin, 'shabbat')).toEqual([[fan.id, 2]]);
    expect(packsOn([fan], 'shabbat', noMargin, 'shabbat')).toEqual([]);
    expect(oncePacks(item({ target: null, packSize: 6 }))).toBe(1);
  });

  it('goes on the next trip when its trip was removed', () => {
    const lost = { ...fan, onceTrip: 'gone' };
    expect(packsOn([lost], 'shabbat', noMargin, 'shabbat')).toEqual([[lost.id, 2]]);
    expect(packsOn([lost], 'main', noMargin, 'shabbat')).toEqual([]);
  });

  it('is never on the stock count', () => {
    expect(countsOnTrip(fan, 'main', noMargin, 'main')).toBe(false);
    expect(countsOnTrip(item({ trips: ['main'] }), 'main', noMargin, 'main')).toBe(true);
  });

  it('is bought on finish: inactive, stock unchanged', () => {
    expect(afterFinish(fan, 2)).toMatchObject({ active: false, stock: 5, ranOut: false });
    expect(afterFinish(item({ stock: 1, ranOut: true }), 2)).toMatchObject({ active: true, stock: 3, ranOut: false });
  });

  it('does not show once bought', () => {
    expect(planTrip([{ ...fan, active: false }], 'main', noMargin, 'main')).toEqual([]);
  });
});

describe('planList (spec 014)', () => {
  it('lists every product below its target, on any trip, with fill-up packs', () => {
    const rice = item({ target: 3, stock: 1, trips: ['friday'] });
    const full = item({ target: 2, stock: 2 });
    const gone = item({ target: 2, stock: 2, ranOut: true });
    const once = item({ onceTrip: 'shabbat', target: 2, packSize: 1, stock: 9 });
    const off = item({ target: 5, stock: 0, active: false });
    const lines = planList([rice, full, gone, once, off], noMargin);
    expect(lines.map((l) => [l.item.id, l.packs])).toEqual([
      [rice.id, 2],
      [gone.id, 1],
      [once.id, 2],
    ]);
  });

  it('uses the amount set for this time', () => {
    const rice = item({ target: 3, stock: 1, price: 4 });
    const [line] = planList([rice], noMargin, new Map([[rice.id, 5]]));
    expect(line).toMatchObject({ packs: 5, computed: 2, overridden: true, cost: 20 });
  });

  it('keeps ticks and finish on the first trip', () => {
    expect(listTrip(noMargin)).toBe(noMargin.trips[0]!.id);
  });
});
