// Makes the PNG icons from the SVG icons with the Playwright Chromium.
// Run: node scripts/make-icons.mjs   (needs `npx playwright install chromium` once)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const ICONS = [
  // Transparent corners: fine for the manifest "any" icon.
  { svg: 'public/icon.svg', size: 192, out: 'public/icon-192.png' },
  { svg: 'public/icon.svg', size: 512, out: 'public/icon-512.png' },
  // Full bleed: iOS fills transparent parts with black, and maskable needs the safe zone.
  { svg: 'public/icon-maskable.svg', size: 180, out: 'public/apple-touch-icon.png' },
  { svg: 'public/icon-maskable.svg', size: 512, out: 'public/icon-maskable-512.png' },
];

const browser = await chromium.launch();
try {
  for (const { svg, size, out } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const data = Buffer.from(readFileSync(svg)).toString('base64');
    await page.setContent(
      `<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${data}" width="${size}" height="${size}" style="display:block"></body></html>`,
    );
    await page.locator('img').screenshot({ path: out, omitBackground: true });
    await page.close();
    console.log(out);
  }
} finally {
  await browser.close();
}
