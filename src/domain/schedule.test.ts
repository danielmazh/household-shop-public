import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  isValidMargin,
  newTripId,
  nextTrip,
  normalizeSettings,
  shareFor,
  snapMargin,
  tripsValid,
  uncoveredCadences,
  upcomingTrips,
  validateTrip,
  validateTrips,
  toStoredSettings,
  type Settings,
  type Trip,
} from './schedule';

// 2026-10-25 is a Sunday.
const day = (offset: number) => new Date(2026, 9, 25 + offset);

const trip = (id: string, d: number | number[], carries: Trip['carries'], name = id): Trip => ({ id, name, emoji: '', days: Array.isArray(d) ? d : [d], carries });
const withTrips = (trips: Trip[]): Settings => ({ ...DEFAULT_SETTINGS, trips });

describe('shareFor', () => {
  const trips = DEFAULT_SETTINGS.trips;

  it('gives each cadence its share on the default trips', () => {
    expect(shareFor(trips, 'main', 'bulk')).toBe(1);
    expect(shareFor(trips, 'main', 'fresh')).toBe(0.5);
    expect(shareFor(trips, 'shabbat', 'fresh')).toBe(0.5);
    expect(shareFor(trips, 'shabbat', 'shabbat')).toBe(1);
    expect(shareFor(trips, 'friday', 'friday')).toBe(1);
  });

  it('gives 0 when the trip does not carry the cadence or is unknown', () => {
    expect(shareFor(trips, 'main', 'shabbat')).toBe(0);
    expect(shareFor(trips, 'friday', 'fresh')).toBe(0);
    expect(shareFor(trips, 'gone', 'bulk')).toBe(0);
  });

  it('splits a cadence over 0, 1, 2 and 3 trips', () => {
    const three = [trip('a', 0, ['fresh']), trip('b', 2, ['fresh', 'bulk']), trip('c', 4, ['fresh'])];
    expect(three.map((t) => shareFor(three, t.id, 'fresh'))).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(three.map((t) => shareFor(three, t.id, 'bulk'))).toEqual([0, 1, 0]);
    expect(three.map((t) => shareFor(three, t.id, 'shabbat'))).toEqual([0, 0, 0]);
    expect(uncoveredCadences(three)).toEqual(['shabbat', 'friday']);
    expect(uncoveredCadences(DEFAULT_SETTINGS.trips)).toEqual([]);
  });
});

describe('nextTrip', () => {
  it.each([
    [0, 'main'], // Sun -> Tue
    [2, 'main'], // Tue itself
    [3, 'shabbat'], // Wed -> Thu
    [4, 'shabbat'],
    [5, 'friday'],
    [6, 'main'], // Sat wraps to next Tue
  ] as const)('day offset %i gives %s', (offset, id) => {
    expect(nextTrip(day(offset), DEFAULT_SETTINGS)).toBe(id);
  });

  it('breaks same-day ties by list order', () => {
    const settings = withTrips([trip('late', 3, ['bulk']), trip('b', 2, ['fresh']), trip('a', 2, ['friday'])]);
    expect(nextTrip(day(1), settings)).toBe('b');
    expect(upcomingTrips(day(1), settings)).toEqual([
      { trip: 'b', inDays: 1 },
      { trip: 'a', inDays: 1 },
      { trip: 'late', inDays: 2 },
    ]);
  });
});

describe('validateTrips', () => {
  it('accepts the defaults', () => {
    expect(tripsValid(validateTrips(DEFAULT_SETTINGS.trips))).toBe(true);
  });

  it('needs 1 to 7 trips', () => {
    expect(validateTrips([]).list).toBeTruthy();
    const eight = Array.from({ length: 8 }, (_, n) => trip(`t${n}`, n % 7, ['bulk']));
    expect(validateTrips(eight).list).toBeTruthy();
    expect(validateTrips(eight.slice(0, 7)).list).toBeUndefined();
  });

  it('rejects duplicate ids and names, bad ids, no cadence and a bad day', () => {
    const errors = validateTrips([trip('a', 1, ['bulk'], 'x'), trip('a', 2, ['fresh'], 'y'), trip('c', 3, ['fresh'], ' X ')]);
    expect(errors.trips[1]?.id).toBeTruthy();
    expect(errors.trips[2]?.name).toBeTruthy();
    const bad = validateTrip({ id: 'Main!', name: ' ', emoji: '', days: [7], carries: [] }, []);
    expect(Object.keys(bad).sort()).toEqual(['carries', 'days', 'id', 'name']);
    expect(validateTrip(trip('a', 1.5, ['bulk']), []).days).toBeTruthy();
    expect(validateTrip(trip('a', [], ['bulk']), []).days).toBeTruthy();
    expect(validateTrip(trip('a', [1, 1], ['bulk']), []).days).toBeTruthy();
    expect(validateTrip(trip('a', [1, 4], ['bulk']), [])).toEqual({});
    expect(validateTrip(trip('a', 1, ['bulk'], 'n'.repeat(31)), []).name).toBeTruthy();
  });

  it('makes a free id for a new trip', () => {
    expect(newTripId([trip('trip-1', 1, ['bulk'])])).toBe('trip-2');
  });
});

describe('margin', () => {
  it('allows 0 to 50% in steps of 5', () => {
    expect([0, 0.05, 0.1, 0.15, 0.5].every(isValidMargin)).toBe(true);
    expect([-0.05, 0.12, 0.55, Number.NaN].some(isValidMargin)).toBe(false);
    expect(snapMargin(0.12)).toBe(0.1);
    expect(snapMargin(2)).toBe(0.5);
  });
});

describe('normalizeSettings', () => {
  it('fills missing or invalid values with defaults', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({ trips: 'x', margin: -1, cadenceLabels: { fresh: ' ', bulk: 3 } })).toEqual(DEFAULT_SETTINGS);
  });

  it('turns the old days shape into the default trips on those days', () => {
    const s = normalizeSettings({ days: { main: 0, shabbat: 9, friday: 6 }, margin: 0.2 });
    expect(s.trips.map((t) => [t.id, t.days])).toEqual([
      ['main', [0]],
      ['shabbat', [4]],
      ['friday', [6]],
    ]);
    expect(s.margin).toBe(0.2);
  });

  it('keeps valid trips and labels, drops bad or duplicate trips', () => {
    const s = normalizeSettings({
      trips: [trip('a', 1, ['bulk']), { id: 'b', name: 'b', day: 2, carries: ['nope'] }, trip('a', 3, ['fresh'], 'other'), trip('c', 3, ['fresh'])],
      cadenceLabels: { fresh: 'ירוקים' },
      margin: 0.12,
    });
    expect(s.trips.map((t) => t.id)).toEqual(['a', 'c']);
    expect(s.cadenceLabels.fresh).toBe('ירוקים');
    expect(s.cadenceLabels.bulk).toBe(DEFAULT_SETTINGS.cadenceLabels.bulk);
    expect(s.margin).toBe(0.1);
  });
});

describe('trips on many days', () => {
  const fresh = trip('fresh', [1, 4], ['fresh']);
  const big = trip('big', 2, ['bulk', 'fresh']);

  it('counts each day in the share', () => {
    expect(shareFor([fresh, big], 'fresh', 'fresh')).toBeCloseTo(1 / 3);
    expect(shareFor([fresh, big], 'big', 'bulk')).toBe(1);
  });

  it('comes next on its nearest day', () => {
    // Tuesday: big today, fresh on Thursday (2 days).
    expect(upcomingTrips(day(2), withTrips([fresh, big]))).toEqual([
      { trip: 'big', inDays: 0 },
      { trip: 'fresh', inDays: 2 },
    ]);
    // Friday: fresh on Monday (3 days).
    expect(upcomingTrips(day(5), withTrips([fresh, big]))[0]).toEqual({ trip: 'fresh', inDays: 3 });
  });

  it('reads the old one-day shape and saves both shapes', () => {
    const s = normalizeSettings({ trips: [{ id: 'a', name: 'a', emoji: '', day: 3, carries: ['bulk'] }, { id: 'b', name: 'b', emoji: '', days: [5, 1, 5], carries: ['fresh'] }] });
    expect(s.trips.map((t) => t.days)).toEqual([[3], [1, 5]]);
    expect(toStoredSettings(s).trips.map((t) => t.day)).toEqual([3, 1]);
    expect(normalizeSettings(toStoredSettings(s))).toEqual(s);
  });
});
