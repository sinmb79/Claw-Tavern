# Portal AIL JWT Session Gate Design

**Date:** 2026-03-21

**Goal**

Require a verified Agent ID Card session before wallet connection on the Claw Tavern brand home and Marketplace app, using a server-verified JWT flow instead of the current browser-local soft gate.

**Decision**

Adopt a single same-origin gate for `/` and `/app/`:

- `Agent ID Card -> JWT -> Cloudflare Pages Function verification -> signed session cookie -> wallet connect allowed`
- The gate runs once before wallet connection
- Write actions do **not** re-check the session after the wallet is connected

This matches the approved product rule: wallet connection is the anti-spam choke point, while later write actions already require wallet signatures and on-chain validation.

## Why this replaces the current gate

The current portal implementation only trusts `localStorage["agentwar.ail.registered"]`, which is easy to spoof and does not verify that the user actually completed Agent ID Card issuance. That was acceptable as a restoration hotfix, but it is not strong enough as the durable anti-spam control for Marketplace.

The new design keeps the same user-visible order while changing the trust source:

- before: browser-local flag
- after: verified server session

The portal must stop treating `localStorage` as proof of identity. A local flag may remain as a UX hint during migration, but it must never unlock wallet connection by itself.

## Scope

In scope:

- `portal-update/index.html`
- `portal-update/app/index.html`
- new Cloudflare Pages Functions under `portal-update/functions/`
- a shared same-origin verification session for `/` and `/app/`
- JWT verification against Agent ID Card
- session issuance, status check, and clear endpoints
- regression tests for client gating and function behavior

Out of scope:

- per-action session enforcement after wallet connection
- contract changes
- Agent War migration in this task
- long-term reputation or profile sync

## Product behavior

### Allowed path

1. User clicks `Connect Wallet` on `/` or `/app/`.
2. Client checks the same-origin AIL verification session.
3. If the session is valid, the existing wallet connect flow continues immediately.
4. If the session is missing, the client opens the Agent ID Card gate.
5. User completes Agent ID Card issuance and the browser receives an AIL JWT.
6. Client sends the JWT to a Pages Function.
7. The Pages Function verifies the JWT with Agent ID Card and issues a signed session cookie.
8. Client retries wallet connect.

### Explicit non-behavior

- The app does not re-run the AIL session check for every task creation, staking call, or vote.
- The app does not trust local storage alone.
- The app does not connect the wallet first and verify identity later.

## Architecture

### Client surfaces

Two entry points share one identity state:

- brand home: `/`
- marketplace app: `/app/`

Both use the same modal language, the same verification endpoints, and the same session cookie at path `/`.

### Functions surface

Add Pages Functions under `portal-update/functions/api/identity/`:

- `POST /api/identity/session`
  - accepts `{ jwt }`
  - verifies the JWT with Agent ID Card
  - sets the signed session cookie on success
  - returns normalized identity metadata for the UI
- `GET /api/identity/session`
  - returns whether the current browser already has a valid verified session
- `DELETE /api/identity/session`
  - clears the cookie so the browser can force a clean state

This keeps the client contract simple and makes the same gate reusable across `/` and `/app/`.

### Verification mechanism

Use the official Agent ID Card verification path from the server side, not from the browser. The current documented surface shows:

- `@agentidcard/sdk`
- `AilClient.verify(token)`
- optional offline verification via `verifyOffline(token, publicKeyJwk)`

Recommended implementation path for this task:

- Pages Function calls the official verification helper or official verification API
- success requires a valid, non-expired JWT
- rejection on invalid signature, expired token, malformed token, or verification service failure

If offline verification becomes practical later, it can replace the network call without changing the browser contract.

## JWT handoff contract

The main browser problem is how the JWT gets from Agent ID Card back to the Claw Tavern page. This spec standardizes the portal side around one client entry point:

- `submitAilJwt(jwt: string)` on the portal side sends the token to `POST /api/identity/session`

Preferred issuer-to-browser handoff:

- Agent ID Card popup posts a message back to the opener
- expected shape: `{ type: "ail-registered", jwt: "<token>" }`
- expected origin: `https://www.agentidcard.org`

This matches the earlier Agent War design notes already captured in the repo.

If Agent ID Card only supports a redirect callback rather than `postMessage`, the portal can still normalize into the same `submitAilJwt(jwt)` client helper. The function contract does not change.

## Session model

The verified state is stored in a signed cookie, not in local storage.

- cookie name: `ct_ail_session`
- attributes: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`
- contents: minimal signed claims such as `ail_id`, `display_name`, `verified_at`, `expires_at`
- lifetime: short-lived and renewable, capped by the verified JWT expiry

Recommended session TTL for Task 41:

- shorter of the JWT expiry and 24 hours

That is long enough to avoid repeated prompts during normal use, while keeping the trust window meaningfully narrower than the old permanent local-storage flag.

## Client flow details

### Connect Wallet click

1. If already connected, existing disconnect behavior stays unchanged.
2. If disconnected, client calls `GET /api/identity/session`.
3. If the response is verified, client continues to the existing wallet chooser / `eth_requestAccounts` flow.
4. If not verified, client opens the identity modal instead of touching wallet APIs.

### Identity modal

The modal should keep the current simple structure:

- `Issue Agent ID Card`
- `I already completed it`
- `Close`

Behavior changes:

- `Issue Agent ID Card` opens the Agent ID Card popup
- `I already completed it` no longer sets trust locally
- instead it checks for a callback result or prompts the app to poll for a new verified session
- if no verified session appears, wallet connect stays blocked

### App bootstrap

Any wallet auto-connect or remembered-wallet bootstrap must check `GET /api/identity/session` first. Otherwise the user could bypass the gate on refresh.

## Error handling

The portal must distinguish between identity problems and wallet problems.

- popup blocked: tell the user the Agent ID Card window was blocked and offer a retry
- callback missing: keep the modal open and explain that verification has not reached the portal yet
- invalid or expired JWT: show a clear retry message and do not issue a session
- Agent ID Card verification outage: fail closed, keep wallet connect blocked, surface a temporary-service-error message
- no injected wallet after a valid session: keep the current no-wallet message

## Security notes

- Trust boundary moves from the browser to the Pages Function
- The browser never marks itself verified without server confirmation
- The session cookie must be signed with a server secret stored in Cloudflare environment bindings
- The cookie must contain only minimal identity metadata
- The client may cache a friendly UI hint, but only the server session may authorize wallet connection

## Migration notes

Task 41 only upgrades the portal. Agent War may still use the older local-storage check until it gets its own migration. The portal code should therefore be explicit that:

- `agentwar.ail.registered` is not an authorization source for `/` or `/app/`
- a future follow-up can move Agent War onto the same Pages Function session model

## Testing strategy

### Function tests

- valid JWT issues a session cookie
- invalid JWT returns 401 or 400 and no cookie
- expired JWT returns 401 and no cookie
- `GET` reports verified only with a valid signed cookie
- `DELETE` clears the cookie

### Client regression tests

- `/` and `/app/` call session status before wallet connect
- `/` and `/app/` no longer trust `agentwar.ail.registered` alone
- wallet connect remains blocked until the verified session exists
- auto-connect paths also check session status first

### Browser smoke tests

- `Connect Wallet` shows the identity gate first when no session exists
- after a mocked successful session response, wallet connect proceeds normally
- console stays clean apart from known non-blocking warnings

## Acceptance criteria

- Wallet connection on `/` and `/app/` is impossible without a verified server session
- A valid Agent ID Card JWT can create that session through a Pages Function
- The same session works on both `/` and `/app/`
- No write action adds extra per-action identity prompts after wallet connection
- Portal code no longer uses local storage as the trust decision for wallet access

## Risks and dependencies

- The portal depends on a working Agent ID Card callback or equivalent JWT delivery path
- If the upstream verifier changes shape, only the Pages Function should need adaptation
- If the external verification service is down, wallet connection must fail closed
- This is stronger than the current gate, but it is still an app-level gate, not an on-chain identity primitive
