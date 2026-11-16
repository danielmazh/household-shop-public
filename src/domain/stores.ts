import type { Shop, ShopErrors } from './types';

/** Limits shared with the database checks in supabase/migrations/0001_init.sql. */
export const SHOP_LIMITS = { name: 40, emoji: 16 } as const;

/** Stores per household: active ones, and all of them with the archive (spec 003). Same as the SQL triggers. */
export const SHOP_COUNTS = { active: 50, total: 200 } as const;

const normalName = (name: string) => name.trim().toLocaleLowerCase('he');

/**
 * Checks a store against spec 007. `others` is every store of the household,
 * archived ones too: a name stays taken while its store is archived.
 */
export function validateShop(shop: Shop, others: readonly Shop[]): ShopErrors {
  const errors: ShopErrors = {};
  const name = normalName(shop.name);
  if (!name) errors.name = 'שם חובה';
  else if (shop.name.trim().length > SHOP_LIMITS.name) errors.name = `עד ${SHOP_LIMITS.name} תווים`;
  else if (others.some((o) => o.id !== shop.id && normalName(o.name) === name)) errors.name = 'כבר יש חנות בשם הזה';
  if (shop.emoji.length > SHOP_LIMITS.emoji) errors.emoji = 'אימוג׳י לא חוקי';
  const count = errors.name ? undefined : shopCountError(shop, others);
  if (count) errors.name = count;
  return errors;
}

/**
 * Error when saving `shop` would pass a store limit: a new store when there
 * are 200 in all, or a store that becomes active when 50 are active.
 */
export function shopCountError(shop: Shop, others: readonly Shop[]): string | undefined {
  const before = others.find((o) => o.id === shop.id);
  const rest = others.filter((o) => o.id !== shop.id);
  if (!before && rest.length >= SHOP_COUNTS.total) return `אפשר עד ${SHOP_COUNTS.total} חנויות בסך הכול. שחזרו חנות מהארכיון במקום.`;
  if (shop.active && !before?.active && rest.filter((o) => o.active).length >= SHOP_COUNTS.active) {
    return `אפשר עד ${SHOP_COUNTS.active} חנויות פעילות. העבירו חנות לארכיון קודם.`;
  }
  return undefined;
}

/** The household's store order: sort, then name. */
export const sortShops = (shops: readonly Shop[]): Shop[] =>
  [...shops].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, 'he'));

/** Sort value for a new store: after all the others. */
export const nextShopSort = (shops: readonly Shop[]): number => shops.reduce((m, s) => Math.max(m, s.sort + 1), 0);

/** Stores in `ids` order get sort 0, 1, 2, ...; stores not in `ids` keep their place after them. */
export function reorderShops(shops: readonly Shop[], ids: readonly string[]): Shop[] {
  const rank = new Map(ids.map((id, n) => [id, n]));
  const rest = sortShops(shops.filter((s) => !rank.has(s.id)));
  const listed = shops.filter((s) => rank.has(s.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  return [...listed, ...rest].map((s, sort) => ({ ...s, sort }));
}
