import { describe, expect, it } from 'vitest';
import { CATEGORIES, canonicalCategory, categoryNames, compareCategories, findCategory, itemsForRoleChange, parseRoleStores, roleOf, roleStoreFor, roleTargets } from './categories';
import { groupByStore } from './planner';
import { normalizeSettings, toStoredSettings, DEFAULT_SETTINGS } from './schedule';
import type { Item } from './types';

const HEBREW = /[֐-׿]/;

let n = 0;
const item = (patch: Partial<Item>): Item => ({
  id: `i${++n}`, name: `item ${n}`, category: '', cadence: 'bulk', trips: null, storeId: null, weeklyUse: 1, unit: '', packSize: 1, price: null, stock: 0, ranOut: false, active: true, ...patch,
});

describe('categories (spec 013)', () => {
  it('has 17 categories in shopping order, in both languages', () => {
    expect(categoryNames('he')[0]).toBe('פירות וירקות');
    expect(categoryNames('he').at(-1)).toBe('כללי');
    expect(CATEGORIES).toHaveLength(17);
    expect(categoryNames('en').filter((c) => HEBREW.test(c))).toEqual([]);
  });

  it('maps old names and the empty category', () => {
    expect(canonicalCategory('יבשים', 'he')).toBe('יבשים ודגנים');
    expect(canonicalCategory('רטבים ושימורים', 'he')).toBe('שימורים ורטבים');
    expect(canonicalCategory('בית וניקיון', 'he')).toBe('ניקיון ובית');
    expect(canonicalCategory('חד פעמי', 'he')).toBe('נייר וחד פעמי');
    expect(canonicalCategory('טיפוח', 'he')).toBe('טיפוח ופארם');
    expect(canonicalCategory('', 'he')).toBe('כללי');
    expect(canonicalCategory('Dry goods', 'en')).toBe('Dry goods and grains');
    expect(canonicalCategory('דגים', 'en')).toBe('Fish');
    expect(canonicalCategory('משהו שלי', 'he')).toBe('משהו שלי');
    expect(findCategory('  מוצרי   חלב ')?.key).toBe('dairy');
  });

  it('sorts in shopping order with free text last', () => {
    expect(['כללי', 'משהו', 'דגים', 'פירות וירקות', 'יבשים'].sort(compareCategories)).toEqual(['פירות וירקות', 'דגים', 'יבשים', 'כללי', 'משהו']);
  });

  it('groups trip lines by category in shopping order', () => {
    const lines = ['שבת', 'ביצים', 'אחר', 'פירות וירקות'].map((category) => ({ item: item({ category }), packs: 1, cost: null, computed: 1, overridden: false }));
    expect(groupByStore(lines, [])[0]!.categories.map((c) => c.category)).toEqual(['פירות וירקות', 'ביצים', 'שבת', 'אחר']);
  });

  it('gives each category a role, dry by default', () => {
    expect(roleOf('ביצים')).toBe('produce');
    expect(roleOf('דגים')).toBe('meat');
    expect(roleOf('לחם ומאפים')).toBe('bakery');
    expect(roleOf('Dairy')).toBe('dry');
    expect(roleOf('משהו')).toBe('dry');
    expect(roleStoreFor('ירקות', { produce: 's2' })).toBe('s2');
    expect(roleStoreFor('ירקות', {})).toBeNull();
  });

  it('moves only products of the role with no store or the old role store', () => {
    const a = item({ category: 'פירות וירקות', storeId: null });
    const b = item({ category: 'ביצים', storeId: 'old' });
    const c = item({ category: 'ירקות', storeId: 'mine' });
    const d = item({ category: 'יבשים', storeId: null });
    expect(itemsForRoleChange([a, b, c, d], 'produce', 'old', 'new')).toEqual([a, b]);
    expect(itemsForRoleChange([a, b], 'produce', 'old', 'old')).toEqual([]);
  });

  it('archive by default stores: each product goes to its role store, else to no store', () => {
    const fish = item({ id: 'f', category: 'דגים', storeId: 'rami' });
    const fruit = item({ id: 'p', category: 'פירות וירקות', storeId: 'rami' });
    const dry = item({ id: 'd', category: 'יבשים', storeId: 'rami' });
    const bread = item({ id: 'b', category: 'לחם ומאפים', storeId: 'rami' });
    const other = item({ id: 'o', category: 'דגים', storeId: 'carrefour' });
    const roles = { meat: 'butcher', produce: 'greens', dry: 'rami', bakery: 'gone' };
    const out = roleTargets([fish, fruit, dry, bread, other], 'rami', roles, new Set(['butcher', 'greens', 'rami', 'carrefour']));
    expect(out.get('butcher')).toEqual(['f']);
    expect(out.get('greens')).toEqual(['p']);
    // The role store is the archived store, or an archived store: no store.
    expect(out.get(null)).toEqual(['d', 'b']);
    expect([...out.values()].flat()).not.toContain('o');
  });

  it('keeps roleStores through settings parse and save', () => {
    const s = { ...DEFAULT_SETTINGS, roleStores: { dry: 'a', produce: null } };
    expect(normalizeSettings(JSON.parse(JSON.stringify(toStoredSettings(s)))).roleStores).toEqual({ dry: 'a', produce: null });
    expect(normalizeSettings({}).roleStores).toEqual({});
    expect(parseRoleStores({ dry: 5, meat: 'm', other: 'x' })).toEqual({ meat: 'm' });
  });
});
