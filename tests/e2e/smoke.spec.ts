import { expect, test, type Page } from '@playwright/test';

/** No horizontal scroll at 320 and 768 px (spec 005 layout rules), then back to the phone size. */
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

// Spec 004 smoke test in demo mode, on the spec 009 screens: home, use sheet, shop mode, products.
test('demo mode: use, shop, quick add, finish, count, add a store', async ({ page }) => {
  const nav = (name: string) => page.getByRole('navigation').getByRole('button', { name }).click();
  await page.goto('/');

  await expect(page.getByText('מצב הדגמה').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'יוצא לקנות' })).toBeVisible();
  await page.getByRole('button', { name: 'סגירת ההסבר' }).click();
  await expect(page.getByRole('heading', { name: 'איך זה עובד' })).toHaveCount(0);
  await noOverflow(page);

  // Home: one tap puts tea on the list, no amount question (2026-11-12).
  await page.getByRole('searchbox').fill('תה');
  await page.getByRole('button', { name: 'הוספת תה לרשימה' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('searchbox')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'ביטול הסימון של תה' })).toBeVisible();

  // Home: a product that is not in the catalog is made, and on save it is on the list.
  await page.getByRole('searchbox').fill('קינואה');
  await page.getByRole('button', { name: /^מוצר חדש: קינואה/ }).click();
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  await page.getByRole('searchbox').fill('קינואה');
  await expect(page.getByRole('button', { name: 'קינואה כבר ברשימת הקניות' })).toBeDisabled();
  await page.getByRole('searchbox').fill('');

  // Shop mode: tea is on the list, marked "נגמר". Add a new product from the shelf, tick both, finish.
  await page.getByRole('button', { name: 'יוצא לקנות' }).click();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  const teaLine = page.locator('li.line[data-item="תה"]');
  await expect(teaLine.locator('.tag')).toHaveText('נגמר');
  await noOverflow(page);
  await page.getByRole('button', { name: 'הוספה לרשימה' }).click();
  // Spec 013: every seed product is on a trip, so a new product is added from the shelf.
  await page.getByPlaceholder('מה להוסיף?').fill('במבה');
  await page.getByRole('button', { name: /^מוצר חדש: במבה/ }).click();
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  const rice = page.locator('li.line[data-item="במבה"]');
  await expect(rice).toBeVisible();
  await teaLine.getByRole('checkbox').click();
  await rice.getByRole('checkbox').click();
  await expect(page.getByRole('button', { name: /בעגלה \(2\)/ })).toBeVisible();
  await page.getByRole('button', { name: /^סיימתי/ }).click();
  await expect(page.getByRole('button', { name: 'יוצא לקנות' })).toBeVisible();

  // Products: tea was bought, so it is no longer gone. Stock count: + is saved at once.
  await nav('מוצרים');
  await page.getByRole('searchbox').fill('תה');
  await expect(page.locator('li[data-item="תה"] .row-sub')).not.toHaveText(/נגמר/);
  await page.getByRole('searchbox').fill('');
  await page.getByRole('button', { name: 'ספירת מלאי' }).click();
  await expect(page.getByRole('navigation')).toHaveCount(0);
  const first = page.locator('.count-list li').first();
  const before = await first.locator('output').innerText();
  await first.getByRole('button', { name: /^יותר/ }).click();
  await expect(first.locator('output')).not.toHaveText(before);
  await page.getByRole('button', { name: 'סיום ספירה' }).click();
  await noOverflow(page);

  // Add a store.
  await nav('הגדרות');
  await page.getByRole('button', { name: /^חנויות/ }).click();
  await page.getByRole('button', { name: 'הוספת חנות' }).click();
  await page.getByLabel('שם החנות').fill('שוק');
  await page.getByRole('button', { name: 'שמירה', exact: true }).click();
  await expect(page.getByRole('button', { name: 'עריכת שוק' })).toBeVisible();
  await page.getByRole('button', { name: 'חזרה להגדרות' }).click();
});

// Spec 003: settings are live in every open tab (storage event in demo mode).
test('demo mode: a settings change shows in another tab', async ({ page, context }) => {
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('button', { name: 'יוצא לקנות' })).toBeVisible();
  // Spec 014: the role store is the settings change left to make.
  const role = 'ברירת מחדל לפירות, ירקות וביצים';
  for (const p of [page, other]) {
    await p.getByRole('navigation').getByRole('button', { name: 'הגדרות' }).click();
    await p.getByRole('button', { name: /^חנויות/ }).click();
  }
  await page.getByLabel(role).selectOption({ label: 'חנות יבשים' });
  await expect(other.getByLabel(role).locator('option:checked')).toHaveText('חנות יבשים');
});
