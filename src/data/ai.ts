import { readSuggestion, type SuggestQuery, type Suggestion } from '../domain/suggest';

export type Suggest = (query: SuggestQuery) => Promise<Suggestion>;

/** Hebrew message for a failed AI call, shown under the button. */
export class SuggestError extends Error {}

/** Calls POST /api/suggest on this site with the user's session token. */
export function makeSuggest(token: () => Promise<string | null>): Suggest {
  return async (query) => {
    if (!navigator.onLine) throw new SuggestError('אין חיבור לרשת');
    const t = await token();
    if (!t) throw new SuggestError('צריך להתחבר מחדש');
    let res: Response;
    try {
      res = await fetch('/api/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${t}` },
        body: JSON.stringify(query),
      });
    } catch {
      throw new SuggestError('אין חיבור לרשת');
    }
    if (res.status === 429) throw new SuggestError('יותר מדי בקשות. נסו שוב בעוד דקה');
    const suggestion = res.ok ? readSuggestion(await res.json().catch(() => null)) : null;
    if (!suggestion) throw new SuggestError('ה-AI לא הצליח הפעם. אפשר למלא ידנית');
    return suggestion;
  };
}
