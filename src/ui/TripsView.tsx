import { useEffect, useRef, useState } from 'preact/hooks';
import { TRIP_LIMITS, newTripId, uncoveredCadences, validateTrip, type Settings, type Trip, type TripErrors } from '../domain/schedule';
import { CADENCES, type Cadence } from '../domain/types';
import { TRIP_EMOJI } from './emoji';
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CalendarIcon, CheckIcon, PlusIcon, WarnIcon } from './icons';
import { domainText, t } from './i18n';
import { dayLetters, dayNames } from './labels';
import { EmojiPicker, PageHead, type Frame } from './parts';
import { move, useDragOrder } from './reorder';

interface Props {
  frame: Frame;
  settings: Settings;
  onSave: (settings: Settings) => Promise<boolean>;
  onBack: () => void;
}

type Edit = { trip: Trip; isNew: boolean };

/** Product types UI, off since 2026-11-03: each product now picks its trips (see ItemForm). */
const SHOW_TYPES = false;

export function TripsView({ frame, settings, onSave, onBack }: Props) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const trips = settings.trips;
  const labels = settings.cadenceLabels;
  const saveTrips = (next: Trip[]) => onSave({ ...settings, trips: next });
  const { order, dragging, handle } = useDragOrder(
    trips.map((t) => t.id),
    (ids) => void saveTrips(ids.flatMap((id) => trips.filter((t) => t.id === id))),
  );
  const shown = order.flatMap((id) => trips.filter((t) => t.id === id));

  if (edit) {
    return <TripEdit frame={frame} edit={edit} trips={trips} labels={labels} onSave={saveTrips} onClose={() => setEdit(null)} />;
  }

  const uncovered = uncoveredCadences(trips);
  const full = trips.length >= TRIP_LIMITS.max;
  const step = (n: number, by: number) => void saveTrips(move(trips, n, n + by));
  const newTrip = (): Trip => ({ id: newTripId(trips), name: '', emoji: TRIP_EMOJI[0]!, days: [new Date().getDay()], carries: [...CADENCES] });

  return frame({
    children: (
      <>
        <PageHead title={t('tripsTitle')} sub={t('tripsSub')(TRIP_LIMITS.max)} back={{ label: t('backToSettings'), onClick: onBack }} />
        {/* Hidden 2026-11-03: products now pick their trips, so product types no longer decide the lists. */}
        {SHOW_TYPES && uncovered.length > 0 && (
          <div class="warn-card" role="status">
            <WarnIcon size={28} />
            <div>
              <strong>{t('noTripCarries')(uncovered.map((c) => labels[c]).join(', '))}</strong>
              <p>{t('noTripCarriesBody')}</p>
            </div>
          </div>
        )}
        <ul class="stack" aria-label={t('trips')}>
          {shown.map((trip, n) => (
            <li key={trip.id} class="card trip-card" data-reorder-id={trip.id} data-dragging={dragging === trip.id ? 'true' : undefined}>
              <div class="row reorder-row">
                <span {...handle(trip.id)} class="tile drag-handle" aria-hidden="true" title={t('dragHint')}>
                  {trip.emoji || '🛒'}
                </span>
                <button type="button" class="row-text plain" aria-label={t('editOf')(trip.name)} onClick={() => setEdit({ trip, isNew: false })}>
                  <span class="card-title clamp2">{trip.name}</span>
                </button>
                <span class="order">
                  <button type="button" class="icon-btn tile-bg" aria-label={t('moveUp')(trip.name)} disabled={n === 0} onClick={() => step(n, -1)}>
                    <ArrowUpIcon />
                  </button>
                  <button type="button" class="icon-btn tile-bg" aria-label={t('moveDown')(trip.name)} disabled={n === shown.length - 1} onClick={() => step(n, 1)}>
                    <ArrowDownIcon />
                  </button>
                </span>
              </div>
              <p class="chip-row">
                <span class="chip info day">
                  <CalendarIcon size={18} />
                  {trip.days.map((d) => dayNames()[d]).join(', ')}
                </span>
                {SHOW_TYPES && trip.carries.map((c) => (
                  <span key={c} class="chip info">
                    {labels[c]}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>
        <button type="button" class="btn primary full" disabled={full} aria-describedby={full ? 'trips-full' : undefined} onClick={() => setEdit({ trip: newTrip(), isNew: true })}>
          <PlusIcon size={22} />
          {t('addTrip')}
        </button>
        {full && (
          <p class="hint center" id="trips-full">
            {t('tripsFull')(TRIP_LIMITS.max)}
          </p>
        )}
      </>
    ),
  });
}

interface EditProps {
  frame: Frame;
  edit: Edit;
  trips: Trip[];
  labels: Record<Cadence, string>;
  onSave: (trips: Trip[]) => Promise<boolean>;
  onClose: () => void;
}

function TripEdit({ frame, edit, trips, labels, onSave, onClose }: EditProps) {
  const { trip, isNew } = edit;
  const [name, setName] = useState(trip.name);
  const [emoji, setEmoji] = useState(trip.emoji);
  const [days, setDays] = useState<number[]>(trip.days);
  const [more, setMore] = useState(false);
  const [carries, setCarries] = useState<Cadence[]>(trip.carries);
  const [errors, setErrors] = useState<TripErrors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tries, setTries] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (tries > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [tries]);

  const toggleDay = (d: number) => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort((a, b) => a - b));
  const toggle = (c: Cadence) => setCarries(carries.includes(c) ? carries.filter((x) => x !== c) : CADENCES.filter((x) => x === c || carries.includes(x)));

  const save = async (e: Event) => {
    e.preventDefault();
    const next: Trip = { ...trip, name: name.trim(), emoji, days, carries };
    const list = isNew ? [...trips, next] : trips.map((t) => (t.id === trip.id ? next : t));
    const found = validateTrip(next, list);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      if (found.carries) setMore(true);
      setTries((n) => n + 1);
      return;
    }
    if (await onSave(list)) onClose();
  };

  const remove = async () => {
    if (await onSave(trips.filter((t) => t.id !== trip.id))) onClose();
  };

  return frame({
    focus: true,
    children: (
      <form ref={formRef} id="trip-form" class="stack" onSubmit={(e) => void save(e)} noValidate>
        <PageHead title={isNew ? t('newTrip') : t('editTrip')} sub={isNew ? undefined : trip.name} close={{ label: t('closeNoSave'), onClick: onClose }} />
        <fieldset class="card">
          <legend class="visually-hidden">{t('details')}</legend>
          <h2 class="card-title" aria-hidden="true">
            {t('details')}
          </h2>
          <label class={errors.name ? 'field invalid' : 'field'}>
            <span>{t('tripName')}</span>
            <input
              value={name}
              maxLength={TRIP_LIMITS.name}
              onInput={(e) => setName(e.currentTarget.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'trip-name-error' : undefined}
            />
            {errors.name && (
              <small class="error-text" id="trip-name-error">
                <AlertIcon size={16} />
                {domainText(errors.name)}
              </small>
            )}
          </label>
          <EmojiPicker id="trip-emoji" choices={TRIP_EMOJI} value={emoji} onChange={setEmoji} />
        </fieldset>
        <section class="card days">
          <h2 class="card-title" id="day-title">
            {t('whichDays')}
          </h2>
          <p class="card-sub">{t('moreThanOneDay')}</p>
          <div role="group" aria-labelledby="day-title">
            {dayLetters().map((letter, d) => (
              <button
                key={d}
                type="button"
                class="chip"
                aria-pressed={days.includes(d)}
                aria-label={t('dayFull')(dayNames()[d]!)}
                aria-invalid={d === 0 && errors.days ? true : undefined}
                aria-describedby={errors.days ? 'trip-days-error' : undefined}
                onClick={() => toggleDay(d)}
              >
                {letter}
              </button>
            ))}
          </div>
          {errors.days && (
            <small class="error-text" id="trip-days-error">
              <AlertIcon size={16} />
              {domainText(errors.days)}
            </small>
          )}
        </section>
        {!SHOW_TYPES ? null : !more ? (
          <button type="button" class="btn secondary full" aria-expanded="false" onClick={() => setMore(true)}>
            {t('moreDetails')}
          </button>
        ) : (
        <fieldset class="card">
          <legend class="visually-hidden">{t('whichProducts')}</legend>
          <h2 class="card-title" aria-hidden="true">
            {t('whichProducts')}
          </h2>
          <p class="card-sub">{t('whichProductsSub')}</p>
          <div class="choice-grid">
            {CADENCES.map((c, n) => (
              <button
                key={c}
                type="button"
                class="chip"
                aria-pressed={carries.includes(c)}
                aria-invalid={n === 0 && errors.carries ? true : undefined}
                aria-describedby={errors.carries ? 'trip-carries-error' : undefined}
                onClick={() => toggle(c)}
              >
                {carries.includes(c) && <CheckIcon size={18} />}
                {labels[c]}
              </button>
            ))}
          </div>
          {errors.carries && (
            <small class="error-text" id="trip-carries-error">
              <AlertIcon size={16} />
              {domainText(errors.carries)}
            </small>
          )}
        </fieldset>
        )}
        {!isNew && (
          <section class="card" aria-label={t('deleteTripLabel')}>
            <p class="card-sub first">{t('deleteTripInfo')}</p>
            {confirmDelete ? (
              <div class="confirm" role="group" aria-labelledby="delete-question">
                <p id="delete-question">{t('deleteQ')(trip.name)}</p>
                <div class="btn-row">
                  <button type="button" class="btn danger" onClick={() => void remove()}>
                    {t('yesDelete')}
                  </button>
                  <button type="button" class="btn secondary" onClick={() => setConfirmDelete(false)}>
                    {t('cancel')}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" class="btn danger full" disabled={trips.length <= TRIP_LIMITS.min} onClick={() => setConfirmDelete(true)}>
                {t('deleteTripLabel')}
              </button>
            )}
            {trips.length <= TRIP_LIMITS.min && <p class="hint">{t('needOneTrip')}</p>}
          </section>
        )}
      </form>
    ),
    dock: (
      <button type="submit" form="trip-form" class="btn primary full">
        <CheckIcon size={22} />
        {t('save')}
      </button>
    ),
  });
}
