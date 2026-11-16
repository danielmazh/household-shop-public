import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('household-shop.lang')) localStorage.setItem('household-shop.lang', 'he');
  });
});

// A tap on a product name in the home list or the simple list opens "עריכת מוצר".
test('demo mode: tap a list item to edit the product', async ({ page }) => {
  const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
  await page.goto('/');
  await page.getByRole('button', { name: 'סגירת ההסבר' }).click();

  // Home: open the trip list and tap the first product name.
  await page.locator('.peek-head').click();
  const first = page.locator('ul.peek .name-btn').first();
  const name = (await first.textContent())?.trim() ?? '';
  await first.click();
  await expect(page.getByRole('heading', { name: 'עריכת מוצר' })).toBeVisible();
  await expect(page.locator('input').first()).toHaveValue(name);
  await page.getByRole('button', { name: 'סגירה בלי שמירה' }).click();

  // Simple list: the name opens the form, the circle still ticks.
  await nav('הגדרות');
  await page.getByRole('radio', { name: 'רשימה פשוטה' }).click();
  await nav('בית');
  await page.getByPlaceholder('מה לקנות?').fill('מאוורר');
  await page.getByPlaceholder('מה לקנות?').press('Enter');
  await page.getByRole('button', { name: 'עריכת מאוורר' }).click();
  await expect(page.getByRole('heading', { name: 'עריכת מוצר' })).toBeVisible();
});
