import { LocalStore } from './localStore';
import { SupabaseStore } from './supabaseStore';
import type { Lang } from '../domain/types';

/** Supabase when both env values are set at build time, otherwise local demo mode. `lang` picks the demo seed. */
export function createStore(lang: () => Lang = () => 'he'): LocalStore | SupabaseStore {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim();
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
  return url && key ? new SupabaseStore(url, key) : new LocalStore(localStorage, lang);
}

export { LocalStore, SupabaseStore };
export type { Store, ItemsResult } from './store';
export type { Household } from './supabaseStore';
