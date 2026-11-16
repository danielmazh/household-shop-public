import { expect, test } from '@playwright/test';

// "ספרו לחברים" in settings: the WhatsApp message follows the app language and carries the app link.
test('tell friends: message in the current language with the app link', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('household-shop.lang')) localStorage.setItem('household-shop.lang', 'he');
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'סגירת ההסבר' }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'הגדרות' }).click();

  const card = page.locator('section', { has: page.getByRole('heading', { name: 'ספרו לחברים' }) });
  const wa = card.getByRole('link', { name: 'שליחה בוואטסאפ' });
  const href = decodeURIComponent((await wa.getAttribute('href')) ?? '');
  expect(href).toContain('אפליקציה חינמית');
  expect(href).toContain(new URL(page.url()).origin);

  await page.getByRole('radio', { name: 'English' }).click();
  const enHref = decodeURIComponent((await page.locator('section', { has: page.getByRole('heading', { name: 'Tell your friends' }) }).getByRole('link').getAttribute('href')) ?? '');
  expect(enHref).toContain('free app');
});
