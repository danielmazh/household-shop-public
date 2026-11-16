import { CADENCES, type Item, type ItemPatch, type ValidationErrors } from './types';

/** Limits shared with the database checks in supabase/migrations/0001_init.sql. */
export const LIMITS = { name: 60, category: 40, unit: 20, number: 100000 } as const;

/** Items per household: active ones, and all of them with the inactive ones (spec 003). Same as the SQL triggers. */
export const ITEM_COUNTS = { active: 500, total: 2000 } as const;

const isNumber = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

const normalName = (name: string) => name.trim().toLocaleLowerCase('he');

/**
 * Checks an item against the rules in spec 001.
 * `others` is the rest of the catalog, used for the unique name rule.
 * Returns an empty object when the item is valid.
 */
export function validateItem(item: Item, others: readonly Item[]): ValidationErrors {
  const errors: ValidationErrors = {};
  const name = normalName(item.name);
  if (!name) {
    errors.name = 'שם חובה';
  } else if (item.name.trim().length > LIMITS.name) {
    errors.name = `עד ${LIMITS.name} תווים`;
  } else if (others.some((o) => o.id !== item.id && normalName(o.name) === name)) {
    errors.name = 'כבר יש פריט בשם הזה';
  }
  if (!CADENCES.includes(item.cadence)) errors.cadence = 'תדירות לא חוקית';
  if (item.trips && item.trips.length === 0) errors.trips = 'בחרו לפחות קנייה אחת';
  if (!isNumber(item.weeklyUse) || item.weeklyUse < 0) errors.weeklyUse = 'צריכה שבועית חייבת להיות 0 או יותר';
  if (!isNumber(item.packSize) || item.packSize <= 0) errors.packSize = 'גודל אריזה חייב להיות גדול מ-0';
  if (item.price !== null && (!isNumber(item.price) || item.price < 0)) errors.price = 'מחיר חייב להיות 0 או יותר';
  if (!isNumber(item.stock) || item.stock < 0) errors.stock = 'מלאי חייב להיות 0 או יותר';
  for (const field of ['category', 'unit'] as const) {
    if (item[field].length > LIMITS[field]) errors[field] = `עד ${LIMITS[field]} תווים`;
  }
  for (const field of ['weeklyUse', 'packSize', 'price', 'stock'] as const) {
    const n = item[field];
    if (!errors[field] && n !== null && n > LIMITS.number) errors[field] = `עד ${LIMITS.number}`;
  }
  const count = errors.name ? undefined : itemCountError(item, others);
  if (count) errors.name = count;
  return errors;
}

/**
 * Error when saving `item` would pass an item limit: a new item when there
 * are 2000 in all, or an item that becomes active when 500 are active.
 */
export function itemCountError(item: Item, others: readonly Item[]): string | undefined {
  const before = others.find((o) => o.id === item.id);
  const rest = others.filter((o) => o.id !== item.id);
  if (!before && rest.length >= ITEM_COUNTS.total) return `אפשר עד ${ITEM_COUNTS.total} פריטים בסך הכול. ערכו פריט לא פעיל במקום.`;
  if (item.active && !before?.active && rest.filter((o) => o.active).length >= ITEM_COUNTS.active) {
    return `אפשר עד ${ITEM_COUNTS.active} פריטים פעילים. הוציאו פריט מהרשימה קודם.`;
  }
  return undefined;
}

export const isValid = (errors: ValidationErrors) => Object.keys(errors).length === 0;

/** "Ran out" tap: nothing is left at home. */
export const markRanOut = (item: Item): Item => ({ ...item, ranOut: true, stock: 0 });

/** Undo of a wrong "ran out" tap: clears ranOut and puts back the stock from before the tap when it is known. */
export const undoRanOut = (item: Item, stockBefore?: number): Item => ({ ...item, ranOut: false, stock: stockBefore ?? item.stock });

/**
 * The fields of `after` that differ from `before`, so an edit sends only
 * what the user changed and does not undo someone else's change.
 */
export function itemPatch(before: Item, after: Item): ItemPatch {
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof Item)[]) {
    if (key !== 'id' && !Object.is(before[key], after[key])) patch[key] = after[key];
  }
  return patch as ItemPatch;
}

/**
 * Relative stock change, the same rule as the adjust_stock and finish_trip
 * SQL functions: stock stays in 0..LIMITS.number. Adding stock clears ranOut.
 */
export function applyStockDelta(item: Item, delta: number): Item {
  const stock = Math.min(LIMITS.number, Math.max(0, item.stock + delta));
  return { ...item, stock, ranOut: delta > 0 ? false : item.ranOut };
}
