import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('household-shop.lang')) localStorage.setItem('household-shop.lang', 'he');
  });
});

// Spec 014 in demo mode: one list, store chips on home and in shop mode, unticked lines stay.
test('demo mode: one list by store', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'סגירת ההסבר' }).click();
  await expect(page.getByRole('heading', { name: /רשימת קניות/ })).toBeVisible();

  // Home: a store chip opens shop mode on that store only.
  await page.getByRole('group', { name: 'באיזו חנות' }).getByRole('button', { name: /^קנייה בירקן/ }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('ירקן');
  await expect(page.locator('li.line[data-item="ירקות"]')).toBeVisible();
  await expect(page.locator('li.line[data-item="חלב"]')).toHaveCount(0);

  // "הכל" shows every store.
  await page.getByRole('button', { name: 'הכל', exact: true }).click();
  await expect(page.locator('li.line[data-item="חלב"]')).toBeVisible();

  // Finish one line; the rest stays on the list.
  await page.locator('li.line[data-item="חלב"]').getByRole('checkbox').click();
  await page.getByRole('button', { name: /^סיימתי/ }).click();
  await page.getByRole('button', { name: 'יוצא לקנות' }).click();
  await expect(page.locator('li.line[data-item="חלב"]')).toHaveCount(0);
  await expect(page.locator('li.line[data-item="ירקות"]')).toBeVisible();
  await page.getByRole('button', { name: 'יציאה מהקנייה' }).click();

  // No trips and days in settings, and no trip field in the product form.
  await page.getByRole('navigation').getByRole('button', { name: 'הגדרות' }).click();
  await expect(page.getByRole('button', { name: /^קניות וימים/ })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('button', { name: 'מוצרים' }).click();
  await page.getByRole('button', { name: 'מוצר חדש' }).click();
  await expect(page.getByText('באיזו קנייה')).toHaveCount(0);
});

// 2026-11-15: archiving a store moves each product to the default store of its kind.
test('demo mode: archive a store to the default stores', async ({ page }) => {
  const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
  await page.goto('/');
  await page.getByRole('button', { name: 'סגירת ההסבר' }).click();

  // A new store, and the vegetables move to it.
  await nav('הגדרות');
  await page.getByRole('button', { name: /^חנויות/ }).click();
  await page.getByRole('button', { name: 'הוספת חנות' }).click();
  await page.getByLabel('שם החנות').fill('רמי לוי');
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  await nav('מוצרים');
  await page.getByRole('searchbox').fill('ירקות');
  await page.getByRole('button', { name: 'עריכת ירקות' }).first().click();
  await page.getByRole('combobox', { name: 'חנות', exact: true }).selectOption({ label: 'רמי לוי' });
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();

  // Archive it: "to the default stores" is the first choice and is picked.
  await nav('הגדרות');
  await page.getByRole('button', { name: /^חנויות/ }).click();
  await page.getByRole('button', { name: 'עריכת רמי לוי' }).click();
  await page.getByRole('button', { name: 'העברה לארכיון' }).click();
  await expect(page.getByRole('radio', { name: /לחנויות ברירת המחדל/ })).toBeChecked();
  await page.getByRole('button', { name: 'העברה וארכיון' }).click();
  await expect(page.getByRole('button', { name: 'שחזור רמי לוי' })).toBeVisible();

  // The vegetables are back at the greengrocer, and no "רמי לוי" chip is left on home.
  await nav('בית');
  const chips = page.getByRole('group', { name: 'באיזו חנות' });
  await expect(chips.getByRole('button', { name: /רמי לוי/ })).toHaveCount(0);
  await chips.getByRole('button', { name: /^קנייה בירקן/ }).click();
  await expect(page.locator('li.line[data-item="ירקות"]')).toBeVisible();
});
