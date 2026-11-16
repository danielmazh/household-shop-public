import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isValid, validateItem } from '../domain/catalog';
import { sortShops } from '../domain/stores';
import { itemTrips, listTrip, packsAtHome, targetPacks } from '../domain/planner';
import type { Suggestion } from '../domain/suggest';
import { SuggestError, type Suggest } from '../data/ai';
import type { Settings, Trip } from '../domain/schedule';
import { categoryNames, roleStoreFor } from '../domain/categories';
import { type Item, type ItemField, type Shop, type ValidationErrors } from '../domain/types';
import { itemEmoji } from './emoji';
import { AlertIcon, CheckIcon, ChevronDownIcon, SpinnerIcon } from './icons';
import { domainText, getLang, locale, t } from './i18n';
import { formatNumber, noCategory, noStore, packWord } from './labels';
import { PageHead, RadioPills, Stepper, type Frame } from './parts';

interface Props {
  frame: Frame;
  item: Item;
  items: Item[];
  shops: Shop[];
  trips: Trip[];
  settings: Settings;
  isNew: boolean;
  /** AI help. Unset in demo mode, then the button is hidden. */
  suggest?: Suggest;
  onSave: (item: Item) => Promise<boolean>;
  onCancel: () => void;
  /** Simple mode (spec 013): no trip, kind or stock fields. */
  simple?: boolean;
}

type TextFields = 'name' | 'category' | 'unit' | 'weeklyUse' | 'packSize' | 'price' | 'stock';
type Draft = Record<TextFields, string>;

const labels = (): Record<TextFields | 'cadence', string> => ({
  name: t('fieldName'),
  category: t('fieldCategory'),
  unit: t('fieldUnit'),
  weeklyUse: t('fieldWeeklyUse'),
  packSize: t('fieldPackSize'),
  price: t('fieldPrice'),
  stock: t('fieldStock'),
  cadence: t('fieldTrips'),
});

// Order of the fields on screen, for the error summary.
const ORDER: (TextFields | 'cadence')[] = ['name', 'category', 'cadence', 'stock', 'price', 'packSize', 'unit', 'weeklyUse'];

const toDraft = (i: Item): Draft => ({
  name: i.name,
  category: i.category,
  unit: i.unit,
  weeklyUse: String(i.weeklyUse),
  packSize: String(i.packSize),
  price: i.price === null ? '' : String(i.price),
  stock: String(i.stock),
});

// An empty number field becomes NaN so validation reports it.
const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));

const unique = (values: string[]) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, locale()));

const errorId = (name: string) => `f-${name}-error`;

function ErrorText({ name, text }: { name: string; text?: string }) {
  if (!text) return null;
  return (
    <small class="error-text" id={errorId(name)}>
      <AlertIcon size={16} />
      {domainText(text)}
    </small>
  );
}

export function ItemForm({ frame, item, items, shops, trips, settings, isNew, suggest, onSave, onCancel, simple = false }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(item));
  // Spec 009: keep-at-home and stock are edited in packs.
  const [keep, setKeep] = useState(() => targetPacks(item, settings));
  const [have, setHave] = useState(() => packsAtHome(item));
  const [emoji, setEmoji] = useState<string | null>(item.emoji ?? null);
  const [ai, setAi] = useState<{ busy: boolean; note: string | null; undo: { draft: Draft; emoji: string | null } | null; autoDone: boolean }>({
    busy: false,
    note: null,
    undo: null,
    autoDone: !isNew,
  });
  // Spec 014: kept as stored; an empty or new list gets every trip, so validation and old app copies are happy.
  const tripIds = useMemo(() => itemTrips(item, trips).map((t) => t.id), [item, trips]);
  // Spec 012: a one-time product goes on one trip and leaves the list once bought.
  const [once, setOnce] = useState(() => !!item.onceTrip);
  // Spec 014: one list, so a one-time product always goes on the list trip.
  const onceTrip = listTrip(settings);
  const [storeId, setStoreId] = useState(item.storeId);
  // Spec 013: until the user picks a store, a new product takes the role store of its category.
  const [storeTouched, setStoreTouched] = useState(!isNew || item.storeId !== null);
  const roleStore = (category: string) => {
    const id = roleStoreFor(category, settings.roleStores);
    return shops.some((s) => s.id === id && s.active) ? id : null;
  };
  // Active stores, plus the item's own store when it is archived.
  const storeOptions = sortShops(shops.filter((s) => s.active || s.id === item.storeId));
  const [errors, setErrors] = useState<ValidationErrors>({});
  // Counts failed submits, so focus moves to the first invalid field after each one.
  const [failedSubmits, setFailedSubmits] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const aiBusy = useRef(false);

  useEffect(() => {
    if (failedSubmits > 0) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [failedSubmits]);

  const set = (field: TextFields) => (e: Event) => setDraft({ ...draft, [field]: (e.currentTarget as HTMLInputElement).value });

  /**
   * Asks the AI for name, emoji, category and price. The button replaces all
   * of them; the automatic run on a new item fills only what is still empty.
   */
  const askAi = async (onlyEmpty: boolean) => {
    // A ref, because blur (auto run) and the button click come in the same tap.
    if (!suggest || aiBusy.current || !draft.name.trim()) return;
    aiBusy.current = true;
    const before = { draft, emoji };
    setAi({ ...ai, busy: true, note: null, autoDone: true });
    try {
      const s: Suggestion = await suggest({
        name: draft.name.trim(),
        unit: draft.unit.trim() || t('defaultUnit'),
        packSize: num(draft.packSize) > 0 ? num(draft.packSize) : 1,
        categories: unique(items.map((i) => i.category)),
        lang: getLang(),
      });
      const fill = (old: string, value: string) => (value && (!onlyEmpty || !old.trim()) ? value : old);
      const next: Draft = {
        ...draft,
        name: isNew && !onlyEmpty ? s.name : draft.name,
        category: fill(draft.category, s.category),
        price: fill(draft.price, s.price === null ? '' : String(s.price)),
      };
      const changed = [
        next.name !== draft.name && t('aiFieldName'),
        next.category !== draft.category && t('aiFieldCategory'),
        next.price !== draft.price && t('aiFieldPrice'),
        s.emoji && (!onlyEmpty || !emoji) && s.emoji !== emoji && t('aiFieldPicture'),
      ].filter(Boolean);
      setDraft(next);
      if (!storeTouched) setStoreId(roleStore(next.category));
      if (s.emoji && (!onlyEmpty || !emoji)) setEmoji(s.emoji);
      setAi({ busy: false, autoDone: true, note: changed.length > 0 ? t('aiFilled')(changed.join(', ')) : t('aiNothing'), undo: changed.length > 0 ? before : null });
    } catch (e) {
      setAi({ busy: false, autoDone: true, undo: null, note: e instanceof SuggestError ? domainText(e.message) : t('aiFailed') });
    }
    aiBusy.current = false;
  };

  const undoAi = () => {
    if (!ai.undo) return;
    setDraft(ai.undo.draft);
    setEmoji(ai.undo.emoji);
    setAi({ ...ai, note: null, undo: null });
  };

  const save = async (active: boolean) => {
    // A regular product sends once_trip only when it was a one-time product, so rows from before 0006 stay untouched.
    // Spec 014: trips no longer decide the list; a new product gets every trip so old app copies still list it.
    const kind = once ? { onceTrip, trips: [onceTrip] } : { trips: isNew || tripIds.length === 0 ? trips.map((tr) => tr.id) : tripIds, ...(item.onceTrip ? { onceTrip: null } : {}) };
    const next: Item = {
      ...item,
      name: draft.name.trim(),
      category: draft.category.trim(),
      storeId: storeId ?? (storeTouched ? null : roleStore(draft.category)),
      unit: draft.unit.trim(),
      ...kind,
      // Sent only when changed, so rows from before the emoji column stay untouched.
      ...(emoji !== (item.emoji ?? null) ? { emoji } : {}),
      active,
      weeklyUse: num(draft.weeklyUse),
      packSize: num(draft.packSize),
      price: draft.price.trim() === '' ? null : Number(draft.price),
      target: (once ? Math.max(1, keep) : keep) * num(draft.packSize),
      // An open pack keeps its exact units unless the count was changed here.
      stock: have === packsAtHome(item) && num(draft.packSize) === item.packSize ? item.stock : have * num(draft.packSize),
    };
    const found = validateItem(next, items);
    setErrors(found);
    if (isValid(found)) await onSave(next);
    else setFailedSubmits((n) => n + 1);
  };

  const submit = (e: Event) => {
    e.preventDefault();
    void save(item.active);
  };

  const field = (name: TextFields, opts: { type?: 'text' | 'number'; list?: string; onBlur?: () => void } = {}) => {
    const { type = 'text', list, onBlur } = opts;
    const error = errors[name as ItemField];
    return (
      <label class={error ? 'field invalid' : 'field'}>
        <span>{labels()[name]}</span>
        <input
          id={`f-${name}`}
          name={name}
          type={type}
          inputMode={type === 'number' ? 'decimal' : undefined}
          step={type === 'number' ? 'any' : undefined}
          list={list}
          value={draft[name]}
          onInput={set(name)}
          onBlur={onBlur}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId(name) : undefined}
        />
        <ErrorText name={name} text={error} />
      </label>
    );
  };

  const wrong = ORDER.filter((f) => errors[f as ItemField]);
  const draftUnit = { unit: draft.unit, packSize: num(draft.packSize) > 0 ? num(draft.packSize) : 1 };
  const storeName = shops.find((s) => s.id === storeId)?.name ?? noStore();
  const preview = { name: draft.name, category: draft.category, emoji };

  return frame({
    focus: true,
    children: (
      <form ref={formRef} class="stack" id="item-form" onSubmit={submit} noValidate>
        <PageHead
          title={isNew ? t('newProduct') : t('editProduct')}
          sub={`${draft.category.trim() || noCategory()} • ${storeName}`}
          close={{ label: t('closeNoSave'), onClick: onCancel }}
        />
        <div class="form-pic">
          <span class="big-tile" aria-hidden="true">
            {itemEmoji(preview)}
          </span>
          <p class="hint">{emoji ? t('picByAi') : t('picByName')}</p>
        </div>
        {wrong.length > 0 && (
          <div class="summary" role="alert">
            <AlertIcon size={24} />
            <div>
              <strong>{t('fixFields')(wrong.length)}</strong>
              <p>{wrong.map((f) => labels()[f]).join(' • ')}</p>
            </div>
          </div>
        )}
        <fieldset class="card">
          <legend class="visually-hidden">{t('details')}</legend>
          <h2 class="card-title" aria-hidden="true">
            {t('details')}
          </h2>
          {field('name', { onBlur: () => void (isNew && !ai.autoDone && draft.name.trim().length >= 2 && askAi(true)) })}
          {suggest && (
            <div class="ai-row">
              <button type="button" class="btn secondary sm" disabled={ai.busy || !draft.name.trim()} onClick={() => void askAi(false)}>
                {ai.busy ? <SpinnerIcon size={18} /> : <span aria-hidden="true">✨</span>}
                {ai.busy ? t('aiBusy') : t('aiFill')}
              </button>
              {ai.undo && !ai.busy && (
                <button type="button" class="btn text sm" onClick={undoAi}>
                  {t('undo')}
                </button>
              )}
              <p class="hint" role="status">
                {ai.note ?? t('aiHint')}
              </p>
            </div>
          )}
          {field('category', { list: 'categories' })}
          <label class="field">
            <span>{t('store')}</span>
            <span class="select-wrap">
              <select
                value={storeId ?? ''}
                onChange={(e) => {
                  setStoreTouched(true);
                  setStoreId(e.currentTarget.value || null);
                }}
              >
                <option value="">{noStore()}</option>
                {storeOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <ChevronDownIcon />
            </span>
          </label>
          {!simple && (
          <div class="field">
            <span class="field-label" id="f-kind-label">
              {t('kindLabel')}
            </span>
            <RadioPills
              labelledBy="f-kind-label"
              options={[
                { value: 'regular', label: t('kindRegular') },
                { value: 'once', label: t('kindOnce') },
              ]}
              value={once ? 'once' : 'regular'}
              onChange={(v) => {
                setOnce(v === 'once');
                if (v === 'once' && keep < 1) setKeep(1);
              }}
            />
          </div>
          )}
          {/* 2026-11-12, spec 014: no trip fields; the list does not depend on trips or days. */}
        </fieldset>
        <fieldset class="card">
          <legend class="visually-hidden">{t('amounts')}</legend>
          <h2 class="card-title" aria-hidden="true">
            {t('amounts')}
          </h2>
          {/* Hidden 2026-11-04 (spec 009): weekly use is replaced by "כמה להחזיק בבית". Kept for target null rows.
          {field('weeklyUse', { type: 'number' })}
          */}
          {simple ? null : once ? (
            <>
              <div class="setting-row">
                <span class="field-label">{t('onceHowMany')}</span>
                <Stepper value={`${keep} ${packWord(draftUnit, keep)}`} label={t('onceStepper')} minusDisabled={keep <= 1} plusDisabled={keep >= 99} onMinus={() => setKeep(keep - 1)} onPlus={() => setKeep(keep + 1)} />
              </div>
              <p class="hint">{t('onceHint')}</p>
            </>
          ) : (
          <>
          <div class="setting-row">
            <span class="field-label">{t('keepAtHome')}</span>
            <Stepper value={`${keep} ${packWord(draftUnit, keep)}`} label={t('keepStepper')} minusDisabled={keep <= 0} plusDisabled={keep >= 99} onMinus={() => setKeep(keep - 1)} onPlus={() => setKeep(keep + 1)} />
          </div>
          <div class="setting-row">
            <span class="field-label">{t('fieldStock')}</span>
            <Stepper
              value={`${formatNumber(have)} ${packWord(draftUnit, have)}`}
              label={t('haveStepper')}
              minusDisabled={have <= 0}
              plusDisabled={have >= 999}
              onMinus={() => setHave(Math.max(0, Math.ceil(have - 1 - 1e-9)))}
              onPlus={() => setHave(Math.floor(have + 1 + 1e-9))}
            />
          </div>
          <p class="hint">
            {keep > have ? t('nextFill')(Math.ceil(keep - have - 1e-9), packWord(draftUnit), keep) : t('enough')}
          </p>
          </>
          )}
          {field('price', { type: 'number' })}
          <div class="pair">
            {field('packSize', { type: 'number' })}
            {field('unit')}
          </div>
          <p class="hint">{t('priceHint')}</p>
        </fieldset>
        <datalist id="categories">
          {/* Spec 013: the fixed list in shopping order, then the household's own categories. */}
          {[...categoryNames(getLang()), ...unique(items.map((i) => i.category)).filter((c) => !categoryNames(getLang()).includes(c))].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {!isNew && (
          <button type="button" class={item.active ? 'btn text danger-text' : 'btn text'} onClick={() => void save(!item.active)}>
            {item.active ? t('removeItem') : t('restoreItem')}
          </button>
        )}
      </form>
    ),
    dock: (
      <button type="submit" form="item-form" class="btn primary full">
        <CheckIcon size={22} />
        {t('save')}
      </button>
    ),
  });
}
