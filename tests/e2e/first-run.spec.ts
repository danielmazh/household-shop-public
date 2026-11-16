import { expect, test, type Page } from '@playwright/test';

/**
 * Hebrew letters the user can see or hear on this screen: visible text,
 * aria-label, placeholder and title. The Hebrew language pill is allowed.
 */
async function hebrewOnScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const re = /[֐-׿]/;
    const found: string[] = [];
    const text = document.body.innerText.replace(/עברית/g, '');
    for (const line of text.split('\n')) if (re.test(line)) found.push(line);
    for (const el of document.querySelectorAll('[aria-label], [placeholder], [title]')) {
      for (const name of ['aria-label', 'placeholder', 'title']) {
        const value = el.getAttribute(name);
        if (value && re.test(value) && value !== 'עברית') found.push(`${name}: ${value}`);
      }
    }
    return found;
  });
}

/**
 * Labels of buttons and chips that wrap to a second line (one text node split
 * over two lines). Names in `.clamp2` (trip and item names) may use two lines by design.
 */
async function wrappedLabels(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('button, .chip, [role="radio"]')) {
      if (!(el instanceof HTMLElement) || el.offsetParent === null) continue;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim() || node.parentElement?.closest('.clamp2')) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (tops.size > 1) out.push(node.textContent.trim());
      }
    }
    return out;
  });
}

async function checkScreen(page: Page, name: string) {
  expect(await hebrewOnScreen(page), `Hebrew on ${name}`).toEqual([]);
  expect(await wrappedLabels(page), `wrapped labels on ${name}`).toEqual([]);
}

// Spec 011: a new device picks a language first; English shows no Hebrew at all.
test('first run: English language, English products, no Hebrew', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const html = page.locator('html');
  const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'עברית' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'English' })).toBeVisible();
  await expect(page.getByText('Home Shopping')).toBeVisible();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  expect(await wrappedLabels(page)).toEqual([]);

  await page.getByRole('button', { name: 'English' }).click();
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle('Home Shopping');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.en.webmanifest');

  await expect(page.getByRole('button', { name: 'Go shopping' })).toBeVisible();
  await checkScreen(page, 'home');

  // Home search (2026-11-12): English labels for one tap to the list and a new product.
  await page.getByRole('searchbox').fill('Tea');
  await expect(page.getByRole('button', { name: 'Add Tea to the list' })).toBeVisible();
  await page.getByRole('searchbox').fill('Quinoa');
  await expect(page.getByRole('button', { name: /^New: Quinoa/ })).toBeVisible();
  await checkScreen(page, 'home search');
  await page.getByRole('searchbox').fill('');

  await nav('Products');
  for (const name of ['Rice', 'Eggs', 'Toilet paper', 'Bread']) await expect(page.locator(`li[data-item="${name}"]`)).toBeVisible();
  await checkScreen(page, 'products');

  await nav('Settings');
  await expect(page.getByRole('radio', { name: 'English' })).toBeChecked();
  await checkScreen(page, 'settings');

  await page.getByRole('button', { name: /^Help/ }).click();
  await expect(page.getByRole('heading', { name: 'Keep at home' })).toBeVisible();
  await checkScreen(page, 'help');
  await page.getByRole('button', { name: 'Back to settings' }).first().click();

  // Spec 014: no trips and days screen.
  await expect(page.getByRole('button', { name: /^Trips and days/ })).toHaveCount(0);

  await nav('Home');
  await page.getByRole('button', { name: 'Go shopping' }).click();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await checkScreen(page, 'shop mode');

  // The choice stays: no language screen after a reload.
  await page.reload();
  await expect(page.getByRole('button', { name: 'English' })).toHaveCount(0);
  await expect(html).toHaveAttribute('dir', 'ltr');
});

test('first run: Hebrew keeps the Hebrew products', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'עברית' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('button', { name: 'יוצא לקנות' })).toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'מוצרים' }).click();
  await expect(page.locator('li[data-item="אורז"]')).toBeVisible();
});

test('an old device without a language key opens in Hebrew, no language screen', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      localStorage.setItem('household-shop.help-closed', '1');
      sessionStorage.setItem('seeded', '1');
    }
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'יוצא לקנות' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'English' })).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('household-shop.lang'))).toBe('he');
});
