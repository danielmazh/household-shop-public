import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Store } from '../data/store';
import type { TripId } from '../domain/schedule';

/** Read side of the trip amounts (spec 012). */
export type OverrideSource = Pick<Store, 'loadOverrides' | 'subscribeOverrides'>;

/**
 * Overrides of one trip, live. The second value puts a saved change on
 * screen at once (packs null removes it), before the refetch comes back.
 */
export function useOverrides(source: OverrideSource, trip: TripId): [Map<string, number>, (itemId: string, packs: number | null) => void] {
  const [overrides, setOverrides] = useState<Map<string, number>>(() => new Map());

  useEffect(() => {
    let live = true;
    const show = (next: Map<string, number>) => {
      if (live) setOverrides(next);
    };
    const load = () => source.loadOverrides(trip).then(show, () => undefined);
    setOverrides(new Map());
    void load();
    const unsubscribe = source.subscribeOverrides(trip, show);
    // Realtime can miss changes while the phone sleeps or is offline.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [source, trip]);

  const put = useCallback((itemId: string, packs: number | null) => {
    setOverrides((prev) => {
      const next = new Map(prev);
      if (packs === null) next.delete(itemId);
      else next.set(itemId, packs);
      return next;
    });
  }, []);

  return [overrides, put];
}
