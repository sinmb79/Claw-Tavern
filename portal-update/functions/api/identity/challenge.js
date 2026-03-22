import { issueSignedCookie } from "../../_lib/session-cookie.js";

const OAUTH_STATE_COOKIE = "ct_ail_oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

function randomHex(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequestPost(context) {
  const secret = context.env?.CT_SESSION_SECRET;

  if (!secret) {
    return json({ ok: false, error: "missing_session_secret" }, { status: 500 });
  }

  const state = randomHex();
  const setCookie = await issueSignedCookie(
    OAUTH_STATE_COOKIE,
    { state },
    secret,
    { maxAge: OAUTH_STATE_MAX_AGE_SECONDS }
  );

  return json(
    { ok: true, state },
    {
      headers: {
        "set-cookie": setCookie
      }
    }
  );
}
