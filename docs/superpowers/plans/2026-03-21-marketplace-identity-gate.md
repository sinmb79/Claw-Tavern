# Portal Identity Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the portal requirement that Agent ID Card completion must happen before wallet connection on both the brand home and Marketplace app.

**Architecture:** Reuse the existing Agent War browser-local Agent ID Card pattern in both the Marketplace app and the brand home. Each `Connect Wallet` handler will check the shared AIL completion key first, open an identity modal when missing, and only call the existing wallet/network flow after the gate passes.

**Tech Stack:** Single-file HTML app, inline JavaScript, inline Tailwind classes, Node `node:test` static regression tests

---

### Task 1: Add failing regression tests for the portal identity gate

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`
- Test: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Write the failing test**

Add assertions that require:
- a Marketplace identity modal shell
- a brand-home identity gate
- the shared `agentwar.ail.registered` storage key
- the Agent ID Card registration URL
- wallet click handling to call an identity gate before `ensureConfiguredNetwork()`

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`
Expected: FAIL because the portal wallet entry points still connect wallets directly.

- [ ] **Step 3: Write minimal implementation**

Implement only the markup and JavaScript needed to satisfy the tests and preserve the current wallet logic after the gate passes.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`
Expected: PASS

### Task 2: Add identity gate UI and shared AIL helpers

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\app\index.html`
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\index.html`

- [ ] **Step 1: Add the failing UI expectation**

Add modal-specific test expectations first if Task 1 did not fully cover copy and controls.

- [ ] **Step 2: Implement the modal shell**

Add a modal with:
- identity title / explanation
- `Issue Agent ID Card`
- `I already completed it`
- `Close`

- [ ] **Step 3: Implement shared helper functions**

Add:
- shared registration URL constant
- shared local-storage key constant
- popup opener with centered positioning and new-tab fallback
- `markMarketplaceAILRegistered()`
- `isMarketplaceAILRegistered()`

- [ ] **Step 4: Verify the tests still pass**

Run: `node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`
Expected: PASS

### Task 3: Gate portal wallet entry points behind identity completion

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\app\index.html`
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\index.html`
- Test: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Write the failing behavior test**

Assert that the connect-wallet handler checks identity completion before calling `ensureConfiguredNetwork()`.

- [ ] **Step 2: Implement the minimal gate**

Change the wallet handlers so:
- connected sessions can still disconnect directly
- disconnected sessions must pass the AIL gate first
- only then call the existing wallet/network flow

- [ ] **Step 3: Bind modal actions**

Wire:
- open popup
- mark completion
- close modal

- [ ] **Step 4: Run tests**

Run: `node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`
Expected: PASS

### Task 4: Run final verification for the regression

**Files:**
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\app\index.html`
- Modify: `C:\Users\sinmb\claw-tavern\portal-update\index.html`
- Test: `C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`

- [ ] **Step 1: Run static regression tests**

Run: `node --test C:\Users\sinmb\claw-tavern\test\portal-update.navigation.test.mjs`
Expected: PASS with 0 failures

- [ ] **Step 2: Run browser smoke verification**

Run a local browser smoke check against `/app/#find-agent` and `/` and confirm:
- identity modal appears before wallet connect
- no console errors
- existing wallet-no-provider fallback still works after the gate path

- [ ] **Step 3: Summarize verification evidence**

Report the commands run and the observed result before any deployment claim.
