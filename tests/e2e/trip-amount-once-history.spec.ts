import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('household-shop.lang')) localStorage.setItem('household-shop.lang', 'he');
  });
});

// Spec 012 in demo mode: a one-time product, an amount for this trip, finish, history and "שוב".
test('demo mode: one-time product, amount for this trip, history', async ({ page }) => {
  const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
  await page.goto('/');
  await page.getByRole('button', { name: 'סגירת ההסבר' }).click();

  // A one-time product on the next trip (the default).
  await nav('מוצרים');
  await page.getByRole('button', { name: 'מוצר חדש' }).click();
  await page.getByLabel('שם', { exact: true }).fill('מאוורר');
  await page.getByRole('radio', { name: 'פעם אחת' }).click();
  await expect(page.getByText('באיזו קנייה')).toHaveCount(0);
  await expect(page.getByText('כמה יש עכשיו')).toHaveCount(0);
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  await page.getByRole('searchbox').fill('מאוורר');
  await expect(page.locator('li[data-item="מאוורר"] .row-sub')).toHaveText(/^פעם אחת · /);

  // Shop mode: change the amount, go back to the computed amount, then set it again.
  await nav('בית');
  await page.getByRole('button', { name: 'יוצא לקנות' }).click();
  const fan = page.locator('li.line[data-item="מאוורר"]');
  await expect(fan).toBeVisible();
  await fan.getByRole('button', { name: /שינוי הכמות/ }).click();
  const sheet = page.getByRole('dialog', { name: 'מאוורר' });
  await expect(sheet.getByText('כמה לקנות הפעם')).toBeVisible();
  await sheet.getByRole('button', { name: /^יותר/ }).click();
  await sheet.getByRole('button', { name: 'שמירה' }).click();
  await expect(fan.locator('.changed')).toBeVisible();
  await expect(fan.getByRole('checkbox')).not.toBeChecked();
  await fan.getByRole('button', { name: /שינוי הכמות/ }).click();
  await sheet.getByRole('button', { name: 'חזרה לחישוב' }).click();
  await expect(fan.locator('.changed')).toHaveCount(0);
  await fan.getByRole('button', { name: /שינוי הכמות/ }).click();
  await sheet.getByRole('button', { name: /^יותר/ }).click();
  await sheet.getByRole('button', { name: 'שמירה' }).click();
  await expect(fan.locator('.amount')).toContainText('2');

  // Finish: the one-time product is bought.
  await fan.getByRole('checkbox').click();
  await page.getByRole('button', { name: /^סיימתי/ }).click();
  await expect(page.getByRole('button', { name: 'יוצא לקנות' })).toBeVisible();
  await nav('מוצרים');
  await page.getByRole('searchbox').fill('מאוורר');
  await expect(page.locator('li[data-item="מאוורר"] .row-sub')).toHaveText('נקנה');

  // History: the trip with its line and an estimated cost.
  await nav('הגדרות');
  await page.getByRole('button', { name: /^היסטוריה/ }).click();
  await expect(page.getByText('המחירים משוערים', { exact: false })).toBeVisible();
  await page.locator('.rows .row-btn').first().click();
  await expect(page.getByText('מאוורר')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'פריט אחד' })).toBeVisible();
  await page.getByRole('button', { name: 'חזרה להיסטוריה' }).first().click();
  await page.getByRole('button', { name: 'חזרה להגדרות' }).first().click();

  // "שוב" puts it back on a trip.
  await nav('מוצרים');
  await page.getByRole('searchbox').fill('מאוורר');
  await page.getByRole('button', { name: 'שוב: מאוורר' }).click();
  await expect(page.locator('li[data-item="מאוורר"] .row-sub')).toHaveText(/^פעם אחת · /);
});
