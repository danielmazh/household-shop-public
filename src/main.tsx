import { render } from 'preact';
import { createStore } from './data';
import { App } from './ui/App';
import { applyLang, getLang } from './ui/i18n';
import './ui/styles.css';

// Spec 010: <html lang dir> follow the saved language before the first paint.
applyLang();
// Spec 011: the demo seed reads the language when it runs, after the first-run choice.
render(<App store={createStore(getLang)} />, document.getElementById('app')!);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const base = import.meta.env.BASE_URL;
  void navigator.serviceWorker.register(`${base}sw.js`, { scope: base, updateViaCache: 'none' });
}
