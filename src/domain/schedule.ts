import { CADENCES, type Cadence, type Lang } from './types';
import { parseRoleStores, type RoleStores } from './categories';

/** A trip id is a short slug (spec 007). */
export type TripId = string;

/** One weekly trip, on one or more days. Days: 0 = Sunday ... 6 = Saturday. */
export interface Trip {
  id: TripId;
  name: string;
  emoji: string;
  /** 1 to 7 days, sorted, no repeats. */
  days: number[];
  /** Cadences bought on this trip, at least one. */
  carries: Cadence[];
}

/** Household settings (spec 007). */
export interface Settings {
  /** 1 to 7 trips. List order breaks ties for "next trip". */
  trips: Trip[];
  /** Name of each cadence in this household. */
  cadenceLabels: Record<Cadence, string>;
  /** Safety margin, 0.1 = 10%. 0 to 0.5 in steps of 0.05. */
  margin: number;
  /** Default store per store role (spec 013). Empty for households from before 0007. */
  roleStores: RoleStores;
}

/** Limits shared with the database checks in supabase/migrations/0001_init.sql. */
export const TRIP_LIMITS = { min: 1, max: 7, name: 30, emoji: 16, label: 20 } as const;
export const TRIP_ID_RE = /^[a-z0-9-]{1,20}$/;
export const MARGIN = { min: 0, max: 0.5, step: 0.05 } as const;

export const DEFAULT_TRIPS: readonly Trip[] = [
  { id: 'main', name: 'קנייה גדולה', emoji: '🧺', days: [2], carries: ['bulk', 'fresh'] },
  { id: 'shabbat', name: 'קניית שבת', emoji: '🕯️', days: [4], carries: ['fresh', 'shabbat'] },
  { id: 'friday', name: 'קניית שישי', emoji: '🍞', days: [5], carries: ['friday'] },
];

export const DEFAULT_CADENCE_LABELS: Readonly<Record<Cadence, string>> = {
  bulk: 'שבועי בכמות',
  fresh: 'טרי',
  shabbat: 'שבת',
  friday: 'שישי',
};

export const DEFAULT_SETTINGS: Settings = {
  trips: DEFAULT_TRIPS.map((t) => ({ ...t, days: [...t.days], carries: [...t.carries] })),
  cadenceLabels: { ...DEFAULT_CADENCE_LABELS },
  margin: 0.1,
  roleStores: {},
};

// Spec 011: the same trips with English names, for a household made in English.
const TRIP_NAMES_EN: Record<TripId, [name: string, emoji: string]> = {
  main: ['Big shop', '🧺'],
  shabbat: ['Weekend', '🛒'],
  friday: ['Bakery', '🍞'],
};

const CADENCE_LABELS_EN: Readonly<Record<Cadence, string>> = {
  bulk: 'Weekly bulk',
  fresh: 'Fresh',
  shabbat: 'Weekend',
  friday: 'Friday',
};

/** Default settings of a new household in this language. Same values as default_settings(lang) in SQL. */
export function defaultSettings(lang: Lang = 'he'): Settings {
  if (lang !== 'en') return normalizeSettings(DEFAULT_SETTINGS);
  return {
    trips: DEFAULT_TRIPS.map((t) => ({ ...t, name: TRIP_NAMES_EN[t.id]![0], emoji: TRIP_NAMES_EN[t.id]![1], days: [...t.days], carries: [...t.carries] })),
    cadenceLabels: { ...CADENCE_LABELS_EN },
    margin: DEFAULT_SETTINGS.margin,
    roleStores: {},
  };
}

// Share rule ------------------------------------------------------------------

/** Trip days in a week that carry the cadence. A trip on two days counts twice. */
const tripsCarrying = (trips: readonly Trip[], cadence: Cadence) =>
  trips.reduce((n, t) => n + (t.carries.includes(cadence) ? t.days.length : 0), 0);

/**
 * Share of a week of use bought on one day of this trip: 1/N when N trip
 * days in the week carry the cadence, 0 when this trip does not carry it or
 * the trip is unknown.
 */
export function shareFor(trips: readonly Trip[], tripId: TripId, cadence: Cadence): number {
  const trip = trips.find((t) => t.id === tripId);
  return trip?.carries.includes(cadence) ? 1 / tripsCarrying(trips, cadence) : 0;
}

/**
 * The share an item gets when it goes on a trip that does not carry it
 * (ran out, or a cadence no trip carries): its normal share, or 1.
 */
export function homeShare(trips: readonly Trip[], cadence: Cadence): number {
  const n = tripsCarrying(trips, cadence);
  return n > 0 ? 1 / n : 1;
}

/** Cadences no trip carries. Their items go on the next trip with share 1. */
export function uncoveredCadences(trips: readonly Trip[]): Cadence[] {
  return CADENCES.filter((c) => tripsCarrying(trips, c) === 0);
}

// Next trip --------------------------------------------------------------------

export interface UpcomingTrip {
  trip: TripId;
  /** Days from today, 0 to 6. */
  inDays: number;
}

/** Days from today to the trip's next day, 0 to 6. */
export const daysUntil = (trip: Trip, today: Date): number => Math.min(...trip.days.map((d) => (d - today.getDay() + 7) % 7));

/** All trips ordered by how soon they come, counting today as day 0. Same day: list order. */
export function upcomingTrips(today: Date, settings: Settings): UpcomingTrip[] {
  return settings.trips
    .map((t, index) => ({ trip: t.id, inDays: daysUntil(t, today), index }))
    .sort((a, b) => a.inDays - b.inDays || a.index - b.index)
    .map(({ trip, inDays }) => ({ trip, inDays }));
}

/** First trip on or after today, wrapping to next week. */
export function nextTrip(today: Date, settings: Settings): TripId {
  return upcomingTrips(today, settings)[0]!.trip;
}

/** The trip with this id, or undefined. */
export const findTrip = (settings: Settings, id: TripId): Trip | undefined => settings.trips.find((t) => t.id === id);

// Validation -------------------------------------------------------------------

export type TripField = 'id' | 'name' | 'emoji' | 'days' | 'carries';
export type TripErrors = Partial<Record<TripField, string>>;

const isDay = (d: unknown): d is number => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6;
const normalName = (name: string) => name.trim().toLocaleLowerCase('he');

/** Checks one trip. `others` is the rest of the list, for the unique id and name rules. */
export function validateTrip(trip: Trip, others: readonly Trip[]): TripErrors {
  const errors: TripErrors = {};
  const rest = others.filter((o) => o !== trip);
  if (!TRIP_ID_RE.test(trip.id)) errors.id = 'מזהה לא חוקי';
  else if (rest.some((o) => o.id === trip.id)) errors.id = 'מזהה כפול';
  const name = normalName(trip.name);
  if (!name) errors.name = 'שם חובה';
  else if (trip.name.trim().length > TRIP_LIMITS.name) errors.name = `עד ${TRIP_LIMITS.name} תווים`;
  else if (rest.some((o) => o.id !== trip.id && normalName(o.name) === name)) errors.name = 'כבר יש קנייה בשם הזה';
  if (trip.emoji.length > TRIP_LIMITS.emoji) errors.emoji = 'אימוג׳י לא חוקי';
  if (trip.days.length === 0) errors.days = 'בחרו לפחות יום אחד';
  else if (!trip.days.every(isDay) || new Set(trip.days).size !== trip.days.length) errors.days = 'יום לא חוקי';
  if (trip.carries.length === 0) errors.carries = 'בחרו לפחות סוג קנייה אחד';
  else if (trip.carries.some((c) => !CADENCES.includes(c)) || new Set(trip.carries).size !== trip.carries.length) {
    errors.carries = 'סוג קנייה לא חוקי';
  }
  return errors;
}

/** Errors per trip (same order as the list) and one error for the list size, if any. */
export interface TripListErrors {
  list?: string;
  trips: TripErrors[];
}

export function validateTrips(trips: readonly Trip[]): TripListErrors {
  const out: TripListErrors = { trips: trips.map((t) => validateTrip(t, trips)) };
  if (trips.length < TRIP_LIMITS.min) out.list = 'צריך לפחות קנייה אחת';
  else if (trips.length > TRIP_LIMITS.max) out.list = `עד ${TRIP_LIMITS.max} קניות בשבוע`;
  return out;
}

export const tripsValid = (e: TripListErrors) => !e.list && e.trips.every((t) => Object.keys(t).length === 0);

/** A free trip id for a new trip: trip-1, trip-2, ... */
export function newTripId(trips: readonly Trip[]): TripId {
  const used = new Set(trips.map((t) => t.id));
  let n = 1;
  while (used.has(`trip-${n}`)) n++;
  return `trip-${n}`;
}

/** True for 0, 0.05, ... 0.5 (with float tolerance). */
export function isValidMargin(m: number): boolean {
  if (!Number.isFinite(m) || m < MARGIN.min - 1e-9 || m > MARGIN.max + 1e-9) return false;
  return Math.abs(m / MARGIN.step - Math.round(m / MARGIN.step)) < 1e-6;
}

/** Nearest valid margin: clamped to 0..0.5 and rounded to a step of 0.05. */
export function snapMargin(m: number): number {
  const clamped = Math.min(MARGIN.max, Math.max(MARGIN.min, m));
  return Math.round(clamped / MARGIN.step) / Math.round(1 / MARGIN.step);
}

// Parsing ---------------------------------------------------------------------

const str = (v: unknown) => (typeof v === 'string' ? v : '');

function parseTrip(raw: unknown): Trip | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const carries = Array.isArray(r.carries) ? CADENCES.filter((c) => (r.carries as unknown[]).includes(c)) : [];
  // Settings saved before multi-day trips have one `day` instead of `days`.
  const rawDays: unknown[] = Array.isArray(r.days) ? r.days : [r.day];
  const days = [...new Set(rawDays)].filter(isDay).sort((a, b) => a - b);
  const trip: Trip = { id: str(r.id), name: str(r.name).trim(), emoji: str(r.emoji), days, carries };
  return Object.keys(validateTrip(trip, [])).length === 0 ? trip : null;
}

/**
 * Reads settings from storage or the database, filling gaps with defaults.
 * Accepts the old shape `{ days: { main, shabbat, friday }, margin }`: it
 * becomes the default trips on the saved days.
 */
export function normalizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { trips?: unknown; days?: Record<string, unknown>; cadenceLabels?: unknown; margin?: unknown; roleStores?: unknown };

  const trips: Trip[] = [];
  if (Array.isArray(r.trips)) {
    for (const t of r.trips.map(parseTrip)) {
      if (t && trips.length < TRIP_LIMITS.max && Object.keys(validateTrip(t, trips)).length === 0) trips.push(t);
    }
  }
  if (trips.length === 0) {
    const days = r.days && typeof r.days === 'object' ? r.days : {};
    for (const t of DEFAULT_TRIPS) trips.push({ ...t, carries: [...t.carries], days: isDay(days[t.id]) ? [days[t.id] as number] : [...t.days] });
  }

  const labels = (r.cadenceLabels && typeof r.cadenceLabels === 'object' ? r.cadenceLabels : {}) as Record<string, unknown>;
  const cadenceLabels = { ...DEFAULT_CADENCE_LABELS };
  for (const c of CADENCES) {
    const label = str(labels[c]).trim();
    if (label && label.length <= TRIP_LIMITS.label) cadenceLabels[c] = label;
  }

  const m = r.margin;
  const margin = typeof m === 'number' && Number.isFinite(m) && m >= 0 ? snapMargin(m) : DEFAULT_SETTINGS.margin;
  return { trips, cadenceLabels, margin, roleStores: parseRoleStores(r.roleStores) };
}

/**
 * Settings as saved. Each trip also keeps `day` (its first day): the database
 * check in 0001_init.sql needs it, and app copies cached before multi-day
 * trips read only `day`.
 */
export const toStoredSettings = (s: Settings) => ({ ...s, trips: s.trips.map((t) => ({ ...t, day: t.days[0] })) });
