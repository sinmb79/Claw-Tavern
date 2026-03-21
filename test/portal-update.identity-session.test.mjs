import test from "node:test";
import assert from "node:assert/strict";

import session from "../portal-update/functions/api/identity/session.js";
import sessionCookie from "../portal-update/functions/_lib/session-cookie.js";
import ailVerifier from "../portal-update/functions/_lib/ail-verifier.js";

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

test("exports remain importable", () => {
  assert.equal(typeof session.onRequestGet, "function");
  assert.equal(typeof session.onRequestPost, "function");
  assert.equal(typeof session.onRequestDelete, "function");
  assert.equal(typeof sessionCookie.issueSessionCookie, "function");
  assert.equal(typeof sessionCookie.readSessionCookie, "function");
  assert.equal(typeof sessionCookie.clearSessionCookie, "function");
  assert.equal(typeof ailVerifier.verifyAilJwt, "function");
});

test("POST issues a signed cookie after verifier success", async () => {
  const response = await session.onRequestPost(
    makeContext({
      method: "POST",
      env: { CT_SESSION_SECRET: "test-secret" },
      body: { jwt: "valid.jwt.token" }
    })
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /ct_ail_session=/);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
});

test("POST rejects invalid JWTs", async () => {
  const response = await session.onRequestPost(
    makeContext({
      method: "POST",
      env: { CT_SESSION_SECRET: "test-secret" },
      body: { jwt: "invalid.jwt.token" }
    })
  );

  assert.ok([400, 401].includes(response.status), `Expected 400 or 401, got ${response.status}`);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST rejects expired JWTs", async () => {
  const response = await session.onRequestPost(
    makeContext({
      method: "POST",
      env: { CT_SESSION_SECRET: "test-secret" },
      body: { jwt: "expired.jwt.token" }
    })
  );

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST fails closed when the session secret is missing", async () => {
  const response = await session.onRequestPost(
    makeContext({
      method: "POST",
      body: { jwt: "valid.jwt.token" }
    })
  );

  assert.ok(response.status >= 500, `Expected 5xx, got ${response.status}`);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("GET reports unverified when no valid cookie is present", async () => {
  const response = await session.onRequestGet(makeContext({ method: "GET" }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: false });
});

test("GET reports verified when a valid cookie is present", async () => {
  const cookie = await sessionCookie.issueSessionCookie(
    {
      ail_id: "AIL-2026-00001",
      display_name: "ClaudeCoder",
      verified_at: "2026-03-21T00:00:00.000Z",
      expires_at: "2026-03-22T00:00:00.000Z"
    },
    "test-secret"
  );

  const response = await session.onRequestGet(
    makeContext({
      method: "GET",
      cookie: `ct_ail_session=${cookie}`
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: true });
});

test("DELETE clears the session cookie", async () => {
  const response = await session.onRequestDelete(
    makeContext({
      method: "DELETE",
      cookie: "ct_ail_session=existing"
    })
  );

  assert.equal(response.status, 204);
  assert.match(response.headers.get("set-cookie") ?? "", /ct_ail_session=/);
  assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
});
