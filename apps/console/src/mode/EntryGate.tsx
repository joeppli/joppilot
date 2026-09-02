import { awsConfig, cloudModeAvailable } from '../aws/config';
import { login } from '../aws/auth';
import { useMode } from './ModeContext';
import { entryStrings as t } from './strings';
import './entry.css';

/**
 * The first screen every visitor sees. Nothing else in the app renders until a
 * mode is chosen, so this is the single place that decides whether a session
 * gets real vehicle access or a simulator.
 *
 * TWO WAYS IN, deliberately:
 *   - operator: redirects to the Cognito Hosted UI. Credentials are never typed
 *     into this page — the Hosted UI owns the password and the MFA challenge
 *     (SEC-03 [M]), so this screen holds no password field to get wrong.
 *   - demo: no account, no credentials, no AWS. See mode.ts.
 *
 * ACCESSIBILITY (ACC-01..04 [M], WCAG 2.1 AA / eCH-0059): real landmarks and
 * headings, native buttons (keyboard-operable by construction), visible focus
 * rings in entry.css, and no state conveyed by colour alone — the demo notice
 * is text, not a green tint.
 */
export function EntryGate() {
  const { select } = useMode();

  function enterOperator() {
    if (!awsConfig) return;
    // The mode is stored BEFORE the redirect: the Hosted UI sends the browser
    // back to this origin with ?code=…, and the session must already know it is
    // an operator session so the provider mounts and completes the exchange.
    select('operator');
    void login(awsConfig);
  }

  return (
    <main className="entry">
      <div className="entry-card">
        <header className="entry-head">
          <h1 className="entry-title">{t.productName}</h1>
          <p className="entry-tagline">{t.tagline}</p>
        </header>

        <section className="entry-section" aria-labelledby="entry-operator">
          <h2 id="entry-operator" className="entry-label">{t.operatorHeading}</h2>
          {cloudModeAvailable ? (
            <>
              <p className="entry-hint">{t.operatorHint}</p>
              <button type="button" className="entry-btn entry-btn-primary" onClick={enterOperator}>
                {t.operatorAction}
              </button>
            </>
          ) : (
            <p className="entry-hint entry-hint-blocked">{t.operatorUnavailable}</p>
          )}
        </section>

        <div className="entry-divider" role="separator" />

        <section className="entry-section" aria-labelledby="entry-demo">
          <h2 id="entry-demo" className="entry-label">{t.demoHeading}</h2>
          <button
            type="button"
            className="entry-btn entry-btn-demo"
            onClick={() => select('demo')}
          >
            {t.demoAction}
          </button>
          <p className="entry-hint">{t.demoHint}</p>
        </section>

        {/* There are exactly TWO ways in, by design. Local development mode
            still exists (the localhost stack in README's run instructions
            needs it) but is not a third button competing for a visitor's
            attention — a developer reaches it with ?mode=local on a localhost
            origin. See ModeContext. */}
      </div>
    </main>
  );
}
