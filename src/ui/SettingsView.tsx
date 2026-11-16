import { useState } from 'preact/hooks';
import { MARGIN, TRIP_LIMITS, snapMargin, type Settings } from '../domain/schedule';
import { CADENCES, type Cadence, type Item, type Purchase, type Shop } from '../domain/types';
import type { ShopActions } from './App';
import { inviteLink } from '../data/authUrl';
import { ChevronIcon, CopyIcon, PlusIcon, ShareIcon, WhatsAppIcon } from './icons';
import { RadioPills, Stepper, type Frame } from './parts';
import { StoresView } from './StoresView';
import { TripsView } from './TripsView';
import { formatNumber } from './labels';
import { HowItWorks } from './HomeView';
import { HelpView } from './HelpView';
import { HistoryView } from './HistoryView';
import type { Role } from '../domain/categories';
import { setSimple, useSimple } from './simple';
import { getLang, setLang, t, type Lang } from './i18n';

/** Shown only in Supabase mode. */
export interface Account {
  email: string | null;
  householdId: string;
  householdName: string;
  joinCode: string;
  /** Every household of the user, oldest membership first. */
  households: { id: string; name: string }[];
  onSwitch: (householdId: string) => void;
  onRotateCode: () => Promise<void>;
  onLeave: () => void;
  /** Opens create or join for one more household. */
  onAddHousehold: () => void;
  onSignOut: () => void;
}

interface Props {
  frame: Frame;
  settings: Settings;
  items: Item[];
  shops: Shop[];
  shopActions: ShopActions;
  onSave: (settings: Settings) => Promise<boolean>;
  /** Sets the default store of a role (spec 013). */
  onRoleStore: (role: Role, storeId: string | null) => Promise<boolean>;
  /** Finished trips, newest first (spec 012). */
  loadHistory: () => Promise<Purchase[]>;
  account?: Account;
}

// 2026-11-12, spec 014: the trips and days screen is hidden. Set to true to show it again.
const SHOW_TRIPS = false as boolean;

type Page = 'main' | 'stores' | 'trips' | 'help' | 'history';

// Each language is named in its own language, so anyone can find theirs.
const LANGS: { value: Lang; label: string }[] = [
  { value: 'he', label: 'עברית' },
  { value: 'en', label: 'English' },
];

export function SettingsView({ frame, settings, items, shops, shopActions, onSave, onRoleStore, loadHistory, account }: Props) {
  const [page, setPage] = useState<Page>('main');
  const simple = useSimple();
  const back = () => setPage('main');

  if (page === 'stores') return <StoresView frame={frame} shops={shops} items={items} actions={shopActions} roleStores={settings.roleStores} onRoleStore={onRoleStore} onBack={back} />;
  if (page === 'trips') return <TripsView frame={frame} settings={settings} onSave={onSave} onBack={back} />;
  if (page === 'help') return <HelpView frame={frame} onBack={back} />;
  if (page === 'history') return <HistoryView frame={frame} settings={settings} load={loadHistory} onBack={back} />;

  const activeShops = shops.filter((s) => s.active).length;

  return frame({
    children: (
      <>
        <div class="page-head">
          <h1>{t('settings')}</h1>
          <p class="sub">{account ? account.householdName : t('demoMode')}</p>
        </div>

        {account && <HouseholdCards account={account} />}

        <section class="card" aria-labelledby="plan-title">
          <h2 class="card-title" id="plan-title">
            {t('planTitle')}
          </h2>
          <ul class="rows">
            <li>
              <button type="button" class="row-btn" onClick={() => setPage('stores')}>
                <span class="tile" aria-hidden="true">
                  🛒
                </span>
                <span class="row-text">
                  <span class="name">{t('stores')}</span>
                  <span class="row-sub">{t('storesSubCount')(activeShops)}</span>
                </span>
                <ChevronIcon size={24} />
              </button>
            </li>
            {/* 2026-11-12, spec 014: trips and days are hidden; one list for the home. */}
            {SHOW_TRIPS && !simple && (
            <li>
              <button type="button" class="row-btn" onClick={() => setPage('trips')}>
                <span class="tile" aria-hidden="true">
                  🧺
                </span>
                <span class="row-text">
                  <span class="name">{t('tripsTitle')}</span>
                  <span class="row-sub">{t('tripsPerWeek')(settings.trips.length)}</span>
                </span>
                <ChevronIcon size={24} />
              </button>
            </li>
            )}
            <li>
              <button type="button" class="row-btn" onClick={() => setPage('history')}>
                <span class="tile" aria-hidden="true">
                  🧾
                </span>
                <span class="row-text">
                  <span class="name">{t('history')}</span>
                  <span class="row-sub">{t('historySub')}</span>
                </span>
                <ChevronIcon size={24} />
              </button>
            </li>
          </ul>
        </section>

        {/* Hidden 2026-11-04 (spec 009): "כמה להחזיק בבית" per product replaces the margin. See MarginCard. */}

        <section class="card" aria-labelledby="help-title">
          <h2 class="card-title" id="help-title">
            {t('helpLangTitle')}
          </h2>
          <ul class="rows">
            <li>
              <button type="button" class="row-btn" onClick={() => setPage('help')}>
                <span class="tile" aria-hidden="true">
                  💡
                </span>
                <span class="row-text">
                  <span class="name">{t('help')}</span>
                  <span class="row-sub">{t('helpSub')}</span>
                </span>
                <ChevronIcon size={24} />
              </button>
            </li>
          </ul>
          <span class="field-label" id="lang-label">
            {t('language')}
          </span>
          <RadioPills labelledBy="lang-label" options={LANGS.map((l) => ({ ...l, label: <bdi lang={l.value}>{l.label}</bdi>, name: l.label }))} value={getLang()} onChange={setLang} />
          <span class="field-label" id="mode-label">
            {t('listMode')}
          </span>
          <RadioPills
            labelledBy="mode-label"
            options={[
              { value: 'full', label: t('listFull') },
              { value: 'simple', label: t('listSimple') },
            ]}
            value={simple ? 'simple' : 'full'}
            onChange={(v) => setSimple(v === 'simple')}
          />
          <p class="hint">{t('simpleHint')}</p>
        </section>

        <TellFriends />

        <HowItWorks />

        {/* Hidden 2026-11-03: users found product types unclear here. Types stay with their default names until spec 008 replaces them with a direct trip choice per product.
        <CadenceLabels key={JSON.stringify(settings.cadenceLabels)} labels={settings.cadenceLabels} onSave={(cadenceLabels) => onSave({ ...settings, cadenceLabels })} />
        */}

        {account ? <AccountCard account={account} /> : <p class="card muted">{t('demoNote')}</p>}
      </>
    ),
  });
}

function HouseholdCards({ account }: { account: Account }) {
  const [note, setNote] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);

  // Spaced in two groups of four for reading aloud; the link carries the plain code.
  const shown = account.joinCode.length === 8 ? `${account.joinCode.slice(0, 4)} ${account.joinCode.slice(4)}` : account.joinCode;
  const link = inviteLink(location.origin, account.joinCode);
  const message = inviteText(account.householdName, link, shown);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setNote(t('linkCopied'));
    } catch {
      setNote(t('copyFailed'));
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: t('appName'), text: inviteText(account.householdName, null, shown), url: link });
    } catch {
      // Closed by the user, or not allowed: nothing to say.
    }
  };

  const rotate = async () => {
    setRotating(true);
    setNote(null);
    try {
      await account.onRotateCode();
      setNote(t('newCodeNote'));
    } finally {
      setRotating(false);
    }
  };

  return (
    <>
      <section class="card" aria-labelledby="home-title">
        <h2 class="card-title" id="home-title">
          {t('activeHome')}
        </h2>
        <div class="chip-row">
          {account.households.length > 1 && (
            <RadioPills label={t('activeHome')} class="chip-row" options={account.households.map((h) => ({ value: h.id, label: h.name }))} value={account.householdId} onChange={account.onSwitch} />
          )}
          {account.households.length <= 1 && (
            <span class="chip on">
              {account.householdName}
            </span>
          )}
          <button type="button" class="chip" onClick={account.onAddHousehold}>
            <PlusIcon size={18} />
            {t('anotherHome')}
          </button>
        </div>
      </section>

      <section class="card" aria-labelledby="code-title">
        <h2 class="card-title" id="code-title">
          {t('joinCode')}
        </h2>
        <p class="card-sub">{t('joinCodeSub')}</p>
        <code class="code-block ltr" aria-label={t('joinCodeAria')(account.joinCode.split('').join(' '))}>
          {shown}
        </code>
        <a class="btn primary full" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
          <WhatsAppIcon size={22} />
          {t('whatsapp')}
        </a>
        <div class="btn-row">
          <button type="button" class="btn brand" onClick={() => void copy()}>
            <CopyIcon />
            {t('copyLink')}
          </button>
          {canShare && (
            <button type="button" class="btn secondary" onClick={() => void share()}>
              <ShareIcon />
              {t('share')}
            </button>
          )}
        </div>
        <button type="button" class="btn text full" disabled={rotating} onClick={() => void rotate()}>
          {t('newCode')}
        </button>
        <p class="hint" role="status">
          {note}
        </p>
      </section>
    </>
  );
}

// Not rendered since 2026-11-04 (spec 009). Still used by items with target null. Text in both languages since spec 011.
export function MarginCard({ settings, onSave }: { settings: Settings; onSave: (settings: Settings) => Promise<boolean> }) {
  const percent = Math.round(settings.margin * 100);
  const setMargin = (delta: number) => void onSave({ ...settings, margin: snapMargin(settings.margin + delta) });
  return (
    <section class="card" aria-labelledby="margin-title">
      <div class="setting-row">
        <div>
          <h2 class="card-title" id="margin-title">
            {t('marginTitle')}
          </h2>
          <p class="row-sub">{t('marginSub')}</p>
        </div>
        <Stepper
          value={`${percent}%`}
          label={t('marginTitle')}
          minusDisabled={settings.margin <= MARGIN.min + 1e-9}
          plusDisabled={settings.margin >= MARGIN.max - 1e-9}
          onMinus={() => setMargin(-MARGIN.step)}
          onPlus={() => setMargin(MARGIN.step)}
        />
      </div>
      <p class="card-sub">
        {t('marginExample')(percent, formatNumber(Math.ceil(10 * (1 + settings.margin) - 1e-9)))}
      </p>
    </section>
  );
}

/** Recommends the app itself to friends, in the current language. Not an invite to this household. */
function TellFriends() {
  const [note, setNote] = useState<string | null>(null);
  const url = `${location.origin}/`;
  const message = `${t('tellText')}\n${url}`;
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setNote(t('tellCopied'));
    } catch {
      setNote(t('copyFailed'));
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: t('appName'), text: t('tellText'), url });
    } catch {
      // Closed by the user, or not allowed: nothing to say.
    }
  };

  return (
    <section class="card" aria-labelledby="tell-title">
      <h2 class="card-title" id="tell-title">
        {t('tellTitle')}
      </h2>
      <p class="card-sub">{t('tellSub')}</p>
      <a class="btn primary full" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
        <WhatsAppIcon size={22} />
        {t('whatsapp')}
      </a>
      <div class="btn-row">
        <button type="button" class="btn brand" onClick={() => void copy()}>
          <CopyIcon />
          {t('copyLink')}
        </button>
        {canShare && (
          <button type="button" class="btn secondary" onClick={() => void share()}>
            <ShareIcon />
            {t('share')}
          </button>
        )}
      </div>
      <p class="hint" role="status">
        {note}
      </p>
    </section>
  );
}

/** Invite message: the link first, the code as a fallback. `link` is null when the share sheet adds the link itself. */
const inviteText = (home: string, link: string | null, code: string) =>
  [t('inviteJoin')(home), ...(link ? [link] : []), t('inviteHow')(code)].join('\n');

// Not rendered since 2026-11-03, see the note in SettingsView. Text in both languages since spec 011.
export function CadenceLabels({ labels, onSave }: { labels: Record<Cadence, string>; onSave: (labels: Record<Cadence, string>) => Promise<boolean> }) {
  const [draft, setDraft] = useState(labels);
  const [note, setNote] = useState<string | null>(null);
  const empty = CADENCES.filter((c) => !draft[c].trim());
  const changed = CADENCES.some((c) => draft[c].trim() !== labels[c]);

  const save = async (e: Event) => {
    e.preventDefault();
    if (empty.length > 0) return;
    const next = Object.fromEntries(CADENCES.map((c) => [c, draft[c].trim()])) as Record<Cadence, string>;
    setNote((await onSave(next)) ? t('savedNote') : null);
  };

  return (
    <form class="card" aria-labelledby="labels-title" onSubmit={(e) => void save(e)} noValidate>
      <h2 class="card-title" id="labels-title">
        {t('typesTitle')}
      </h2>
      <p class="card-sub">{t('typesSub')}</p>
      <div class="pair">
        {CADENCES.map((c) => (
          <label key={c} class={draft[c].trim() ? 'field' : 'field invalid'}>
            <span class="visually-hidden">{t('typeName')(labels[c])}</span>
            <input
              value={draft[c]}
              maxLength={TRIP_LIMITS.label}
              aria-invalid={draft[c].trim() ? undefined : true}
              onInput={(e) => {
                setDraft({ ...draft, [c]: e.currentTarget.value });
                setNote(null);
              }}
            />
          </label>
        ))}
      </div>
      <button type="submit" class="btn secondary full" disabled={!changed || empty.length > 0}>
        {t('saveNames')}
      </button>
      <p class="hint" role="status">
        {empty.length > 0 ? t('typeNeedsName') : note}
      </p>
    </form>
  );
}

function AccountCard({ account }: { account: Account }) {
  const [confirmLeave, setConfirmLeave] = useState(false);
  return (
    <section class="card" aria-labelledby="account-title">
      <h2 class="card-title" id="account-title">
        {t('account')}
      </h2>
      {account.email && <p class="muted ltr">{account.email}</p>}
      {confirmLeave ? (
        <div class="confirm" role="group" aria-labelledby="leave-question">
          <p id="leave-question">{t('leaveQ')(account.householdName)}</p>
          <div class="btn-row">
            <button type="button" class="btn danger" onClick={account.onLeave}>
              {t('yesLeave')}
            </button>
            <button type="button" class="btn secondary" onClick={() => setConfirmLeave(false)}>
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div class="btn-row">
          <button type="button" class="btn secondary" onClick={account.onSignOut}>
            {t('signOut')}
          </button>
          <button type="button" class="btn text danger-text" onClick={() => setConfirmLeave(true)}>
            {t('leaveHome')}
          </button>
        </div>
      )}
    </section>
  );
}
