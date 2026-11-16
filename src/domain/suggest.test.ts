import { describe, expect, it } from 'vitest';
import { MAX_CATEGORIES, buildPrompt, readQuery, readSuggestion, responseSchema } from './suggest';

describe('readQuery', () => {
  it('keeps a valid query and fills defaults', () => {
    expect(readQuery({ name: ' במבה ', categories: ['יבשים', 5, ''] })).toEqual({ name: 'במבה', unit: 'יחידה', packSize: 1, categories: ['יבשים'], lang: 'he' });
  });
  it('reads lang: only "en" is English, anything else is Hebrew (spec 011)', () => {
    expect(readQuery({ name: 'Rice', lang: 'en' })).toEqual({ name: 'Rice', unit: 'unit', packSize: 1, categories: [], lang: 'en' });
    for (const lang of [undefined, 'he', 'fr', 'EN', 1, null, ['en']]) expect(readQuery({ name: 'אורז', lang })!.lang).toBe('he');
  });
  it('rejects a missing or too long name', () => {
    expect(readQuery({})).toBeNull();
    expect(readQuery({ name: 'א'.repeat(61) })).toBeNull();
    expect(readQuery('x')).toBeNull();
  });
  it('caps the categories', () => {
    const categories = Array.from({ length: 100 }, (_, n) => `ק${n}`);
    expect(readQuery({ name: 'חלב', categories })!.categories).toHaveLength(MAX_CATEGORIES);
  });
});

describe('buildPrompt', () => {
  it('names the product, the pack and the categories', () => {
    const p = buildPrompt({ name: 'נייר טואלט', unit: 'גליל', packSize: 32, categories: ['בית וניקיון'], lang: 'he' });
    expect(p).toContain('"נייר טואלט"');
    expect(p).toContain('32 גליל');
    expect(p).toContain('ניקיון ובית');
    expect(p).toContain('"כללי"');
    expect(p).toContain('name in Hebrew');
  });
  it('asks for English name and category in English', () => {
    const p = buildPrompt({ name: 'toilet paper', unit: 'roll', packSize: 32, categories: [], lang: 'en' });
    expect(p).toContain('name in English');
    expect(p).toContain('Paper and disposables');
    expect(p).toContain('"General"');
    expect(p).not.toContain('Hebrew');
  });
});

describe('fixed categories for the AI (spec 013)', () => {
  it('gives the category as an enum and maps old names', () => {
    expect(responseSchema('en').properties.category.enum).toContain('Dairy');
    expect(responseSchema('he').properties.category.enum).toHaveLength(17);
    expect(readSuggestion({ name: 'א', emoji: '🍿', category: 'יבשים', price: 1 }, 'he')!.category).toBe('יבשים ודגנים');
  });
});

describe('readSuggestion', () => {
  it('cleans a good answer', () => {
    expect(readSuggestion({ name: ' במבה ', emoji: '🍿', category: 'יבשים', price: 6.54 })).toEqual({ name: 'במבה', emoji: '🍿', category: 'יבשים', price: 6.5 });
  });
  it('drops a price of 0, a negative or a huge one', () => {
    for (const price of [0, -3, 99999, Number.NaN, '7']) expect(readSuggestion({ name: 'א', emoji: '🍿', category: 'ב', price })!.price).toBeNull();
  });
  it('drops an emoji that is text', () => {
    expect(readSuggestion({ name: 'א', emoji: 'popcorn', category: 'ב', price: 1 })!.emoji).toBe('');
  });
  it('rejects an answer without name or category', () => {
    expect(readSuggestion({ name: '', emoji: '🍿', category: 'ב', price: 1 })).toBeNull();
    expect(readSuggestion({ name: 'א', emoji: '🍿', price: 1 })).toBeNull();
    expect(readSuggestion(null)).toBeNull();
  });
});
