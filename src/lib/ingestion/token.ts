/**
 * Ingestion token generation and hashing.
 *
 * The only place in the product where a secret exists in plaintext, and it
 * exists for one function call: `mintToken()` returns the token so it can be
 * shown once, and the caller stores `hash` and `prefix`. There is no code path
 * that turns a stored row back into a usable token, because there is nothing
 * stored to turn back.
 *
 * Everything here is Web Crypto — the same API in Node 18+, in the Edge
 * runtime, and in the browser. No dependency, and no chance of the route and
 * the sender disagreeing about how a token is hashed.
 */

/** Distinguishes a ContextShelf token at a glance, e.g. in a shell history scan. */
const PREFIX = 'cs_live_';

/** 32 bytes. Base64url, so it survives a shell, a JSON string and a header. */
const BYTES = 32;

export interface MintedToken {
  /** Shown once, never stored. */
  token: string;
  /** What the database keeps. */
  hash: string;
  /** What a person sees in the list, to tell two tokens apart. */
  prefix: string;
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token.trim()));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function mintToken(): Promise<MintedToken> {
  const bytes = new Uint8Array(BYTES);
  crypto.getRandomValues(bytes);
  const token = `${PREFIX}${base64url(bytes)}`;
  return {
    token,
    hash: await hashToken(token),
    // Long enough to be recognisable, far too short to be guessed back: 8
    // base64url characters of a 256-bit secret.
    prefix: token.slice(0, PREFIX.length + 8),
  };
}

/**
 * Reads the token out of an Authorization header.
 *
 * Returns null rather than throwing, and never echoes what it saw. A malformed
 * header must not be able to put a near-miss of a real token into a log line.
 */
export function bearerFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  const token = match?.[1]?.trim();
  return token && token.length >= 16 ? token : null;
}

/**
 * A short, non-reversible label for logs and errors.
 *
 * Rule for this file: nothing that touches a token may render it. When a
 * delivery fails and someone needs to know *which* token, they get the prefix
 * — the same eight characters already visible in Settings — and nothing more.
 */
export function tokenLabel(token: string): string {
  return `${token.slice(0, PREFIX.length + 8)}…`;
}
