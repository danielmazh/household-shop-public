import { describe, expect, it } from 'vitest';
import { REVIEW_EMAIL, isReviewEmail } from './supabaseStore';

describe('Google Play review account', () => {
  it('matches only the review address, any case and spaces', () => {
    expect(isReviewEmail(` ${REVIEW_EMAIL.toUpperCase()} `)).toBe(true);
    expect(isReviewEmail('someone@gmail.com')).toBe(false);
  });
});
