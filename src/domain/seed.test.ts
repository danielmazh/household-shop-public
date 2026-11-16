import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, defaultSettings, normalizeSettings } from './schedule';
import { PRODUCTS, seedCatalog, seedRoleStores, seedShops } from './seed';
import { roleOf } from './categories';
import type { Lang } from './types';

// The server seeds new households in SQL (create_household), demo mode seeds
// in TypeScript. Stores, items and default settings must stay the same.
// Settings are in 0001 (he) and 0005 (en); stores and items in 0007 (spec 013).
const read = (file: string) => readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8');
const SETTINGS_SQL: Record<Lang, { text: string; suffix: string }> = {
  he: { text: read('0001_init.sql'), suffix: '' },
  en: { text: read('0005_household_lang.sql'), suffix: '-en' },
};
const SEED_SQL = read('0007_role_stores_seed.sql');

function sqlRows(text: string, marker: string): string[] {
  const block = new RegExp(`-- ${marker}:start\\n([\\s\\S]*?)-- ${marker}:end`).exec(text)?.[1] ?? '';
  return block
    .split('\n')
    .map((line) => line.trim().replace(/,$/, ''))
    .filter(Boolean)
    .map((line) => {
      const values = line.slice(1, -1).match(/'[^']*'|[^,\s]+/g) ?? [];
      return values.map((v) => (v.startsWith("'") ? v.slice(1, -1) : v === 'null' ? 'null' : String(Number(v)))).join('|');
    });
}

const sqlSettings = (lang: Lang) => {
  const { text, suffix } = SETTINGS_SQL[lang];
  return JSON.parse(new RegExp(`-- settings${suffix}:start\\n\\s*'(.*)'\\n`).exec(text)?.[1] ?? 'null') as unknown;
};

const HEBREW = /[֐-׿]/;

describe('seed role stores in SQL and TypeScript (spec 013)', () => {
  it('has the same role stores in the same order', () => {
    const he = seedShops(undefined, 'he');
    const en = seedShops(undefined, 'en');
    const roles = seedRoleStores(he, 'he');
    const ts = he.map((s, n) => [Object.entries(roles).find(([, id]) => id === s.id)![0], s.name, en[n]!.name, s.emoji, s.sort].join('|'));
    expect(sqlRows(SEED_SQL, 'role-stores')).toEqual(ts);
  });
});

describe.each<Lang>(['he', 'en'])('seed in SQL and TypeScript (%s)', (lang) => {
  const shops = seedShops(undefined, lang);
  const roles = seedRoleStores(shops, lang);

  it('has the same default settings', () => {
    expect(normalizeSettings(sqlSettings(lang))).toEqual(defaultSettings(lang));
  });

  it('has the same items, each on the role store of its category', () => {
    const items = seedCatalog(shops, undefined, lang);
    const ts = items.map((i) => [i.name, i.category, i.cadence, roleOf(i.category), i.weeklyUse, i.unit, i.packSize, i.target].map(String).join('|'));
    const rows = sqlRows(SEED_SQL, lang === 'en' ? 'seed-v2-en' : 'seed-v2');
    expect(rows).toHaveLength(56);
    expect(rows).toEqual(ts);
    expect(items.every((i) => i.storeId !== null && i.storeId === roles[roleOf(i.category)])).toBe(true);
    expect(items.every((i) => i.price === null)).toBe(true);
  });

  it('has unique names and every role has a store', () => {
    const items = seedCatalog(shops, undefined, lang);
    expect(new Set(items.map((i) => i.name.toLowerCase())).size).toBe(items.length);
    expect(Object.values(roles).every((id) => id !== null)).toBe(true);
  });
});

// The household data script is private: the public copy of the repo has no supabase/data (2026-11-16).
const OUR_HOME = new URL('../../supabase/data/2026-11-07-our-home-defaults.sql', import.meta.url);
describe.skipIf(!existsSync(OUR_HOME))('data script for our home (spec 013 G)', () => {
  it('adds the same products as the Hebrew seed', () => {
    const text = readFileSync(OUR_HOME, 'utf8');
    const ts = seedCatalog(seedShops(undefined, 'he'), undefined, 'he').map((i) => [i.name, i.category, roleOf(i.category), i.unit, i.packSize, i.target].join('|'));
    expect(sqlRows(text, 'products')).toEqual(ts);
  });
});

describe('English seed (spec 011)', () => {
  const enShops = seedShops(undefined, 'en');
  const en = seedCatalog(enShops, undefined, 'en');
  const he = seedCatalog(seedShops(undefined, 'he'), undefined, 'he');

  it('keeps the Hebrew default settings', () => {
    expect(defaultSettings('he')).toEqual(DEFAULT_SETTINGS);
    expect(defaultSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('has the same shape as Hebrew', () => {
    const shape = (items: typeof en) => items.map((i) => [i.cadence, i.trips, i.weeklyUse, i.packSize, i.target, roleOf(i.category)]);
    expect(shape(en)).toEqual(shape(he));
    expect(PRODUCTS).toHaveLength(56);
  });

  it('has no Hebrew letters', () => {
    const settings = defaultSettings('en');
    const texts = [
      ...enShops.map((s) => s.name),
      ...en.flatMap((i) => [i.name, i.category, i.unit]),
      ...settings.trips.map((tr) => tr.name),
      ...Object.values(settings.cadenceLabels),
    ];
    expect(texts.filter((x) => HEBREW.test(x))).toEqual([]);
  });
});
