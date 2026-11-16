import { expect, test, type Page } from '@playwright/test';

/** No horizontal scroll at 320 and 768 px, then back to the phone size. */
async function noOverflow(page: Page) {
  const size = page.viewportSize()!;
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 800 });
    const extra = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(extra, `horizontal overflow at ${width}px`).toBe(0);
  }
  await page.setViewportSize(size);
}

// Spec 011: a new device asks for a language first. These tests start in Hebrew.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('household-shop.lang')) localStorage.setItem('household-shop.lang', 'he');
  });
});

// Spec 010: switch to English in settings, LTR layout, help page, and back to Hebrew.
test('demo mode: English, help page and back to Hebrew', async ({ page }) => {
  const html = page.locator('html');
  await page.goto('/');
  await expect(html).toHaveAttribute('dir', 'rtl');

  await page.getByRole('navigation').getByRole('button', { name: 'הגדרות' }).click();
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(html).toHaveAttribute('dir', 'ltr');
  await expect(html).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // Home in English, and the choice stays after a reload.
  await page.getByRole('navigation').getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('button', { name: 'Go shopping' })).toBeVisible();
  await noOverflow(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Go shopping' })).toBeVisible();
  await expect(html).toHaveAttribute('dir', 'ltr');

  // Help page from settings.
  await page.getByRole('navigation').getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('button', { name: /^Help/ }).click();
  await expect(page.getByRole('heading', { name: 'Keep at home' })).toBeVisible();
  await noOverflow(page);
  await page.getByRole('button', { name: 'Back to settings' }).first().click();

  // Back to Hebrew.
  await page.getByRole('radio', { name: 'עברית' }).click();
  await expect(html).toHaveAttribute('dir', 'rtl');
  await page.getByRole('navigation').getByRole('button', { name: 'בית' }).click();
  await expect(page.getByRole('button', { name: 'יוצא לקנות' })).toBeVisible();
});
