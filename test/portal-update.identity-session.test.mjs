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
const TEST_SECRET = "test-secret";
const BASE_ENV = {
  CT_SESSION_SECRET: TEST_SECRET,
  AIL_CLIENT_ID: "ail_client_test",
  AIL_CLIENT_SECRET: "ail_secret_test"
};

function makeRequest(url, { method = "POST", body, cookie } = {}) {
  const headers = new Headers();

  if (cookie) {
    headers.set("cookie", cookie);
  }

  const init = { method, headers };

  if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  return new Request(url, init);
}

function makeContext({
  url = "https://clawtavern.quest/api/identity/session",
  method = "POST",
  env = {},
  body,
  cookie
} = {}) {
  return {
    request: makeRequest(url, { method, body, cookie }),
    env,
    params: {},
    waitUntil() {}
  };
}

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function extractCookiePair(setCookie, name) {
  assert.ok(setCookie, "Expected Set-Cookie output");
  const match = String(setCookie).match(
    new RegExp(`${name}=([^;]+)`)
  );
  assert.ok(match, `Expected ${name} cookie in Set-Cookie header`);
  return `${name}=${match[1]}`;
}

async function withMockedFetch(mockFetch, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function createOauthChallenge(env = { CT_SESSION_SECRET: TEST_SECRET }) {
  const { onRequestPost } = await import(challengeModuleUrl.href);
  const response = await onRequestPost(
    makeContext({
      url: "https://clawtavern.quest/api/identity/challenge",
      method: "POST",
      env
    })
  );

  assert.equal(response.status, 200);

  const payload = await response.json();
  return {
    state: payload.state,
    cookie: extractCookiePair(response.headers.get("set-cookie"), "ct_ail_oauth_state")
  };
}

async function createVerifiedSessionCookie({
  exchangePayload = {
    valid: true,
    ail_id: "AIL-100",
    display_name: "Pilot",
    role: "builder"
  },
  mockFetch
} = {}) {
  return withMockedFetch(
    mockFetch ?? (async (url, init) => {
      assert.equal(String(url), "https://api.agentidcard.org/auth/exchange");
      assert.equal(init?.method, "POST");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      assert.deepEqual(JSON.parse(init?.body ?? "{}"), {
        code: "oauth-code",
        client_id: BASE_ENV.AIL_CLIENT_ID,
        client_secret: BASE_ENV.AIL_CLIENT_SECRET
      });

      return jsonResponse(exchangePayload);
    }),
    async () => {
      const { onRequestPost } = await import(sessionModuleUrl.href);
      const challenge = await createOauthChallenge();
      const response = await onRequestPost(
        makeContext({
          env: BASE_ENV,
          body: { code: "oauth-code", state: challenge.state },
          cookie: challenge.cookie
        })
      );

      assert.equal(response.status, 200);

      const payload = await response.json();
      return {
        payload,
        cookie: extractCookiePair(response.headers.get("set-cookie"), "ct_ail_session")
      };
    }
  );
}

test("POST /api/identity/challenge returns state and signed cookie", async () => {
  const { onRequestPost } = await import(challengeModuleUrl.href);
  const response = await onRequestPost(
    makeContext({
      url: "https://clawtavern.quest/api/identity/challenge",
      method: "POST",
      env: { CT_SESSION_SECRET: TEST_SECRET }
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.match(payload.state, /^[a-f0-9]{32,}$/);
  assert.match(response.headers.get("set-cookie") ?? "", /ct_ail_oauth_state=/);
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/i);
});

test("POST /api/identity/session exchanges a code and issues ct_ail_session", async () => {
  const { payload, cookie } = await createVerifiedSessionCookie();

  assert.equal(payload.verified, true);
  assert.equal(payload.identity?.ail_id, "AIL-100");
  assert.match(cookie, /^ct_ail_session=/);
});

test("POST /api/identity/session rejects missing code", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);
  const challenge = await createOauthChallenge();

  const response = await onRequestPost(
    makeContext({
      env: BASE_ENV,
      body: { state: challenge.state },
      cookie: challenge.cookie
    })
  );

  assert.equal(response.status, 400);
});

test("POST /api/identity/session rejects missing state", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);
  const challenge = await createOauthChallenge();

  const response = await onRequestPost(
    makeContext({
      env: BASE_ENV,
      body: { code: "oauth-code" },
      cookie: challenge.cookie
    })
  );

  assert.equal(response.status, 400);
});

test("POST /api/identity/session rejects missing csrf cookie state", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);

  const response = await onRequestPost(
    makeContext({
      env: BASE_ENV,
      body: { code: "oauth-code", state: "known-state" }
    })
  );

  assert.equal(response.status, 401);
});

test("POST /api/identity/session rejects mismatched state", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);
  const challenge = await createOauthChallenge();

  const response = await onRequestPost(
    makeContext({
      env: BASE_ENV,
      body: { code: "oauth-code", state: "wrong-state" },
      cookie: challenge.cookie
    })
  );

  assert.equal(response.status, 401);
});

test("POST /api/identity/session rejects upstream exchange failure", async () => {
  await withMockedFetch(
    async () => jsonResponse({ error: "invalid_code" }, { status: 401 }),
    async () => {
      const { onRequestPost } = await import(sessionModuleUrl.href);
      const challenge = await createOauthChallenge();

      const response = await onRequestPost(
        makeContext({
          env: BASE_ENV,
          body: { code: "oauth-code", state: challenge.state },
          cookie: challenge.cookie
        })
      );

      assert.equal(response.status, 401);
      assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /ct_ail_session=/);
    }
  );
});

test("POST /api/identity/session rejects missing env secrets", async () => {
  const { onRequestPost } = await import(sessionModuleUrl.href);
  const challenge = await createOauthChallenge();

  const response = await onRequestPost(
    makeContext({
      env: { CT_SESSION_SECRET: TEST_SECRET },
      body: { code: "oauth-code", state: challenge.state },
      cookie: challenge.cookie
    })
  );

  assert.equal(response.status, 500);
});

test("GET /api/identity/session returns unverified without a session cookie", async () => {
  const { onRequestGet } = await import(sessionModuleUrl.href);

  const response = await onRequestGet(
    makeContext({
      method: "GET",
      env: { CT_SESSION_SECRET: TEST_SECRET }
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: false });
});

test("GET /api/identity/session returns unverified with a malformed session cookie", async () => {
  const { onRequestGet } = await import(sessionModuleUrl.href);

  const response = await onRequestGet(
    makeContext({
      method: "GET",
      env: { CT_SESSION_SECRET: TEST_SECRET },
      cookie: "ct_ail_session=not-a-signed-cookie"
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: false });
});

test("GET /api/identity/session rejects a replayed oauth-state cookie under ct_ail_session", async () => {
  const { onRequestGet } = await import(sessionModuleUrl.href);
  const challenge = await createOauthChallenge();
  const replayedCookie = challenge.cookie.replace("ct_ail_oauth_state=", "ct_ail_session=");

  const response = await onRequestGet(
    makeContext({
      method: "GET",
      env: { CT_SESSION_SECRET: TEST_SECRET },
      cookie: replayedCookie
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verified: false });
});

test("GET /api/identity/session returns verified with a valid session cookie", async () => {
  const { onRequestGet } = await import(sessionModuleUrl.href);
  const { cookie: sessionCookie } = await createVerifiedSessionCookie();

  const response = await onRequestGet(
    makeContext({
      method: "GET",
      env: { CT_SESSION_SECRET: TEST_SECRET },
      cookie: sessionCookie
    })
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.verified, true);
  assert.equal(payload.identity?.ail_id, "AIL-100");
  assert.equal(payload.identity?.display_name, "Pilot");
  assert.equal(payload.identity?.role, "builder");
});

test("POST /api/identity/session normalizes numeric expires into a future session expiry", async () => {
  const { onRequestGet } = await import(sessionModuleUrl.href);
  const beforeRequest = Date.now();
  const { payload, cookie: sessionCookie } = await createVerifiedSessionCookie({
    exchangePayload: {
      valid: true,
      ail_id: "AIL-200",
      display_name: "Timer",
      role: "builder",
      expires: 3600
    }
  });

  assert.equal(payload.verified, true);
  assert.equal(payload.identity?.ail_id, "AIL-200");
  assert.ok(Date.parse(payload.identity?.expires_at ?? "") >= beforeRequest + 3500 * 1000);

  const response = await onRequestGet(
    makeContext({
      method: "GET",
      env: { CT_SESSION_SECRET: TEST_SECRET },
      cookie: sessionCookie
    })
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).verified, true);
});

test("POST /api/identity/session preserves exchange_unavailable as 502", async () => {
  await withMockedFetch(
    async () => {
      throw new Error("network down");
    },
    async () => {
      const { onRequestPost } = await import(sessionModuleUrl.href);
      const challenge = await createOauthChallenge();

      const response = await onRequestPost(
        makeContext({
          env: BASE_ENV,
          body: { code: "oauth-code", state: challenge.state },
          cookie: challenge.cookie
        })
      );

      assert.equal(response.status, 502);
      assert.doesNotMatch(response.headers.get("set-cookie") ?? "", /ct_ail_session=/);
    }
  );
});

test("DELETE /api/identity/session clears the session cookie", async () => {
  const { onRequestDelete } = await import(sessionModuleUrl.href);

  const response = await onRequestDelete(
    makeContext({
      method: "DELETE",
      env: { CT_SESSION_SECRET: TEST_SECRET },
      cookie: "ct_ail_session=stale-session"
    })
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /ct_ail_session=/);
  assert.match(response.headers.get("set-cookie") ?? "", /(Max-Age=0|Expires=)/i);
});
