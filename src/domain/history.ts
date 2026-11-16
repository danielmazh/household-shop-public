import type { Item, Purchase, PurchaseLine, Shop, StockDelta } from './types';

/** Finished trips kept in demo mode and loaded in the history screen (spec 012). */
export const HISTORY_LIMIT = 100;

/**
 * History lines for the bought lines of a trip, with name, unit, store and
 * price copied now. Same rule as finish_household_trip in migration 0006.
 */
export function purchaseLines(bought: readonly StockDelta[], items: readonly Item[], shops: readonly Shop[]): PurchaseLine[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  return bought.flatMap((b) => {
    const item = byId.get(b.itemId);
    if (!item) return [];
    return [
      {
        itemId: item.id,
        name: item.name,
        packs: b.packs ?? Math.round((b.delta / item.packSize) * 100) / 100,
        units: b.delta,
        unit: item.unit,
        storeName: shops.find((s) => s.id === item.storeId)?.name ?? null,
        price: item.price,
      },
    ];
  });
}

/** Estimated cost of a finished trip: packs * price of the lines with a price, or null when none has one. */
export function purchaseCost(p: Pick<Purchase, 'lines'>): number | null {
  const known = p.lines.filter((l) => l.price !== null);
  return known.length ? known.reduce((s, l) => s + l.packs * l.price!, 0) : null;
}

/** Newest first. */
export const sortPurchases = (list: readonly Purchase[]): Purchase[] => [...list].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
