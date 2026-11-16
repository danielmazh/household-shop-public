import { describe, expect, it } from 'vitest';
import { cloudflareHeaders, contentSecurityPolicy } from './securityPlugin';

describe('contentSecurityPolicy', () => {
  it('allows only the Supabase project host besides self', () => {
    const csp = contentSecurityPolicy('https://abcdefgh.supabase.co');
    expect(csp).toContain("connect-src 'self' https://abcdefgh.supabase.co wss://abcdefgh.supabase.co;");
    expect(csp).toContain("script-src 'self';");
  });

  it('has no Supabase hosts in a demo build and rejects plain http', () => {
    expect(contentSecurityPolicy('')).toContain("connect-src 'self';");
    expect(() => contentSecurityPolicy('http://abcdefgh.supabase.co')).toThrow();
  });
});

describe('cloudflareHeaders', () => {
  it('sends the hardening headers on every page', () => {
    const headers = cloudflareHeaders("default-src 'self'");
    expect(headers).toContain("Content-Security-Policy: default-src 'self'; frame-ancestors 'none'");
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toContain('Strict-Transport-Security: max-age=31536000');
    expect(headers).toContain('Cross-Origin-Opener-Policy: same-origin');
  });
});
