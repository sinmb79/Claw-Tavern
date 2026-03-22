const DEFAULT_PATH = "/";
const DEFAULT_SAME_SITE = "Lax";
const DEFAULT_FLAGS = {
  httpOnly: true,
  secure: true,
  sameSite: DEFAULT_SAME_SITE,
  path: DEFAULT_PATH
};
const EPOCH_EXPIRES = new Date(0);

function bytesToBinary(bytes) {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

function base64UrlEncode(text) {
  const encoded = new TextEncoder().encode(text);
  return btoa(bytesToBinary(encoded)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(text) {
  const normalized = text.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function normalizeMaxAge(maxAge) {
  if (maxAge === undefined || maxAge === null) {
    return undefined;
  }

  const numeric = Number(maxAge);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : undefined;
}

function resolveExpiry({ expiresAt, maxAge }) {
  if (expiresAt !== undefined && expiresAt !== null) {
    const timestamp = new Date(expiresAt).getTime();
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }

  if (maxAge === undefined) {
    return undefined;
  }

  return Date.now() + maxAge * 1000;
}

function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${value}`];
  const path = options.path ?? DEFAULT_FLAGS.path;
  const sameSite = options.sameSite ?? DEFAULT_FLAGS.sameSite;
  const maxAge = normalizeMaxAge(options.maxAge);
  const expires = options.expires ?? (options.expiresAt ? new Date(options.expiresAt) : undefined);

  parts.push(`Path=${path}`);
  parts.push(`SameSite=${sameSite}`);

  if (options.httpOnly ?? DEFAULT_FLAGS.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure ?? DEFAULT_FLAGS.secure) {
    parts.push("Secure");
  }

  if (maxAge !== undefined) {
    parts.push(`Max-Age=${maxAge}`);
  }

  if (expires instanceof Date && Number.isFinite(expires.getTime())) {
    parts.push(`Expires=${expires.toUTCString()}`);
  }

  return parts.join("; ");
}

function parseCookieHeader(cookieHeader) {
  if (!cookieHeader) {
    return new Map();
  }

  return String(cookieHeader)
    .split(";")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const separatorIndex = pair.indexOf("=");
      if (separatorIndex <= 0) {
        return cookies;
      }

      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();
      cookies.set(key, value);
      return cookies;
    }, new Map());
}

async function signValue(value, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return btoa(bytesToBinary(new Uint8Array(signature)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function verifySignature(value, signature, secret) {
  const expected = await signValue(value, secret);

  if (expected.length !== signature.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) {
    diff |= expected.charCodeAt(index) ^ signature.charCodeAt(index);
  }

  return diff === 0;
}

export async function issueSignedCookie(name, payload, secret, options = {}) {
  if (!secret) {
    throw new Error("Missing cookie secret");
  }

  const maxAge = normalizeMaxAge(options.maxAge);
  const exp = resolveExpiry({ expiresAt: options.expiresAt, maxAge });
  const envelope = { payload };

  if (exp !== undefined) {
    envelope.exp = exp;
  }

  const encodedPayload = base64UrlEncode(JSON.stringify(envelope));
  const signature = await signValue(`${name}.${encodedPayload}`, secret);

  return serializeCookie(name, `${encodedPayload}.${signature}`, {
    ...options,
    maxAge,
    expires: exp !== undefined ? new Date(exp) : options.expires
  });
}

export async function readSignedCookie(cookieHeader, name, secret) {
  if (!cookieHeader || !name || !secret) {
    return null;
  }

  const cookies = parseCookieHeader(cookieHeader);
  const rawValue = cookies.get(name);

  if (!rawValue) {
    return null;
  }

  const separatorIndex = rawValue.lastIndexOf(".");
  if (separatorIndex <= 0) {
    return null;
  }

  const encodedPayload = rawValue.slice(0, separatorIndex);
  const signature = rawValue.slice(separatorIndex + 1);

  if (!(await verifySignature(`${name}.${encodedPayload}`, signature, secret))) {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecode(encodedPayload));

    if (parsed?.exp !== undefined && Date.now() > Number(parsed.exp)) {
      return null;
    }

    return parsed?.payload ?? null;
  } catch {
    return null;
  }
}

export function clearCookie(name, options = {}) {
  return serializeCookie(name, "", {
    ...options,
    maxAge: 0,
    expires: EPOCH_EXPIRES
  });
}
