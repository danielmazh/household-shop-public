import { ITEM_COUNTS } from '../domain/catalog';
import { SHOP_COUNTS } from '../domain/stores';
import { domainText, getLang, locale, t } from './i18n';

/** Day names in the active language, Sunday first. */
export const dayNames = () => t('dayNames');
/** One-letter day names for the day pills, Sunday first. */
export const dayLetters = () => t('dayLetters');

// One formatter per locale, made on first use.
const moneyBy = new Map<string, Intl.NumberFormat>();
const numberBy = new Map<string, Intl.NumberFormat>();

export const formatMoney = (n: number) => {
  const l = locale();
  if (!moneyBy.has(l)) moneyBy.set(l, new Intl.NumberFormat(l, { style: 'currency', currency: 'ILS', minimumFractionDigits: 0, maximumFractionDigits: 2 }));
  return moneyBy.get(l)!.format(n);
};
export const formatNumber = (n: number) => {
  const l = locale();
  if (!numberBy.has(l)) numberBy.set(l, new Intl.NumberFormat(l, { maximumFractionDigits: 2 }));
  return numberBy.get(l)!.format(n);
};

export const noStore = () => t('noStore');
export const noCategory = () => t('noCategory');

export const itemsLabel = (n: number) => t('items')(n);

// Units: "קילו" instead of ק"ג, and the plural for counts other than 1.
const UNIT_ALIAS: Record<string, string> = { 'ק"ג': 'קילו', 'ק״ג': 'קילו', 'קג': 'קילו', 'קילוגרם': 'קילו' };
const PLURAL: Record<string, string> = {
  'ביצה': 'ביצים',
  'גביע': 'גביעים',
  'בקבוק': 'בקבוקים',
  'דג': 'דגים',
  'חלה': 'חלות',
  'גליל': 'גלילים',
  'שקיק': 'שקיקים',
  'צנצנת': 'צנצנות',
  'חבילה': 'חבילות',
  'אריזה': 'אריזות',
  'חיתול': 'חיתולים',
  'יחידה': 'יחידות',
  'קופסה': 'קופסאות',
  // Units of the spec 013 seed.
  'שקית': 'שקיות',
  'כיכר': 'כיכרות',
};

// English words for the Hebrew seed units, the English seed units and the English default unit. Other units show as typed.
const UNIT_EN: Record<string, [one: string, many: string]> = {
  'קילו': ['kg', 'kg'],
  'ליטר': ['liter', 'liters'],
  'ביצה': ['egg', 'eggs'],
  'גביע': ['cup', 'cups'],
  'בקבוק': ['bottle', 'bottles'],
  'דג': ['fish', 'fish'],
  'חלה': ['challah', 'challahs'],
  'גליל': ['roll', 'rolls'],
  'שקיק': ['sachet', 'sachets'],
  'צנצנת': ['jar', 'jars'],
  'חבילה': ['pack', 'packs'],
  'אריזה': ['pack', 'packs'],
  'חיתול': ['diaper', 'diapers'],
  'יחידה': ['unit', 'units'],
  'קופסה': ['box', 'boxes'],
  unit: ['unit', 'units'],
  pack: ['pack', 'packs'],
  // Units of the English seed (spec 011).
  kg: ['kg', 'kg'],
  liter: ['liter', 'liters'],
  egg: ['egg', 'eggs'],
  cup: ['cup', 'cups'],
  bottle: ['bottle', 'bottles'],
  fish: ['fish', 'fish'],
  loaf: ['loaf', 'loaves'],
  roll: ['roll', 'rolls'],
  'tea bag': ['tea bag', 'tea bags'],
  jar: ['jar', 'jars'],
  diaper: ['diaper', 'diapers'],
  // Units of the spec 013 seed.
  'שקית': ['bag', 'bags'],
  'כיכר': ['loaf', 'loaves'],
  bag: ['bag', 'bags'],
  sachet: ['sachet', 'sachets'],
};

/** The unit as shown: "קילו" for ק"ג, plural when `n` is not 1. In English the known units get English words. */
export function unitLabel(unit: string, n = 1): string {
  const u = UNIT_ALIAS[unit.trim()] ?? unit.trim();
  // English units (spec 011 seed) get their plural in both languages.
  const word = getLang() === 'en' || /^[a-z ]+$/.test(u) ? UNIT_EN[u] : undefined;
  if (word) return n === 1 ? word[0] : word[1];
  return n === 1 ? u : (PLURAL[u] ?? u);
}

/** Total units with the unit: "30 ביצים", "3 ליטר", "חצי קילו". */
export function formatAmount(n: number, unit: string): string {
  if (n === 0.5) return t('half')(unitLabel(unit, 1));
  return `${formatNumber(n)} ${unitLabel(unit, n)}`.trim();
}

/** Words for a sign-in error code from the return address (spec 003). */
export function authErrorText(code: string): string {
  return code === 'otp_expired' ? t('authExpired') : t('authFailed');
}

export interface Notice {
  title: string;
  body: string;
}

const messageOf = (error: unknown) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : '');

/** Banner for a failed write. The household limits and the archived store rule (spec 003) get their own words. */
export function writeErrorNotice(error: unknown, online: boolean): Notice {
  const message = messageOf(error);
  if (message.includes('store limit reached')) {
    return { title: t('storeLimitTitle'), body: t('storeLimitBody')(SHOP_COUNTS.active, SHOP_COUNTS.total) };
  }
  if (message.includes('item limit reached')) {
    return { title: t('itemLimitTitle'), body: t('itemLimitBody')(ITEM_COUNTS.active, ITEM_COUNTS.total) };
  }
  if (message.includes('store not active')) return { title: t('storeArchivedTitle'), body: t('storeArchivedBody') };
  // Demo mode throws the Hebrew text of the domain check.
  if (message.startsWith('אפשר עד')) return { title: t('saveFailed'), body: domainText(message) };
  return online ? { title: t('saveFailed'), body: t('tryAgainSoon') } : { title: t('noNetwork'), body: t('saveNeedsNetwork') };
}

/**
 * Packs of an item in words (spec 009): the unit when a pack is one unit
 * ("3 שקיות"), else packs with the units in brackets ("2 אריזות (24 ביצים)").
 */
export function packsText(n: number, item: { unit: string; packSize: number }): string {
  if (item.packSize === 1) return formatAmount(n, item.unit);
  const packs = t('packs')(formatNumber(n), n === 1);
  return `${packs} (${formatAmount(n * item.packSize, item.unit)})`;
}

/** Short pack word for steppers: the unit when a pack is one unit, else "אריזות". */
export const packWord = (item: { unit: string; packSize: number }, n = 2) => (item.packSize === 1 ? unitLabel(item.unit, n) : t('packWord')(n === 1));
