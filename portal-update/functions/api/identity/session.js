import { exchangeAilAuthCode } from "../../_lib/ail-verifier.js";
import {
  clearCookie,
  issueSignedCookie,
  readSignedCookie
} from "../../_lib/session-cookie.js";

const SESSION_COOKIE = "ct_ail_session";
const OAUTH_STATE_COOKIE = "ct_ail_oauth_state";
const DEFAULT_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

function json(payload, { status = 200, headers = {} } = {}) {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("content-type")) {
    responseHeaders.set("content-type", "application/json");
  }

  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders
  });
}

async function readRequestJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function getCookieHeader(request) {
  return request.headers.get("cookie") ?? "";
}

function normalizeIdentity(exchangeResult) {
  const identity = {
    ail_id: exchangeResult.ail_id,
    display_name: exchangeResult.display_name ?? null,
    role: exchangeResult.role ?? null,
    verified_at: new Date().toISOString()
  };

  if (exchangeResult.owner_org !== undefined) {
    identity.owner_org = exchangeResult.owner_org;
  }

  if (exchangeResult.reputation !== undefined) {
    identity.reputation = exchangeResult.reputation;
  }

  if (exchangeResult.expires_at !== undefined) {
    identity.expires_at = exchangeResult.expires_at;
  }

  if (exchangeResult.expires !== undefined) {
    identity.expires = exchangeResult.expires;
  }

  return identity;
}

function resolveSessionOptions(identity) {
  if (!identity?.expires_at) {
    return { maxAge: DEFAULT_SESSION_MAX_AGE_SECONDS };
  }

  const expiryTime = new Date(identity.expires_at).getTime();
  if (!Number.isFinite(expiryTime)) {
    return { maxAge: DEFAULT_SESSION_MAX_AGE_SECONDS };
  }

  const maxAge = Math.floor((expiryTime - Date.now()) / 1000);
  return maxAge > 0 ? { maxAge, expiresAt: identity.expires_at } : { maxAge: 0, expiresAt: identity.expires_at };
}

export async function onRequestGet(context) {
  const secret = context.env?.CT_SESSION_SECRET;

  if (!secret) {
    return json({ verified: false });
  }

  const identity = await readSignedCookie(getCookieHeader(context.request), SESSION_COOKIE, secret);
  if (!identity?.ail_id) {
    return json({ verified: false });
  }

  return json({ verified: true, identity });
}

export async function onRequestPost(context) {
  const secret = context.env?.CT_SESSION_SECRET;

  if (!secret) {
    return json({ verified: false, error: "missing_session_secret" }, { status: 500 });
  }

  const body = await readRequestJson(context.request);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const state = typeof body?.state === "string" ? body.state.trim() : "";

  if (!code || !state) {
    return json({ verified: false, error: "invalid_request" }, { status: 400 });
  }

  const stateCookie = await readSignedCookie(getCookieHeader(context.request), OAUTH_STATE_COOKIE, secret);
  if (!stateCookie?.state || stateCookie.state !== state) {
    return json(
      { verified: false, error: "invalid_state" },
      {
        status: 401,
        headers: {
          "set-cookie": clearCookie(OAUTH_STATE_COOKIE)
        }
      }
    );
  }

  if (!context.env?.AIL_CLIENT_ID || !context.env?.AIL_CLIENT_SECRET) {
    return json(
      { verified: false, error: "missing_ail_credentials" },
      {
        status: 500,
        headers: {
          "set-cookie": clearCookie(OAUTH_STATE_COOKIE)
        }
      }
    );
  }

  const exchangeResult = await exchangeAilAuthCode(code, context.env);
  if (!exchangeResult.valid) {
    const status = exchangeResult.status >= 500 ? exchangeResult.status : 401;

    return json(
      { verified: false, error: exchangeResult.error ?? "identity_exchange_failed" },
      {
        status,
        headers: {
          "set-cookie": clearCookie(OAUTH_STATE_COOKIE)
        }
      }
    );
  }

  const identity = normalizeIdentity(exchangeResult);
  const sessionCookie = await issueSignedCookie(
    SESSION_COOKIE,
    identity,
    secret,
    resolveSessionOptions(identity)
  );

  const headers = new Headers();
  headers.append("set-cookie", sessionCookie);
  headers.append("set-cookie", clearCookie(OAUTH_STATE_COOKIE));

  return json(
    { verified: true, identity },
    {
      headers
    }
  );
}

export async function onRequestDelete() {
  return json(
    { verified: false },
    {
      headers: {
        "set-cookie": clearCookie(SESSION_COOKIE)
      }
    }
  );
}
