import { useEffect, useState } from 'preact/hooks';
import { purchaseCost } from '../domain/history';
import { findTrip, type Settings } from '../domain/schedule';
import type { Purchase } from '../domain/types';
import { ChevronIcon, SpinnerIcon } from './icons';
import { locale, t } from './i18n';
import { formatMoney, itemsLabel, packsText } from './labels';
import { PageHead, type Frame } from './parts';

interface Props {
  frame: Frame;
  settings: Settings;
  load: () => Promise<Purchase[]>;
  onBack: () => void;
}

const formatWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale(), { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
};

const who = (p: Purchase) => (p.finishedBy ? t('historyBy')(p.finishedBy) : t('historyHere'));

/** "היסטוריה" (spec 012): finished trips, newest first; a tap opens the lines. Costs are estimates. */
export function HistoryView({ frame, settings, load, onBack }: Props) {
  const [list, setList] = useState<Purchase[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Purchase | null>(null);

  useEffect(() => {
    let live = true;
    load().then(
      (l) => live && setList(l),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [load]);

  if (open) return <PurchaseDetail frame={frame} purchase={open} onBack={() => setOpen(null)} />;

  const emoji = (p: Purchase) => findTrip(settings, p.trip)?.emoji ?? '🧺';

  return frame({
    focus: true,
    children: (
      <>
        <PageHead title={t('history')} sub={t('historySub')} back={{ label: t('backToSettings'), onClick: onBack }} />
        {failed ? (
          <p class="card muted center" role="alert">
            {t('historyFailed')}
          </p>
        ) : list === null ? (
          <p class="loading-note" role="status">
            <SpinnerIcon />
            {t('loading')}
          </p>
        ) : list.length === 0 ? (
          <p class="card muted center">{t('historyEmpty')}</p>
        ) : (
          <>
            <section class="card" aria-label={t('history')}>
              <ul class="rows">
                {list.map((p) => {
                  const cost = purchaseCost(p);
                  return (
                    <li key={p.id}>
                      <button type="button" class="row-btn" onClick={() => setOpen(p)}>
                        <span class="tile" aria-hidden="true">
                          {emoji(p)}
                        </span>
                        <span class="row-text">
                          <span class="name">{purchaseTitle(p)}</span>
                          <span class="row-sub history-meta">
                            <span>{formatWhen(p.finishedAt)}</span>
                            <span>{who(p)}</span>
                            <span>{itemsLabel(p.lines.length)}</span>
                            {cost !== null && <span>{t('historyAbout')(formatMoney(cost))}</span>}
                          </span>
                        </span>
                        <ChevronIcon size={24} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
            <p class="hint">{t('historyEstimate')}</p>
          </>
        )}
      </>
    ),
    dock: (
      <button type="button" class="btn primary full" onClick={onBack}>
        {t('backToSettings')}
      </button>
    ),
  });
}

function PurchaseDetail({ frame, purchase: p, onBack }: { frame: Frame; purchase: Purchase; onBack: () => void }) {
  const cost = purchaseCost(p);
  return frame({
    focus: true,
    children: (
      <>
        <PageHead
          title={purchaseTitle(p)}
          sub={
            <span class="history-meta">
              <span>{formatWhen(p.finishedAt)}</span>
              <span>{who(p)}</span>
            </span>
          }
          back={{ label: t('backToHistory'), onClick: onBack }}
        />
        <section class="card" aria-label={itemsLabel(p.lines.length)}>
          <div class="store-head">
            <div class="title">
              <h2>{itemsLabel(p.lines.length)}</h2>
            </div>
            {cost !== null && <span class="total">{t('historyAbout')(formatMoney(cost))}</span>}
          </div>
          <ul class="rows">
            {p.lines.map((l, n) => (
              <li key={`${l.itemId ?? ''}-${n}`} class="row">
                <span class="row-text">
                  <span class="name">{l.name}</span>
                  <span class="row-sub history-meta">
                    <span>{packsText(l.packs, { unit: l.unit, packSize: l.packs > 0 ? l.units / l.packs : 1 })}</span>
                    {l.storeName && <span>{l.storeName}</span>}
                  </span>
                </span>
                <span class="line-end">{l.price === null ? t('noPrice') : formatMoney(l.packs * l.price)}</span>
              </li>
            ))}
          </ul>
        </section>
        <p class="hint">{t('historyEstimate')}</p>
      </>
    ),
    dock: (
      <button type="button" class="btn primary full" onClick={onBack}>
        {t('backToHistory')}
      </button>
    ),
  });
}

/** Spec 014: a finished shop is named by the stores bought in, else by its old trip name. */
export function purchaseTitle(p: Purchase): string {
  const stores = [...new Set(p.lines.map((l) => l.storeName).filter((n): n is string => !!n))];
  return stores.length > 0 ? stores.join(', ') : (p.tripName ?? p.trip);
}
