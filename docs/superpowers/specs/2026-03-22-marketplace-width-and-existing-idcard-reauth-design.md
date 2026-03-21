# Marketplace Width + Existing Agent ID Card Re-Auth Design

**Date:** 2026-03-22

## Goal

Tighten the Marketplace page width so the main content no longer feels overly stretched on wide desktop screens, and add a clear re-authentication path for users who already own an Agent ID Card.

This work must preserve the Task 41 security model:

- wallet connect remains blocked until the browser has a verified same-origin identity session
- the portal still trusts the server-issued session cookie, not local storage
- the gate still runs once before wallet connection rather than before every write action

## Current Problems

### 1. Marketplace still feels too wide

The current `/app/` shell uses a width that is visually looser than desired on large desktop screens. Even after the previous reduction, the page still reads as broader than the intended product feel for a focused marketplace.

### 2. Existing Agent ID Card owners do not have a clear re-auth path

The current modal gives users:

- `Issue Agent ID Card`
- `I already completed it`

That is not enough for users who already have an Agent ID Card and want to authenticate with it again. The second button only re-checks whether a valid session already exists in the current browser. It does not communicate a distinct “log in with my existing Agent ID Card” flow.

## Product Decision

The Marketplace wallet gate should support three distinct user intents:

1. I need to create a new Agent ID Card
2. I already have an Agent ID Card and want to authenticate with it again
3. I already finished the flow in another tab and want this page to re-check the session

These are different user states and should be represented explicitly in the modal.

## Scope

- `portal-update/app/index.html`
- `test/portal-update.navigation.test.mjs`
- optional follow-up parity on `portal-update/index.html` only if we decide to keep both entry points visually and behaviorally aligned in the same task

Out of scope:

- Cloudflare Functions contract changes
- Agent ID Card verifier changes
- Agent War identity flow
- per-action identity prompts after wallet connection

## Layout Decision

The Marketplace shell should use a `1200px` content width target.

Implementation rule:

- top sticky shell container: `max-w-[1200px]`
- main content container: `max-w-[1200px]`

Rationale:

- narrower than the current live Marketplace
- still roomy enough for the card grid and desktop search/header layout
- closer to the product feel the user wants without collapsing into a cramped layout

This width change applies only to the Marketplace app in this task.

## Identity Modal Decision

Replace the current two-action framing with three clearly named actions:

- `Get New Agent ID Card`
- `Use Existing Agent ID Card`
- `I already completed it`

### Button meanings

#### `Get New Agent ID Card`

Opens the official Agent ID Card registration flow for users who do not yet have a credential.

#### `Use Existing Agent ID Card`

Opens the official Agent ID Card owner login flow for users who already have a credential and need to authenticate again.

Portal rule:

- if Agent ID Card exposes a stable dedicated login entry URL, use that URL
- otherwise use the existing official registration page, but the modal copy must explain that the page also supports existing-owner login

The portal side does not need a separate verification contract for existing users. It only needs a way to receive a fresh JWT after the upstream login flow finishes.

#### `I already completed it`

This remains a local re-check action only.

Meaning:

- the user already finished registration or login in another tab
- the portal should poll or re-check the same-origin identity session
- if the session is valid, the page should continue directly into wallet connect
- if the session is still missing, the modal stays open and explains the next step clearly

This button must not pretend to authenticate the user by itself.

## Identity Flow

### New user flow

1. User clicks `Connect Wallet`
2. Portal checks `GET /api/identity/session`
3. If no valid session exists, modal opens
4. User clicks `Get New Agent ID Card`
5. Agent ID Card completes registration and returns a JWT
6. Portal sends JWT to `submitAilJwt(jwt)`
7. Verified session is created
8. Portal continues directly into wallet chooser / wallet connect

### Existing card holder flow

1. User clicks `Connect Wallet`
2. Portal checks `GET /api/identity/session`
3. If no valid session exists, modal opens
4. User clicks `Use Existing Agent ID Card`
5. Agent ID Card existing-owner login flow completes and returns a JWT
6. Portal sends JWT to `submitAilJwt(jwt)`
7. Verified session is created
8. Portal continues directly into wallet chooser / wallet connect

### Completed-in-another-tab flow

1. User already finished the upstream Agent ID Card flow elsewhere
2. User returns and clicks `I already completed it`
3. Portal calls `fetchIdentitySession()`
4. If verified, portal immediately continues into wallet chooser / wallet connect
5. If not verified, modal remains open and instructs the user to finish either:
   - new card issuance, or
   - existing card login

## UX Copy Direction

The modal should no longer imply that every user needs a brand-new card.

Recommended body copy:

`Complete Agent ID Card verification before connecting a wallet. If you already have an Agent ID Card, you can sign in with it and continue.`

Recommended helper copy:

`Use the existing-card option if you already received an Agent ID Card before. Use the re-check button only after you finish the upstream flow in another tab.`

## Portal Behavior Requirements

### Must preserve

- `submitAilJwt(jwt)` as the single client entry point for both new-card and existing-card flows
- `fetchIdentitySession()` as the source of truth for `I already completed it`
- direct continuation into wallet connect after session verification succeeds

### Must not do

- must not restore local-storage-based trust
- must not treat `I already completed it` as proof of identity by itself
- must not require a second manual `Connect Wallet` click after successful re-check

## Testing Requirements

### Static regression coverage

- app shell width uses `max-w-[1200px]` at the top shell and main container
- modal includes all three actions
- modal text references both new-card issuance and existing-card use
- existing session re-check still routes through `fetchIdentitySession()`
- successful session confirmation still routes into wallet connect without a second manual connect click

### Browser QA

- wide desktop viewport shows noticeably tighter centered layout
- `Connect Wallet` opens the updated modal
- `I already completed it` with a valid mocked session goes directly to wallet chooser
- existing-card CTA opens the intended upstream entry point

## Acceptance Criteria

- Marketplace desktop width is reduced to a `1200px` shell target
- users with an existing Agent ID Card see an explicit re-authentication path
- the modal clearly distinguishes new issuance, existing-card sign-in, and local session re-check
- successful re-check or JWT return continues directly into wallet connect
- Task 41 server-session identity model remains intact
