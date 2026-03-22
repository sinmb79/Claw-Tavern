import test from "node:test";
import assert from "node:assert/strict";

const challengeModuleUrl = new URL(
  "../portal-update/functions/api/identity/challenge.js",
  import.meta.url
);
const sessionModuleUrl = new URL(
  "../portal-update/functions/api/identity/session.js",
  import.meta.url
);

function makeRequest(url, { method = "POST", body, cookie } = {}) {
  const headers = new Headers();
  headers.set("content-type", "application/json");

  if (cookie) {
    headers.set("cookie", cookie);
  }

  const init = { method, headers };

  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  return new Request(url, init);
}

function makeContext({
  url = "https://clawtavern.quest/api/identity/session",
  method = "POST",
  env = {},
  body,
  cookie,
  exchangeResult
} = {}) {
  return {
    request: makeRequest(url, { method, body, cookie }),
    env,
    params: {},
    data: { exchangeResult },
    waitUntil() {}
  };
}

test("POST /api/identity/challenge returns state and signed cookie", async () => {
  const { onRequestPost } = await import(challengeModuleUrl.href);

  const response = await onRequestPost(
    makeContext({
      url: "https://clawtavern.quest/api/identity/challenge",
      method: "POST",
      env: { CT_SESSION_SECRET: "test-secret" }
    })
  );

  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.match(payload.state, /^[a-f0-9]{32,}$/);
  assert.match(response.headers.get("set-cookie") ?? "", /ct_ail_oauth_state=/);
});

test("POST /api/identity/session exchanges a code and issues ct_ail_session", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);

  const response = await onRequestPost(
    makeContext({
      env: {
        CT_SESSION_SECRET: "test-secret",
        AIL_CLIENT_ID: "ail_client_test",
        AIL_CLIENT_SECRET: "ail_secret_test"
      },
      body: { code: "oauth-code", state: "known-state" },
      cookie: "ct_ail_oauth_state=known-state",
      exchangeResult: {
        valid: true,
        ail_id: "AIL-100",
        display_name: "Pilot",
        role: "builder"
      }
    })
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /ct_ail_session=/);
});

test("POST /api/identity/session rejects missing code", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);

  const response = await onRequestPost(
    makeContext({
      env: {
        CT_SESSION_SECRET: "test-secret",
        AIL_CLIENT_ID: "ail_client_test",
        AIL_CLIENT_SECRET: "ail_secret_test"
      },
      body: { state: "known-state" },
      cookie: "ct_ail_oauth_state=known-state"
    })
  );

  assert.notEqual(response.status, 200);
});

test("POST /api/identity/session rejects missing state", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);

  const response = await onRequestPost(
    makeContext({
      env: {
        CT_SESSION_SECRET: "test-secret",
        AIL_CLIENT_ID: "ail_client_test",
        AIL_CLIENT_SECRET: "ail_secret_test"
      },
      body: { code: "oauth-code" },
      cookie: "ct_ail_oauth_state=known-state"
    })
  );

  assert.notEqual(response.status, 200);
});

test("POST /api/identity/session rejects mismatched state", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);

  const response = await onRequestPost(
    makeContext({
      env: {
        CT_SESSION_SECRET: "test-secret",
        AIL_CLIENT_ID: "ail_client_test",
        AIL_CLIENT_SECRET: "ail_secret_test"
      },
      body: { code: "oauth-code", state: "wrong-state" },
      cookie: "ct_ail_oauth_state=known-state"
    })
  );

  assert.notEqual(response.status, 200);
});

test("POST /api/identity/session rejects upstream exchange failure", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);

  const response = await onRequestPost(
    makeContext({
      env: {
        CT_SESSION_SECRET: "test-secret",
        AIL_CLIENT_ID: "ail_client_test",
        AIL_CLIENT_SECRET: "ail_secret_test"
      },
      body: { code: "oauth-code", state: "known-state" },
      cookie: "ct_ail_oauth_state=known-state",
      exchangeResult: { valid: false, error: "invalid_code" }
    })
  );

  assert.notEqual(response.status, 200);
});

test("POST /api/identity/session rejects missing env secrets", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);

  const response = await onRequestPost(
    makeContext({
      env: { CT_SESSION_SECRET: "test-secret" },
      body: { code: "oauth-code", state: "known-state" },
      cookie: "ct_ail_oauth_state=known-state"
    })
  );

  assert.notEqual(response.status, 200);
});

test("GET /api/identity/session returns unverified without a valid session cookie", async () => {
  const { onRequestGet } = await import(sessionModuleUrl.href);

  const response = await onRequestGet(
    makeContext({
      method: "GET",
      env: { CT_SESSION_SECRET: "test-secret" }
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: false });
});

test("GET /api/identity/session returns verified with a valid session cookie", async () => {
  const { onRequestGet } = await import(sessionModuleUrl.href);

  const response = await onRequestGet(
    makeContext({
      method: "GET",
      env: { CT_SESSION_SECRET: "test-secret" },
      cookie: "ct_ail_session=signed-session"
    })
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.verified, true);
  assert.ok(payload.identity);
});

test("DELETE /api/identity/session clears the session cookie", async () => {
  const { onRequestDelete } = await import(sessionModuleUrl.href);

  const response = await onRequestDelete(
    makeContext({
      method: "DELETE",
      env: { CT_SESSION_SECRET: "test-secret" },
      cookie: "ct_ail_session=signed-session"
    })
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /ct_ail_session=/);
});
