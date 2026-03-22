# Claw Tavern Agent ID Card OAuth Callback Patch Design

**Date:** 2026-03-22

## Goal

Patch the existing Claw Tavern Agent ID Card integration to the new OAuth-style popup flow without exposing `client_secret`, while preserving the current product boundary:

- Agent ID Card verification gates wallet connection
- verified session unlocks wallet connect
- no durable `ail_id -> user/account` database mapping is added in this task

## Approved Product Decision

This task upgrades the current soft gate into the new official OAuth flow:

- browser opens Agent ID Card verification popup
- Agent ID Card returns an auth code to the registered callback
- Claw Tavern submits the auth code to a server-side exchange endpoint
- Pages Functions exchange the auth code with `client_id + client_secret`
- server issues the signed Claw Tavern verification session cookie
- wallet connect proceeds only after the verified session exists

The old direct frontend verification pattern must be removed. The browser must never self-declare verification.

## Current Codebase Reality

The current production portal still uses the old browser-local pattern:

- `/` and `/app/` show `Issue Agent ID Card` plus `I already completed it`
- `I already completed it` acts as a self-asserted trust shortcut
- no durable backend account mapping for `ail_id` exists in this repository

That means the migration rule is interpreted narrowly for this codebase:

- users do not need to mint a new Agent ID Card
- existing card holders can re-verify through the new OAuth flow
- the verified result is stored in the Claw Tavern signed session cookie
- long-term account linkage remains out of scope until a real backend store exists

## Critical Redirect Constraint

The issued Claw Tavern production client is:

- `client_id`: `ail_client_c74c4d278959405297171e92bc76a559`
- `allowed_origin`: `https://www.clawtavern.quest`
- `redirect_uri`: `https://www.clawtavern.quest/callback`

This creates two hard rules:

1. Claw Tavern must use `/callback` exactly for the OAuth return path.
2. The live product must launch verification from `https://www.clawtavern.quest` so the opener origin and callback origin remain aligned.

This blocker is now resolved because a dedicated `www` production client has been issued for the current live site.

## Scope

In scope:

- `portal-update/index.html`
- `portal-update/app/index.html`
- `portal-update/callback.html` served as `/callback`
- `portal-update/functions/api/identity/challenge.js`
- `portal-update/functions/api/identity/session.js`
- `portal-update/functions/_lib/ail-verifier.js`
- session-cookie reuse from Task 41
- UI copy and control changes required by the new flow
- regression tests for session exchange and navigation gating

Out of scope:

- durable database storage for `ail_id`
- user profile/account merge logic beyond the signed session
- Agent War migration
- Koinara implementation in this repository
- any callback path other than `/callback`

## Frontend Integration Design

### Scripts

Both portal surfaces load the official public scripts:

- `https://api.agentidcard.org/widget.js`
- `https://api.agentidcard.org/badge.js`

The public `client_id` may be present in frontend code. `client_secret` must remain server-only.

### Surfaces

Two surfaces share the same same-origin verification session:

- brand home: `/`
- marketplace app: `/app/`

Both surfaces must expose the same identity behavior before wallet connect.

### Identity Modal

Replace the old modal actions with:

- `Get New Agent ID Card`
- `Use Existing Agent ID Card`
- `Close`

Explicitly remove:

- `I already completed it`

Reason: existing card holders must complete official re-authentication, not a local self-declaration.

### Button Semantics

- `Get New Agent ID Card`
  - opens the official OAuth popup using the registered `client_id`
  - requests at least `identity`
- `Use Existing Agent ID Card`
  - opens the same official OAuth popup
  - copy explains that this is for already-issued cards
- both actions end in the same callback and auth-code exchange flow

The product difference is UX framing, not protocol shape.

### OAuth Parameters

The popup flow must initialize with:

- exact `client_id`
- exact `redirect_uri = https://www.clawtavern.quest/callback` in production
- `scope = identity` by default
- `state` generated per launch for CSRF protection

`identity+reputation` may be added later only if the UI actually consumes reputation data.

The client must not derive the redirect URI from `window.location.origin`. The redirect URI has to be injected from configuration as the exact registered value, otherwise the live `www` host will generate an invalid OAuth request.

### Popup and Recovery Behavior

Preferred path:

1. opener requests a signed OAuth challenge
2. opener launches Agent ID Card popup
3. callback page receives `code` and `state`
4. callback page sends the payload to the opener with `postMessage`
5. opener performs local `state` sanity check
6. opener posts `{ code }` to `/api/identity/session`
7. opener proceeds to wallet flow after verified session returns

Fallback path for popup/opener loss:

- callback page stores a short-lived recovery payload containing the one-time `code`, `state`, and timestamp
- original tab checks for that recovery payload when the user returns
- recovery storage is only a transport fallback, never a trust signal

## Callback Route Design

Add a dedicated callback document:

- file: `portal-update/callback.html`
- public route: `/callback`

Responsibilities:

- parse `code`, `state`, and provider error parameters from the query string
- reject callback payloads with missing required fields
- send the auth code back to the opener when available
- persist short-lived recovery payload when opener messaging is unavailable
- present minimal completion UI such as `Verification complete, return to Claw Tavern`

This route is intentionally browser-facing. It does not perform the secret exchange itself.

## Backend Exchange Design

### Session Endpoint

`POST /api/identity/challenge`

Server behavior:

1. generate a random challenge state
2. sign it with the existing server secret material
3. set a short-lived `ct_ail_oauth_state` cookie
4. return the raw `state` value for popup launch

This gives the browser an exact state value to send to Agent ID Card while preserving a server-side comparison target.

### Session Endpoint

`POST /api/identity/session`

Request body:

```json
{
  "code": "<auth_code>",
  "state": "<csrf_state>"
}
```

Server behavior:

1. validate request shape
2. validate caller-provided `state` against the signed `ct_ail_oauth_state` cookie
3. call `POST https://api.agentidcard.org/auth/exchange`
4. send:
   - `code`
   - `client_id`
   - `client_secret`
5. normalize the identity response
6. issue signed `ct_ail_session` cookie
7. return `{ verified: true, identity: ... }`

### Stored Session Data

The signed session cookie may contain:

- `ail_id`
- `display_name`
- `role`
- `owner_org`
- `reputation` only when scope includes it
- `verified_at`
- `expires_at`

No long-term database write is added in this task.

### Verification Library

`portal-update/functions/_lib/ail-verifier.js`

Responsibilities:

- exchange auth code at `POST https://api.agentidcard.org/auth/exchange`
- enforce presence of server env bindings
- normalize upstream success and failure shapes
- fail closed on malformed or unavailable upstream responses

### Secret Handling

Cloudflare Pages env bindings:

- `AIL_CLIENT_ID`
- `AIL_CLIENT_SECRET`
- existing `CT_SESSION_SECRET`

`AIL_CLIENT_SECRET` must be read only inside Pages Functions. It must not appear in:

- frontend HTML
- client-side JS constants
- test fixtures committed to git
- docs intended for public sharing

## State and CSRF Design

Each verification attempt generates a random `state` in the opener context.

Rules:

- issue `state` from `POST /api/identity/challenge`
- store a matching signed short-lived server cookie
- keep the pending `state` in opener memory for local sanity checks only
- callback payload must echo the same `state`
- mismatch means reject and keep wallet connect blocked
- consumed `state` must be deleted immediately after success or failure on both client and server

`state` validation is mandatory even when the callback uses `postMessage`.

## Wallet Gate Behavior

The gate remains a pre-wallet choke point only.

Allowed path:

1. user clicks `Connect Wallet`
2. client calls `GET /api/identity/session`
3. verified session present:
   - continue directly to wallet chooser or `eth_requestAccounts`
4. no verified session:
   - open Agent ID Card modal
5. successful OAuth exchange:
   - continue wallet flow immediately

Explicit non-behavior:

- no write action re-checks the session after wallet connection
- no `localStorage["agentwar.ail.registered"]` or similar local flag can unlock wallet access

## Local Development Rule

The production client is registered only for:

- origin: `https://clawtavern.quest`
- callback: `https://www.clawtavern.quest/callback`

Therefore:

- local implementation and tests should use mocks for real OAuth responses
- real end-to-end OAuth can only be validated on the registered production origin
- if local real-provider testing is required later, a separate localhost client registration is needed

## Error Handling

- missing public client id:
  - fail closed
  - show configuration error toast
- popup blocked:
  - open a new tab fallback
  - instruct the user to finish verification and return
- callback without code:
  - show verification failed message
- state mismatch:
  - reject exchange
  - require restart of the verification flow
- upstream exchange failure:
  - keep wallet blocked
  - show temporary verification error
- verified session but no wallet provider:
  - preserve existing no-wallet behavior

## Testing Strategy

### Function tests

- challenge endpoint issues a state value plus short-lived signed cookie
- valid auth code exchange issues a signed session cookie
- invalid exchange response returns failure and no cookie
- mismatched or missing state is rejected before exchange
- missing env bindings fail closed
- `GET /api/identity/session` returns verified only with a valid cookie
- `DELETE /api/identity/session` clears the cookie

### Client tests

- `/` and `/app/` open the OAuth identity gate before wallet connect
- `I already completed it` no longer exists
- both `Get New` and `Use Existing` launch the official OAuth flow
- callback recovery path can resume the wallet gate after a successful code return
- client uses `/callback`, not `/api/identity/callback`
- local storage is not used as proof of verification

### Browser QA

- popup flow from `/`
- popup flow from `/app/`
- callback page shows expected completion state
- successful verification proceeds directly into wallet selection

## Acceptance Criteria

- Claw Tavern no longer uses the old direct frontend verification pattern
- `/` and `/app/` both use the new OAuth popup -> auth code -> server exchange flow
- the only production callback route is `/callback`
- `client_secret` stays server-side
- existing Agent ID Card holders can verify through `Use Existing Agent ID Card`
- wallet connect remains blocked until the verified Claw Tavern session exists
- no durable account-mapping database is introduced in this task

## Operational Note

Production origin and callback are now aligned on `https://www.clawtavern.quest`, so live OAuth is no longer blocked by the earlier apex-vs-www mismatch.
