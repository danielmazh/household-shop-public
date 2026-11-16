import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Origins the app may connect to for Supabase: https and wss of the project host. Empty in demo builds. */
export function supabaseOrigins(url: string | undefined): string[] {
  if (!url?.trim()) return [];
  const u = new URL(url.trim());
  if (u.protocol !== 'https:') throw new Error('VITE_SUPABASE_URL must start with https://');
  return [`https://${u.host}`, `wss://${u.host}`];
}

/** Content Security Policy for the meta tag (spec 004). frame-ancestors only works as a header. */
export function contentSecurityPolicy(supabaseUrl: string | undefined): string {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    ['connect-src', "'self'", ...supabaseOrigins(supabaseUrl)].join(' '),
    "manifest-src 'self'",
    "worker-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

/** Cloudflare Pages headers file. Same CSP as the meta tag plus what only a header can do. */
export function cloudflareHeaders(csp: string): string {
  return [
    '/*',
    `  Content-Security-Policy: ${csp}; frame-ancestors 'none'`,
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: no-referrer',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Strict-Transport-Security: max-age=31536000',
    '  Cross-Origin-Opener-Policy: same-origin',
    '/sw.js',
    '  Cache-Control: no-cache',
    '/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n');
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : [join(dir, e.name)]));
}

// Files in the output that the service worker does not precache.
const NOT_PRECACHED = new Set(['sw.js', '_headers', 'index.html']);

/**
 * Build only:
 * - adds the CSP and referrer meta tags to index.html,
 * - writes _headers for Cloudflare Pages,
 * - fills sw.js with a build version and the list of files to precache.
 */
export function securityPlugin(supabaseUrl: string | undefined): Plugin {
  const csp = contentSecurityPolicy(supabaseUrl);
  let outDir = '';
  return {
    name: 'household-shop:security',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    transformIndexHtml: {
      order: 'post',
      // Right after the charset tag, so the policy covers every tag below it.
      handler(html) {
        const charset = '<meta charset="UTF-8" />';
        if (!html.includes(charset)) throw new Error('index.html needs <meta charset="UTF-8" />');
        const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}" />\n    <meta name="referrer" content="no-referrer" />`;
        return html.replace(charset, `${charset}\n    ${meta}`);
      },
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: cloudflareHeaders(csp) });
    },
    closeBundle() {
      const files = listFiles(outDir)
        .map((f) => relative(outDir, f).split('\\').join('/'))
        .filter((f) => !NOT_PRECACHED.has(f) && !f.endsWith('.map'))
        .sort();
      const hash = createHash('sha256');
      for (const f of [...files, 'index.html']) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);

      const swPath = join(outDir, 'sw.js');
      const sw = readFileSync(swPath, 'utf8');
      const filled = sw
        .replace("const VERSION = 'dev';", `const VERSION = '${version}';`)
        .replace('const PRECACHE = [];', `const PRECACHE = ${JSON.stringify(files.map((f) => `./${f}`))};`);
      if (!filled.includes(version) || filled.includes('const PRECACHE = [];')) throw new Error('sw.js placeholders not found');
      writeFileSync(swPath, filled);
    },
  };
}
