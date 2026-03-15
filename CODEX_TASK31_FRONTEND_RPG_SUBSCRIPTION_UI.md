# CODEX TASK 31 — Frontend RPG & Subscription UI Tabs

**Objective**: Add two new tab sections to `claw-tavern-app.html` for the TavernClientRPG and TavernSubscription contracts. The ABI fragments and contract wiring already exist in the page; this task adds the missing user-facing UI.

---

## Context

Current tabs: Quest Board, My Quests, Dashboard, Token, Staking, Governance (6 tabs).

After this task: Quest Board, My Quests, Dashboard, Token, Staking, Governance, **RPG**, **Subscription** (8 tabs).

The following are already wired in the HTML:
- `RPG_ABI` with `clientProfiles`, `currentSeasonNumber`, `checkWithdrawalEligible`
- `SUBSCRIPTION_ABI` with `subscriptions`, `agentMonthlyRate`, `subscribe`
- `appState.contracts.clientRPG` and `appState.contracts.subscription` are initialized
- Address cards for both contracts render in the header

---

## Part 1 — Add Tab Buttons

In the tab bar (around line 294–299), add two new buttons after the Governance tab:

```html
<button class="tab-button rounded-2xl px-4 py-3 text-sm font-semibold" data-tab="rpg">RPG</button>
<button class="tab-button rounded-2xl px-4 py-3 text-sm font-semibold" data-tab="subscription">Subscription</button>
```

---

## Part 2 — RPG Tab Section

Add a new `<section id="tab-rpg">` with the following panels:

### 2-A. My Adventurer Profile

A read-only card showing the connected wallet's RPG profile. Call `clientProfiles(address)` on mount and display:

| Field | Source | Display |
|---|---|---|
| Level | `level` return value | Show level name: 0=Unranked, 1=Novice, 2=Apprentice, 3=Journeyman, 4=Veteran, 5=Master |
| EXP | `exp` return value | Numeric with progress bar to next level |
| Total Jobs | `totalJobsCompleted` | Numeric |
| Verified | `verified` | Badge (checkmark or "Unverified") |
| Registered | `registeredAt` | Format as date |
| Withdrawn This Month | `withdrawnThisMonth` | Formatted TVRN amount |

Level thresholds for progress bar calculation:
- Lv.1 Novice: 0 EXP
- Lv.2 Apprentice: 100 EXP
- Lv.3 Journeyman: 500 EXP
- Lv.4 Veteran: 2000 EXP
- Lv.5 Master: 10000 EXP

### 2-B. Season Info

Call `currentSeasonNumber()` and display:
- Current season number
- Season badge/label

### 2-C. TVRN Withdrawal Eligibility Checker

A small form where the user enters an amount of TVRN to withdraw, clicks "Check Eligibility", and sees the result from `checkWithdrawalEligible(address, amount)`.

- Input: TVRN amount (number input)
- Button: "Check Eligibility"
- Output: Green "Eligible" or Red with reason string from contract

### 2-D. Styling

Follow the existing panel/card patterns in the page:
- Use `panel` or `panel-soft` classes
- Use `heading-font` for section titles
- Gold accent color for level badges
- Use the same grid layout as other tabs (responsive, 1-col mobile, 2-col desktop)

---

## Part 3 — Subscription Tab Section

Add a new `<section id="tab-subscription">` with the following panels:

### 3-A. Browse Agent Subscriptions

A search/lookup panel:
- Input: Agent address
- Button: "Check Rate"
- Calls `agentMonthlyRate(agentAddress)` and displays the monthly USDC rate
- If rate > 0, show a "Subscribe" button

### 3-B. Subscribe Action

When user clicks "Subscribe":
1. Check if wallet is connected (prompt connect if not)
2. Check USDC allowance for TavernSubscription contract address
3. If allowance < rate, prompt USDC approval first
4. Call `subscribe(agentAddress)`
5. Show tx hash with explorer link on success
6. Show error message on failure

### 3-C. My Active Subscriptions

If the contract exposes a way to look up subscriptions by client (check if there is a `clientSubscriptionId` or `clientAgentSub` mapping), show a list of active subscriptions with:
- Agent address
- Monthly rate (USDC)
- Current period start/end dates
- Status (Active / Cancelled / Expired)

If no direct client→subscription lookup exists on-chain, show a note: "Subscription lookup requires indexing. Check BaseScan for your transaction history."

### 3-D. Fee Transparency Note

A small info panel at the bottom:
- "Subscription fees are settled immediately: 95% goes directly to the agent, 5% platform fee."
- "No funds are held in escrow. Trustless, transparent, on-chain."

### 3-E. Styling

Same guidelines as Part 2-D. Use the `--emerald` accent for active subscriptions, `--ember` for expired.

---

## Part 4 — Wire Up Data Loading

### 4-A. RPG Data Loader

Create a `loadRPGData()` async function:
```javascript
async function loadRPGData() {
  if (!appState.contracts.clientRPG) return;
  const address = appState.userAddress;
  if (!address) return;

  const profile = await appState.contracts.clientRPG.clientProfiles(address);
  const season = await appState.contracts.clientRPG.currentSeasonNumber();

  // Update DOM elements with profile data
  // Update season display
}
```

Call `loadRPGData()`:
- After wallet connection
- When switching to the RPG tab
- After network change

### 4-B. Subscription Data Loader

Create a `loadSubscriptionData()` async function that loads agent rate on lookup.

### 4-C. Tab Switch Integration

Ensure the existing tab switch handler (around line 2189) properly shows/hides the new sections:
- `tab-rpg` and `tab-subscription` must follow the same `hidden` class toggle pattern

---

## Part 5 — Error Handling

- If `clientRPG` contract is not available (e.g., address is zero), show: "RPG system not available on this network."
- If `subscription` contract is not available, show similar message.
- Wrap all contract calls in try/catch with user-friendly error display.
- Handle the case where user is not connected (show "Connect wallet to view your profile").

---

## Part 6 — Testing

### 6-A. Manual Browser Test Checklist

Open `claw-tavern-app.html` and verify:

- [ ] 8 tabs visible, all clickable
- [ ] RPG tab shows "Connect wallet" prompt when disconnected
- [ ] RPG tab shows profile data when connected on Sepolia
- [ ] Level name displays correctly based on level number
- [ ] EXP progress bar renders
- [ ] Season number displays
- [ ] Withdrawal eligibility checker works (returns eligible/reason)
- [ ] Subscription tab shows agent rate lookup
- [ ] Subscribe flow: approval → subscribe → tx link
- [ ] Fee transparency note renders
- [ ] All tabs still work (no regressions on existing 6 tabs)
- [ ] Mobile responsive (tabs wrap or scroll on narrow screens)

### 6-B. Parse Verification

```bash
node -e "const fs=require('fs'); const html=fs.readFileSync('claw-tavern-app.html','utf8'); const m=html.match(/<script[\s\S]*?<\/script>/g); console.log('Script blocks:', m.length); m.forEach((s,i)=>{try{new Function(s.replace(/<\/?script[^>]*>/g,''));console.log('Block',i,': OK')}catch(e){console.log('Block',i,': PARSE ERROR -',e.message)}})"
```

---

## Acceptance Checklist

- [ ] Two new tab buttons (RPG, Subscription) added to tab bar
- [ ] `<section id="tab-rpg">` with profile, season, withdrawal eligibility UI
- [ ] `<section id="tab-subscription">` with agent lookup, subscribe, active subs UI
- [ ] `loadRPGData()` function reads from clientRPG contract
- [ ] Subscription lookup and subscribe flow implemented
- [ ] Fee transparency note present
- [ ] Error handling for disconnected wallet and missing contracts
- [ ] Tab switch handler updated for 8 tabs
- [ ] Inline script parse test passes
- [ ] No regressions on existing tabs
- [ ] Mobile responsive layout maintained
