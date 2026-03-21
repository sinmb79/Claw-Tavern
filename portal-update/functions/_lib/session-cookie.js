import { createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "ct_ail_session";
const COOKIE_MAX_AGE_SECONDS = 24 * 60 * 60;

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(serializedPayload, secret) {
  return createHmac("sha256", secret).update(serializedPayload).digest();
}

function extractCookieValue(cookieHeader) {
  if (!cookieHeader) {
    return null;
  }

  for (const segment of cookieHeader.split(";")) {
    const trimmed = segment.trim();

    if (trimmed.startsWith(`${COOKIE_NAME}=`)) {
      return trimmed.slice(COOKIE_NAME.length + 1);
    }
  }

  return null;
}

function normalizeSessionExpiry(payload, nowMs) {
  const jwtExpiryMs = Date.parse(payload?.expires_at);

  if (!Number.isFinite(jwtExpiryMs)) {
    throw new Error("Invalid session expiry");
  }

  const cappedExpiryMs = Math.min(jwtExpiryMs, nowMs + COOKIE_MAX_AGE_SECONDS * 1000);

  if (cappedExpiryMs <= nowMs) {
    throw new Error("Session expired");
  }

  return cappedExpiryMs;
}

function validateSecret(secret) {
  if (typeof secret !== "string" || secret.trim() === "") {
    throw new Error("Missing session secret");
  }
}

function isSignatureValid(serializedPayload, signatureValue, secret) {
  try {
    const expected = sign(serializedPayload, secret);
    const provided = Buffer.from(signatureValue, "base64url");

    if (provided.length !== expected.length) {
      return false;
    }

    return timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

export async function issueSessionCookie(payload, secret) {
  validateSecret(secret);

  const nowMs = Date.now();
  const expiresAtMs = normalizeSessionExpiry(payload, nowMs);
  const sessionPayload = {
    ...payload,
    expires_at: new Date(expiresAtMs).toISOString()
  };
  const serializedPayload = JSON.stringify(sessionPayload);
  const signedPayload = encodeBase64Url(serializedPayload);
  const signature = encodeBase64Url(sign(serializedPayload, secret));
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAtMs - nowMs) / 1000));

  return `${COOKIE_NAME}=${signedPayload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}; Expires=${new Date(expiresAtMs).toUTCString()}`;
}

export async function readSessionCookie(cookieHeader, secret) {
  if (typeof secret !== "string" || secret.trim() === "") {
    return null;
  }

  const cookieValue = extractCookieValue(cookieHeader);

  if (!cookieValue) {
    return null;
  }

  const [payloadPart, signaturePart, ...extraParts] = cookieValue.split(".");

  if (!payloadPart || !signaturePart || extraParts.length > 0) {
    return null;
  }

  let serializedPayload;

  try {
    serializedPayload = decodeBase64Url(payloadPart);
  } catch {
    return null;
  }

  if (!isSignatureValid(serializedPayload, signaturePart, secret)) {
    return null;
  }

  let payload;

  try {
    payload = JSON.parse(serializedPayload);
  } catch {
    return null;
  }

  const expiresAtMs = Date.parse(payload?.expires_at);

  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return null;
  }

  return payload;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0; Expires=${new Date(0).toUTCString()}`;
}
