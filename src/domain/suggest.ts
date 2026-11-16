// AI help for a product (2026-11-03): from the name the user typed, Gemini
// suggests a clean name, an emoji, a category and a price for one pack.
// Shared by the app and the Cloudflare function in functions/api/suggest.ts.
import { LIMITS } from './catalog';
import type { Lang } from './types';
import { canonicalCategory, categoryNames } from './categories';

export interface SuggestQuery {
  name: string;
  unit: string;
  packSize: number;
  /** Categories the household already uses, so the AI picks one of them when it fits. */
  categories: string[];
  /** App language (spec 011): the name and a new category come back in it. Hebrew when missing. */
  lang: Lang;
}

export interface Suggestion {
  name: string;
  emoji: string;
  category: string;
  /** Price in shekels for one pack, or null when the AI does not know. */
  price: number | null;
}

/** At most this many categories go into one prompt. */
export const MAX_CATEGORIES = 60;
/** Highest price per pack the app accepts from the AI. */
export const MAX_PRICE = 5000;

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : null);

/** A request body from the app, or null when it is not valid. */
export function readQuery(raw: unknown): SuggestQuery | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = text(r.name, LIMITS.name);
  // Spec 011: only "en" is English; anything else (missing, unknown) is Hebrew, as before.
  const lang: Lang = r.lang === 'en' ? 'en' : 'he';
  const unit = text(r.unit, LIMITS.unit) ?? (lang === 'en' ? 'unit' : 'יחידה');
  const packSize = typeof r.packSize === 'number' && Number.isFinite(r.packSize) && r.packSize > 0 ? r.packSize : 1;
  const categories = Array.isArray(r.categories)
    ? r.categories.map((c) => text(c, LIMITS.category)).filter((c): c is string => c !== null).slice(0, MAX_CATEGORIES)
    : [];
  return name ? { name, unit, packSize, categories, lang } : null;
}

export function buildPrompt(q: SuggestQuery): string {
  const en = q.lang === 'en';
  return [
    en ? 'You help fill a product in an English household shopping list in Israel.' : 'You help fill a product in a Hebrew household shopping list in Israel.',
    `The user typed this product name: "${q.name}".`,
    `One pack is ${q.packSize} ${q.unit}.`,
    // Spec 013: a fixed list of categories in shopping order.
    `Categories: ${categoryNames(q.lang).join(', ')}.`,
    'Return JSON with:',
    en
      ? '- name: the product name in English, short, spelling fixed. Keep the meaning the user typed, and translate it to English when it is in another language.'
      : '- name: the product name in Hebrew, short, spelling fixed, as people say it in Israel. Keep the meaning the user typed.',
    '- emoji: one emoji that shows the product.',
    `- category: exactly one of the categories above. Use "${en ? 'General' : 'כללי'}" when none fits.`,
    '- price: a typical supermarket price in Israel today, in shekels, for one pack as above. Use 0 when you cannot tell.',
  ].join('\n');
}

/** Gemini `responseSchema` for the JSON above. The category is an enum of the fixed list (spec 013). */
export const responseSchema = (lang: Lang) => ({
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    emoji: { type: 'STRING' },
    category: { type: 'STRING', enum: categoryNames(lang) },
    price: { type: 'NUMBER' },
  },
  required: ['name', 'emoji', 'category', 'price'],
});

const EMOJI = /^\p{Extended_Pictographic}/u;

/** The AI answer checked and cleaned, or null when it is not usable. With `lang`, the category is mapped to the fixed list. */
export function readSuggestion(raw: unknown, lang?: Lang): Suggestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const name = text(r.name, LIMITS.name);
  const category = text(r.category, LIMITS.category);
  const emoji = text(r.emoji, 16);
  if (!name || !category) return null;
  const price = typeof r.price === 'number' && Number.isFinite(r.price) && r.price > 0 && r.price <= MAX_PRICE ? Math.round(r.price * 10) / 10 : null;
  return { name, category: lang ? canonicalCategory(category, lang) : category, emoji: emoji && EMOJI.test(emoji) ? emoji : '', price };
}
