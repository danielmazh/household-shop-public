// Fixed categories in shopping order and store roles (spec 013).
import type { Item, Lang } from './types';

export const ROLES = ['dry', 'produce', 'meat', 'bakery'] as const;
/** Store role: which default store a product goes to. `dry` is the fallback. */
export type Role = (typeof ROLES)[number];

/** Default store per role: a store id or null. */
export type RoleStores = Partial<Record<Role, string | null>>;

export interface Category {
  key: string;
  he: string;
  en: string;
  role: Role;
}

/** The canonical list, in the order people walk a store. */
export const CATEGORIES: readonly Category[] = [
  { key: 'produce', he: 'פירות וירקות', en: 'Fruit and veg', role: 'produce' },
  { key: 'eggs', he: 'ביצים', en: 'Eggs', role: 'produce' },
  { key: 'meat', he: 'בשר ועוף', en: 'Meat and chicken', role: 'meat' },
  { key: 'fish', he: 'דגים', en: 'Fish', role: 'meat' },
  { key: 'dairy', he: 'מוצרי חלב', en: 'Dairy', role: 'dry' },
  { key: 'bakery', he: 'לחם ומאפים', en: 'Bread and bakery', role: 'bakery' },
  { key: 'frozen', he: 'קפואים', en: 'Frozen', role: 'dry' },
  { key: 'dry', he: 'יבשים ודגנים', en: 'Dry goods and grains', role: 'dry' },
  { key: 'cans', he: 'שימורים ורטבים', en: 'Cans and sauces', role: 'dry' },
  { key: 'snacks', he: 'חטיפים ומתוקים', en: 'Snacks and sweets', role: 'dry' },
  { key: 'drinks', he: 'משקאות', en: 'Drinks', role: 'dry' },
  { key: 'shabbat', he: 'שבת', en: 'Weekend', role: 'dry' },
  { key: 'home', he: 'ניקיון ובית', en: 'Cleaning and home', role: 'dry' },
  { key: 'paper', he: 'נייר וחד פעמי', en: 'Paper and disposables', role: 'dry' },
  { key: 'care', he: 'טיפוח ופארם', en: 'Personal care', role: 'dry' },
  { key: 'baby', he: 'תינוק', en: 'Baby', role: 'dry' },
  { key: 'general', he: 'כללי', en: 'General', role: 'dry' },
];

/** Old and common names -> category key. Same list as the data script for our home. */
const ALIASES: Record<string, string> = {
  '': 'general',
  'יבשים': 'dry',
  'רטבים ושימורים': 'cans',
  'שימורים': 'cans',
  'בית וניקיון': 'home',
  'ניקיון': 'home',
  'חד פעמי': 'paper',
  'טיפוח': 'care',
  'פארם': 'care',
  'פירות': 'produce',
  'ירקות': 'produce',
  'בשר': 'meat',
  'עוף': 'meat',
  'חלב': 'dairy',
  'לחם': 'bakery',
  'מאפים': 'bakery',
  'מאפייה': 'bakery',
  'קפוא': 'frozen',
  'חטיפים': 'snacks',
  'מתוקים': 'snacks',
  'שתייה': 'drinks',
  'dry goods': 'dry',
  'sauces and cans': 'cans',
  'home and cleaning': 'home',
  'bread': 'bakery',
};

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');

const byName = new Map<string, Category>();
for (const c of CATEGORIES) {
  byName.set(norm(c.he), c);
  byName.set(norm(c.en), c);
}
const byKey = new Map(CATEGORIES.map((c) => [c.key, c]));
for (const [alias, key] of Object.entries(ALIASES)) byName.set(norm(alias), byKey.get(key)!);

/** The canonical category for a name (Hebrew, English or an old name), or undefined for a free-text category. */
export const findCategory = (name: string): Category | undefined => byName.get(norm(name));

/** The canonical name in this language, or the name as typed when it is not on the list. */
export const canonicalCategory = (name: string, lang: Lang): string => {
  const c = findCategory(name);
  return c ? c[lang] : name.trim();
};

/** Category names in shopping order, in this language. */
export const categoryNames = (lang: Lang): string[] => CATEGORIES.map((c) => c[lang]);

/** Position in shopping order; free-text categories come after the list. */
export const categoryRank = (name: string): number => {
  const c = findCategory(name);
  return c ? CATEGORIES.indexOf(c) : CATEGORIES.length;
};

/** Shopping order: list order, then free-text categories by name. */
export const compareCategories = (a: string, b: string): number => categoryRank(a) - categoryRank(b) || a.localeCompare(b, 'he');

/** The store role of a category. Free text and unknown names are `dry`. */
export const roleOf = (category: string): Role => findCategory(category)?.role ?? 'dry';

/** The default store for a product of this category, or null when the role has none. */
export const roleStoreFor = (category: string, roleStores: RoleStores): string | null => roleStores[roleOf(category)] ?? null;

/**
 * Products that follow a role store change: products of that role whose
 * store is empty or the old role store. Other store choices stay.
 */
export function itemsForRoleChange(items: readonly Item[], role: Role, oldStore: string | null, newStore: string | null): Item[] {
  if (oldStore === newStore) return [];
  return items.filter((i) => roleOf(i.category) === role && (i.storeId === null || i.storeId === oldStore) && i.storeId !== newStore);
}

/**
 * Archive "by default stores" (2026-11-15): where each product of store `storeId` goes.
 * Its role store when that store is active and is not the archived one, else no store.
 * Returns target store (or null) -> item ids, in a stable order.
 */
export function roleTargets(items: readonly Item[], storeId: string, roleStores: RoleStores, activeIds: ReadonlySet<string>): Map<string | null, string[]> {
  const out = new Map<string | null, string[]>();
  for (const i of items) {
    if (i.storeId !== storeId) continue;
    const want = roleStoreFor(i.category, roleStores);
    const to = want !== null && want !== storeId && activeIds.has(want) ? want : null;
    out.set(to, [...(out.get(to) ?? []), i.id]);
  }
  return out;
}

/** Reads roleStores from stored settings: only string ids or null under known roles. */
export function parseRoleStores(raw: unknown): RoleStores {
  const out: RoleStores = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const role of ROLES) {
    const v = (raw as Record<string, unknown>)[role];
    if (typeof v === 'string' && v.length > 0 && v.length <= 64) out[role] = v;
    else if (v === null) out[role] = null;
  }
  return out;
}
