# 001 - Catalog

## Item
| field | type | rule |
|---|---|---|
| name | text | required, unique per household |
| category | text | for grouping in UI |
| cadence | `bulk` \| `fresh` \| `shabbat` \| `friday` | decides which trips carry it |
| storeId | store id or none | where it is cheapest; one of the household's stores (007) |
| weeklyUse | number >= 0 | units used per week |
| unit | text | e.g. pack, kg, unit |
| packSize | number > 0 | units per pack bought |
| price | number >= 0, optional | price per pack |
| stock | number >= 0 | units at home, last count |
| ranOut | boolean | set by "ran out" tap, cleared after purchase |
| active | boolean | inactive items never appear on a trip |

## Behavior
- Add, edit, deactivate items. No hard delete in UI.
- Up to 500 active items and 2000 in all (inactive ones count) per household (spec 003).
- First run seeds a default catalog (rice, eggs, flour, tea, spices, pickles, mayonnaise, ketchup, toilet paper, wipes, diapers, milk, cheese, yogurt, fruit, vegetables, chicken, denis, salmon, amnon, tilapia, challah, grape juice, white wine).
- Validation errors shown inline; invalid items never saved.

## Acceptance
- Seed has every item above with a sane cadence.
- `validateItem` rejects each rule violation.
