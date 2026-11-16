import { describe, expect, it } from 'vitest';
import { SHOP_COUNTS, SHOP_LIMITS, nextShopSort, reorderShops, sortShops, validateShop } from './stores';
import type { Shop } from './types';

const shop = (id: string, name: string, sort = 0, active = true): Shop => ({ id, name, emoji: '', sort, active });

describe('validateShop', () => {
  const others = [shop('a', 'ירקן'), shop('b', 'מאפייה', 1, false)];

  it('accepts a new unique name', () => {
    expect(validateShop(shop('c', 'קצביה'), others)).toEqual({});
    expect(validateShop(shop('a', ' ירקן '), others)).toEqual({});
  });

  it('rejects an empty, long or taken name, archived stores included', () => {
    expect(validateShop(shop('c', '  '), others).name).toBeTruthy();
    expect(validateShop(shop('c', 'א'.repeat(SHOP_LIMITS.name + 1)), others).name).toBeTruthy();
    expect(validateShop(shop('c', ' ירקן'), others).name).toBeTruthy();
    expect(validateShop(shop('c', 'מאפייה'), others).name).toBeTruthy();
    expect(validateShop({ ...shop('c', 'x'), emoji: 'e'.repeat(SHOP_LIMITS.emoji + 1) }, others).emoji).toBeTruthy();
  });

  it('keeps the store limits of the database', () => {
    const many = (n: number, active: boolean) => Array.from({ length: n }, (_, k) => shop(`s${k}`, `s${k}`, k, active));
    const full = many(SHOP_COUNTS.active, true);
    expect(validateShop(shop('new', 'new'), full).name).toContain(String(SHOP_COUNTS.active));
    // Restoring an archived store needs room too.
    const archived = shop('old', 'old', 0, false);
    expect(validateShop({ ...archived, active: true }, [...full, archived]).name).toBeDefined();
    expect(validateShop({ ...full[0]!, name: 'renamed' }, full)).toEqual({});
    const all = many(SHOP_COUNTS.total, false);
    expect(validateShop(shop('new', 'new', 0, false), all).name).toContain(String(SHOP_COUNTS.total));
  });
});

describe('store order', () => {
  const shops = [shop('a', 'ב', 1), shop('b', 'א', 1), shop('c', 'ג', 0)];

  it('sorts by sort, then name', () => {
    expect(sortShops(shops).map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(nextShopSort(shops)).toBe(2);
    expect(nextShopSort([])).toBe(0);
  });

  it('reorders by the given ids, the rest after them', () => {
    expect(reorderShops(shops, ['a']).map((s) => [s.id, s.sort])).toEqual([
      ['a', 0],
      ['c', 1],
      ['b', 2],
    ]);
  });
});
