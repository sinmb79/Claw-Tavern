# Task 28-A — Subscription Fee Immediate Settlement Refactor

> References: `CODEX_TASK28_SUBSCRIPTION_FEE.md`, `MASTER_ROADMAP.md` line 264
> Difficulty: LOW — simplification refactor
> Prerequisite: Task 28 complete, 97 tests passing

---

## Objective

Refactor `TavernSubscription.subscribe()` to **immediately distribute** the 5% fee at payment time instead of accumulating it in the contract. This aligns with the whitepaper's core principles:

- **No intermediary holding funds** — trustless, no custodial risk
- **Immediate transparency** — every USDC flow is visible on-chain in the same transaction
- **Simpler code** — fewer state variables, no automation dependency for fee movement

---

## Current Flow (remove)

```
Client pays 100 USDC → Subscription contract holds 5 USDC
  → (weekly automation) flushFeesToEscrow() → operatorWallet
```

## New Flow (implement)

```
Client pays 100 USDC → subscribe() atomically splits:
  → 95 USDC → agent (safeTransfer)
  → 5 USDC  → operatorWallet (safeTransfer)
  → Done. Zero USDC remains in contract.
```

---

## Changes Required

### 1. `TavernSubscription.sol`

**Remove:**
- `uint256 public accumulatedFees` state variable
- `flushFeesToEscrow()` function
- `FeeFlushed` event

**Modify `subscribe()`:**

```solidity
function subscribe(address agent) external nonReentrant {
    uint256 rate = agentMonthlyRate[agent];
    require(rate > 0, "Agent has no rate");
    require(registry.isActiveAgent(agent), "Agent not active");

    uint256 fee = (rate * SUBSCRIPTION_FEE_BPS) / BPS_DENOMINATOR;
    uint256 agentPayment = rate - fee;

    // Pull USDC from client
    usdc.safeTransferFrom(msg.sender, address(this), rate);

    // Immediate distribution — no accumulation
    usdc.safeTransfer(agent, agentPayment);
    usdc.safeTransfer(operatorWallet, fee);

    // ... rest of subscription logic (create/renew, RPG EXP grant) stays the same

    emit SubscriptionFeeDistributed(msg.sender, agent, fee, operatorWallet);
}
```

**Add event:**
```solidity
event SubscriptionFeeDistributed(address indexed client, address indexed agent, uint256 fee, address indexed operatorWallet);
```

**Keep `operatorWallet`** as a configurable admin-set address (already exists from Task 28). This is just a destination, not a custodial intermediary.

### 2. `TavernAutomationRouter.sol`

**Remove from `checkUpkeep()` / `performUpkeep()`:**
- Fee flush logic (the `accumulatedFees > 0` check and `flushFeesToEscrow()` call)
- `lastFeeFlushAt` state variable
- `FEE_FLUSH_INTERVAL` constant

**Keep:**
- `SubscriptionExpiry` task type for expiring lapsed subscriptions (this is still needed)

### 3. `ITavernSubscription.sol`

**Remove:**
- `accumulatedFees()` from interface
- `flushFeesToEscrow()` from interface

### 4. Tests

**Update `test/TavernSubscription.test.ts`:**

| # | Change |
|---|--------|
| Remove | "flushFeesToEscrow transfers accumulated fees" test |
| Modify | "Client subscribes successfully" — verify operatorWallet receives 5% in same tx |
| Add | "Zero USDC remains in contract after subscribe" — `expect(await usdc.balanceOf(subscription)).to.equal(0)` |
| Add | "SubscriptionFeeDistributed event emitted with correct args" |

All other subscription tests remain the same.

---

## Completion Checklist

```
[ ] accumulatedFees removed from TavernSubscription
[ ] flushFeesToEscrow() removed
[ ] subscribe() does immediate 2-way safeTransfer (agent + operatorWallet)
[ ] SubscriptionFeeDistributed event added
[ ] Router fee flush logic removed (keep SubscriptionExpiry)
[ ] ITavernSubscription interface updated
[ ] Tests updated — zero balance after subscribe, immediate distribution verified
[ ] All existing tests still pass (97+)
[ ] Foundry fuzz still pass (29)
[ ] npx tsc --noEmit clean
[ ] npx hardhat compile clean
```

---

## Security Note

- `operatorWallet` must not be `address(0)`. Add a require check in `subscribe()`.
- Two `safeTransfer` calls in one tx is safe — both are to known addresses, no callback risk with USDC (not ERC-777).
- Contract should hold zero USDC at all times after this change. Consider adding an emergency `rescueToken()` for any accidental direct transfers.
