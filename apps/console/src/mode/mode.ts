/**
 * App mode — where this console session gets its data from.
 *
 * Chosen at the entry gate at RUNTIME (not build time): the same bundle serves
 * the public demo and a signed-in operator, so the deployed page can be shown
 * to anyone without provisioning them an account.
 *
 *   demo      in-browser simulator. Zero network calls, zero AWS credentials,
 *             zero real vehicle data — the visitor drives a fake vehicle. This
 *             is the ONLY mode a visitor without a Cognito account can enter.
 *   operator  the real console: Cognito sign-in → live IoT telemetry over WSS
 *             → commands through the API Gateway. Requires cloud config.
 *   local     developer mode against the localhost stack (`pnpm dev` + the
 *             docker-compose services). See isLocalOriginAvailable below.
 */
import { getTokens } from '../aws/auth';

export type AppMode = 'demo' | 'operator' | 'local';

const STORAGE_KEY = 'joppilot.mode';

/**
 * Local mode is offered ONLY when the page itself is served from localhost.
 *
 * WHY THIS GUARD EXISTS: the console's local mode connects to 127.0.0.1:4000/
 * 4001/4002. On a PUBLICLY served page those connections are attempts by a
 * public site to reach software on the visitor's own machine — the browser
 * raises a local-network permission prompt, the visitor sees a scary "allow
 * access to other apps?" dialog, and nothing works anyway because they are not
 * running our services. Gating on the origin makes that impossible by
 * construction rather than by remembering to check a flag.
 */
export function isLocalOriginAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * Is a stored 'operator' choice still backed by an actual sign-in?
 *
 * WHY THIS GUARD EXISTS: the gate stores the mode BEFORE redirecting to the
 * Hosted UI (it has to — the redirect comes back to this origin and the
 * session must already know what it is). A visitor who then closes the Hosted
 * UI, cancels, or hits an auth error returns to a page whose stored mode says
 * "operator" but which holds no token: the console mounted around an empty
 * session, with no telemetry and — worse — no way back, because the entry gate
 * is the ONLY place that can start the Hosted-UI flow. Two things count as a
 * live operator session: a token in hand, or an authorization code in the URL
 * that is about to become one.
 */
export function operatorSessionAlive(): boolean {
  try {
    if (new URLSearchParams(window.location.search).has('code')) return true;
  } catch {
    /* malformed query string — fall through to the token check */
  }
  return getTokens() !== null;
}

export function readStoredMode(): AppMode | null {
  try {
    const v = window.sessionStorage.getItem(STORAGE_KEY);
    if (v === 'demo' || v === 'operator' || v === 'local') {
      // A stored mode the current origin cannot serve is discarded rather than
      // honoured (e.g. a 'local' left over from a dev session, opened on the
      // deployed site).
      if (v === 'local' && !isLocalOriginAvailable()) return null;
      if (v === 'operator' && !operatorSessionAlive()) return null;
      return v;
    }
  } catch {
    /* sessionStorage can throw in private modes — treat as "no choice yet" */
  }
  return null;
}

export function storeMode(mode: AppMode | null): void {
  try {
    if (mode) window.sessionStorage.setItem(STORAGE_KEY, mode);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* non-fatal: the session simply asks again on reload */
  }
}
