import { afterEach, describe, expect, it } from 'vitest';
import { domainText, getLang, plural, setLang, t } from './i18n';
import { formatAmount, itemsLabel, packsText, writeErrorNotice } from './labels';
import { whenInSentence, whenLabel } from './when';

afterEach(() => setLang('he'));

// A Sunday, local time.
const SUNDAY = new Date(2026, 10, 1).getTime();

describe('language', () => {
  it('is Hebrew by default', () => {
    expect(getLang()).toBe('he');
    expect(t('goShopping')).toBe('יוצא לקנות');
  });
  it('switches every helper to English', () => {
    setLang('en');
    expect(t('goShopping')).toBe('Go shopping');
    expect(itemsLabel(1)).toBe('1 item');
    expect(itemsLabel(3)).toBe('3 items');
    expect(whenLabel(SUNDAY, 0)).toBe('Today');
    expect(whenLabel(SUNDAY, 4)).toBe('Thursday');
    expect(whenInSentence(SUNDAY, 4)).toBe('on Thursday');
  });
  it('keeps the Hebrew day words', () => {
    expect(whenLabel(SUNDAY, 4)).toBe('יום חמישי');
    expect(whenInSentence(SUNDAY, 4)).toBe('ביום חמישי');
  });
});

describe('plural', () => {
  it('picks one only for 1', () => {
    expect(plural(1, 'pack', 'packs')).toBe('pack');
    expect(plural(0, 'pack', 'packs')).toBe('packs');
  });
});

describe('English units', () => {
  it('names the seed units in English and keeps other units as typed', () => {
    setLang('en');
    expect(formatAmount(30, 'ביצה')).toBe('30 eggs');
    expect(formatAmount(2, 'ק"ג')).toBe('2 kg');
    expect(formatAmount(3, 'jars')).toBe('3 jars');
    expect(packsText(2, { unit: 'ביצה', packSize: 12 })).toBe('2 packs (24 eggs)');
  });
});

describe('domainText', () => {
  it('maps known Hebrew domain messages in English', () => {
    expect(domainText('שם חובה', 'en')).toBe('Name is required');
    expect(domainText('עד 30 תווים', 'en')).toBe('Up to 30 characters');
    expect(domainText('משהו אחר', 'en')).toBe('משהו אחר');
    expect(domainText('שם חובה', 'he')).toBe('שם חובה');
  });
  it('is used by the write error banner', () => {
    setLang('en');
    expect(writeErrorNotice(new Error('אפשר עד 50 חנויות פעילות. העבירו חנות לארכיון קודם.'), true).body).toBe('Up to 50 active stores. Archive a store first.');
  });
});
