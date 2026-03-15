# Task 21 — AdminPriceFeed + Whitepaper Supply Fix

> Codex execution instruction. This task produces a new contract and a documentation fix.

---

## Goal

Deploy-ready `AdminPriceFeed.sol` for TVRN/USD on Base mainnet, and fix the total supply discrepancy in `WHITEPAPER_V2.md`.

---

## Deliverable 1 — `contracts/AdminPriceFeed.sol`

### Purpose

A Chainlink AggregatorV3Interface-compatible price feed where an admin manually sets the TVRN/USD price. This replaces `MockV3Aggregator` for mainnet use until DEX liquidity enables a TWAP oracle.

### Requirements

- Implement the full `AggregatorV3Interface` (all 5 view functions):
  - `decimals()` → returns `8` (Chainlink standard)
  - `description()` → returns `"TVRN / USD"`
  - `version()` → returns `1`
  - `getRoundData(uint80 _roundId)` → returns stored round data
  - `latestRoundData()` → returns the most recent round

- Admin controls:
  - `updatePrice(int256 _price)` — sets a new price, increments `roundId`, records `block.timestamp` as `updatedAt`
  - Protected by `onlyOwner` (use OpenZeppelin `Ownable`)
  - Emit `PriceUpdated(uint80 indexed roundId, int256 price, uint256 updatedAt)`

- Validation:
  - `updatePrice` must revert if `_price <= 0`
  - `latestRoundData` must return `answeredInRound == roundId` (satisfies TavernEscrow oracle check)

- Constructor:
  - `constructor(int256 _initialPrice)` — sets the first price at deployment
  - Must revert if `_initialPrice <= 0`

- Initial price for TVRN/USD:
  - `$0.01` = `1_000_000` in 8-decimal format (1e6)

### Compatibility Check

`TavernEscrow._getCheckedPrice()` checks:
1. `price > 0` ✅ (enforced by `updatePrice`)
2. `updatedAt > block.timestamp - ORACLE_STALENESS` (1 hour) — admin must update at least once per hour during active settlement, OR the staleness window should be configurable
3. `answeredInRound >= roundId` ✅ (always equal)

**Important**: The 1-hour staleness check means the admin feed must be updated frequently during active quest settlement periods. Add a note about this in the contract NatSpec.

### Alternative: Configurable Staleness

Consider adding an `adminStalenessOverride` that the escrow can read, OR simply document that the admin must update the feed within the staleness window. The simpler approach is: **just document it**. The admin can call `refreshPrice()` (same price, new timestamp) to keep the feed fresh without changing the price.

Add a convenience function:
- `refreshPrice()` — re-records the current price with a new timestamp and incremented roundId. Same `onlyOwner` guard.

### Contract Size Target

Should be well under 1KB compiled. This is a trivial contract.

### Test

Create `test/AdminPriceFeed.test.ts`:

- Deploy with initial price `1_000_000` (8 decimals = $0.01)
- Verify `decimals() == 8`
- Verify `latestRoundData()` returns correct initial values
- Verify `updatePrice(2_000_000)` updates and increments roundId
- Verify `updatePrice(0)` and `updatePrice(-1)` revert
- Verify `refreshPrice()` updates timestamp without changing price
- Verify non-owner cannot call `updatePrice` or `refreshPrice`
- Verify `getRoundData(1)` returns first round, `getRoundData(2)` returns second round
- Verify `getRoundData(999)` reverts for non-existent round

---

## Deliverable 2 — WHITEPAPER_V2.md Total Supply Fix

### Problem

`WHITEPAPER_V2.md` Section 6 ($TVRN Tokenomics) states:
> "The high-level supply model remains the same as the first draft: `2.1B TVRN` total supply"

But `TavernToken.sol` has:
```solidity
uint256 public constant MAX_SUPPLY = 1_000_000_000 * 1e18;  // 1B
```

The code is the truth. The whitepaper is wrong.

### Fix

In `WHITEPAPER_V2.md`, replace all references to `2.1B` total supply with `1B` (1,000,000,000). Specifically:

1. Section 6 opening paragraph: change `2.1B TVRN` → `1B TVRN`
2. Search the entire file for any other occurrence of `2.1B` or `2,100,000,000` and fix
3. Ensure the allocation breakdown is consistent:
   - 150M (15%) initial team/development
   - 600M (60%) ecosystem pool
   - 250M (25%) reserve (gap between minted paths and MAX_SUPPLY)
4. If the whitepaper mentions any other supply figure that contradicts the code, fix it

### Do NOT change

- Contract code (the code is correct)
- Any other whitepaper section that doesn't mention supply numbers
- The disclaimer section

---

## Deliverable 3 — `deploy/08_mainnet_deploy.ts` Update

Update the mainnet deploy script to support `AdminPriceFeed` as the TVRN/USD oracle:

Add a new env var option:
- `MAINNET_DEPLOY_TVRN_FEED=true` — if set, deploy a fresh `AdminPriceFeed` with initial price `1_000_000` (8 decimals = $0.01) and use its address as the TVRN/USD feed for TavernEscrow

If `MAINNET_DEPLOY_TVRN_FEED=true`:
1. Deploy `AdminPriceFeed(1_000_000)`
2. Use the deployed address as the `tvrnUsdFeed` constructor arg for TavernEscrow
3. Record the AdminPriceFeed address in `deployments/base.json`
4. Verify on Basescan

If `MAINNET_DEPLOY_TVRN_FEED` is not set:
- Fall back to existing behavior: read `MAINNET_TVRN_USD_FEED` from env

Add resume var:
- `MAINNET_REUSE_TVRN_FEED_ADDRESS`
- `MAINNET_REUSE_TVRN_FEED_TX_HASH`

---

## Deliverable 4 — `.env.example` Update

Add:
```
# Set to true to deploy AdminPriceFeed for TVRN/USD ($0.01 initial)
MAINNET_DEPLOY_TVRN_FEED=false

# Resume var for AdminPriceFeed
MAINNET_REUSE_TVRN_FEED_ADDRESS=
MAINNET_REUSE_TVRN_FEED_TX_HASH=
```

---

## Deliverable 5 — Documentation Updates

### DEPLOY_GUIDE.md

Add a section "Oracle Strategy" explaining:
- Mainnet uses `AdminPriceFeed` for TVRN/USD initially
- Admin must call `refreshPrice()` at least once per hour during active settlement windows
- When DEX liquidity appears, migrate to TWAP oracle by calling `TavernEscrow.setPriceFeeds(ethUsdFeed, newTwapFeed)`

### MAINNET_CHECKLIST.md

Update Section 5 (Oracle Strategy):
- [x] TVRN/USD strategy decided: AdminPriceFeed at $0.01
- [ ] AdminPriceFeed deployed and verified
- [ ] Initial price set to 1_000_000 (8 decimals = $0.01)
- [ ] Admin refresh cadence documented

### HANDOFF_RESUME.md

Add Task 21 row and "What Changed In Task 21" section.

---

## Checklist

### AdminPriceFeed Contract

- [ ] `contracts/AdminPriceFeed.sol` created
- [ ] Implements full `AggregatorV3Interface`
- [ ] `updatePrice()` with owner guard and price > 0 check
- [ ] `refreshPrice()` convenience function
- [ ] `PriceUpdated` event emitted
- [ ] Constructor takes initial price and validates
- [ ] NatSpec documents staleness requirement

### Tests

- [ ] `test/AdminPriceFeed.test.ts` created
- [ ] All test cases listed above pass
- [ ] `npm run test` passes (all existing + new tests)

### Whitepaper Fix

- [ ] `WHITEPAPER_V2.md` total supply corrected to 1B
- [ ] All occurrences of 2.1B removed
- [ ] Allocation breakdown consistent with code

### Deploy Script

- [ ] `deploy/08_mainnet_deploy.ts` supports `MAINNET_DEPLOY_TVRN_FEED`
- [ ] AdminPriceFeed deploy + verify integrated
- [ ] Resume var supported
- [ ] `deployments/base.json` schema updated to include `adminPriceFeed` field

### Documentation

- [ ] `.env.example` updated
- [ ] `DEPLOY_GUIDE.md` oracle strategy section added
- [ ] `MAINNET_CHECKLIST.md` Section 5 updated
- [ ] `HANDOFF_RESUME.md` updated with Task 21

### Build

- [ ] `npm run compile` passes
- [ ] `npm run test` passes
- [ ] `npx tsc --noEmit` passes
