// Item pictures are native emoji picked from the name, with a category
// fallback (spec 006). Pure: no schema change, nothing stored.

const BY_NAME: Record<string, string> = {
  'אורז': '🍚',
  'ביצים': '🥚',
  'קמח': '🌾',
  'תה': '🍵',
  'תבלינים': '🧂',
  'חמוצים': '🥒',
  'מיונז': '🫙',
  'קטשופ': '🍅',
  'נייר טואלט': '🧻',
  'מגבונים': '🧼',
  'חיתולים': '👶',
  'חלב': '🥛',
  'גבינה': '🧀',
  'יוגורט': '🥣',
  'פירות': '🍎',
  'ירקות': '🥕',
  'עוף': '🍗',
  'דניס': '🐟',
  'סלמון': '🍣',
  'אמנון': '🐠',
  'טילפיה': '🐟',
  'חלה': '🍞',
  'מיץ ענבים': '🍇',
  'יין לבן': '🍷',
  // English seed (spec 011)
  rice: '🍚',
  eggs: '🥚',
  flour: '🌾',
  tea: '🍵',
  spices: '🧂',
  pickles: '🥒',
  mayonnaise: '🫙',
  ketchup: '🍅',
  'toilet paper': '🧻',
  'wet wipes': '🧼',
  diapers: '👶',
  milk: '🥛',
  cheese: '🧀',
  yogurt: '🥣',
  fruit: '🍎',
  vegetables: '🥕',
  chicken: '🍗',
  'sea bream': '🐟',
  salmon: '🍣',
  'sea bass': '🐠',
  tilapia: '🐟',
  bread: '🍞',
  'grape juice': '🍇',
  'white wine': '🍷',
};

const BY_CATEGORY: Record<string, string> = {
  'יבשים': '🌾',
  'רטבים ושימורים': '🥫',
  'בית וניקיון': '🧽',
  'תינוק': '👶',
  'מוצרי חלב': '🥛',
  'פירות וירקות': '🥬',
  'בשר ועוף': '🍗',
  'דגים': '🐟',
  'שבת': '🕯️',
  'dry goods': '🌾',
  'sauces and cans': '🥫',
  'home and cleaning': '🧽',
  baby: '👶',
  dairy: '🥛',
  'fruit and veg': '🥬',
  'meat and chicken': '🍗',
  fish: '🐟',
  weekend: '🛒',
};

export const DEFAULT_EMOJI = '🛒';

const norm = (s: string) => s.trim().toLocaleLowerCase('he');

/** Emoji for an item: its own, then exact name, then category, then a cart. */
export function itemEmoji(item: { name: string; category: string; emoji?: string | null }): string {
  return item.emoji || BY_NAME[norm(item.name)] || BY_CATEGORY[norm(item.category)] || DEFAULT_EMOJI;
}

/** Curated emoji for store and trip pickers. No external library. */
export const STORE_EMOJI = ['🛒', '🏬', '🥕', '🍎', '🥬', '🍗', '🐟', '🍞', '🥛', '🧀', '🍷', '💊'];
export const TRIP_EMOJI = ['🧺', '🕯️', '🍞', '🛒', '🍷', '🏡', '🥕', '🐟', '🥛', '🎉', '📦', '⭐'];
