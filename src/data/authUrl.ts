// Query and hash params a magic-link return can carry. Removed from the address bar after use.
const QUERY_PARAMS = ['code', 'error', 'error_code', 'error_description'];
const HASH_PARAMS = ['error', 'error_code', 'error_description'];

export interface AuthUrl {
  /** Error code from the query or the hash (for example `otp_expired`), or null. */
  error: string | null;
  /** True when the address carried a PKCE `code`. */
  hadCode: boolean;
  /** The address without the auth params, or null when there was nothing to remove. */
  clean: string | null;
}

/** Reads a sign-in error from the return address once, and gives the address to put back without it. */
export function readAuthUrl(href: string): AuthUrl {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const pick = (key: string) => url.searchParams.get(key) || hash.get(key) || null;
  const error = pick('error_code') ?? pick('error');
  const hadCode = url.searchParams.has('code');
  let changed = false;
  for (const p of QUERY_PARAMS) {
    if (url.searchParams.has(p)) {
      url.searchParams.delete(p);
      changed = true;
    }
  }
  if (HASH_PARAMS.some((p) => hash.has(p))) {
    for (const p of HASH_PARAMS) hash.delete(p);
    url.hash = hash.toString();
    changed = true;
  }
  return { error, hadCode, clean: changed ? url.toString() : null };
}

/** Query param of an invite link: `/?join=<CODE>`. */
export const JOIN_PARAM = 'join';

/** The invite link for a join code. */
export const inviteLink = (origin: string, code: string) => `${origin}/?${JOIN_PARAM}=${encodeURIComponent(code)}`;

/**
 * Reads a join code from an invite link, and gives the address to put back without it.
 * The code keeps only letters and digits, in upper case. `clean` is null when there was no param.
 */
export function readJoinParam(href: string): { code: string | null; clean: string | null } {
  const url = new URL(href);
  if (!url.searchParams.has(JOIN_PARAM)) return { code: null, clean: null };
  const code = (url.searchParams.get(JOIN_PARAM) ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16) || null;
  url.searchParams.delete(JOIN_PARAM);
  return { code, clean: url.toString() };
}
