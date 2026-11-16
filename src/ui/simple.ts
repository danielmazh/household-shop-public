import { useEffect, useState } from 'preact/hooks';

// Spec 013: "רשימה פשוטה" is a per-device choice, like the language.
const SIMPLE_KEY = 'household-shop.simple';

const read = () => {
  try {
    return localStorage.getItem(SIMPLE_KEY) === '1';
  } catch {
    return false;
  }
};

let current = read();
const listeners = new Set<() => void>();

export const isSimple = () => current;

/** Turns simple mode on or off on this device and redraws. */
export function setSimple(on: boolean) {
  current = on;
  try {
    if (on) localStorage.setItem(SIMPLE_KEY, '1');
    else localStorage.removeItem(SIMPLE_KEY);
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
  for (const l of listeners) l();
}

/** Simple mode; the component redraws when it changes. */
export function useSimple(): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  return current;
}
