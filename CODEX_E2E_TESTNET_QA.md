# Task 18 — End-to-End Testnet QA

> Codex execution instruction. This task runs live transactions on Base Sepolia.
> No new contracts are deployed. This is a pure QA task that exercises every user flow.

---

## Goal

Execute real transactions on Base Sepolia to verify the entire Claw Tavern protocol works end-to-end. This covers the quest lifecycle, staking, governance, automation eligibility, and fee stage logic. Each test scenario produces a Hardhat script that can be re-run.

**Why now?** We built 17 tasks of contracts, automation, and frontend without ever running a single real quest through the system. This task closes that gap.

---

## Live Contract Addresses (Phase 3)

| Contract | Address |
|----------|---------|
| TavernToken | `0x3b63deb3632b2484bAb6069281f08642ab112b16` |
| TavernRegistry | `0x3CA052162d56634fc511f0Fc1129b5Bb21fcD2B2` |
| TavernEscrow | `0x1E8d07B68b0447c27B8976767d91974Eee5B5103` |
| TavernStaking | `0x73191ECE512D1B4dd346fe7a86E3e8664604aFC8` |
| TavernGovernance | `0x9B688C3c86a27b0E120406AfA85AbDe07b6D393F` |
| TavernAutomationRouter | `0x43A309C814f68e8B96E56E5F85A51f524Ac73cAc` |
| USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| ETH/USD Feed | `0x4aDC67d868Ac7a395922e35C834E3BFa52e3f9c0` |

Deployer / test wallet: `0xf95232Ae6a716862799C90239028fb590C9bB307`

---

## Deliverables

1. **`scripts/e2e-testnet-qa.ts`** — single Hardhat script that runs all scenarios sequentially
2. **`test/e2e-results.json`** — machine-readable log of every tx hash, gas used, and pass/fail per scenario
3. **Console output** — human-readable summary of each scenario result

---

## Pre-Flight Checks

Before running any scenario, the script must verify:

```typescript
// 1. Deployer has enough ETH for gas
const ethBalance = await ethers.provider.getBalance(deployer.address);
assert(ethBalance > ethers.parseEther("0.01"), "Need at least 0.01 ETH for gas");

// 2. Deployer has TVRN for staking
const tvrnBalance = await token.balanceOf(deployer.address);
console.log(`TVRN balance: ${ethers.formatEther(tvrnBalance)}`);

// 3. Deployer has USDC for quest funding (or we use ETH quests)
// Base Sepolia USDC faucet may be needed — fall back to ETH quests if USDC balance is 0

// 4. Confirm live contracts are responsive
const guildCount = await registry.guildCount();
assert(guildCount >= 5n, "Registry should have at least 5 founding guilds");
const nextQuestId = await escrow.nextQuestId();
console.log(`Current nextQuestId: ${nextQuestId}`);
```

---

## Scenario 1 — Staking Flow

**Purpose:** Verify TavernStaking accepts a 100 TVRN bond and the Registry recognizes the staker.

```
Steps:
  1. token.approve(stakingAddress, 100e18)
  2. staking.stake()
  3. Assert staking.isStaked(deployer) == true
  4. Assert staking.getStakeInfo(deployer).amount == 100e18
```

**Expected:** Staked event emitted. `isStaked` returns true.

**Note:** Do NOT unstake — the deployer needs to remain staked for Scenario 2 (guild join).

---

## Scenario 2 — Agent Registration (Guild Join)

**Purpose:** Verify a staked agent can join a founding guild.

```
Steps:
  1. Assert staking.isStaked(deployer) == true (from Scenario 1)
  2. registry.joinGuild(1, "gpt-4o")  // Guild 1 = 추론 길드
  3. Assert registry.isAgentActive(deployer) == true
  4. Read registry.getAgent(deployer) → verify guildId == 1, rank == Apprentice, isActive == true
```

**Expected:** AgentJoined event emitted. Agent profile created.

---

## Scenario 3 — Quest Lifecycle: Happy Path (ETH)

**Purpose:** Run a complete quest from creation to evaluation using ETH. This is the core protocol flow.

We need TWO addresses: a client and an agent. Since we only have the deployer wallet, use the deployer as both client AND agent by switching roles. However, `acceptQuest` requires `client != msg.sender`.

**Solution:** Use a second Hardhat signer if available, or create a funded secondary wallet from the deployer. The script should:

```typescript
// Create or derive a second signer
// If Hardhat provides multiple signers on Base Sepolia, use signers[1]
// Otherwise, create a new wallet and fund it from deployer
const [deployer, secondSigner] = await ethers.getSigners();
let agent: Signer;
if (secondSigner) {
  agent = secondSigner;
} else {
  // Create ephemeral wallet, fund with ETH + TVRN, stake, join guild
  const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
  await deployer.sendTransaction({ to: wallet.address, value: ethers.parseEther("0.005") });
  await token.transfer(wallet.address, ethers.parseEther("100"));
  // Then stake + joinGuild from wallet
  agent = wallet;
}
```

**Important: If only one signer is available (common on Base Sepolia with a single private key), the script must create an ephemeral wallet for the agent role.** The ephemeral wallet needs:
- ETH for gas (~0.005 ETH)
- 100 TVRN for staking
- Staked via staking.stake()
- Joined a guild via registry.joinGuild()

```
Steps (client = deployer, agent = second signer or ephemeral wallet):

  A. Agent preparation (if ephemeral):
     1. Send 0.005 ETH from deployer to agent
     2. Send 100 TVRN from deployer to agent
     3. agent: token.approve(staking, 100e18)
     4. agent: staking.stake()
     5. agent: registry.joinGuild(2, "claude-3.5")  // Guild 2 = 코딩 길드

  B. Quest creation + funding (client = deployer):
     1. escrow.createQuest(address(0), parseEther("0.001"), briefHash, "ipfs://test-brief")
        - Use address(0) for ETH currency
        - Use 0.001 ETH as deposit (small amount for testnet)
        - briefHash = keccak256("test-brief-scenario-3")
     2. Record questId from QuestCreated event
     3. escrow.fundQuestETH(questId, { value: parseEther("0.001") })
     4. Assert quest state == Funded

  C. Quest acceptance + work (agent):
     1. escrow.connect(agent).acceptQuest(questId)
     2. Assert quest state == Accepted
     3. escrow.connect(agent).recordHeartbeat(questId)
     4. Assert quest state == InProgress
     5. escrow.connect(agent).submitResult(questId, resultHash, "ipfs://test-result")
        - resultHash = keccak256("test-result-scenario-3")
     6. Assert quest state == Submitted

  D. Evaluation (client = deployer):
     1. escrow.recordResultViewed(questId)
     2. Assert resultViewedAt > 0
     3. escrow.submitEvaluation(questId, [5,5,5,5,5], "Excellent work on the test quest", ["quality","speed"])
     4. Assert quest state == Evaluated
     5. Read evaluationAvgScore(questId) → should be 50 (5.0 average × 10)
```

**Expected:** Full lifecycle completes. Agent receives ETH payout. TVRN completion bonus minted. Reputation updated on Registry.

**CRITICAL BLOCKER — TVRN/USD Feed:**
The `tvrnUsdFeed` is set to `address(0)`. When `_settleQuest` calls `_mintTVRN` → the completion bonus path calls `_usd18ToTVRN` which calls `_getCheckedPrice(tvrnUsdFeed)` — this will **revert** with "Oracle not set" because the feed is zero address.

**Workaround options (pick ONE, in order of preference):**

1. **Deploy a MockV3Aggregator for TVRN/USD** and call `escrow.setPriceFeeds(ethUsdFeed, mockTvrnFeed)` before running quests. Set TVRN price to $0.01 (1e6 with 8 decimals). This is the cleanest solution.

2. **Set completionBonusBps to 0** via `escrow.setCompletionBonusBps(0)` — this skips the TVRN mint path entirely. Less realistic but avoids the blocker.

3. **Both** — deploy the mock feed AND test with bonus enabled, so we verify the full path.

**Recommended: Option 3.** Deploy MockV3Aggregator, set it as tvrnUsdFeed, then run the quest with full completion bonus enabled. This exercises the maximum code coverage.

```typescript
// Deploy mock TVRN/USD feed
const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
const tvrnFeed = await MockV3Aggregator.deploy(8, 1_000_000); // $0.01 with 8 decimals
await tvrnFeed.waitForDeployment();

// Set on Escrow
await escrow.setPriceFeeds(
  "0x4aDC67d868Ac7a395922e35C834E3BFa52e3f9c0", // keep real ETH/USD
  await tvrnFeed.getAddress()
);
```

**After deploying the mock feed, record its address in the test results and update `baseSepolia.json` constructorArgs.tavernEscrow.tvrnUsdFeed.**

---

## Scenario 4 — Quest Cancellation

**Purpose:** Verify unfunded quest can be cancelled.

```
Steps:
  1. escrow.createQuest(address(0), parseEther("0.0005"), hash, "ipfs://cancel-test")
  2. escrow.cancelQuest(questId)
  3. Assert quest state == Cancelled
```

**Expected:** QuestCancelled event. No funds moved.

---

## Scenario 5 — Auto-Approve Eligibility Check

**Purpose:** Verify that a submitted quest becomes auto-approve eligible after 72 hours. We can't wait 72 hours, but we can verify the automation router's `checkUpkeep` returns the right data.

```
Steps:
  1. Create + fund + accept + submit a quest (abbreviated from Scenario 3)
  2. Call router.checkUpkeep("0x") immediately
  3. Assert upkeepNeeded == false (72 hours haven't passed)
  4. Read quest.submittedAt — confirm it's recent
```

**Expected:** checkUpkeep returns false because auto-approve delay hasn't elapsed. This confirms the router is correctly reading quest state from the new Escrow.

---

## Scenario 6 — Timeout Eligibility Check

**Purpose:** Verify that an accepted (not submitted) quest shows as not-yet-timed-out.

```
Steps:
  1. Create + fund + accept a quest (don't submit)
  2. Call router.checkUpkeep("0x")
  3. Assert upkeepNeeded == false (48 hours haven't passed)
  4. Read quest.acceptedAt — confirm it's recent
```

**Expected:** checkUpkeep returns false. Quest is in Accepted state and timeout hasn't elapsed.

---

## Scenario 7 — Fee Stage Preview

**Purpose:** Verify fee stage logic reads active client/agent counts correctly.

```
Steps:
  1. Read escrow.activeClientCount()
  2. Read escrow.activeAgentCount()
  3. Read escrow.currentFeeStage()
  4. Read escrow.previewFeeStage()
  5. Log all values
```

**Expected:** Fee stage is 0 (we have very few clients/agents). previewFeeStage() should return 0 since thresholds are not met.

---

## Scenario 8 — Governance Proposal

**Purpose:** Create a proposal and verify voting power calculation.

```
Steps:
  1. Read governance.getVotingPower(deployer.address) → should be sqrt(tvrnBalance) with bonuses
  2. governance.propose(
       0,  // ProposalType.ParameterChange
       "Test parameter change proposal",
       abi.encode(...)  // or empty bytes for a no-op proposal
     )
  3. Record proposalId from ProposalCreated event
  4. Read governance.proposals(proposalId) → verify state, timestamps
  5. governance.vote(proposalId, 0)  // VoteType.For
  6. Read vote count → should show deployer's voting power
```

**Expected:** Proposal created, vote recorded. Cannot queue yet (voting period is 5 days).

---

## Scenario 9 — Staking Unstake Flow

**Purpose:** Verify unstake request + cooldown logic.

**Note:** Run this LAST because it deactivates the deployer as an agent.

```
Steps:
  1. registry.leaveGuild()  // Must leave guild before unstaking
  2. Assert registry.isAgentActive(deployer) == false
  3. staking.requestUnstake()
  4. Read staking.getStakeInfo(deployer) → unstakeRequestAt > 0
  5. Try staking.withdraw() → should revert with "Cooldown still active"
  6. Log: "Unstake requested. Withdraw available after 7 days."
```

**Expected:** UnstakeRequested event. Withdraw reverts (cooldown not elapsed). This confirms the full unstake flow up to the cooldown gate.

---

## Scenario 10 — ERC-8004 Config Check (Read-Only)

**Purpose:** Confirm ERC-8004 code is deployed but unconfigured.

```
Steps:
  1. Read registry.erc8004IdentityRegistry() → address(0)
  2. Read registry.erc8004ReputationRegistry() → address(0)
  3. Read registry.erc8004Required() → false
  4. Call registry.hasValidERC8004Identity(deployer) → false
  5. Log: "ERC-8004 code is live but unconfigured — expected for testnet."
```

**Expected:** All zero/false. Code exists but no identity registry is set.

---

## Script Structure

```typescript
// scripts/e2e-testnet-qa.ts

import hre from "hardhat";
const { ethers } = hre;

interface ScenarioResult {
  scenario: string;
  status: "PASS" | "FAIL" | "SKIP";
  txHashes: string[];
  gasUsed: bigint;
  error?: string;
  notes?: string;
}

async function main() {
  const results: ScenarioResult[] = [];

  // Pre-flight checks...

  // Scenario 1: Staking
  results.push(await runScenario1_Staking());

  // Scenario 2: Guild Join
  results.push(await runScenario2_GuildJoin());

  // Scenario 3: Quest Happy Path
  results.push(await runScenario3_QuestHappyPath());

  // Scenario 4: Quest Cancellation
  results.push(await runScenario4_QuestCancel());

  // Scenario 5: Auto-Approve Eligibility
  results.push(await runScenario5_AutoApproveCheck());

  // Scenario 6: Timeout Eligibility
  results.push(await runScenario6_TimeoutCheck());

  // Scenario 7: Fee Stage
  results.push(await runScenario7_FeeStage());

  // Scenario 8: Governance Proposal
  results.push(await runScenario8_Governance());

  // Scenario 9: Unstake Flow (LAST — deactivates agent)
  results.push(await runScenario9_Unstake());

  // Scenario 10: ERC-8004 Check (read-only)
  results.push(await runScenario10_ERC8004());

  // Write results
  await writeFile("test/e2e-results.json", JSON.stringify(results, null, 2));

  // Print summary
  console.log("\n=== E2E QA Summary ===");
  for (const r of results) {
    console.log(`${r.status} | ${r.scenario} | ${r.txHashes.length} txns | gas: ${r.gasUsed}`);
  }
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  console.log(`\nTotal: ${passed} PASS, ${failed} FAIL, ${results.length - passed - failed} SKIP`);
}
```

### Error Handling

Each scenario function should:
1. Wrap in try/catch
2. On failure, record the error message and return `FAIL` status
3. Continue to the next scenario (don't abort the whole script)
4. If a scenario depends on a previous one (e.g., Scenario 2 needs Scenario 1's stake), check the dependency and `SKIP` if the dependency failed

### Idempotency

The script should handle re-runs gracefully:
- Check `staking.isStaked(deployer)` before attempting to stake again
- Check `registry.isAgentActive(deployer)` before joining a guild again
- Always create new quests (they get fresh IDs)

---

## package.json Script

Add to `package.json`:

```json
{
  "scripts": {
    "e2e:baseSepolia": "npx hardhat run scripts/e2e-testnet-qa.ts --network baseSepolia"
  }
}
```

---

## Checklist

### Script

- [ ] `scripts/e2e-testnet-qa.ts` created
- [ ] Pre-flight checks implemented
- [ ] All 10 scenarios implemented
- [ ] Each scenario has try/catch with PASS/FAIL/SKIP
- [ ] Idempotent re-run handling (check state before acting)
- [ ] `test/e2e-results.json` written at end

### Mock TVRN/USD Feed

- [ ] MockV3Aggregator deployed for TVRN/USD on Base Sepolia
- [ ] Mock feed address recorded in e2e-results.json
- [ ] `escrow.setPriceFeeds()` called with real ETH/USD + mock TVRN/USD
- [ ] `baseSepolia.json` constructorArgs.tavernEscrow.tvrnUsdFeed updated with mock address

### Scenario Results

- [ ] Scenario 1 (Staking): PASS
- [ ] Scenario 2 (Guild Join): PASS
- [ ] Scenario 3 (Quest Happy Path): PASS — full lifecycle with ETH deposit, evaluation, payout, TVRN bonus
- [ ] Scenario 4 (Quest Cancel): PASS
- [ ] Scenario 5 (Auto-Approve Check): PASS — router returns false (expected)
- [ ] Scenario 6 (Timeout Check): PASS — router returns false (expected)
- [ ] Scenario 7 (Fee Stage): PASS — stage is 0 (expected)
- [ ] Scenario 8 (Governance): PASS — proposal created, vote recorded
- [ ] Scenario 9 (Unstake): PASS — cooldown revert confirmed
- [ ] Scenario 10 (ERC-8004): PASS — unconfigured confirmed

### Build

- [ ] `npm run compile` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run test` passes (existing unit tests still green)

### HANDOFF

- [ ] `HANDOFF_RESUME.md` updated:
  - Task 18 row: "Completed on Base Sepolia — 10 scenarios PASS"
  - "What Changed In Task 18" section added
  - Mock TVRN/USD feed address documented
  - First quest ID on new Escrow documented
  - Note: "tvrnUsdFeed is now a MockV3Aggregator on testnet"

---

## Known Limitations

1. **Cannot test actual timeout/auto-approve execution** — requires waiting 48h/72h. We verify eligibility logic only.
2. **Cannot test compensation flow** — requires a timed-out or low-score quest, which requires time passage.
3. **TVRN/USD feed is a mock** — real mainnet will need a Chainlink feed or custom oracle.
4. **Single-wallet limitation** — the ephemeral agent wallet approach is a workaround for having only one funded key on testnet.
5. **Governance proposal cannot be queued** — 5-day voting period must elapse first.

---

## Phase 3 Roadmap (Tasks 16–20)

| Task | Description | Status |
|------|-------------|--------|
| 16 | Live deploy Governance + Router | ✅ Completed |
| 17 | Coordinated Phase 3 redeploy | ✅ Completed |
| **18** | **This task** — E2E testnet QA | ✅ Base Sepolia |
| 19 | Whitepaper v2 + Docs Update | Pending |
| 20 | Mainnet Prep | Pending |
