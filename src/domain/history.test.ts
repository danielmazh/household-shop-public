import { describe, expect, it } from 'vitest';
import { purchaseCost, purchaseLines, sortPurchases } from './history';
import type { Item, Purchase, PurchaseLine } from './types';

const item = (patch: Partial<Item>): Item => ({
  id: 'a',
  name: 'Rice',
  category: '',
  cadence: 'bulk',
  trips: ['main'],
  storeId: 's1',
  weeklyUse: 1,
  unit: 'kg',
  packSize: 2,
  price: 9,
  stock: 0,
  ranOut: false,
  active: true,
  ...patch,
});

const line = (patch: Partial<PurchaseLine>): PurchaseLine => ({ itemId: 'a', name: 'Rice', packs: 1, units: 1, unit: '', storeName: null, price: null, ...patch });

describe('purchaseLines', () => {
  it('copies name, unit, store and price at this time', () => {
    const shops = [{ id: 's1', name: 'Market', emoji: '', sort: 0, active: true }];
    expect(purchaseLines([{ itemId: 'a', delta: 4, packs: 2 }], [item({})], shops)).toEqual([
      { itemId: 'a', name: 'Rice', packs: 2, units: 4, unit: 'kg', storeName: 'Market', price: 9 },
    ]);
  });

  it('computes packs from units when packs are missing, and skips unknown items', () => {
    const lines = purchaseLines([{ itemId: 'a', delta: 3 }, { itemId: 'x', delta: 1 }], [item({ storeId: null })], []);
    expect(lines).toEqual([{ itemId: 'a', name: 'Rice', packs: 1.5, units: 3, unit: 'kg', storeName: null, price: 9 }]);
  });
});

describe('purchaseCost', () => {
  it('sums packs * price of the lines with a price', () => {
    expect(purchaseCost({ lines: [line({ packs: 2, price: 5 }), line({ packs: 3, price: null }), line({ packs: 1, price: 2.5 })] })).toBe(12.5);
  });

  it('is null when no line has a price', () => {
    expect(purchaseCost({ lines: [line({})] })).toBeNull();
    expect(purchaseCost({ lines: [] })).toBeNull();
  });
});

describe('sortPurchases', () => {
  it('puts the newest first', () => {
    const p = (id: string, finishedAt: string): Purchase => ({ id, trip: 'main', tripName: null, finishedBy: null, finishedAt, lines: [] });
    expect(sortPurchases([p('a', '2026-11-01T10:00:00Z'), p('b', '2026-11-03T10:00:00Z')]).map((x) => x.id)).toEqual(['b', 'a']);
  });
});
