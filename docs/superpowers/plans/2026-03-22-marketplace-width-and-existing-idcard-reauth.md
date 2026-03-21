# Marketplace Width + Existing Agent ID Card Re-Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the Marketplace desktop shell to `1200px` and add an explicit existing-Agent-ID-Card re-authentication path while preserving the Task 41 server-session gate.

**Architecture:** Keep the current Pages Functions session model intact and limit all client work to the inline portal HTML files plus static regression coverage. `/app/` gets the new shell width, while both `/app/` and `/` get parallel identity-modal CTA/copy updates and broadened JWT message-origin handling for Agent ID Card callbacks.

**Tech Stack:** Inline HTML/JavaScript, Cloudflare Pages Functions session API, Node `node:test`, Playwright CLI browser QA

---

## File Structure

- Modify: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\portal-update\app\index.html`
  - tighten Marketplace shell width to `max-w-[1200px]`
  - add `Get New Agent ID Card` and `Use Existing Agent ID Card` CTAs
  - update helper copy for the three user intents
  - allow Agent ID Card callback `postMessage` from both `https://www.agentidcard.org` and `https://api.agentidcard.org`
  - keep `submitAilJwt(jwt)` as the single session-creation path
- Modify: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\portal-update\index.html`
  - keep current shell width
  - mirror the new modal CTA/copy structure and widened allowed origins
- Modify: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs`
  - add failing static expectations for width, CTA labels, copy, and accepted origins

## Task 1: Lock the New Width + Re-Auth Requirements in Tests

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Add failing Marketplace width assertions**

```js
assert.match(html, /max-w-\[1200px\]/);
assert.doesNotMatch(html, /max-w-7xl/);
```

- [ ] **Step 2: Add failing identity CTA and copy assertions**

```js
assert.match(html, />Get New Agent ID Card</);
assert.match(html, />Use Existing Agent ID Card</);
assert.match(html, />I already completed it</);
assert.match(html, /If you already have an Agent ID Card, you can sign in with it and continue\./);
```

- [ ] **Step 3: Add failing allowed-origin assertions for both portal entry points**

```js
assert.match(html, /TRUSTED_AIL_ORIGINS = new Set/);
assert.match(html, /TRUSTED_AIL_ORIGINS\.has\(e\.origin\)/);
assert.match(html, /https:\/\/www\.agentidcard\.org/);
assert.match(html, /https:\/\/api\.agentidcard\.org/);
assert.match(brandHome, /TRUSTED_AIL_ORIGINS = new Set/);
assert.match(brandHome, /TRUSTED_AIL_ORIGINS\.has\(e\.origin\)/);
assert.match(brandHome, /https:\/\/www\.agentidcard\.org/);
assert.match(brandHome, /https:\/\/api\.agentidcard\.org/);
```

- [ ] **Step 4: Run the navigation suite to verify RED**

Run: `node --test C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs`

Expected: FAIL on missing CTA labels, copy, width, and/or origin support

- [ ] **Step 5: Commit the red-state test changes**

```bash
git add C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs
git commit -m "test: add width and id card reauth coverage"
```

---

## Task 2: Implement the Marketplace Width and Three-Intent Identity Modal

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\portal-update\app\index.html`
- Test: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Replace the Marketplace shell width**

Update the top shell and main content container from the current width class to:

```html
max-w-[1200px]
```

- [ ] **Step 2: Replace the existing two-button modal action row with three actions**

Use this structure:

```html
<button id="marketplace-identity-open">Get New Agent ID Card</button>
<button id="marketplace-identity-existing">Use Existing Agent ID Card</button>
<button id="marketplace-identity-complete">I already completed it</button>
```

- [ ] **Step 3: Update modal copy to distinguish new issuance, existing-card sign-in, and local re-check**

Use copy matching the approved spec:

```html
Complete Agent ID Card verification before connecting a wallet. If you already have an Agent ID Card, you can sign in with it and continue.
```

- [ ] **Step 4: Add a shared helper for the upstream Agent ID Card entry point**

Use a small helper that always opens:

```js
const AIL_AUTH_URL = "https://api.agentidcard.org/register";
```

and call it from:
- `Get New Agent ID Card`
- `Use Existing Agent ID Card`

The helper copy can differ, but the upstream URL stays the same for this task.

- [ ] **Step 5: Keep `I already completed it` as a session re-check, then continue directly into wallet connect**

Preserve the current pattern:

```js
const session = await fetchIdentitySession();
if (session?.verified) {
  await continueWalletConnectAfterIdentity();
  return;
}
```

- [ ] **Step 6: Widen accepted callback origins without weakening the message contract**

Implement a small origin guard like:

```js
const TRUSTED_AIL_ORIGINS = new Set([
  "https://www.agentidcard.org",
  "https://api.agentidcard.org"
]);
```

and require both:
- origin in the allowlist
- `e.data?.type === "ail-registered"`

- [ ] **Step 7: Keep the JWT flow unchanged after validation**

Preserve:

```js
const session = await submitAilJwt(jwt);
if (session?.verified) {
  await continueWalletConnectAfterIdentity();
}
```

- [ ] **Step 8: Run the navigation suite to verify GREEN**

Run: `node --test C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs`

Expected: PASS

- [ ] **Step 9: Commit the Marketplace implementation**

```bash
git add C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\portal-update\app\index.html C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs
git commit -m "feat: tighten marketplace shell and add existing id card reauth"
```

---

## Task 3: Mirror the Identity Modal Behavior on Brand Home

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\portal-update\index.html`
- Modify: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Update the home identity modal to match the new three-intent CTA structure**

Use:

```html
<button id="identity-open">Get New Agent ID Card</button>
<button id="identity-existing">Use Existing Agent ID Card</button>
<button id="identity-complete">I already completed it</button>
```

- [ ] **Step 2: Update the home modal copy to explain existing-card sign-in**

Keep the same product language as `/app/`, but do not change the home shell width.

- [ ] **Step 3: Add the same upstream helper and trusted-origin allowlist on `/`**

Use the same:

```js
const AIL_AUTH_URL = "https://api.agentidcard.org/register";
const TRUSTED_AIL_ORIGINS = new Set([...]);
```

- [ ] **Step 4: Preserve the same server-session behavior on `/`**

Keep:
- `fetchIdentitySession()` for re-check
- `submitAilJwt(jwt)` for session creation
- direct continuation after session verification succeeds

- [ ] **Step 5: Re-run the navigation suite**

Run: `node --test C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs`

Expected: PASS with `/` and `/app/` expectations aligned

- [ ] **Step 6: Commit the home parity update**

```bash
git add C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\portal-update\index.html C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs
git commit -m "feat: align home id card reauth modal with marketplace"
```

---

## Task 4: Full Verification and Browser QA

**Files:**
- Test: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.identity-session.test.mjs`
- Test: `C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Run the identity-session suite**

Run: `node --test C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.identity-session.test.mjs`

Expected: PASS (`25/25` or current total if expanded)

- [ ] **Step 2: Run the navigation suite**

Run: `node --test C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs`

Expected: PASS

- [ ] **Step 3: Perform browser QA on `/app/`**

Verify:
- shell feels tighter at desktop width
- `Connect Wallet` opens the updated three-intent modal
- `I already completed it` still goes straight into wallet chooser after a mocked valid session
- `Use Existing Agent ID Card` opens `https://api.agentidcard.org/register`

- [ ] **Step 4: Perform browser QA on `/`**

Verify:
- home width is unchanged
- updated three-intent modal appears
- existing-card CTA uses the same upstream entry point

- [ ] **Step 5: Commit the final verification snapshot if code changed during QA**

```bash
git add C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\portal-update\app\index.html C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\portal-update\index.html C:\Users\sinmb\claw-tavern\.worktrees\codex-deploy-task40-41-main\test\portal-update.navigation.test.mjs
git commit -m "test: verify width and id card reauth flow"
```
