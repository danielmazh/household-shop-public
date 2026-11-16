import { t } from './i18n';
import { PageHead, type Frame } from './parts';

/** Help page (spec 010): short sections in plain words, opened from settings. */
export function HelpView({ frame, onBack }: { frame: Frame; onBack: () => void }) {
  return frame({
    focus: true,
    children: (
      <>
        <PageHead title={t('help')} sub={t('helpSub')} back={{ label: t('backToSettings'), onClick: onBack }} />
        {t('helpSections').map((s, n) => (
          <section key={s.title} class="card help-section" aria-labelledby={`help-${n}`}>
            <h2 class="card-title" id={`help-${n}`}>
              {s.title}
            </h2>
            {s.body.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {s.steps && (
              <ol class="help-steps">
                {s.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </>
    ),
    dock: (
      <button type="button" class="btn primary full" onClick={onBack}>
        {t('backToSettings')}
      </button>
    ),
  });
}
