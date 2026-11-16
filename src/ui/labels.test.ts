import { describe, expect, it } from 'vitest';
import { DEFAULT_EMOJI, itemEmoji } from './emoji';
import { authErrorText, formatAmount, unitLabel, writeErrorNotice } from './labels';

describe('itemEmoji', () => {
  it('uses the item own emoji before the name map', () => {
    expect(itemEmoji({ name: 'ביצים', category: '', emoji: '🍳' })).toBe('🍳');
    expect(itemEmoji({ name: 'ביצים', category: '', emoji: null })).toBe('🥚');
  });
  it('uses the name map first', () => {
    expect(itemEmoji({ name: 'ביצים', category: 'מוצרי חלב' })).toBe('🥚');
    expect(itemEmoji({ name: ' סלמון ', category: '' })).toBe('🍣');
  });
  it('falls back to the category, then a cart', () => {
    expect(itemEmoji({ name: 'קוטג׳', category: 'מוצרי חלב' })).toBe('🥛');
    expect(itemEmoji({ name: 'משהו', category: 'אחר' })).toBe(DEFAULT_EMOJI);
  });
});

describe('formatAmount', () => {
  it('writes total units with the unit', () => {
    expect(formatAmount(30, 'ביצה')).toBe('30 ביצים');
    expect(formatAmount(3, 'ליטר')).toBe('3 ליטר');
    expect(formatAmount(1, 'דג')).toBe('1 דג');
  });
  it('writes קילו, never ק"ג', () => {
    expect(formatAmount(2, 'ק"ג')).toBe('2 קילו');
    expect(formatAmount(0.5, 'ק"ג')).toBe('חצי קילו');
    expect(unitLabel('ק"ג')).toBe('קילו');
  });
});

describe('writeErrorNotice', () => {
  it('names the household limits and the archived store rule', () => {
    expect(writeErrorNotice({ message: 'store limit reached' }, true).body).toContain('50');
    expect(writeErrorNotice({ message: 'item limit reached' }, true).body).toContain('500');
    expect(writeErrorNotice(new Error('store not active'), true).title).toBe('החנות בארכיון');
  });
  it('falls back to the network state', () => {
    expect(writeErrorNotice(new Error('boom'), true).title).toBe('השמירה נכשלה');
    expect(writeErrorNotice(undefined, false).title).toBe('אין חיבור לרשת');
  });
});

describe('authErrorText', () => {
  it('names an expired link and points to a new link or the code', () => {
    expect(authErrorText('otp_expired')).toContain('פג תוקף');
    expect(authErrorText('exchange_failed')).toContain('הקוד מהמייל');
  });
});
