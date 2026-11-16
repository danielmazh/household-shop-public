import { useEffect, useRef, useState } from 'preact/hooks';
import { SHOP_LIMITS, nextShopSort, sortShops, validateShop } from '../domain/stores';
import type { Item, Shop, ShopErrors } from '../domain/types';
import { BY_ROLE, type ShopActions } from './App';
import { STORE_EMOJI } from './emoji';
import { AlertIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, PlusIcon } from './icons';
import { domainText, t } from './i18n';
import { itemsLabel, noStore } from './labels';
import { EmojiPicker, PageHead, RadioPills, type Frame } from './parts';
import { move, useDragOrder } from './reorder';
import { ChevronDownIcon } from './icons';
import { ROLES, type Role, type RoleStores } from '../domain/categories';

interface Props {
  frame: Frame;
  shops: Shop[];
  items: Item[];
  actions: ShopActions;
  /** Default store per role (spec 013). */
  roleStores: RoleStores;
  /** Sets the default store of a role and moves the products that follow it. False when it failed. */
  onRoleStore: (role: Role, storeId: string | null) => Promise<boolean>;
  onBack: () => void;
}

type Edit = { shop: Shop; isNew: boolean };

export function StoresView({ frame, shops, items, actions, roleStores, onRoleStore, onBack }: Props) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const sorted = sortShops(shops);
  const active = sorted.filter((s) => s.active);
  const archived = sorted.filter((s) => !s.active);
  const count = (id: string) => items.filter((i) => i.storeId === id).length;
  const ids = active.map((s) => s.id);
  const { order, dragging, handle } = useDragOrder(ids, (next) => void actions.reorder(next));
  const shown = order.flatMap((id) => active.filter((s) => s.id === id));

  if (edit) {
    return <StoreEdit frame={frame} edit={edit} shops={shops} itemCount={count(edit.shop.id)} hasRoles={ROLES.some((r) => roleStores[r])} actions={actions} onClose={() => setEdit(null)} />;
  }

  const step = (n: number, by: number) => void actions.reorder(move(ids, n, n + by));
  const newShop = (): Shop => ({ id: crypto.randomUUID(), name: '', emoji: STORE_EMOJI[0]!, sort: nextShopSort(shops), active: true });

  return frame({
    children: (
      <>
        <PageHead title={t('stores')} sub={t('storesSub')} back={{ label: t('backToSettings'), onClick: onBack }} />
        {shown.length > 0 && (
          <section class="card" aria-label={t('activeStores')}>
            <ul class="rows">
              {shown.map((s, n) => (
                <li key={s.id} data-reorder-id={s.id} data-dragging={dragging === s.id ? 'true' : undefined} class="row reorder-row">
                  <span {...handle(s.id)} class="tile drag-handle" aria-hidden="true" title={t('dragHint')}>
                    {s.emoji || '🛒'}
                  </span>
                  <button type="button" class="row-text plain" aria-label={t('editOf')(s.name)} onClick={() => setEdit({ shop: s, isNew: false })}>
                    <span class="name clamp2">{s.name}</span>
                    <span class="row-sub">{itemsLabel(count(s.id))}</span>
                  </button>
                  <span class="order">
                    <button type="button" class="icon-btn tile-bg" aria-label={t('moveUp')(s.name)} disabled={n === 0} onClick={() => step(n, -1)}>
                      <ArrowUpIcon />
                    </button>
                    <button type="button" class="icon-btn tile-bg" aria-label={t('moveDown')(s.name)} disabled={n === shown.length - 1} onClick={() => step(n, 1)}>
                      <ArrowDownIcon />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <button type="button" class="btn primary full" onClick={() => setEdit({ shop: newShop(), isNew: true })}>
          <PlusIcon size={22} />
          {t('addStore')}
        </button>
        {active.length > 0 && (
          <section class="card" aria-labelledby="roles-title">
            <h2 class="card-title" id="roles-title">
              {t('roleStoresTitle')}
            </h2>
            <p class="card-sub">{t('roleStoresSub')}</p>
            {ROLES.map((role) => {
              const value = roleStores[role] ?? '';
              // An archived store stays shown while it is the default.
              const options = sorted.filter((s) => s.active || s.id === value);
              return (
                <label key={role} class="field">
                  <span>{t('roleDefault')(t('roleNames')[role])}</span>
                  <span class="select-wrap">
                    <select value={value} onChange={(e) => void onRoleStore(role, e.currentTarget.value || null)}>
                      <option value="">{t('noDefaultStore')}</option>
                      {options.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </span>
                </label>
              );
            })}
          </section>
        )}
        {archived.length > 0 && (
          <>
            <h2 class="section-label">{t('archived')}</h2>
            <section class="card" aria-label={t('archivedStores')}>
              <ul class="rows">
                {archived.map((s) => (
                  <li key={s.id} class="row">
                    <span class="tile" aria-hidden="true">
                      {s.emoji || '🛒'}
                    </span>
                    <span class="row-text">
                      <span class="name clamp2">{s.name}</span>
                      <span class="row-sub">{t('notOnList')}</span>
                    </span>
                    <button type="button" class="btn sm secondary" aria-label={t('restoreOf')(s.name)} onClick={() => void actions.update(s.id, { active: true })}>
                      {t('restore')}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </>
    ),
  });
}

interface EditProps {
  frame: Frame;
  edit: Edit;
  shops: Shop[];
  itemCount: number;
  /** True when a default store is set for some role, so "by default stores" can move products. */
  hasRoles: boolean;
  actions: ShopActions;
  onClose: () => void;
}

function StoreEdit({ frame, edit, shops, itemCount, hasRoles, actions, onClose }: EditProps) {
  const { shop, isNew } = edit;
  const [name, setName] = useState(shop.name);
  const [emoji, setEmoji] = useState(shop.emoji);
  const [errors, setErrors] = useState<ShopErrors>({});
  const [moving, setMoving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    if (tries > 0) input.current?.focus();
  }, [tries]);

  if (moving) return <ArchiveStep frame={frame} shop={shop} shops={shops} itemCount={itemCount} hasRoles={hasRoles} actions={actions} onCancel={() => setMoving(false)} onDone={onClose} />;

  const save = async (e: Event) => {
    e.preventDefault();
    const next: Shop = { ...shop, name: name.trim(), emoji };
    const found = validateShop(next, shops);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setTries((n) => n + 1);
      return;
    }
    const ok = isNew ? await actions.add(next) : await actions.update(shop.id, { ...(next.name !== shop.name ? { name: next.name } : {}), ...(emoji !== shop.emoji ? { emoji } : {}) });
    if (ok) onClose();
  };

  return frame({
    focus: true,
    children: (
      <form id="store-form" class="stack" onSubmit={(e) => void save(e)} noValidate>
        <PageHead title={isNew ? t('newStore') : t('editStore')} sub={isNew ? undefined : `${shop.name} • ${itemsLabel(itemCount)}`} close={{ label: t('closeNoSave'), onClick: onClose }} />
        <fieldset class="card">
          <legend class="visually-hidden">{t('details')}</legend>
          <h2 class="card-title" aria-hidden="true">
            {t('details')}
          </h2>
          <label class={errors.name ? 'field invalid' : 'field'}>
            <span>{t('storeName')}</span>
            <input
              ref={input}
              value={name}
              maxLength={SHOP_LIMITS.name}
              onInput={(e) => setName(e.currentTarget.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? 'shop-name-error' : undefined}
            />
            {errors.name && (
              <small class="error-text" id="shop-name-error">
                <AlertIcon size={16} />
                {domainText(errors.name)}
              </small>
            )}
          </label>
          <EmojiPicker id="shop-emoji" choices={STORE_EMOJI} value={emoji} onChange={setEmoji} />
        </fieldset>
        {!isNew && (
          <section class="card" aria-labelledby="archive-title">
            <h2 class="card-title" id="archive-title">
              {t('archive')}
            </h2>
            <p class="card-sub">{t('archiveInfo')}</p>
            <button type="button" class="btn danger full" onClick={() => setMoving(true)}>
              {t('moveToArchive')}
            </button>
          </section>
        )}
      </form>
    ),
    dock: (
      <button type="submit" form="store-form" class="btn primary full">
        <CheckIcon size={22} />
        {t('save')}
      </button>
    ),
  });
}

function ArchiveStep({ frame, shop, shops, itemCount, hasRoles, actions, onCancel, onDone }: { frame: Frame; shop: Shop; shops: Shop[]; itemCount: number; hasRoles: boolean; actions: ShopActions; onCancel: () => void; onDone: () => void }) {
  const targets = sortShops(shops.filter((s) => s.active && s.id !== shop.id));
  const NONE = '';
  // 2026-11-15: "by default stores" first, so each product follows its category to the store set for it.
  const byRole = hasRoles && itemCount > 0;
  const [target, setTarget] = useState<string>(byRole ? BY_ROLE : (targets[0]?.id ?? NONE));
  const [busy, setBusy] = useState(false);

  const archive = async () => {
    setBusy(true);
    const ok = await actions.archive(shop.id, target || null);
    setBusy(false);
    if (ok) onDone();
  };

  const options = [
    ...(byRole ? [{ id: BY_ROLE, name: t('byRoleStores'), emoji: '🧭' }] : []),
    ...targets.map((s) => ({ id: s.id, name: s.name, emoji: s.emoji || '🛒' })),
    { id: NONE, name: noStore(), emoji: '📦' },
  ];

  return frame({
    focus: true,
    children: (
      <>
        <PageHead title={t('moveToArchive')} sub={`${shop.name} • ${itemsLabel(itemCount)}`} close={{ label: t('cancel'), onClick: onCancel }} />
        <section class="card" aria-labelledby="move-title">
          <h2 class="card-title" id="move-title">
            {itemCount === 0 ? t('noItemsToMove') : t('whereToMove')(itemsLabel(itemCount))}
          </h2>
          <p class="card-sub">{byRole ? t('moveInfoRoles')(shop.name) : t('moveInfo')(shop.name)}</p>
          <RadioPills
            labelledBy="move-title"
            class="rows radio-rows"
            itemClass="row-btn"
            options={options.map((o) => ({
              value: o.id,
              name: o.name,
              label: (
                <>
                  <span class="tile" aria-hidden="true">
                    {o.emoji}
                  </span>
                  <span class="row-text">
                    <span class="name clamp2">{o.name}</span>
                  </span>
                  <span class="radio-dot" aria-hidden="true" />
                </>
              ),
            }))}
            value={target}
            onChange={setTarget}
          />
        </section>
      </>
    ),
    dock: (
      <div class="btn-row">
        <button type="button" class="btn primary" disabled={busy} onClick={() => void archive()}>
          {t('moveAndArchive')}
        </button>
        <button type="button" class="btn secondary" onClick={onCancel}>
          {t('cancel')}
        </button>
      </div>
    ),
  });
}
