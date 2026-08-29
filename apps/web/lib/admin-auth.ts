const TOKEN_VERSION = "v1";

export const ADMIN_SESSION_COOKIE = "mso_admin_session";
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60;

const encoder = new TextEncoder();

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
}

export async function verifyAdminPassword(candidate: string, secret: string): Promise<boolean> {
  const [candidateDigest, secretDigest] = await Promise.all([
    hmac(candidate, "magyarsportonline-admin-password-check"),
    hmac(secret, "magyarsportonline-admin-password-check"),
  ]);
  return equalBytes(candidateDigest, secretDigest);
}

export async function createAdminSessionToken(secret: string, now = Date.now()): Promise<string> {
  const issuedAt = Math.floor(now / 1000);
  const payload = `${TOKEN_VERSION}.${issuedAt}`;
  return `${payload}.${base64Url(await hmac(secret, payload))}`;
}

export async function verifyAdminSessionToken(
  token: string | undefined,
  secret: string,
  now = Date.now(),
): Promise<boolean> {
  if (!token) return false;
  const [version, issuedAtRaw, signature, ...extra] = token.split(".");
  if (
    version !== TOKEN_VERSION ||
    !issuedAtRaw ||
    !signature ||
    extra.length > 0 ||
    !/^\d+$/.test(issuedAtRaw) ||
    !/^[A-Za-z0-9_-]{43}$/.test(signature)
  ) {
    return false;
  }

  const issuedAt = Number(issuedAtRaw);
  const nowSeconds = Math.floor(now / 1000);
  if (
    !Number.isSafeInteger(issuedAt) ||
    issuedAt > nowSeconds + 60 ||
    nowSeconds - issuedAt > ADMIN_SESSION_TTL_SECONDS
  ) {
    return false;
  }

  const expected = base64Url(await hmac(secret, `${version}.${issuedAtRaw}`));
  return equalBytes(encoder.encode(signature), encoder.encode(expected));
}

export function safeAdminRedirect(value: FormDataEntryValue | string | null): string {
  if (typeof value !== "string") return "/admin";
  if (value === "/admin" || value.startsWith("/admin/") || value.startsWith("/internal/")) {
    return value;
  }
  return "/admin";
}
