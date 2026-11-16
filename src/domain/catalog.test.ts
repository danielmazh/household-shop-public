import { describe, expect, it } from 'vitest';
import { ITEM_COUNTS, LIMITS, applyStockDelta, isValid, itemPatch, markRanOut, undoRanOut, validateItem } from './catalog';
import { seedCatalog, seedShops } from './seed';
import type { Item } from './types';

const base: Item = {
  id: 'a',
  name: 'אורז',
  category: 'יבשים',
  cadence: 'bulk',
  trips: null,
  storeId: 's1',
  weeklyUse: 1,
  unit: 'ק"ג',
  packSize: 1,
  price: 9,
  stock: 0,
  ranOut: false,
  active: true,
};

describe('validateItem', () => {
  it('accepts a valid item, with or without a price', () => {
    expect(validateItem(base, [])).toEqual({});
    expect(validateItem({ ...base, price: null, weeklyUse: 0 }, [])).toEqual({});
  });

  it.each<[string, Partial<Item>, keyof Item]>([
    ['empty name', { name: '   ' }, 'name'],
    ['unknown cadence', { cadence: 'monthly' as Item['cadence'] }, 'cadence'],
    ['negative weekly use', { weeklyUse: -1 }, 'weeklyUse'],
    ['NaN weekly use', { weeklyUse: Number.NaN }, 'weeklyUse'],
    ['zero pack size', { packSize: 0 }, 'packSize'],
    ['negative pack size', { packSize: -2 }, 'packSize'],
    ['negative price', { price: -1 }, 'price'],
    ['negative stock', { stock: -0.5 }, 'stock'],
  ])('rejects %s', (_label, patch, field) => {
    const errors = validateItem({ ...base, ...patch }, []);
    expect(Object.keys(errors)).toEqual([field]);
    expect(isValid(errors)).toBe(false);
  });

  it('rejects a duplicate name, ignoring case and spaces', () => {
    const other = { ...base, id: 'b', name: ' Rice ' };
    expect(validateItem({ ...base, name: 'rice' }, [other]).name).toBeDefined();
  });

  it('does not count the item itself as a duplicate when editing', () => {
    expect(validateItem(base, [base])).toEqual({});
  });

  it('keeps the item limits of the database', () => {
    const many = (n: number, active: boolean) => Array.from({ length: n }, (_, k) => ({ ...base, id: `x${k}`, name: `x${k}`, active }));
    const full = many(ITEM_COUNTS.active, true);
    // A new active item, or one made active again, needs room.
    expect(validateItem(base, full).name).toContain(String(ITEM_COUNTS.active));
    expect(validateItem(base, [...full, { ...base, active: false }]).name).toBeDefined();
    // Editing an item that is already active, or adding an inactive one, is fine.
    expect(validateItem(full[0]!, full)).toEqual({});
    expect(validateItem({ ...base, active: false }, full)).toEqual({});
    // No new row at all once the household has the most rows.
    const all = many(ITEM_COUNTS.total, false);
    expect(validateItem({ ...base, active: false }, all).name).toContain(String(ITEM_COUNTS.total));
    expect(validateItem({ ...all[0]!, active: true }, all)).toEqual({});
  });
});

describe('markRanOut', () => {
  it('sets ranOut and zero stock', () => {
    expect(markRanOut({ ...base, stock: 3 })).toMatchObject({ ranOut: true, stock: 0 });
  });
});

describe('seedCatalog', () => {
  const shops = seedShops();
  const seed = seedCatalog(shops);
  const cadenceOf = (name: string) => seed.find((i) => i.name === name)?.cadence;

  it('keeps the spec 001 basics and adds the spec 013 list, each valid and unique', () => {
    const names = ['אורז', 'ביצים', 'קמח', 'תה', 'תבלינים', 'מיונז', 'קטשופ', 'נייר טואלט', 'מגבונים', 'חיתולים', 'חלב', 'גבינה', 'יוגורט', 'פירות', 'ירקות', 'עוף', 'דניס', 'חלה', 'מיץ ענבים', 'יין לבן', 'פילה סלמון', 'שמפו לתינוק'];
    for (const name of names) expect(seed.some((i) => i.name === name), name).toBe(true);
    expect(seed).toHaveLength(56);
    for (const item of seed) {
      expect(validateItem(item, seed), item.name).toEqual({});
      expect(item).toMatchObject({ active: true, ranOut: false, stock: 0 });
    }
  });

  it('puts each product on the trip of its store role (spec 013)', () => {
    for (const n of ['אורז', 'חלב', 'נייר טואלט', 'חיתולים', 'יין לבן']) expect(cadenceOf(n)).toBe('bulk');
    for (const n of ['פירות', 'ירקות', 'ביצים', 'עוף', 'דניס']) expect(cadenceOf(n)).toBe('shabbat');
    expect(cadenceOf('חלה')).toBe('friday');
  });

  it('points every item to a seed store', () => {
    const ids = new Set(shops.map((s) => s.id));
    expect(seed.every((i) => i.storeId !== null && ids.has(i.storeId))).toBe(true);
  });

  it('gives each item a fresh id', () => {
    expect(new Set(seed.map((i) => i.id)).size).toBe(seed.length);
  });
});

describe('limits', () => {
  it('rejects text and numbers over the database limits', () => {
    const errors = validateItem({ ...base, name: 'א'.repeat(LIMITS.name + 1), unit: 'x'.repeat(LIMITS.unit + 1), stock: LIMITS.number + 1 }, []);
    expect(Object.keys(errors).sort()).toEqual(['name', 'stock', 'unit']);
  });
});

describe('itemPatch', () => {
  it('holds only the changed fields', () => {
    expect(itemPatch(base, { ...base, storeId: 's2', price: null })).toEqual({ storeId: 's2', price: null });
    expect(itemPatch(base, { ...base })).toEqual({});
  });
});

describe('applyStockDelta', () => {
  it('keeps stock in range and clears ranOut only when stock is added', () => {
    const out = { ...base, stock: 2, ranOut: true };
    expect(applyStockDelta(out, -5)).toMatchObject({ stock: 0, ranOut: true });
    expect(applyStockDelta(out, 3)).toMatchObject({ stock: 5, ranOut: false });
    expect(applyStockDelta(out, LIMITS.number * 2).stock).toBe(LIMITS.number);
  });
});

describe('undoRanOut', () => {
  it('clears ranOut and puts back the stock from before the tap when known', () => {
    const marked = markRanOut({ ...base, stock: 3 });
    expect(itemPatch(marked, undoRanOut(marked, 3))).toEqual({ ranOut: false, stock: 3 });
    expect(itemPatch(marked, undoRanOut(marked))).toEqual({ ranOut: false });
  });
});
