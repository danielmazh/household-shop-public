import { Layout } from './parts';
import { setLang } from './i18n';

/**
 * First screen on a new device (spec 011): the app name and a language
 * button in each language. The texts are fixed, not from `t()`, so each
 * shows in its own language before a choice exists.
 */
export function LanguageScreen() {
  return (
    <Layout
      focus
      hero={
        <div class="welcome stack">
          <div class="float-tiles" aria-hidden="true">
            <span>🍞</span>
            <span>🥛</span>
            <span>🥕</span>
          </div>
          <h1>
            <span lang="he" dir="rtl">
              קניות לבית
            </span>
            <span class="visually-hidden"> · </span>
            <span class="sub lang-name" lang="en" dir="ltr">
              Home Shopping
            </span>
          </h1>
        </div>
      }
    >
      <section class="card lang-card" aria-label="Language · שפה">
        <button type="button" class="btn primary full lang-btn" lang="he" dir="rtl" onClick={() => setLang('he')}>
          עברית
        </button>
        <button type="button" class="btn primary full lang-btn" lang="en" dir="ltr" onClick={() => setLang('en')}>
          English
        </button>
      </section>
    </Layout>
  );
}
