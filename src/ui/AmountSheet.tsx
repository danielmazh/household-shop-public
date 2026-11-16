import { useEffect, useRef, useState } from 'preact/hooks';
import { OVERRIDE_LIMITS, type TripLine } from '../domain/planner';
import { itemEmoji } from './emoji';
import { CheckIcon } from './icons';
import { t } from './i18n';
import { packWord, packsText } from './labels';
import { Stepper } from './parts';

interface Props {
  line: TripLine;
  canWrite: boolean;
  /** Saves packs for this trip, or null to go back to the computed amount. False when it failed. */
  onSave: (packs: number | null) => Promise<boolean>;
  onClose: () => void;
}

/** "כמה לקנות הפעם" (spec 012): the amount of one line for this trip only. */
export function AmountSheet({ line, canWrite, onSave, onClose }: Props) {
  const { item, computed, overridden } = line;
  const [packs, setPacks] = useState(() => Math.min(OVERRIDE_LIMITS.max, Math.max(OVERRIDE_LIMITS.min, line.packs)));
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  // Focus once when opened; Escape closes.
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button.btn.primary')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const run = async (value: number | null) => {
    if (await onSave(value)) onClose();
  };

  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} class="sheet" role="dialog" aria-modal="true" aria-labelledby="amount-title">
        <div class="sheet-head">
          <span class="big-tile" aria-hidden="true">
            {itemEmoji(item)}
          </span>
          <h2 id="amount-title">{item.name}</h2>
        </div>
        <div class="setting-row">
          <span class="field-label">{t('amountThisTrip')}</span>
          <Stepper
            value={`${packs} ${packWord(item, packs)}`}
            label={t('amountStepper')}
            minusDisabled={packs <= OVERRIDE_LIMITS.min}
            plusDisabled={packs >= OVERRIDE_LIMITS.max}
            onMinus={() => setPacks(packs - 1)}
            onPlus={() => setPacks(packs + 1)}
          />
        </div>
        <p class="use-math">
          {t('amountComputed')(packsText(computed, item))}
          <br />
          {t('amountOnlyThisTrip')}
        </p>
        <button type="button" class="btn primary full" disabled={!canWrite} onClick={() => void run(packs)}>
          <CheckIcon size={22} />
          {t('save')}
        </button>
        <div class="btn-row">
          {overridden && (
            <button type="button" class="btn secondary" disabled={!canWrite} onClick={() => void run(null)}>
              {t('backToComputed')}
            </button>
          )}
          <button type="button" class="btn text" onClick={onClose}>
            {t('cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
