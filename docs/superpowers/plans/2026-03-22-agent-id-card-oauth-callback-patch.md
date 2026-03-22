# Agent ID Card OAuth Callback Patch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Claw Tavern's old browser-local Agent ID Card gate with the new OAuth popup -> `/callback` -> server-side auth-code exchange flow, while keeping the current product scope limited to `verified session gate + wallet connect allowed`.

**Architecture:** Add a small Pages Functions surface for OAuth challenge issuance and auth-code exchange, plus a static `/callback` page that returns the auth code to the opener or stores a short-lived recovery payload. Update both `portal-update/index.html` and `portal-update/app/index.html` so wallet connection always checks the verified session first and never trusts local storage or the old `I already completed it` shortcut.

**Tech Stack:** Cloudflare Pages Functions, static HTML with inline JavaScript, Web Crypto HMAC signing, `fetch`, `node:test`, Playwright CLI

---

## File Structure

- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\session-cookie.js`
  - sign, verify, serialize, and clear the `ct_ail_session` and `ct_ail_oauth_state` cookies
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\ail-verifier.js`
  - server-side `POST https://api.agentidcard.org/auth/exchange` adapter
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\challenge.js`
  - issues short-lived OAuth state + signed cookie
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\session.js`
  - `GET` verified session, `POST` auth-code exchange, `DELETE` clear session
- Create: `C:\Users\sinmb\claw-tavern\portal-update\callback.html`
  - browser-facing callback page for `/callback`
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\app\index.html`
  - marketplace OAuth gate, callback recovery, modal copy, exact redirect config
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\index.html`
  - brand-home OAuth gate and modal parity
- Create: `C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs`
  - function tests for challenge/session/cookies/exchange
- Modify: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`
  - client and callback route regression coverage
- Optional modify: `C:\Users\sinmb\claw-tavern\portal-update\wrangler.jsonc`
  - only if additional Pages config is needed for local function dev

## Preflight Constraint

The live launch origin is now aligned with the registered AIL client:

- registered origin: `https://www.clawtavern.quest`
- registered callback: `https://www.clawtavern.quest/callback`

Implementation and live OAuth validation can proceed on the current production hostname.

---

### Task 1: Lock the new OAuth contract with failing tests

**Files:**
- Create: `C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs`
- Modify: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Write failing function tests for the challenge and session API**

Add `node:test` coverage that requires:

```js
test("POST /api/identity/challenge returns state and signed cookie", async () => {
  const response = await onRequestPost(makeContext({ env: { CT_SESSION_SECRET: "test-secret" } }));
  const payload = await response.json();
  assert.match(payload.state, /^[a-f0-9]{32,}$/);
  assert.match(response.headers.get("set-cookie"), /ct_ail_oauth_state=/);
});

test("POST /api/identity/session exchanges a code and issues ct_ail_session", async () => {
  const response = await onRequestPost(
    makeContext({
      env: {
        CT_SESSION_SECRET: "test-secret",
        AIL_CLIENT_ID: "ail_client_test",
        AIL_CLIENT_SECRET: "ail_secret_test"
      },
      body: { code: "oauth-code", state: "known-state" },
      cookie: "ct_ail_oauth_state=...",
      exchangeResult: { valid: true, ail_id: "AIL-100", display_name: "Pilot", role: "builder" }
    })
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /ct_ail_session=/);
});
```

Also require failures for:
- missing code
- missing or mismatched state
- upstream exchange failure
- missing env secrets
- `GET` with and without valid session cookie
- `DELETE` clearing the session cookie

- [ ] **Step 2: Write failing navigation tests for the new client flow**

Update `test/portal-update.navigation.test.mjs` to require:

```js
assert.doesNotMatch(html, /I already completed it/);
assert.match(html, /Use Existing Agent ID Card/);
assert.match(html, /Get New Agent ID Card/);
assert.match(html, /\/api\/identity\/challenge/);
assert.match(html, /\/api\/identity\/session/);
assert.match(html, /https:\/\/api\.agentidcard\.org\/auth\/verify/);
assert.match(html, /https:\/\/clawtavern\.quest\/callback/);
assert.doesNotMatch(html, /window\.location\.origin\s*\+\s*["'`]\/callback/);
assert.doesNotMatch(html, /agentwar\.ail\.registered/);
```

- [ ] **Step 3: Run the tests to verify red state**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs
node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
```

Expected:
- new function tests fail because the challenge/session handlers do not exist yet
- navigation tests fail because the current HTML still uses `I already completed it` and local storage

- [ ] **Step 4: Commit the red baseline**

```bash
git add C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
git commit -m "test: add oauth callback patch coverage"
```

---

### Task 2: Implement server-side cookies, challenge issuance, and auth-code exchange

**Files:**
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\session-cookie.js`
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\ail-verifier.js`
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\challenge.js`
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\session.js`
- Test: `C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs`

- [ ] **Step 1: Implement signed-cookie utilities**

Add helpers:

```js
export async function issueSignedCookie(name, payload, secret, options = {}) {}
export async function readSignedCookie(cookieHeader, name, secret) {}
export function clearCookie(name, options = {}) {}
```

Rules:
- use HMAC signing with `CT_SESSION_SECRET`
- support `ct_ail_session`
- support short-lived `ct_ail_oauth_state`
- reject tampering and expiry
- set `HttpOnly; Secure; SameSite=Lax; Path=/`

- [ ] **Step 2: Implement the auth-exchange adapter**

In `ail-verifier.js`, add:

```js
export async function exchangeAilAuthCode(code, env, deps = {}) {
  const response = await (deps.fetch ?? fetch)("https://api.agentidcard.org/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      client_id: env.AIL_CLIENT_ID,
      client_secret: env.AIL_CLIENT_SECRET
    })
  });
  return normalizeExchangeResponse(response);
}
```

Normalize:
- `ail_id`
- `display_name`
- `role`
- `owner_org`
- `reputation` when present
- `expires` or equivalent expiry field

- [ ] **Step 3: Implement `POST /api/identity/challenge`**

Return:

```json
{ "ok": true, "state": "<random-hex>" }
```

and set a short-lived `ct_ail_oauth_state` cookie.

- [ ] **Step 4: Implement `GET/POST/DELETE /api/identity/session`**

`GET`
- read `ct_ail_session`
- return `{ verified: false }` or `{ verified: true, identity: ... }`

`POST`
- validate `{ code, state }`
- compare `state` with `ct_ail_oauth_state`
- exchange auth code using `AIL_CLIENT_ID + AIL_CLIENT_SECRET`
- issue `ct_ail_session`
- clear the consumed OAuth-state cookie

`DELETE`
- clear `ct_ail_session`

- [ ] **Step 5: Run focused function tests**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs
```

Expected:
- all challenge/session tests pass

- [ ] **Step 6: Commit**

```bash
git add C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\session-cookie.js C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\ail-verifier.js C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\challenge.js C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\session.js C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs
git commit -m "feat: add agent id oauth exchange session endpoints"
```

---

### Task 3: Add the `/callback` page and recovery transport

**Files:**
- Create: `C:\Users\sinmb\claw-tavern\portal-update\callback.html`
- Modify: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Add failing callback-route assertions**

Require:

```js
assert.match(callbackHtml, /Verification complete/i);
assert.match(callbackHtml, /postMessage/);
assert.match(callbackHtml, /code/);
assert.match(callbackHtml, /state/);
assert.match(callbackHtml, /clawtavern/i);
```

- [ ] **Step 2: Implement `portal-update/callback.html`**

The page must:
- parse `code`, `state`, and error params from `location.search`
- send a message to `window.opener` when available
- store a short-lived recovery payload if the opener path is unavailable
- close itself when safe, otherwise show a small completion/error message

Use a narrow payload shape:

```js
{
  type: "ail-oauth-complete",
  code,
  state,
  source: "clawtavern-callback"
}
```

- [ ] **Step 3: Run the navigation test suite**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
```

Expected:
- callback route assertions pass
- client-flow assertions still fail until the next task

- [ ] **Step 4: Commit**

```bash
git add C:\Users\sinmb\claw-tavern\portal-update\callback.html C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
git commit -m "feat: add agent id oauth callback page"
```

---

### Task 4: Rewire `/app/` and `/` to the new OAuth gate

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\app\index.html`
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\index.html`
- Modify: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Remove the old soft-gate controls**

Delete or replace:
- `AIL_REGISTER_URL`
- `AIL_COMPLETION_STORAGE_KEY`
- local storage reads and writes of `agentwar.ail.registered`
- `I already completed it`

- [ ] **Step 2: Add shared client constants**

Add explicit constants to both pages:

```js
const AIL_AUTH_URL = "https://api.agentidcard.org/auth/verify";
const AIL_WIDGET_URL = "https://api.agentidcard.org/widget.js";
const AIL_BADGE_URL = "https://api.agentidcard.org/badge.js";
const AIL_CLIENT_ID = "ail_client_c74c4d278959405297171e92bc76a559";
const AIL_REDIRECT_URI = "https://www.clawtavern.quest/callback";
```

Do not compute `AIL_REDIRECT_URI` from `window.location.origin`.

- [ ] **Step 3: Add client helpers**

Add:

```js
async function fetchIdentitySession() {}
async function createIdentityChallenge() {}
async function submitAuthCode(code, state) {}
function buildAilAuthUrl({ state, mode }) {}
function readStoredOauthRecovery() {}
function clearStoredOauthRecovery() {}
```

Behavior:
- `fetchIdentitySession()` gates every wallet-connect entry
- `createIdentityChallenge()` calls `POST /api/identity/challenge`
- `submitAuthCode()` calls `POST /api/identity/session`
- recovery helpers only transport the auth code back; they do not mark trust

- [ ] **Step 4: Replace the modal actions**

Marketplace and home modals should expose:
- `Get New Agent ID Card`
- `Use Existing Agent ID Card`
- `Close`

Both primary buttons:
- request a fresh challenge state
- open the same OAuth popup URL
- differ only in user-facing copy or `mode` tracking

- [ ] **Step 5: Handle callback completion**

On both pages:
- listen for `message` from same-origin callback page
- validate message type and local pending state
- call `submitAuthCode(code, state)`
- on success, close the identity modal and continue directly into the wallet flow
- on failure, show a toast and keep the wallet blocked

- [ ] **Step 6: Run navigation tests**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
```

Expected:
- all navigation tests pass
- no references remain to `I already completed it` or `agentwar.ail.registered`

- [ ] **Step 7: Commit**

```bash
git add C:\Users\sinmb\claw-tavern\portal-update\app\index.html C:\Users\sinmb\claw-tavern\portal-update\index.html C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
git commit -m "feat: rewire portal wallet gate to ail oauth flow"
```

---

### Task 5: Verify browser behavior and record the production blocker

**Files:**
- Modify if needed: `C:\Users\sinmb\claw-tavern\docs\superpowers\specs\2026-03-22-agent-id-card-oauth-callback-patch-design.md`
- Optional: `C:\Users\sinmb\claw-tavern\portal-update\wrangler.jsonc`

- [ ] **Step 1: Run the targeted test suites fresh**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs
node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
```

Expected:
- both suites pass fully

- [ ] **Step 2: Start a local Pages Functions smoke environment**

Run:

```bash
npx wrangler pages dev C:\Users\sinmb\claw-tavern\portal-update --port 8788
```

Expected:
- local Pages server starts without module or routing errors
- `/api/identity/challenge`
- `/api/identity/session`
- `/callback`
- `/`
- `/app/`
all resolve from the same dev environment

- [ ] **Step 3: Browser-QA the mocked flow**

Check at minimum:
- `/` opens the new 2-button modal before wallet connect
- `/app/` opens the new 2-button modal before wallet connect
- popup blocked path falls back cleanly
- callback recovery can resume wallet flow
- after mocked session creation, wallet UI proceeds to chooser or no-wallet branch

- [ ] **Step 4: Record the live OAuth blocker if unresolved**

Confirm production Pages continues to serve wallet entrypoints from `https://www.clawtavern.quest` so the registered origin and callback stay aligned.

- [ ] **Step 5: Commit final verification adjustments**

```bash
git add C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs C:\Users\sinmb\claw-tavern\portal-update C:\Users\sinmb\claw-tavern\docs\superpowers\specs\2026-03-22-agent-id-card-oauth-callback-patch-design.md
git commit -m "test: verify agent id oauth callback patch"
```
