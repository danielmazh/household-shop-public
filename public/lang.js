// Spec 011: before the first paint, the page follows the saved language:
// <html lang dir>, the title, the description and the install manifest.
// A plain file, because the CSP allows no inline script. src/ui/i18n.ts does the same later.
(function () {
  var en = false;
  try {
    en = localStorage.getItem('household-shop.lang') === 'en';
  } catch {
    // No storage: Hebrew, as in index.html.
  }
  if (!en) return;
  var root = document.documentElement;
  root.lang = 'en';
  root.dir = 'ltr';
  document.title = 'Home Shopping';
  var description = document.querySelector('meta[name="description"]');
  if (description) description.setAttribute('content', 'A shared shopping list for the home');
  var manifest = document.querySelector('link[rel="manifest"]');
  if (manifest) manifest.setAttribute('href', './manifest.en.webmanifest');
})();
