// Google Play store images (2026-11-12): phone screenshots in demo mode and the 1024x500 feature graphic.
// Run: npm run build && (npx vite preview --port 4174 --strictPort &) ; node scripts/store-assets.mjs ; stop the preview.
// Needs a build made with empty VITE_SUPABASE_URL so the app runs in demo mode.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const base = process.env.STORE_URL ?? 'http://localhost:4174';
const out = resolve('store/out');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();

// 412x732 CSS px at 2.625 = 1081x1922: inside Play's 2:1 limit.
async function shots(lang) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 732 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, locale: lang === 'he' ? 'he-IL' : 'en-US' });
  await ctx.addInitScript((l) => localStorage.setItem('household-shop.lang', l), lang);
  const page = await ctx.newPage();
  const he = lang === 'he';
  const nav = (he_, en_) => page.getByRole('navigation').getByRole('button', { name: he ? he_ : en_ }).click();
  const snap = (n) => page.screenshot({ path: `${out}/${lang}-${n}.png` });
  await page.goto(base + '/');
  await page.getByRole('button', { name: he ? 'סגירת ההסבר' : /close/i }).first().click();
  await page.waitForTimeout(400);
  await snap('1-home');
  await page.getByRole('button', { name: he ? 'יוצא לקנות' : /go shopping/i }).first().click();
  await page.waitForTimeout(400);
  await snap('2-shop');
  await page.getByRole('button', { name: he ? 'יציאה מהקנייה' : 'Leave shop mode' }).first().click();
  await nav('מוצרים', 'Products');
  await page.waitForTimeout(400);
  await snap('3-catalog');
  await nav('הגדרות', 'Settings');
  await page.waitForTimeout(400);
  await snap('4-settings');
  await ctx.close();
}

await shots('he');
await shots('en').catch((e) => console.error('en screenshots failed:', e.message));

const fg = await browser.newPage({ viewport: { width: 1024, height: 500 } });
await fg.goto('file://' + resolve('store/feature-graphic.html'));
await fg.screenshot({ path: `${out}/feature-graphic.png` });

await browser.close();
console.log('done:', out);
