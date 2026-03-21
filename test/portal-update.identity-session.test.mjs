import test from "node:test";
import assert from "node:assert/strict";

import {
  createIdentitySessionHandlers,
  onRequestGet,
  onRequestPost,
  onRequestDelete
} from "../portal-update/functions/api/identity/session.js";
import {
  issueSessionCookie,
  readSessionCookie,
  clearSessionCookie
} from "../portal-update/functions/_lib/session-cookie.js";
import { verifyAilJwt } from "../portal-update/functions/_lib/ail-verifier.js";

function makeContext({
  method = "GET",
  body,
  headers = {},
  env = {},
  cookie,
  url = "https://portal-update.example/api/identity/session"
} = {}) {
  const requestHeaders = new Headers(headers);

  if (cookie) {
    requestHeaders.set("cookie", cookie);
  }

  const hasBody = body !== undefined && method !== "GET" && method !== "DELETE";
  if (hasBody && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }

  return {
    request: new Request(url, {
      method,
      headers: requestHeaders,
      body: hasBody ? JSON.stringify(body) : undefined
    }),
    env,
    waitUntil() {},
    params: {}
  };
}

function makeHandlers(deps = {}) {
  return createIdentitySessionHandlers(deps);
}

test("exports remain importable", () => {
  assert.equal(typeof createIdentitySessionHandlers, "function");
  assert.equal(typeof onRequestGet, "function");
  assert.equal(typeof onRequestPost, "function");
  assert.equal(typeof onRequestDelete, "function");
  assert.equal(typeof issueSessionCookie, "function");
  assert.equal(typeof readSessionCookie, "function");
  assert.equal(typeof clearSessionCookie, "function");
  assert.equal(typeof verifyAilJwt, "function");
});

test("issueSessionCookie signs payload and caps expiry at 24 hours", async () => {
  const nowMs = Date.now();
  const setCookie = await issueSessionCookie(
    {
      ail_id: "AIL-2026-00001",
      display_name: "ClaudeCoder",
      verified_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + 48 * 60 * 60 * 1000).toISOString()
    },
    "test-secret"
  );

  assert.match(setCookie, /^ct_ail_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Path=\//);

  const maxAgeMatch = setCookie.match(/Max-Age=(\d+)/);
  assert.ok(maxAgeMatch, "Expected Max-Age attribute");

  const maxAge = Number(maxAgeMatch[1]);
  assert.ok(maxAge <= 24 * 60 * 60, `Expected cap at 24 hours, got ${maxAge}`);
  assert.ok(maxAge >= 24 * 60 * 60 - 30, `Expected near 24 hours, got ${maxAge}`);
});

test("readSessionCookie returns payload for a valid signed cookie", async () => {
  const nowMs = Date.now();
  const setCookie = await issueSessionCookie(
    {
      ail_id: "AIL-2026-00001",
      display_name: "ClaudeCoder",
      verified_at: new Date(nowMs).toISOString(),
      expires_at: new Date(nowMs + 48 * 60 * 60 * 1000).toISOString()
    },
    "test-secret"
  );
  const cookieValue = setCookie.match(/^ct_ail_session=([^;]+)/)?.[1];

  assert.ok(cookieValue, "Expected session cookie value");

  const session = await readSessionCookie(`foo=bar; ct_ail_session=${cookieValue}`, "test-secret");

  assert.equal(session?.ail_id, "AIL-2026-00001");
  assert.equal(session?.display_name, "ClaudeCoder");
  assert.equal(session?.verified_at, new Date(nowMs).toISOString());
  assert.ok(Date.parse(session?.expires_at ?? "") <= nowMs + 24 * 60 * 60 * 1000);
});

test("readSessionCookie rejects tampered cookies", async () => {
  const setCookie = await issueSessionCookie(
    {
      ail_id: "AIL-2026-00001",
      display_name: "ClaudeCoder",
      verified_at: "2026-03-21T00:00:00.000Z",
      expires_at: "2026-03-22T00:00:00.000Z"
    },
    "test-secret"
  );
  const cookieValue = setCookie.match(/^ct_ail_session=([^;]+)/)?.[1];

  assert.ok(cookieValue, "Expected session cookie value");

  const tamperedValue = cookieValue.replace(/.$/, (char) => (char === "A" ? "B" : "A"));

  const session = await readSessionCookie(`ct_ail_session=${tamperedValue}`, "test-secret");

  assert.equal(session, null);
});

test("readSessionCookie returns null without a secret", async () => {
  const setCookie = await issueSessionCookie(
    {
      ail_id: "AIL-2026-00001",
      display_name: "ClaudeCoder",
      verified_at: "2026-03-21T00:00:00.000Z",
      expires_at: "2026-03-22T00:00:00.000Z"
    },
    "test-secret"
  );
  const cookieValue = setCookie.match(/^ct_ail_session=([^;]+)/)?.[1];

  assert.ok(cookieValue, "Expected session cookie value");

  const session = await readSessionCookie(`ct_ail_session=${cookieValue}`);

  assert.equal(session, null);
});

test("clearSessionCookie clears the session cookie", () => {
  const setCookie = clearSessionCookie();

  assert.match(setCookie, /^ct_ail_session=/);
  assert.match(setCookie, /Max-Age=0/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
});

test("default handler entrypoints still reject as not implemented", async () => {
  await assert.rejects(() => onRequestGet(makeContext({ method: "GET" })), /not implemented/);
  await assert.rejects(
    () =>
      onRequestPost(
        makeContext({
          method: "POST",
          body: { jwt: "opaque-jwt" }
        })
      ),
    /not implemented/
  );
  await assert.rejects(
    () =>
      onRequestDelete(
        makeContext({
          method: "DELETE"
        })
      ),
    /not implemented/
  );
});

test("POST issues a signed cookie after verifier success", async () => {
  const { onRequestPost: post } = makeHandlers({
    verifyAilJwt: async () => ({
      valid: true,
      ail_id: "AIL-2026-00001",
      display_name: "ClaudeCoder",
      expires_at: "2026-03-22T00:00:00.000Z"
    })
  });

  const response = await post(
    makeContext({
      method: "POST",
      env: { CT_SESSION_SECRET: "test-secret" },
      body: { jwt: "opaque-jwt" }
    })
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /ct_ail_session=/);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
});

test("POST rejects invalid JWTs", async () => {
  const { onRequestPost: post } = makeHandlers({
    verifyAilJwt: async () => ({ valid: false, error: "invalid-jwt" })
  });

  const response = await post(
    makeContext({
      method: "POST",
      env: { CT_SESSION_SECRET: "test-secret" },
      body: { jwt: "opaque-jwt" }
    })
  );

  assert.ok([400, 401].includes(response.status), `Expected 400 or 401, got ${response.status}`);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST rejects expired JWTs", async () => {
  const { onRequestPost: post } = makeHandlers({
    verifyAilJwt: async () => ({ valid: false, error: "expired-jwt" })
  });

  const response = await post(
    makeContext({
      method: "POST",
      env: { CT_SESSION_SECRET: "test-secret" },
      body: { jwt: "opaque-jwt" }
    })
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST fails closed when the session secret is missing", async () => {
  const { onRequestPost: post } = makeHandlers({
    verifyAilJwt: async () => ({ valid: true, ail_id: "AIL-2026-00001" })
  });

  const response = await post(
    makeContext({
      method: "POST",
      body: { jwt: "opaque-jwt" }
    })
  );

  assert.ok(response.status >= 500, `Expected 5xx, got ${response.status}`);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("GET reports unverified when no valid cookie is present", async () => {
  const { onRequestGet: get } = makeHandlers();
  const response = await get(makeContext({ method: "GET" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: false });
});

test("GET reports verified when a valid cookie is present", async () => {
  const env = { CT_SESSION_SECRET: "test-secret" };
  const cookie = await issueSessionCookie(
    {
      ail_id: "AIL-2026-00001",
      display_name: "ClaudeCoder",
      verified_at: "2026-03-21T00:00:00.000Z",
      expires_at: "2026-03-22T00:00:00.000Z"
    },
    "test-secret"
  );

  const { onRequestGet: get } = makeHandlers();
  const response = await get(
    makeContext({
      method: "GET",
      env,
      cookie: `ct_ail_session=${cookie}`
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: true });
});

test("DELETE clears the session cookie", async () => {
  const { onRequestDelete: del } = makeHandlers();
  const response = await del(
    makeContext({
      method: "DELETE",
      cookie: "ct_ail_session=existing"
    })
  );

  assert.equal(response.status, 204);
  assert.match(response.headers.get("set-cookie") ?? "", /ct_ail_session=/);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});
