# Portal AIL JWT Session Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the portal's browser-local Agent ID Card soft gate with a Cloudflare Pages Functions JWT verification session gate that must pass once before wallet connection on `/` and `/app/`.

**Architecture:** Add a same-origin identity API at `/api/identity/session` inside `portal-update/functions/`, backed by a signed `ct_ail_session` cookie and an Agent ID Card JWT verifier adapter. Update the brand home and Marketplace app so every disconnected wallet-connect path checks the server session first, opens the existing identity modal when missing, and only enters the existing wallet chooser flow after session verification succeeds.

**Tech Stack:** Cloudflare Pages Functions, inline HTML/JavaScript, Node `node:test`, Web Crypto HMAC signing, Cloudflare Pages secrets

---

## File Structure

- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\session.js`
  - Pages Functions route for `GET`, `POST`, and `DELETE /api/identity/session`
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\session-cookie.js`
  - pure helpers to sign, verify, serialize, and clear `ct_ail_session`
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\ail-verifier.js`
  - wraps Agent ID Card JWT verification behind one function
- Create: `C:\Users\sinmb\claw-tavern\portal-update\wrangler.jsonc`
  - Pages config for local dev and Functions bundling
- Create: `C:\Users\sinmb\claw-tavern\portal-update\.dev.vars.example`
  - local secret template only, no real secret values
- Modify: `C:\Users\sinmb\claw-tavern\.gitignore`
  - ignore `portal-update/.dev.vars`
- Modify: `C:\Users\sinmb\claw-tavern\package.json`
  - add any minimal dependency needed for Agent ID Card verification and local Pages dev
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\app\index.html`
  - replace local-storage trust with session API checks and JWT callback submission
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\index.html`
  - same session-gated wallet entry flow for brand home
- Create: `C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs`
  - unit tests for cookie signing, verifier seams, and route behavior
- Modify: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`
  - remove soft-gate assumptions and add server-session client expectations

### Runtime bindings

- `CT_SESSION_SECRET`
  - required signing secret for `ct_ail_session`
- optional verifier config if needed during implementation:
  - `AIL_VERIFY_MODE`
  - `AIL_VERIFY_ENDPOINT`

Keep the public client contract stable even if the verifier internals change.

---

### Task 1: Scaffold the Pages Functions surface and lock the failing tests

**Files:**
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\session.js`
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\session-cookie.js`
- Create: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\ail-verifier.js`
- Create: `C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs`
- Modify: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Write the failing function tests**

Add `node:test` cases that require:

```js
test("POST issues a signed cookie after verifier success", async () => {
  const response = await onRequestPost(
    makeContext({
      env: { CT_SESSION_SECRET: "test-secret" },
      body: { jwt: "valid.jwt" },
      verifyResult: { valid: true, ail_id: "AIL-2026-00001", display_name: "ClaudeCoder", expires_at: "2027-03-17T00:00:00Z" }
    })
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /ct_ail_session=/);
});
```

Also add failures for:
- invalid JWT
- expired JWT
- missing secret
- `GET` with and without a valid cookie
- `DELETE` clearing the cookie

- [ ] **Step 2: Write the failing client regression tests**

Update `test/portal-update.navigation.test.mjs` so it now expects:

```js
assert.match(html, /fetch\("\/api\/identity\/session"/);
assert.doesNotMatch(html, /agentwar\.ail\.registered[^]*ensureConfiguredNetwork/);
assert.match(html, /async function submitAilJwt\(/);
assert.match(html, /e\.origin === "https:\/\/www\.agentidcard\.org"/);
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs
node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
```

Expected:
- identity-session test fails because the Functions files do not exist yet
- navigation test fails because the HTML still trusts local storage

- [ ] **Step 4: Create the minimal route and helper skeletons**

Add empty but importable modules:

```js
export async function onRequestGet(context) {
  throw new Error("not implemented");
}

export async function onRequestPost(context) {
  throw new Error("not implemented");
}

export async function onRequestDelete(context) {
  throw new Error("not implemented");
}
```

- [ ] **Step 5: Commit the red-state test baseline**

```bash
git add C:\Users\sinmb\claw-tavern\portal-update\functions C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
git commit -m "test: add failing portal identity session coverage"
```

---

### Task 2: Add config, secret plumbing, and cookie-signing utilities

**Files:**
- Create: `C:\Users\sinmb\claw-tavern\portal-update\wrangler.jsonc`
- Create: `C:\Users\sinmb\claw-tavern\portal-update\.dev.vars.example`
- Modify: `C:\Users\sinmb\claw-tavern\.gitignore`
- Modify: `C:\Users\sinmb\claw-tavern\package.json`
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\session-cookie.js`
- Test: `C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs`

- [ ] **Step 1: Add the local Pages config**

Create `portal-update/wrangler.jsonc` with a minimal Pages config:

```json
{
  "name": "clawtavern-portal",
  "compatibility_date": "2026-03-21",
  "pages_build_output_dir": ".",
  "compatibility_flags": ["nodejs_compat"]
}
```

- [ ] **Step 2: Add local-secret scaffolding**

Create `portal-update/.dev.vars.example`:

```env
CT_SESSION_SECRET=replace-with-local-dev-secret
```

Update `.gitignore`:

```gitignore
portal-update/.dev.vars
portal-update/.dev.vars.*
```

- [ ] **Step 3: Document the production secret provisioning step**

Before any deploy verification, provision the Cloudflare Pages secret:

```bash
npx wrangler pages secret put CT_SESSION_SECRET --project-name clawtavern-portal
```

Expected:
- Wrangler prompts for the secret value
- the secret is stored in the `clawtavern-portal` Pages project

If the installed Wrangler build does not support `pages secret put`, set the same secret in the Cloudflare Pages dashboard and note that fallback in the task log.

- [ ] **Step 4: Implement signed-cookie helpers**

In `session-cookie.js`, add pure functions:

```js
export async function issueSessionCookie(payload, secret) {}
export async function readSessionCookie(cookieHeader, secret) {}
export function clearSessionCookie() {}
```

Rules:
- HMAC-sign the serialized payload
- reject tampered or expired cookies
- cap session expiry to `Math.min(jwtExpiry, now + 24h)`

- [ ] **Step 5: Run the focused cookie tests**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs --test-name-pattern "cookie|secret|GET|DELETE"
```

Expected:
- cookie-related assertions pass
- verifier-related assertions still fail until the next task

- [ ] **Step 6: Commit**

```bash
git add C:\Users\sinmb\claw-tavern\portal-update\wrangler.jsonc C:\Users\sinmb\claw-tavern\portal-update\.dev.vars.example C:\Users\sinmb\claw-tavern\.gitignore C:\Users\sinmb\claw-tavern\package.json C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\session-cookie.js C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs
git commit -m "feat: add portal identity session cookie scaffolding"
```

---

### Task 3: Implement the Agent ID Card verifier adapter and session route

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\package.json`
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\ail-verifier.js`
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\session.js`
- Test: `C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs`

- [ ] **Step 1: Add the failing verifier tests**

Require the adapter to normalize upstream verification into one shape:

```js
{
  valid: true,
  ail_id: "AIL-2026-00001",
  display_name: "ClaudeCoder",
  expires_at: "2027-03-17T00:00:00Z"
}
```

Also require:
- invalid JWT returns `{ valid: false, reason: "invalid" }`
- expired JWT returns `{ valid: false, reason: "expired" }`

- [ ] **Step 2: Add the minimal verification adapter**

Implement:

```js
export async function verifyAilJwt(jwt, env, deps = {}) {
  const client = deps.client ?? createAilClient(env);
  const result = await client.verify(jwt);
  return normalizeVerifyResult(result);
}
```

Notes:
- prefer the official `@agentidcard/sdk` verification path first
- keep all SDK-specific code inside `ail-verifier.js`
- do not let HTML files know anything about SDK details

- [ ] **Step 3: Implement the session route**

Implement `session.js` so:

```js
export async function onRequestPost(context) {
  const { jwt } = await context.request.json();
  const verification = await verifyAilJwt(jwt, context.env);
  if (!verification.valid) return json({ ok: false }, { status: 401 });

  const setCookie = await issueSessionCookie(verification, context.env.CT_SESSION_SECRET);
  return json({ ok: true, verified: true, identity: verification }, { headers: { "Set-Cookie": setCookie } });
}
```

Also implement:
- `GET`: reads cookie and returns `{ verified, identity }`
- `DELETE`: clears cookie and returns `{ ok: true }`

- [ ] **Step 4: Run the function test suite**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs
```

Expected:
- all route and verifier tests pass

- [ ] **Step 5: Local function smoke**

Run from `C:\Users\sinmb\claw-tavern\portal-update`:

```bash
npx wrangler pages dev . --local --port 8788
```

Then verify in another shell:

```bash
curl.exe -i http://127.0.0.1:8788/api/identity/session
```

Expected:
- HTTP 200 for `GET`
- JSON body with `verified: false` before any cookie is set

- [ ] **Step 6: Commit**

```bash
git add C:\Users\sinmb\claw-tavern\package.json C:\Users\sinmb\claw-tavern\portal-update\functions\_lib\ail-verifier.js C:\Users\sinmb\claw-tavern\portal-update\functions\api\identity\session.js C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs
git commit -m "feat: add portal Agent ID Card session API"
```

---

### Task 4: Replace browser-local trust with server-session checks in both UIs

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\app\index.html`
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\index.html`
- Modify: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Update the failing client tests first**

Require both HTML entry points to include:

```js
async function fetchIdentitySession() {}
async function submitAilJwt(jwt) {}
window.addEventListener("message", (e) => {
  if (e.origin === "https://www.agentidcard.org" && e.data?.type === "ail-registered") {
    submitAilJwt(e.data.jwt);
  }
});
```

Also require:
- `Connect Wallet` checks `fetchIdentitySession()` before `ensureConfiguredNetwork()` or `discoverWallets()`
- bootstrap auto-connect checks session first
- `I already completed it` no longer writes `agentwar.ail.registered = "true"`

- [ ] **Step 2: Implement the shared client helpers**

Add to both HTML files:

```js
async function fetchIdentitySession() {
  const response = await fetch("/api/identity/session", { credentials: "same-origin" });
  return response.json();
}

async function submitAilJwt(jwt) {
  const response = await fetch("/api/identity/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jwt })
  });
  return response.json();
}
```

- [ ] **Step 3: Rewire the modal behavior**

Change the modal so:
- `Issue Agent ID Card` opens the popup
- popup callback submits JWT to the session endpoint
- `I already completed it` triggers a re-check of the session instead of granting trust locally
- wallet connect remains blocked until `verified === true`

- [ ] **Step 4: Run the client regression suite**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
```

Expected:
- all navigation and client-gating assertions pass

- [ ] **Step 5: Commit**

```bash
git add C:\Users\sinmb\claw-tavern\portal-update\app\index.html C:\Users\sinmb\claw-tavern\portal-update\index.html C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
git commit -m "feat: gate portal wallet connect behind verified identity session"
```

---

### Task 5: Run end-to-end verification and capture deployment prerequisites

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\docs\superpowers\plans\2026-03-21-marketplace-identity-gate.md`
- Test: `C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs`
- Test: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Run all automated tests**

Run:

```bash
node --test C:\Users\sinmb\claw-tavern\test\portal-update.identity-session.test.mjs
node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs
```

Expected:
- both test files pass with 0 failures

- [ ] **Step 2: Run browser smoke checks**

Run local Pages dev from `C:\Users\sinmb\claw-tavern\portal-update`, then verify:

- `http://127.0.0.1:8788/`
- `http://127.0.0.1:8788/app/#find-agent`

Confirm:
- `Connect Wallet` shows the identity gate when no session exists
- mocked or real verified session allows wallet connect to continue
- no console errors beyond known Tailwind warnings

- [ ] **Step 3: Confirm deployment prerequisites**

Before any deploy claim, verify:

```bash
npx wrangler pages secret put CT_SESSION_SECRET --project-name clawtavern-portal
```

Then record whether these are present:
- `portal-update/wrangler.jsonc`
- `portal-update/functions/...`
- Cloudflare Pages secret `CT_SESSION_SECRET`

- [ ] **Step 4: Summarize evidence**

Capture:
- exact commands run
- whether local function smoke passed
- whether browser wallet gating matched the spec
- whether any upstream Agent ID Card callback dependency remains blocked

- [ ] **Step 5: Commit any final verification-only doc touches**

```bash
git add C:\Users\sinmb\claw-tavern\docs\superpowers\plans\2026-03-21-marketplace-identity-gate.md
git commit -m "docs: finalize portal identity gate execution notes"
```
