/**
 * Cognito Hosted-UI login — authorization-code flow with PKCE (M3-4b).
 *
 * Public SPA client (no secret): the code_verifier is generated per login,
 * kept in sessionStorage across the redirect, and exchanged at /oauth2/token.
 * Tokens live in sessionStorage only (cleared with the tab) — the console is
 * an operator workstation tool, not a long-lived web session (SEC-03; MFA is
 * enforced by the pool itself during the hosted-UI login).
 */
import type { AwsConfig } from './config';

const VERIFIER_KEY = 'jp.pkce.verifier';
const TOKENS_KEY = 'jp.tokens';

interface Tokens {
  idToken: string;
  accessToken: string;
  expiresAt: number; // epoch ms
}

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256(input: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

const redirectUri = () => window.location.origin; // must be in cognito callback_urls

/** Begin login: stash a PKCE verifier and redirect to the Hosted UI. */
export async function login(cfg: AwsConfig): Promise<void> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  const challenge = b64url(await sha256(verifier));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: cfg.clientId,
    redirect_uri: redirectUri(),
    scope: 'openid email profile',
    code_challenge_method: 'S256',
    code_challenge: challenge,
  });
  window.location.assign(`https://${cfg.cognitoDomain}/oauth2/authorize?${params}`);
}

/** On app load: if the URL carries ?code=, exchange it for tokens. */
export async function completeLoginIfRedirected(cfg: AwsConfig): Promise<Tokens | null> {
  const url = new URL(window.location.href);
  const code = url.searchParams.get('code');
  if (!code) return getTokens();

  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  if (!verifier) return getTokens();

  const res = await fetch(`https://${cfg.cognitoDomain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: cfg.clientId,
      redirect_uri: redirectUri(),
      code,
      code_verifier: verifier,
    }),
  });
  // Clean the code out of the address bar either way (it is single-use).
  url.searchParams.delete('code');
  url.searchParams.delete('state');
  window.history.replaceState({}, '', url.toString());
  if (!res.ok) {
    console.error('Cognito token exchange failed', res.status, await res.text());
    return null;
  }
  const body = (await res.json()) as { id_token: string; access_token: string; expires_in: number };
  const tokens: Tokens = {
    idToken: body.id_token,
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
  };
  sessionStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  return tokens;
}

/**
 * The signed-in operator's Cognito username from the ID token (M3-4c). The
 * cloud command service runs with identity binding (AUTH_TRUST_APIGW_JWT=true),
 * so the console must send this as `operatorId` — the body id MUST equal the
 * token identity or the call gets 403 IDENTITY_MISMATCH (LEG-05). Not
 * signature-verified here (the API Gateway authorizer already verified the
 * token at the edge); we only READ the username to fill the body.
 */
export function getUsername(): string | null {
  const t = getTokens();
  if (!t) return null;
  try {
    const part = t.idToken.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(part.length + ((4 - (part.length % 4)) % 4), '='));
    const p = JSON.parse(json) as Record<string, unknown>;
    const id = p['cognito:username'] ?? p['email'] ?? p['sub'];
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

export function getTokens(): Tokens | null {
  try {
    const raw = sessionStorage.getItem(TOKENS_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as Tokens;
    if (Date.now() > t.expiresAt - 60_000) {
      sessionStorage.removeItem(TOKENS_KEY);
      return null; // expired (or about to) — user signs in again; no refresh flow yet
    }
    return t;
  } catch {
    return null;
  }
}

export function logout(cfg: AwsConfig): void {
  sessionStorage.removeItem(TOKENS_KEY);
  const params = new URLSearchParams({ client_id: cfg.clientId, logout_uri: redirectUri() });
  window.location.assign(`https://${cfg.cognitoDomain}/logout?${params}`);
}
