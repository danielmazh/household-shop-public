# 002 - Trip planner

## Schedule (defaults for a new household; each household edits its own, see 007)
Days: 0 = Sunday ... 6 = Saturday.
| trip | day | carries |
|---|---|---|
| main | Tue (2) | `bulk` full week, `fresh` half week |
| shabbat | Thu (4) | `fresh` half week, `shabbat` full week |
| friday | Fri (5) | `friday` full week |
Safety margin default 10%.

## Quantity rule
For an item on a trip with share `s` (1 or 1/fresh trips per week):
- `target = weeklyUse * s * (1 + margin)`
- `needUnits = max(0, target - stock)`
- `packs = ceil(needUnits / packSize)`, with float tolerance 1e-9.
- If `ranOut` and `packs = 0`, then `packs = 1`.
- Item listed only if `packs > 0`.
`ranOut` items of any cadence go on the next upcoming trip.

## Next trip
The first scheduled trip day on or after today (wraps to next week). The user can switch to any trip.

## Flow
1. Open trip. Optional quick stock count (stepper per item).
2. List grouped by store (sorted by category inside). Each row shows an emoji, the name and the total amount (packs x pack size, with unit). Prices show only as a per-store total and a trip total, when prices exist.
3. Tick items while shopping. "Finish trip" adds `packs * packSize` to stock for ticked items and clears `ranOut`.
4. "Ran out" button on any item from the catalog.

## Acceptance
Unit tests cover: shares per cadence, margin, pack rounding, stock above target, ranOut forcing, next-trip wrap, grouping and totals, finish-trip stock update.

## Shared ticks
Ticks are live and shared. A tick on one phone shows on every member's phone and device within seconds. Ticks are kept per trip (`main`, `shabbat`, `friday`). "Finish trip" applies the stock change and clears that trip's ticks in one step, for everyone.
