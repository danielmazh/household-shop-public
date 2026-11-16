// Cloudflare Pages Function: POST /api/suggest (2026-11-03).
// Holds the Gemini key server side. Only a signed-in Supabase user may call it.
// Secrets on the Pages project: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY.
import { buildPrompt, readQuery, readSuggestion, responseSchema } from '../../src/domain/suggest';

interface Env {
  GEMINI_API_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}

interface Context {
  request: Request;
  env: Env;
}

const MODEL = 'gemini-2.5-flash';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

function parseJson(text: string | undefined): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

/** True when the bearer token is a live Supabase session. */
async function signedIn(request: Request, env: Env): Promise<boolean> {
  const auth = request.headers.get('authorization');
  if (!auth?.startsWith('Bearer ') || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return false;
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers: { authorization: auth, apikey: env.SUPABASE_ANON_KEY } });
    return res.ok;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  if (!env.GEMINI_API_KEY) return json({ error: 'not_configured' }, 503);
  if (!(await signedIn(request, env))) return json({ error: 'unauthorized' }, 401);

  const query = readQuery(await request.json().catch(() => null));
  if (!query) return json({ error: 'bad_request' }, 400);

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(query) }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: responseSchema(query.lang), temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } },
    }),
  }).catch(() => null);
  if (!res) return json({ error: 'ai_failed' }, 502);
  if (res.status === 429) return json({ error: 'busy' }, 429);
  if (!res.ok) return json({ error: 'ai_failed' }, 502);

  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const out = data.candidates?.[0]?.content?.parts?.[0]?.text;
  const suggestion = readSuggestion(parseJson(out), query.lang);
  return suggestion ? json(suggestion) : json({ error: 'ai_failed' }, 502);
}
