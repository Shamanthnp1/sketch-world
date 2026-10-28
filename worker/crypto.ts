// Hashes and secrets for the checks and worlds tables. Web Crypto only (never Math.random).
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Lowercase hex SHA-256: checks.sha256 and worlds.owner_token_hash. */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What randomId() makes. Checked before any D1 or R2 access by id. */
export const WORLD_ID = /^[A-Za-z0-9]{10}$/;

/** A world id: 10 random base62 chars. Bytes ≥ 248 (= 4 × 62) are skipped, so every char is equally likely. */
export function randomId(length = 10): string {
  let id = "";
  while (id.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) if (b < 248 && id.length < length) id += BASE62[b % 62];
  }
  return id;
}

/** An Owner_Token: 32 random bytes in base64url without padding (43 chars). */
export function randomToken(): string {
  const b64 = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  return b64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
