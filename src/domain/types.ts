/** App language (spec 010). Hebrew is the default. */
export type Lang = 'he' | 'en';

export const CADENCES = ['bulk', 'fresh', 'shabbat', 'friday'] as const;
export type Cadence = (typeof CADENCES)[number];

export interface Item {
  id: string;
  name: string;
  category: string;
  /** Older way to place an item on trips, through the trips that carry it. Used when `trips` is null. */
  cadence: Cadence;
  /** Ids of the trips this item is bought on. Null on rows made before 2026-11-03. */
  trips: string[] | null;
  /** Picture chosen for this item (by the AI or the user). Unset: picked from the name, see itemEmoji. */
  emoji?: string | null;
  /** Id of a store in the household's store list, or null for no store. */
  storeId: string | null;
  /** Units used per week. Not shown since spec 009; `target` decides. Used for `target` null and the backfill. */
  weeklyUse: number;
  /** Units to keep at home (spec 009). The list fills stock up to it. Null on rows read before 0004. */
  target?: number | null;
  unit: string;
  /** Units per pack bought. */
  packSize: number;
  /** Price per pack, or null when unknown. */
  price: number | null;
  /** Units at home, last count. */
  stock: number;
  ranOut: boolean;
  active: boolean;
  /**
   * One-time product (spec 012): the trip it goes on, or null/unset for a
   * regular product. Bought means `active` false; the field stays for "שוב".
   */
  onceTrip?: string | null;
}

export type ItemField = Exclude<keyof Item, 'id'>;
export type ValidationErrors = Partial<Record<ItemField, string>>;

/** Only the fields that changed. Sent as a partial update. */
export type ItemPatch = Partial<Omit<Item, 'id'>>;

/** A store of the household (spec 007). Archived stores keep their row; `active` is false. */
export interface Shop {
  id: string;
  name: string;
  emoji: string;
  /** Position in the household's store order, smallest first. */
  sort: number;
  active: boolean;
}

export type ShopField = 'name' | 'emoji';
export type ShopErrors = Partial<Record<ShopField, string>>;
/** Fields a store edit may change. Archive with `archiveShop`; `active: true` restores. */
export type ShopPatch = Partial<Pick<Shop, 'name' | 'emoji'>> & { active?: true };

/** Units to add to (or take from) one item's stock. */
export interface StockDelta {
  itemId: string;
  delta: number;
  /** Packs bought, for the purchase history (spec 012). Unset: delta / pack size. */
  packs?: number;
}

/** One line of a finished trip (spec 012). Name, unit, store and price as they were then. */
export interface PurchaseLine {
  itemId: string | null;
  name: string;
  packs: number;
  units: number;
  unit: string;
  storeName: string | null;
  /** Price per pack then, or null when unknown. */
  price: number | null;
}

/** A finished trip in the history (spec 012). */
export interface Purchase {
  id: string;
  trip: string;
  /** Trip name then, or null when unknown. */
  tripName: string | null;
  /** Short name of who finished it, or null (demo mode, or unknown). */
  finishedBy: string | null;
  /** ISO time. */
  finishedAt: string;
  lines: PurchaseLine[];
}
