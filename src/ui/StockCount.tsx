import { packsAtHome, targetPacks } from '../domain/planner';
import type { Settings } from '../domain/schedule';
import type { Item } from '../domain/types';
import { itemEmoji } from './emoji';
import { CheckIcon } from './icons';
import { locale, t } from './i18n';
import { formatNumber, packWord } from './labels';
import { PageHead, Stepper, type Frame } from './parts';

interface Props {
  frame: Frame;
  items: Item[];
  settings: Settings;
  canWrite: boolean;
  /** Stock change in units; saved at once. */
  onAdjust: (id: string, delta: number) => Promise<boolean>;
  onDone: () => void;
}

/** Stock count of every active item, in packs (spec 009; moved from the trip screen). One-time products are not counted (spec 012). */
export function StockCount({ frame, items, settings, canWrite, onAdjust, onDone }: Props) {
  const sorted = items.filter((i) => i.active && !i.onceTrip).sort((a, b) => a.name.localeCompare(b.name, locale()));
  return frame({
    focus: true,
    wide: true,
    children: (
      <>
        <PageHead title={t('stockCount')} sub={t('stockCountSub')} back={{ label: t('backToProducts'), onClick: onDone }} />
        {sorted.length === 0 ? (
          <p class="card muted center">{t('noProductsDot')}</p>
        ) : (
          <ul class="grid count-list" aria-label={t('stockCount')}>
            {sorted.map((item) => {
              const home = packsAtHome(item);
              const raw = item.stock / item.packSize;
              return (
                <li key={item.id} class="card count-card" data-item={item.name}>
                  <span class="big-tile" aria-hidden="true">
                    {itemEmoji(item)}
                  </span>
                  <span class="name clamp2">{item.name}</span>
                  <span class="row-sub">{t('baseOf')(targetPacks(item, settings), packWord(item))}</span>
                  <Stepper
                    value={formatNumber(home)}
                    label={item.name}
                    minusDisabled={!canWrite || item.stock <= 0}
                    plusDisabled={!canWrite}
                    // One pack per tap; an open pack is rounded to whole packs first.
                    onMinus={() => void onAdjust(item.id, Math.max(0, Math.ceil(raw - 1 - 1e-9)) * item.packSize - item.stock)}
                    onPlus={() => void onAdjust(item.id, Math.floor(raw + 1 + 1e-9) * item.packSize - item.stock)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </>
    ),
    dock: (
      <button type="button" class="btn primary full" onClick={onDone}>
        <CheckIcon size={22} />
        {t('finishCount')}
      </button>
    ),
  });
}
