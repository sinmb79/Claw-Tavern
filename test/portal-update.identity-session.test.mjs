import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

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

function extractCookieValue(setCookieHeader) {
  return setCookieHeader.match(/^ct_ail_session=([^;]+)/)?.[1] ?? null;
}

function forgeSignedSessionCookie(payload, secret) {
  const serializedPayload = JSON.stringify(payload);
  const payloadPart = Buffer.from(serializedPayload).toString("base64url");
  const signaturePart = createHmac("sha256", secret).update(serializedPayload).digest("base64url");

  return `ct_ail_session=${payloadPart}.${signaturePart}`;
}

function forgeJwt(payload) {
  const headerPart = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payloadPart = Buffer.from(JSON.stringify(payload)).toString("base64url");

  return `${headerPart}.${payloadPart}.signature`;
}

const SESSION_TEST_VERIFIED_OFFSET_MS = -60 * 1000;
const SESSION_TEST_EXPIRES_OFFSET_MS = 24 * 60 * 60 * 1000;

function makeIdentityTimestamps(nowMs = Date.now()) {
  return {
    verified_at: new Date(nowMs + SESSION_TEST_VERIFIED_OFFSET_MS).toISOString(),
    expires_at: new Date(nowMs + SESSION_TEST_EXPIRES_OFFSET_MS).toISOString()
  };
}

function makeIdentityPayload(nowMs = Date.now()) {
  return {
    ail_id: "AIL-2026-00001",
    display_name: "ClaudeCoder",
    ...makeIdentityTimestamps(nowMs)
  };
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

test("verifyAilJwt normalizes successful SDK verification results", async () => {
  const identity = makeIdentityPayload();

  class FakeAilClient {
    async verify(token) {
      assert.equal(token, "opaque-jwt");
      return {
        valid: true,
        ail_id: identity.ail_id,
        display_name: identity.display_name,
        issued: identity.verified_at,
        expires: identity.expires_at
      };
    }
  }

  const result = await verifyAilJwt("opaque-jwt", {
    sdk: { AilClient: FakeAilClient }
  });

  assert.deepEqual(result, {
    valid: true,
    ail_id: identity.ail_id,
    display_name: identity.display_name,
    verified_at: identity.verified_at,
    expires_at: identity.expires_at
  });
});

test("verifyAilJwt derives expiry from JWT claims when the verifier omits expiry fields", async () => {
  const identity = makeIdentityPayload();

  class FakeAilClient {
    async verify(token) {
      assert.equal(token, jwt);
      return {
        valid: true,
        ail_id: identity.ail_id,
        display_name: identity.display_name,
        owner_org: "22B Labs",
        issued: identity.verified_at,
        revoked: false
      };
    }
  }

  const jwt = forgeJwt({
    sub: identity.ail_id,
    exp: Math.floor(Date.parse(identity.expires_at) / 1000)
  });
  const result = await verifyAilJwt(jwt, {
    sdk: { AilClient: FakeAilClient }
  });

  assert.deepEqual(result, {
    valid: true,
    ail_id: identity.ail_id,
    display_name: identity.display_name,
    verified_at: identity.verified_at,
    expires_at: new Date(Math.floor(Date.parse(identity.expires_at) / 1000) * 1000).toISOString()
  });
});

test("verifyAilJwt normalizes expired verifier failures", async () => {
  class FakeAilClient {
    async verify() {
      return {
        valid: false,
        reason: "jwt expired"
      };
    }
  }

  const result = await verifyAilJwt("expired-jwt", {
    sdk: { AilClient: FakeAilClient }
  });

  assert.deepEqual(result, {
    valid: false,
    error: "expired-jwt"
  });
});

test("verifyAilJwt treats missing jwt input as invalid at the verifier boundary", async () => {
  const result = await verifyAilJwt("");

  assert.deepEqual(result, {
    valid: false,
    error: "invalid-jwt"
  });
});

test("verifyAilJwt falls back to HTTP verification when the SDK is unavailable", async () => {
  let requestUrl = null;
  let requestBody = null;
  const identity = makeIdentityPayload();

  const result = await verifyAilJwt("opaque-jwt", {
    loadSdk: async () => null,
    fetchImpl: async (url, init) => {
      requestUrl = url;
      requestBody = JSON.parse(init.body);

      return new Response(
        JSON.stringify({
          valid: true,
          ail_id: identity.ail_id,
          display_name: identity.display_name,
          issued: identity.verified_at,
          expires: identity.expires_at
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }
  });

  assert.equal(requestUrl, "https://api.agentidcard.org/verify");
  assert.deepEqual(requestBody, { token: "opaque-jwt" });
  assert.deepEqual(result, {
    valid: true,
    ail_id: identity.ail_id,
    display_name: identity.display_name,
    verified_at: identity.verified_at,
    expires_at: identity.expires_at
  });
});

test("verifyAilJwt normalizes HTTP fallback failures when the SDK is unavailable", async () => {
  const result = await verifyAilJwt("expired-jwt", {
    loadSdk: async () => null,
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: "jwt expired" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      })
  });

  assert.deepEqual(result, {
    valid: false,
    error: "expired-jwt"
  });
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

test("issueSessionCookie keeps a still-valid cookie alive for subsecond expiry windows", async () => {
  const now = 1_700_000_000_000;
  const originalNow = Date.now;
  Date.now = () => now;

  try {
    const setCookie = await issueSessionCookie(
      {
        ail_id: "AIL-2026-00001",
        display_name: "ClaudeCoder",
        verified_at: new Date(now).toISOString(),
        expires_at: new Date(now + 500).toISOString()
      },
      "test-secret"
    );

    const maxAge = Number(setCookie.match(/Max-Age=(\d+)/)?.[1]);
    assert.equal(maxAge, 1);
  } finally {
    Date.now = originalNow;
  }
});

test("issueSessionCookie rejects payloads missing required claims", async () => {
  const identity = makeIdentityPayload();
  await assert.rejects(
    () =>
      issueSessionCookie(
        {
          ail_id: identity.ail_id,
          display_name: identity.display_name,
          verified_at: identity.verified_at
        },
        "test-secret"
      ),
    /required/i
  );
});

test("readSessionCookie strips unsupported claims from the emitted session payload", async () => {
  const identity = makeIdentityPayload();
  const setCookie = await issueSessionCookie(
    {
      ail_id: identity.ail_id,
      display_name: identity.display_name,
      verified_at: identity.verified_at,
      expires_at: identity.expires_at,
      roles: ["admin"],
      source: "browser"
    },
    "test-secret"
  );
  const cookieValue = extractCookieValue(setCookie);

  assert.ok(cookieValue, "Expected session cookie value");

  const session = await readSessionCookie(`ct_ail_session=${cookieValue}`, "test-secret");

  assert.deepEqual(session, {
    ail_id: identity.ail_id,
    display_name: identity.display_name,
    verified_at: identity.verified_at,
    expires_at: identity.expires_at
  });
  assert.equal(Object.hasOwn(session ?? {}, "roles"), false);
  assert.equal(Object.hasOwn(session ?? {}, "source"), false);
});

test("readSessionCookie rejects cookies missing required claims", async () => {
  const identity = makeIdentityPayload();
  const cookie = forgeSignedSessionCookie(
    {
      ail_id: identity.ail_id,
      verified_at: identity.verified_at,
      expires_at: identity.expires_at
    },
    "test-secret"
  );

  const session = await readSessionCookie(cookie, "test-secret");

  assert.equal(session, null);
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
  const identity = makeIdentityPayload();
  const setCookie = await issueSessionCookie(
    {
      ail_id: identity.ail_id,
      display_name: identity.display_name,
      verified_at: identity.verified_at,
      expires_at: identity.expires_at
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
  const identity = makeIdentityPayload();
  const setCookie = await issueSessionCookie(
    {
      ail_id: identity.ail_id,
      display_name: identity.display_name,
      verified_at: identity.verified_at,
      expires_at: identity.expires_at
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

test("default handler entrypoints expose the live route behavior", async () => {
  const getResponse = await onRequestGet(makeContext({ method: "GET" }));
  assert.equal(getResponse.status, 200);
  assert.deepEqual(await getResponse.json(), { verified: false });

  const postResponse = await onRequestPost(
    makeContext({
      method: "POST",
      env: { CT_SESSION_SECRET: "test-secret" },
      body: {}
    })
  );
  assert.equal(postResponse.status, 400);
  assert.deepEqual(await postResponse.json(), {
    verified: false,
    error: "missing-jwt"
  });

  const deleteResponse = await onRequestDelete(
    makeContext({
      method: "DELETE"
    })
  );
  assert.equal(deleteResponse.status, 204);
  assert.match(deleteResponse.headers.get("set-cookie") ?? "", /ct_ail_session=/);
});

test("POST issues a signed cookie after verifier success", async () => {
  const identity = makeIdentityPayload();
  const { onRequestPost: post } = makeHandlers({
    verifyAilJwt: async () => ({
      valid: true,
      ail_id: identity.ail_id,
      display_name: identity.display_name,
      verified_at: identity.verified_at,
      expires_at: identity.expires_at
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
  assert.deepEqual(await response.json(), {
    verified: true,
    identity: {
      ail_id: identity.ail_id,
      display_name: identity.display_name,
      verified_at: identity.verified_at,
      expires_at: identity.expires_at
    }
  });
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

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    verified: false,
    error: "invalid-jwt"
  });
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
  assert.deepEqual(await response.json(), {
    verified: false,
    error: "expired-jwt"
  });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST fails closed when the session secret is missing", async () => {
  let verifierCalled = false;
  const { onRequestPost: post } = makeHandlers({
    verifyAilJwt: async () => {
      verifierCalled = true;
      return { valid: false, error: "invalid-jwt" };
    }
  });

  const response = await post(
    makeContext({
      method: "POST",
      body: { jwt: "opaque-jwt" }
    })
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    verified: false,
    error: "server-misconfigured"
  });
  assert.equal(verifierCalled, false);
  assert.equal(response.headers.get("set-cookie"), null);
});

test("POST rejects requests without a jwt payload", async () => {
  const { onRequestPost: post } = makeHandlers({
    verifyAilJwt: async () => {
      throw new Error("should not be called");
    }
  });

  const response = await post(
    makeContext({
      method: "POST",
      env: { CT_SESSION_SECRET: "test-secret" },
      body: {}
    })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    verified: false,
    error: "missing-jwt"
  });
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
  const identity = makeIdentityPayload();
  const cookie = await issueSessionCookie(
    {
      ail_id: identity.ail_id,
      display_name: identity.display_name,
      verified_at: identity.verified_at,
      expires_at: identity.expires_at
    },
    "test-secret"
  );

  const { onRequestGet: get } = makeHandlers();
  const response = await get(
    makeContext({
      method: "GET",
      env,
      cookie: `ct_ail_session=${extractCookieValue(cookie)}`
    })
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    verified: true,
    identity: {
      ail_id: identity.ail_id,
      display_name: identity.display_name,
      verified_at: identity.verified_at,
      expires_at: identity.expires_at
    }
  });
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
