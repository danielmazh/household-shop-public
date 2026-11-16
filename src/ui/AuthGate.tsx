import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { SupabaseStore } from '../data';
import { readJoinParam } from '../data/authUrl';
import { AlertIcon, MailIcon, PlusIcon, SpinnerIcon } from './icons';
import { getLang, t, useLang } from './i18n';
import { authErrorText } from './labels';
import { Layout } from './parts';
import type { Account } from './SettingsView';

type Phase =
  | { name: 'loading' }
  | { name: 'signed-out' }
  | { name: 'no-household' }
  // Create or join one more household; cancel goes back to the app.
  | { name: 'add-household' }
  | { name: 'ready'; account: Account }
  | { name: 'failed' };

interface Props {
  store: SupabaseStore;
  children: (account: Account) => ComponentChildren;
}

/** Join code from an invite link. Kept in localStorage so the sign-in email link does not lose it. */
const PENDING_JOIN = 'household-shop.pendingJoin';

const pendingJoin = {
  get(): string {
    try {
      return localStorage.getItem(PENDING_JOIN) ?? '';
    } catch {
      return '';
    }
  },
  set(code: string) {
    try {
      localStorage.setItem(PENDING_JOIN, code);
    } catch {
      // Private mode or blocked storage: the user can still type the code.
    }
  },
  clear() {
    try {
      localStorage.removeItem(PENDING_JOIN);
    } catch {
      // Same as above.
    }
  },
};

/** Saves the code from `?join=` and removes the param from the address bar. */
function takeJoinParam() {
  const { code, clean } = readJoinParam(window.location.href);
  if (code) pendingJoin.set(code);
  if (clean) window.history.replaceState(window.history.state, '', clean);
}

/** Sign-in and household setup before the main app in Supabase mode. */
export function AuthGate({ store, children }: Props) {
  useState(takeJoinParam);
  const [phase, setPhase] = useState<Phase>({ name: 'loading' });

  const refresh = useCallback(async () => {
    try {
      const email = await store.userEmail();
      if (!email) return setPhase({ name: 'signed-out' });
      const h = await store.loadHousehold();
      if (!h) return setPhase({ name: 'no-household' });
      setPhase({ name: 'ready', account: accountFor(email) });
    } catch {
      setPhase({ name: 'failed' });
    }
  }, [store]);

  const accountFor = (email: string): Account => {
    const h = store.household!;
    return {
      email,
      householdId: h.id,
      householdName: h.name,
      joinCode: h.joinCode,
      households: store.households.map(({ id, name }) => ({ id, name })),
      onSwitch: (id) => {
        store.switchHousehold(id);
        setPhase({ name: 'ready', account: accountFor(email) });
      },
      onRotateCode: async () => {
        try {
          await store.rotateJoinCode();
          setPhase({ name: 'ready', account: accountFor(email) });
        } catch {
          window.alert(t('rotateFailed'));
        }
      },
      onLeave: () =>
        void store
          .leaveHousehold()
          .then(refresh)
          .catch(() => window.alert(t('leaveFailed'))),
      onAddHousehold: () => setPhase({ name: 'add-household' }),
      onSignOut: () => void store.signOut().finally(refresh),
    };
  };

  useEffect(() => {
    void refresh();
    return store.onAuthChange(() => void refresh());
  }, [store, refresh]);

  // Spec 011: the next sign-in email follows the language of this device.
  const lang = useLang();
  const signedIn = phase.name === 'ready' || phase.name === 'no-household' || phase.name === 'add-household';
  useEffect(() => {
    if (signedIn) void store.saveLang(lang);
  }, [store, lang, signedIn]);

  switch (phase.name) {
    case 'loading':
      return (
        <Layout focus>
          <p class="loading-note" role="status">
            <SpinnerIcon />
            {t('loading')}
          </p>
        </Layout>
      );
    case 'failed':
      return (
        <Layout focus>
          <section class="card empty-card">
            <span class="big-tile" aria-hidden="true">
              📡
            </span>
            <h1 class="card-title">{t('serverFailed')}</h1>
            <p class="muted">{t('checkConnection')}</p>
            <button type="button" class="btn primary full" onClick={() => void refresh()}>
              {t('tryAgain')}
            </button>
          </section>
        </Layout>
      );
    case 'signed-out':
      return <SignIn store={store} />;
    case 'no-household':
      return <HouseholdSetup store={store} onDone={() => void refresh()} />;
    case 'add-household':
      return <HouseholdSetup store={store} onDone={() => void refresh()} onCancel={() => void refresh()} />;
    case 'ready':
      return <>{children(phase.account)}</>;
  }
}

function SignIn({ store }: { store: SupabaseStore }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  // A sign-in error from the return address, shown once until the next send.
  const [linkError, setLinkError] = useState(() => store.takeAuthError());
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<'idle' | 'checking' | 'error'>('idle');

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLinkError(null);
    setState('sending');
    try {
      await store.signIn(email, getLang());
      setState('sent');
    } catch {
      setState('error');
    }
  };

  // On success supabase-js signs in and AuthGate moves on by itself.
  const submitCode = async (e: Event) => {
    e.preventDefault();
    if (!CODE_RE.test(code.trim())) return setCodeState('error');
    setCodeState('checking');
    try {
      await store.verifyCode(email, code);
    } catch {
      setCodeState('error');
    }
  };

  return (
    <Layout
      focus
      hero={
        <div class="welcome stack">
          <div class="float-tiles" aria-hidden="true">
            <span>🍞</span>
            <span>🥛</span>
            <span>🥕</span>
          </div>
          <h1>{t('appName')}</h1>
          <p class="sub">{t('tagline')}</p>
        </div>
      }
    >
      {linkError && (
        <p class="summary" role="alert">
          <AlertIcon size={24} />
          <span>{authErrorText(linkError)}</span>
        </p>
      )}
      <form class="card" onSubmit={(e) => void submit(e)}>
        <h2 class="card-title">{t('emailSignIn')}</h2>
        <label class="field">
          <span>{t('email')}</span>
          <input type="email" dir="ltr" autoComplete="email" placeholder="name@example.com" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} />
        </label>
        <button type="submit" class="btn primary full" disabled={state === 'sending'}>
          <MailIcon size={22} />
          {state === 'sent' ? t('sendAgain') : t('sendLink')}
        </button>
        <p class="hint">{t('noPassword')}</p>
      </form>
      <div role="status">
        {state === 'sent' && (
          <p class="note">
            <MailIcon />
            {t('sentNote')}
          </p>
        )}
      </div>
      {state === 'error' && (
        <p class="error-text" role="alert">
          <AlertIcon size={16} />
          {t('sendFailed')}
        </p>
      )}
      {state === 'sent' && (
        <form class="card" onSubmit={(e) => void submitCode(e)} noValidate>
          <h2 class="card-title">{t('codeSignIn')}</h2>
          <label class="field">
            <span>{t('codeFromEmail')}</span>
            <input
              class="code-input"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={10}
              value={code}
              aria-invalid={codeState === 'error'}
              aria-describedby={codeState === 'error' ? 'code-error' : undefined}
              onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
            />
          </label>
          {codeState === 'error' && (
            <p class="error-text" id="code-error" role="alert">
              <AlertIcon size={16} />
              {t('codeWrong')}
            </p>
          )}
          <button type="submit" class="btn secondary full" disabled={codeState === 'checking'}>
            {t('signInWithCode')}
          </button>
        </form>
      )}
    </Layout>
  );
}

/** The email code: 6 digits by default; Supabase allows up to 10. */
const CODE_RE = /^[0-9]{6,10}$/;

function HouseholdSetup({ store, onDone, onCancel }: { store: SupabaseStore; onDone: () => void; onCancel?: () => void }) {
  const [name, setName] = useState(() => t('defaultHomeName'));
  const [code, setCode] = useState(pendingJoin.get);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** `action` resolves to null when nothing was found (wrong join code). */
  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      if ((await action()) === null) setError(message);
      else onDone();
    } catch {
      // The household exists but did not load: say so, a retry only loads it.
      setError(store.createPending ? t('createdNotLoaded') : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Layout focus>
      <div class="page-head">
        <div class="float-tiles start" aria-hidden="true">
          <span>🏡</span>
          <span>🧺</span>
        </div>
        <h1>
          {t('newHome')}
          <br />
          <span class="muted">{t('orJoin')}</span>
        </h1>
      </div>
      <form
        class="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void run(() => store.createHousehold(name.trim(), getLang()), t('createFailed'));
        }}
      >
        <h2 class="card-title">{t('startNew')}</h2>
        <label class="field">
          <span>{t('homeName')}</span>
          <input value={name} onInput={(e) => setName(e.currentTarget.value)} />
        </label>
        <button type="submit" class="btn primary full" disabled={busy}>
          <PlusIcon size={22} />
          {t('createHome')}
        </button>
      </form>
      <form
        class="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim())
            void run(async () => {
              const joined = await store.joinHousehold(code);
              if (joined) pendingJoin.clear();
              return joined;
            }, t('codeNotFound'));
        }}
      >
        <h2 class="card-title">{t('gotCode')}</h2>
        <label class="field">
          <span>{t('joinCode')}</span>
          <input class="code-input" dir="ltr" autoCapitalize="characters" autoComplete="off" value={code} onInput={(e) => setCode(e.currentTarget.value)} />
        </label>
        <button type="submit" class="btn secondary full" disabled={busy}>
          {t('join')}
        </button>
      </form>
      {error && (
        <p class="error-text" role="alert">
          <AlertIcon size={16} />
          {error}
        </p>
      )}
      {onCancel ? (
        <button type="button" class="btn text" onClick={onCancel}>
          {t('cancel')}
        </button>
      ) : (
        <button type="button" class="btn text" onClick={() => void store.signOut()}>
          {t('signOutAccount')}
        </button>
      )}
    </Layout>
  );
}
