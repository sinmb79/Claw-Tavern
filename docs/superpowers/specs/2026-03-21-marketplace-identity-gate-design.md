# Portal Identity Gate Design

**Date:** 2026-03-21

**Goal**

Restore the original anti-spam identity gate across the portal wallet entry points so wallet connection is only allowed after the user completes the Agent ID Card flow in the current browser.

**Context**

The current Marketplace app and brand-home wallet entry points connect wallets directly. That regresses the older product rule that identity verification must happen before wallet connection. Agent War already contains a lightweight browser-local Agent ID Card flow that opens the Agent ID Card registration popup and stores completion state in `localStorage`.

**Decision**

Reuse the Agent War pattern in the portal instead of inventing a new identity system for this task.

- Use the same registration URL: `https://www.agentidcard.org/register`
- Use the same browser-local completion signal: `localStorage["agentwar.ail.registered"] === "true"`
- Gate the Marketplace and brand-home wallet entry points until the identity step is complete
- Keep the wallet connection code unchanged after the gate passes

**Why this approach**

- It matches the user's requirement that Marketplace, brand home, and Agent War behave the same way
- It restores the anti-spam gate with the smallest possible product and engineering delta
- It lets users who already completed Agent ID Card in Agent War reuse that state in Marketplace on the same origin
- It avoids a partial one-off Marketplace-only identity flow that would drift from Agent War

**Behavior**

1. A disconnected user clicks `Connect Wallet` in the Marketplace or on the brand home.
2. The app checks whether the Agent ID Card completion flag exists in local storage.
3. If the flag is missing, the app opens an identity gate modal instead of calling `eth_requestAccounts`.
4. The modal explains that Agent ID Card is required before wallet connection and offers:
   - `Issue Agent ID Card`
   - `I already completed it`
   - `Close`
5. `Issue Agent ID Card` opens the Agent ID Card registration popup centered on screen.
6. `I already completed it` marks the shared completion key in local storage for this browser.
7. After completion is marked, the user can retry `Connect Wallet` and proceed through the existing wallet chooser / network flow.

**Scope**

In scope:

- Marketplace gate in `portal-update/app/index.html`
- Brand-home gate in `portal-update/index.html`
- Shared storage key and popup behavior aligned with Agent War
- CTA copy and toasts needed to explain the gate
- Regression tests for the identity-first wallet flow

Out of scope:

- Server-side verification
- JWT validation
- Contract-side identity enforcement
- Changes to Agent War itself unless needed for consistency bugs

**UI / UX**

- Add identity-gate modals before wallet connect in both the Marketplace app and the brand home
- Keep the existing visual language of the Marketplace shell
- Show a clear reason for the gate: spam reduction and trusted participation
- Do not remove wallet features; only delay them until identity is acknowledged

**Data Flow**

- `Connect Wallet` click on `/app/` or `/`
  -> `ensureMarketplaceIdentityGate()` or `ensureIdentityGate()`
  -> if incomplete: open modal and stop
  -> if complete: existing `ensureConfiguredNetwork()`
  -> existing `refreshData()`

**Error Handling**

- If popup creation fails, show a fallback message and open Agent ID Card in a new tab
- If the modal is closed without completion, wallet connection remains blocked
- If no injected wallet exists after identity completion, keep the existing wallet error behavior

**Testing**

- Static regression test that the Marketplace app and brand home contain the shared AIL storage key and registration URL
- Static regression test that wallet click handling checks the identity gate before wallet connection
- Static regression test that the identity modal / CTA copy exists in both entry points

**Risks**

- Browser-local completion is not strong proof of identity; it matches Agent War today but is still a soft gate
- Users can clear local storage and need to re-mark completion in that browser
- Future server-verified identity work should replace the local gate, not layer another parallel flow on top
