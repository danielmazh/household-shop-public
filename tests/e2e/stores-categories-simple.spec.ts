import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('household-shop.lang')) localStorage.setItem('household-shop.lang', 'he');
  });
});

// Spec 013 in demo mode: role store change, category headers, catalog views, simple mode.
test('demo mode: default stores, categories, list view and simple list', async ({ page }) => {
  const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
  await page.goto('/');
  await page.getByRole('button', { name: 'סגירת ההסבר' }).click();

  // Role store: produce goes to the grocery store, and the greengrocer is left with no products.
  await nav('הגדרות');
  await page.getByRole('button', { name: /^חנויות/ }).click();
  await expect(page.getByRole('button', { name: 'עריכת ירקן' })).not.toContainText('0 פריטים');
  await page.getByLabel('ברירת מחדל לפירות, ירקות וביצים').selectOption({ label: 'חנות יבשים' });
  await expect(page.getByRole('button', { name: 'עריכת ירקן' })).toContainText('0 פריטים');
  await page.getByRole('button', { name: 'חזרה להגדרות' }).click();

  // Shop mode: small category headers inside each store.
  await nav('בית');
  await page.getByRole('button', { name: 'יוצא לקנות' }).click();
  await expect(page.locator('.cat-head').first()).toBeVisible();
  await page.getByRole('button', { name: 'יציאה מהקנייה' }).click();

  // Catalog: list by default, gallery after a tap, kept after a reload.
  await nav('מוצרים');
  await expect(page.locator('ul.list-view').first()).toBeVisible();
  await page.getByRole('button', { name: 'תצוגת גלריה' }).click();
  await expect(page.locator('ul.list-view')).toHaveCount(0);
  await page.reload();
  await nav('מוצרים');
  await expect(page.locator('ul.list-view')).toHaveCount(0);
  await page.getByRole('button', { name: 'תצוגת רשימה' }).click();

  // Simple list: add a new and an existing product, tick one, finish.
  await nav('הגדרות');
  await page.getByRole('radio', { name: 'רשימה פשוטה' }).click();
  await expect(page.getByRole('button', { name: /^קניות וימים/ })).toHaveCount(0);
  await nav('בית');
  await expect(page.getByRole('heading', { name: 'רשימת קניות' })).toBeVisible();
  await page.getByPlaceholder('מה לקנות?').fill('מאוורר');
  await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  const fan = page.locator('li.line[data-item="מאוורר"]');
  await expect(fan).toBeVisible();
  await page.getByPlaceholder('מה לקנות?').fill('קוסקוס');
  await page.getByRole('button', { name: 'הוספה', exact: true }).click();
  await expect(page.locator('li.line[data-item="קוסקוס"]')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'כללי' })).toBeVisible();
  await fan.getByRole('checkbox').click();
  await page.getByRole('button', { name: /^סיימתי/ }).click();
  await expect(fan).toHaveCount(0);
  await expect(page.locator('li.line[data-item="קוסקוס"]')).toBeVisible();

  // Back to the full list.
  await nav('הגדרות');
  await page.getByRole('radio', { name: 'רשימה מלאה' }).click();
  await nav('בית');
  await expect(page.getByRole('button', { name: 'יוצא לקנות' })).toBeVisible();
});
