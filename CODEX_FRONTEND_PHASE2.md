# Task 15 — Frontend Phase 2 Tabs (Staking + Governance)

> Codex implementation instruction. Modify `claw-tavern-app.html` only.
> No contract changes, no deploy scripts, no tests file.

---

## Goal

Add two new tabs — **Staking** and **Governance** — to the existing 4-tab RPG UI in `claw-tavern-app.html`. These tabs interact with the live `TavernStaking` and `TavernGovernance` contracts (or their zero-address placeholders gracefully).

Current tabs: Quest Board, My Quests, Dashboard, Token
After this task: Quest Board, My Quests, Dashboard, Token, **Staking**, **Governance**

---

## 1. Tab Navigation

Add two buttons after the existing four in the `<nav>` grid:

```html
<button class="tab-button rounded-2xl px-4 py-3 text-sm font-semibold" data-tab="staking">Staking</button>
<button class="tab-button rounded-2xl px-4 py-3 text-sm font-semibold" data-tab="governance">Governance</button>
```

Update the `grid-cols-2` to `grid-cols-3` (or keep `sm:flex` which already handles it). The existing tab switching logic already works with `data-tab` attributes — just add the new sections.

---

## 2. Staking Tab

### 2.1 Section HTML

Create `<section id="tab-staking" class="tab-panel hidden space-y-6">` inside `<main>`.

Layout (2-column on desktop):

**Left column — Staking Panel**:
- "Staking Bond" heading
- Info card: "100 TVRN bond required to join a guild. 7-day cooldown to withdraw. 50% slash penalty for bad actors."
- Current stake status card (dynamic):
  - If not staked: show "No active stake" + Stake button
  - If staked (no unstake request): show "Staked: 100 TVRN" + green badge + "Request Unstake" button
  - If unstake requested: show countdown days + "Withdraw" button (disabled until cooldown done)
  - If slashed: show "Slashed" + remaining amount
- Stake amount input is NOT needed — it's always 100 TVRN fixed

**Right column — Staking Info**:
- "Bond Details" heading
- Info cards (static):
  - Bond amount: 100 TVRN
  - Cooldown: 7 days
  - Slash: 50% burn
  - Prerequisite: Must `leaveGuild()` before requesting unstake

### 2.2 Contract ABI (add to script)

```javascript
const STAKING_ABI = [
  "function stakes(address) view returns (uint256 amount, uint256 unstakeRequestAt, bool slashed)",
  "function isStaked(address) view returns (bool)",
  "function stake()",
  "function requestUnstake()",
  "function withdraw()"
];
```

### 2.3 State

Add to `appState`:
```javascript
stakeInfo: { amount: 0n, unstakeRequestAt: 0n, slashed: false }
```

### 2.4 Data Fetch

In `refreshData()`, when `appState.account` is connected, also fetch:
```javascript
const stakeInfo = await stakingContract.stakes(appState.account);
appState.stakeInfo = {
  amount: stakeInfo.amount,
  unstakeRequestAt: stakeInfo.unstakeRequestAt,
  slashed: stakeInfo.slashed
};
```

If `CONFIG.addresses.tavernStaking` is zero-address, skip the fetch and show "Staking contract not deployed" placeholder.

### 2.5 Actions

Three write actions (each follows the existing confirm-modal → setPending → tx → clearPending → toast pattern):

1. **Stake**: requires TVRN approval first (`token.approve(stakingAddress, 100e18)`), then `staking.stake()`
2. **Request Unstake**: `staking.requestUnstake()` — must have left guild first (agent not active)
3. **Withdraw**: `staking.withdraw()` — only after 7-day cooldown

### 2.6 Staking Address

Add to `CONFIG.addresses`:
```javascript
tavernStaking: "0x3cBa5c92f8fB5b00B230c37eE32c93B5971DBEa8"
```

This is the live Phase 2 staking contract.

---

## 3. Governance Tab

### 3.1 Section HTML

Create `<section id="tab-governance" class="tab-panel hidden space-y-6">` inside `<main>`.

Layout:

**Top — Governance Stats Row** (4 KPI cards):
- Total proposals
- Quorum threshold (live from `governance.quorum()`)
- Your voting power (live from `governance.getVotingPower(account, 0)` — use 0 as placeholder, or show "Connect wallet")
- Proposal threshold: 100 TVRN

**Middle — Create Proposal Panel** (left) + **Proposal Type Reference** (right):

Create Proposal form:
- Dropdown: ProposalType (GuildFeeChange=0, GuildMasterChange=1, SubTokenIssuance=2, PlatformFeeChange=3, ForceDissolveGuild=4, EmergencyFreeze=5)
- Input: target address
- Textarea: callData (hex)
- Textarea: description
- Button: "Submit Proposal"

Proposal Type Reference (info cards):
- GuildFeeChange: "Change a guild's fee rate"
- GuildMasterChange: "Replace a guild master"
- SubTokenIssuance: "Issue sub-tokens for a guild"
- PlatformFeeChange: "Change platform-wide fee"
- ForceDissolveGuild: "Force dissolve an inactive guild"
- EmergencyFreeze: "Instant queue, no timelock delay"

**Bottom — Proposal List**:
- Iterate `nextProposalId` and render each proposal as a card
- Each card shows:
  - Proposal ID, type badge, state badge (Active/Defeated/Queued/Executed/Cancelled)
  - Proposer (shortened), description (first 120 chars)
  - Vote bars: For / Against / Abstain with visual progress bars (same style as quota bars)
  - Time remaining (if Active) or ETA (if Queued)
  - Action buttons (conditional):
    - Active + not voted: "Vote For", "Vote Against", "Abstain"
    - Active + voted: "Already voted" (disabled)
    - Voting ended + not queued: "Queue" button
    - Queued + eta passed: "Execute" button
    - Proposer or admin + Active/Queued: "Cancel" button

### 3.2 Contract ABI (add to script)

```javascript
const GOVERNANCE_ABI = [
  "function nextProposalId() view returns (uint256)",
  "function proposals(uint256) view returns (uint256 id, address proposer, uint8 proposalType, bytes callData, address target, uint256 forVotes, uint256 againstVotes, uint256 abstainVotes, uint256 startTime, uint256 endTime, uint256 eta, uint8 state, string description)",
  "function hasVoted(uint256, address) view returns (bool)",
  "function quorum() view returns (uint256)",
  "function getVotingPower(address, uint256) view returns (uint256)",
  "function propose(uint8, address, bytes, string) returns (uint256)",
  "function vote(uint256, uint8)",
  "function queue(uint256)",
  "function execute(uint256)",
  "function cancel(uint256)",
  "event ProposalCreated(uint256 indexed id, address indexed proposer, uint8 proposalType, address target, string description)"
];
```

### 3.3 State

Add to `appState`:
```javascript
proposals: [],
governanceQuorum: 0n,
votingPower: 0n
```

### 3.4 Data Fetch

In `refreshData()`, if governance address is not zero:
```javascript
const [proposalCount, quorumValue] = await Promise.all([
  governanceContract.nextProposalId(),
  governanceContract.quorum()
]);
appState.governanceQuorum = quorumValue;

// Fetch latest 20 proposals (reverse order like quests)
const proposalPromises = [];
const start = Math.max(0, Number(proposalCount) - 20);
for (let i = Number(proposalCount) - 1; i >= start; i--) {
  proposalPromises.push(fetchProposal(i, governanceContract));
}
appState.proposals = await Promise.all(proposalPromises);

// Voting power for connected user
if (appState.account && Number(proposalCount) > 0) {
  appState.votingPower = await governanceContract.getVotingPower(
    appState.account,
    Number(proposalCount) - 1
  );
}
```

If governance is zero-address: skip and show "Governance contract not yet deployed" placeholder.

### 3.5 Render

**Proposal state badges** — use the same `badge` pattern with new colors:
```javascript
const GOV_STATE_NAMES = ["Active", "Defeated", "Queued", "Executed", "Cancelled"];
const GOV_STATE_CLASSES = {
  Active: "state-accepted",      // gold
  Defeated: "state-timedout",    // red
  Queued: "state-submitted",     // purple
  Executed: "state-evaluated",   // green
  Cancelled: "state-cancelled"   // grey strikethrough
};
```

**Proposal type badges**:
```javascript
const PROPOSAL_TYPE_NAMES = [
  "Guild Fee Change",
  "Guild Master Change",
  "Sub-Token Issuance",
  "Platform Fee Change",
  "Force Dissolve Guild",
  "Emergency Freeze"
];
```

**Vote bars**: For each proposal, render three horizontal bars (For = emerald, Against = ember, Abstain = muted) with percentages. Reuse the existing `.progress-rail` / `.progress-fill` pattern.

### 3.6 Actions

Five write actions (all follow existing pattern):

1. **Propose**: `governance.propose(type, target, callData, description)` — requires 100+ TVRN balance
2. **Vote For**: `governance.vote(proposalId, 1)`
3. **Vote Against**: `governance.vote(proposalId, 0)`
4. **Abstain**: `governance.vote(proposalId, 2)`
5. **Queue**: `governance.queue(proposalId)`
6. **Execute**: `governance.execute(proposalId)`
7. **Cancel**: `governance.cancel(proposalId)`

---

## 4. Contract Instantiation

Update `getReadContracts()` and `getWriteContracts()` to include:
```javascript
staking: new ethers.Contract(CONFIG.addresses.tavernStaking, STAKING_ABI, provider),
governance: new ethers.Contract(CONFIG.addresses.tavernGovernance, GOVERNANCE_ABI, provider)
```

Add null-safety: if address is zero, skip creating the contract and return `null`. All render/fetch code must check for null.

---

## 5. Render Functions

Add:
- `renderStakingTab()` — called from `renderAll()`
- `renderGovernanceTab()` — called from `renderAll()`

Both follow the existing pattern: build HTML string, set `.innerHTML` on the container.

---

## 6. Zero-Address Grace

Both tabs must show a friendly placeholder when their contract address is `0x000...000`:
```html
<div class="panel rounded-[28px] p-6">
  <p class="heading-font text-xl font-semibold">Staking</p>
  <p class="mt-3 text-sm text-[var(--muted)]">
    The staking contract is not yet deployed on Base Sepolia.
    Check back after the next coordinated deploy.
  </p>
</div>
```

Same pattern for governance.

---

## 7. Header Address Cards

Add `TavernStaking` card to the header address grid (it's live):
```html
<a class="panel-soft rounded-2xl p-4 hover:border-[rgba(246,223,142,0.24)]"
   target="_blank" rel="noreferrer"
   href="https://sepolia.basescan.org/address/0x3cBa5c92f8fB5b00B230c37eE32c93B5971DBEa8">
  <p class="text-xs uppercase tracking-[0.22em] text-[var(--muted)]">TavernStaking</p>
  <p class="mt-2 break-all text-sm">0x3cBa...DBEa8</p>
</a>
```

Only show Governance card when its address is not zero.

---

## 8. Style Additions

Add these CSS classes for governance:

```css
.vote-bar-for .progress-fill {
  background: linear-gradient(90deg, rgba(47, 141, 113, 0.65), rgba(87, 210, 170, 0.95));
}
.vote-bar-against .progress-fill {
  background: linear-gradient(90deg, rgba(218, 107, 56, 0.65), rgba(255, 165, 100, 0.95));
}
.vote-bar-abstain .progress-fill {
  background: linear-gradient(90deg, rgba(148, 163, 184, 0.45), rgba(200, 210, 220, 0.7));
}

.stake-badge {
  border: 1px solid rgba(47, 141, 113, 0.35);
  background: rgba(47, 141, 113, 0.12);
  color: #b8f0dc;
}
.stake-badge.inactive {
  border-color: rgba(148, 163, 184, 0.3);
  background: rgba(148, 163, 184, 0.1);
  color: #d8dee9;
}
.stake-badge.slashed {
  border-color: rgba(210, 76, 76, 0.4);
  background: rgba(210, 76, 76, 0.12);
  color: #ffc0c0;
}
```

---

## 9. Checklist

### HTML Structure

- [ ] `<button data-tab="staking">` added to nav
- [ ] `<button data-tab="governance">` added to nav
- [ ] `<section id="tab-staking">` created with full layout
- [ ] `<section id="tab-governance">` created with full layout
- [ ] TavernStaking card added to header address grid
- [ ] Governance card conditionally shown in header

### JavaScript — ABIs & Config

- [ ] `STAKING_ABI` declared
- [ ] `GOVERNANCE_ABI` declared
- [ ] `CONFIG.addresses.tavernStaking` set to live address
- [ ] `getReadContracts()` returns `staking` and `governance`
- [ ] `getWriteContracts()` returns `staking` and `governance`
- [ ] Null-safety when address is zero

### JavaScript — State & Fetch

- [ ] `appState.stakeInfo` added
- [ ] `appState.proposals` added
- [ ] `appState.governanceQuorum` added
- [ ] `appState.votingPower` added
- [ ] `refreshData()` fetches staking info when connected
- [ ] `refreshData()` fetches proposals when governance is deployed
- [ ] `refreshData()` fetches quorum and voting power

### JavaScript — Render

- [ ] `renderStakingTab()` created and called from `renderAll()`
- [ ] `renderGovernanceTab()` created and called from `renderAll()`
- [ ] Stake status dynamic rendering (not staked / staked / unstake requested / slashed)
- [ ] Proposal cards with type badge, state badge, vote bars, action buttons
- [ ] Vote bar percentages calculated correctly
- [ ] Time remaining / ETA display
- [ ] Zero-address placeholder for both tabs

### JavaScript — Actions

- [ ] Stake action (approve + stake two-step)
- [ ] Request unstake action
- [ ] Withdraw action (cooldown check)
- [ ] Propose action
- [ ] Vote (For/Against/Abstain) actions
- [ ] Queue action
- [ ] Execute action
- [ ] Cancel action
- [ ] All actions use confirm-modal → setPending → tx → clearPending → toast pattern

### CSS

- [ ] Vote bar colors (for/against/abstain)
- [ ] Stake badge classes (active/inactive/slashed)

### HANDOFF

- [ ] `HANDOFF_RESUME.md` updated with "What Changed In Task 15" section
- [ ] Task 15 row added to status table

---

## Design Notes

- Keep the RPG fantasy theme consistent — "Bond" not "Stake" in headings, "Decree" or "Proposal" for governance
- All data reads use the `readProvider` (no wallet required for viewing)
- All write actions require wallet connection and Base Sepolia chain
- The governance tab is functional even before GOVERNANCE_ROLE is wired on target contracts — proposals can be created, voted, queued, and "executed" (the execution will revert if target doesn't grant the role, which is expected Phase 3 behavior)
- No separate files — everything stays in the single `claw-tavern-app.html`
