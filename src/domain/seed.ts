import type { Cadence, Item, Lang, Shop } from './types';
import { DEFAULT_TRIPS } from './schedule';
import { CATEGORIES, type Role, type RoleStores } from './categories';

// Spec 013: four role stores with placeholder names and a bigger product list
// without prices. Same rows as seed_role_stores and seed_items_v2 in
// migration 0007 (a unit test compares them). The user renames a store to a
// real one, and every product on it follows.

/** Role stores in their default order: role, Hebrew name, English name, emoji. */
const ROLE_STORES: [role: Role, he: string, en: string, emoji: string][] = [
  ['dry', 'חנות יבשים', 'Grocery', '🏬'],
  ['produce', 'ירקן', 'Greengrocer', '🥕'],
  ['meat', 'קצב ודגים', 'Butcher and fish', '🍗'],
  ['bakery', 'מאפייה', 'Bakery', '🍞'],
];

/** Trip by store role, through the cadence: produce and meat on the shabbat trip, bakery on friday, the rest on main. */
export const ROLE_CADENCE: Record<Role, Cadence> = { produce: 'shabbat', meat: 'shabbat', bakery: 'friday', dry: 'bulk' };

type ProductRow = [he: string, en: string, category: string, heUnit: string, enUnit: string, packSize: number, targetPacks: number];

/** Default products. Category is a key of CATEGORIES. Target is small: 1 to 4 packs. */
export const PRODUCTS: readonly ProductRow[] = [
  ['פירות', 'Fruit', 'produce', 'ק"ג', 'kg', 1, 2],
  ['ירקות', 'Vegetables', 'produce', 'ק"ג', 'kg', 1, 3],
  ['ביצים', 'Eggs', 'eggs', 'ביצה', 'egg', 12, 1],
  ['עוף', 'Chicken', 'meat', 'ק"ג', 'kg', 1, 1],
  ['דניס', 'Sea bream', 'fish', 'דג', 'fish', 1, 2],
  ['פילה סלמון', 'Salmon fillet', 'fish', 'ק"ג', 'kg', 0.5, 1],
  ['פילה אמנון', 'Tilapia fillet', 'fish', 'ק"ג', 'kg', 0.5, 1],
  ['חלה', 'Challah', 'bakery', 'חלה', 'loaf', 1, 2],
  ['לחם', 'Bread', 'bakery', 'כיכר', 'loaf', 1, 1],
  ['חלב', 'Milk', 'dairy', 'ליטר', 'liter', 1, 2],
  ['גבינה', 'Cheese', 'dairy', 'גביע', 'cup', 1, 2],
  ['יוגורט', 'Yogurt', 'dairy', 'גביע', 'cup', 1, 4],
  ['יוגורט פירות', 'Fruit yogurt', 'dairy', 'גביע', 'cup', 1, 4],
  ['משקה יוגורט', 'Yogurt drink', 'dairy', 'בקבוק', 'bottle', 1, 2],
  ['משקה שיבולת שועל', 'Oat drink', 'dairy', 'ליטר', 'liter', 1, 1],
  ['מעדן פרי', 'Fruit pudding', 'dairy', 'גביע', 'cup', 1, 4],
  ['מעדן סויה', 'Soy pudding', 'dairy', 'גביע', 'cup', 1, 4],
  ['אוכמניות קפואות', 'Frozen blueberries', 'frozen', 'אריזה', 'pack', 1, 1],
  ['חומוס מבושל קפוא', 'Frozen cooked chickpeas', 'frozen', 'אריזה', 'pack', 1, 1],
  ['אורז', 'Rice', 'dry', 'ק"ג', 'kg', 1, 1],
  ['אורז פרסי', 'Persian rice', 'dry', 'ק"ג', 'kg', 1, 1],
  ['קמח', 'Flour', 'dry', 'ק"ג', 'kg', 1, 1],
  ['קמח כוסמין', 'Spelt flour', 'dry', 'ק"ג', 'kg', 1, 1],
  ['קוסקוס', 'Couscous', 'dry', 'אריזה', 'pack', 1, 1],
  ['אבקת אפייה', 'Baking powder', 'dry', 'שקיק', 'sachet', 1, 2],
  ['תה', 'Tea', 'dry', 'שקיק', 'tea bag', 25, 1],
  ['תבלינים', 'Spices', 'dry', 'אריזה', 'pack', 1, 1],
  ['מלפפונים כבושים', 'Pickles', 'cans', 'צנצנת', 'jar', 1, 1],
  ['מיונז', 'Mayonnaise', 'cans', 'צנצנת', 'jar', 1, 1],
  ['קטשופ', 'Ketchup', 'cans', 'בקבוק', 'bottle', 1, 1],
  ['קרקרים', 'Crackers', 'snacks', 'חבילה', 'pack', 1, 1],
  ['עוגיות', 'Cookies', 'snacks', 'חבילה', 'pack', 1, 1],
  ['חטיפים', 'Snacks', 'snacks', 'חבילה', 'pack', 1, 2],
  ['תפוצ׳יפס', 'Potato chips', 'snacks', 'שקית', 'bag', 1, 1],
  ['מים מינרליים', 'Mineral water', 'drinks', 'בקבוק', 'bottle', 6, 1],
  ['מיץ ענבים', 'Grape juice', 'shabbat', 'בקבוק', 'bottle', 1, 1],
  ['יין לבן', 'White wine', 'shabbat', 'בקבוק', 'bottle', 1, 1],
  ['שקיות אשפה', 'Trash bags', 'home', 'גליל', 'roll', 1, 1],
  ['ספריי ניקוי', 'Cleaning spray', 'home', 'בקבוק', 'bottle', 1, 1],
  ['אבקת כביסה', 'Laundry powder', 'home', 'אריזה', 'pack', 1, 1],
  ['ג׳ל לאסלה', 'Toilet gel', 'home', 'בקבוק', 'bottle', 1, 1],
  ['מרכך כביסה', 'Fabric softener', 'home', 'בקבוק', 'bottle', 1, 1],
  ['נוזל ניקוי רצפות', 'Floor cleaner', 'home', 'בקבוק', 'bottle', 1, 1],
  ['נוזל כלים', 'Dish soap', 'home', 'בקבוק', 'bottle', 1, 1],
  ['נייר טואלט', 'Toilet paper', 'paper', 'גליל', 'roll', 32, 1],
  ['כפיות חד פעמי', 'Disposable spoons', 'paper', 'חבילה', 'pack', 1, 1],
  ['מזלגות חד פעמי', 'Disposable forks', 'paper', 'חבילה', 'pack', 1, 1],
  ['סכינים חד פעמי', 'Disposable knives', 'paper', 'חבילה', 'pack', 1, 1],
  ['נייר אפייה', 'Baking paper', 'paper', 'גליל', 'roll', 1, 1],
  ['נייר סנדוויץ׳', 'Sandwich paper', 'paper', 'גליל', 'roll', 1, 1],
  ['נייר כסף', 'Aluminum foil', 'paper', 'גליל', 'roll', 1, 1],
  ['שמפו', 'Shampoo', 'care', 'בקבוק', 'bottle', 1, 1],
  ['חיתולים', 'Diapers', 'baby', 'חיתול', 'diaper', 44, 1],
  ['מגבונים', 'Wet wipes', 'baby', 'חבילה', 'pack', 1, 2],
  ['חטיף לתינוק', 'Baby snack', 'baby', 'חבילה', 'pack', 1, 2],
  ['שמפו לתינוק', 'Baby shampoo', 'baby', 'בקבוק', 'bottle', 1, 1],
];

const categoryOf = (key: string) => CATEGORIES.find((c) => c.key === key)!;

/** Builds the first-run store list in this language. */
export function seedShops(newId: () => string = () => crypto.randomUUID(), lang: Lang = 'he'): Shop[] {
  return ROLE_STORES.map(([, he, en, emoji], sort) => ({ id: newId(), name: lang === 'en' ? en : he, emoji, sort, active: true }));
}

/** The role stores of a fresh seed: each role to the seed store with its name. */
export function seedRoleStores(shops: readonly Shop[], lang: Lang = 'he'): RoleStores {
  const out: RoleStores = {};
  for (const [role, he, en] of ROLE_STORES) out[role] = shops.find((s) => s.name === (lang === 'en' ? en : he))?.id ?? null;
  return out;
}

/** One default product as a new item (no id store or stock yet). Used by the seed and the data script test. */
export function productItem(row: ProductRow, lang: Lang): Omit<Item, 'id' | 'storeId'> & { role: Role } {
  const [he, en, key, heUnit, enUnit, packSize, targetPacks] = row;
  const c = categoryOf(key);
  const cadence = ROLE_CADENCE[c.role];
  return {
    name: lang === 'en' ? en : he,
    category: c[lang],
    role: c.role,
    cadence,
    trips: DEFAULT_TRIPS.filter((tr) => tr.carries.includes(cadence)).map((tr) => tr.id),
    weeklyUse: packSize * targetPacks,
    target: packSize * targetPacks,
    unit: lang === 'en' ? enUnit : heUnit,
    packSize,
    price: null,
    stock: 0,
    ranOut: false,
    active: true,
  };
}

/**
 * Builds the first-run catalog in this language. Each item points to the
 * role store of its category in `shops` (null when there is none).
 * `newId` is injected so tests stay deterministic.
 */
export function seedCatalog(shops: readonly Shop[], newId: () => string = () => crypto.randomUUID(), lang: Lang = 'he'): Item[] {
  const roles = seedRoleStores(shops, lang);
  return PRODUCTS.map((row): Item => {
    const { role, ...rest } = productItem(row, lang);
    return { id: newId(), ...rest, storeId: roles[role] ?? null };
  });
}
