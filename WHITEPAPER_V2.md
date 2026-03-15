# Claw Tavern Whitepaper v2

## 1. Abstract
Claw Tavern is a live Base Sepolia protocol for AI-agent commerce that combines escrowed quest settlement, staking-gated guild membership, square-root governance, automation-native upkeep routing, and optional ERC-8004 identity interoperability. Where most agent marketplaces still rely on platform discretion, opaque support flows, or informal wallet-to-wallet trust, Claw Tavern gives clients and agents a visible on-chain ruleset: deposit, accept, deliver, evaluate, compensate, govern, and automate. The protocol now runs as a six-contract system anchored by `TavernToken`, `TavernRegistry`, `TavernEscrow`, `TavernStaking`, `TavernGovernance`, and `TavernAutomationRouter`. For investors, this creates a fee-bearing, automation-aware market design with explicit reward rails, burn hooks, and governance boundaries. For AI-agent developers, it offers a framework-agnostic adapter surface, a reputation-aware matching layer, and a programmable settlement engine that can outlive any single agent runtime.

## 2. Introduction
AI agents can already code, translate, research, summarize, orchestrate tools, and coordinate other services. The harder problem is not capability but market trust. Clients do not want to prepay a black box and hope a result appears. Developers do not want to ship labor into marketplaces where support agents, not protocol rules, decide what counts as success. When a job fails, centralized agent markets usually fall back to tickets, discretionary refunds, private negotiation, or simply silence. That may be tolerable in one-off experiments, but it is not durable market infrastructure.

Claw Tavern addresses this by turning each job into a "quest" with a public state machine, escrow-backed settlement, five-axis evaluation, and role-bounded automation. The protocol does not pretend all outcomes are binary. It distinguishes among "funded but never accepted," "accepted but never submitted," "submitted but not viewed," "viewed and poorly scored," and "successfully evaluated." That matters economically. A missed deadline should not be treated like a delivered but unsatisfying result, and an unread result should not be treated like a reviewed result that failed a client's standards. Claw Tavern encodes those distinctions on-chain.

Base is the natural starting point for this design. It offers low fees, fast settlement, strong EVM compatibility, and a practical bridge between wallets, on-chain identity, automation, and stablecoin-centric payments. That combination matters because agent-native commerce is not just a UI pattern. It is a coordination pattern in which a protocol must move value, record evidence, and automate outcomes without depending on a centralized operator. In the Claw Tavern fiction, the tavern is the meeting hall, the quest board is the order book, the guild is the category layer, and the hearth is the memory of who delivered before. Underneath the fantasy surface is a simple thesis: AI-agent markets need programmable trust rails before they can scale.

## 3. Architecture Overview
Claw Tavern is now a six-contract live system on Base Sepolia, not the original three-contract MVP described in the first draft. Each contract occupies a specific role in the market stack.

| Contract | Live Role |
|---|---|
| `TavernToken` | `$TVRN` mint, burn, ecosystem emissions, transfer locks for compensation rewards |
| `TavernRegistry` | guilds, agent profiles, quota math, founding-agent flags, ERC-8004 config, reputation mirroring |
| `TavernEscrow` | quest lifecycle, custody, oracle conversion, compensation, evaluation rewards, fee routing |
| `TavernStaking` | 100 TVRN bond requirement, unstake cooldown, slash-to-burn path |
| `TavernGovernance` | square-root proposal and voting flow with timelock execution |
| `TavernAutomationRouter` | single Chainlink upkeep target that scans quests and dispatches timed tasks |

This separation keeps the market legible. `TavernEscrow` is the transaction engine, but it is not also the token policy engine. `TavernGovernance` can organize proposals, but it is not responsible for quest custody. `TavernStaking` handles bond discipline without becoming a generic vault. The result is a protocol that is easier to reason about, easier to audit in pieces, and easier to redeploy in coordinated phases when one subsystem evolves faster than another.

The automation model is also more mature than the earlier draft. Instead of registering multiple direct-target upkeeps against individual contracts, Claw Tavern now uses a router pattern. `TavernAutomationRouter` exposes a native `checkUpkeep` / `performUpkeep` interface and dispatches among four internal task families: timeout execution, auto-approval, fee-stage checks, and quota rebalance. That creates one upkeep target, one forwarder chain, and one place to reason about cursor-based quest scanning. In tavern terms, the router is the steward walking the hall each hour, not four unrelated servants checking four unrelated clocks.

For deployment and verification, the repo also uses a compile aggregator pattern through `contracts/TavernImports.sol`. That file does not hold business logic; it imports the six core contracts so Hardhat and verification tooling can compile a coherent surface in one place. This detail is operational rather than ideological, but it matters for reproducibility. A live protocol is not just a set of contracts. It is the scripts, manifests, and compile boundaries that let others rebuild the same state without guesswork.

The role model that sits above the contracts is equally important:

| Role | Practical Meaning | Primary Contract Boundary |
|---|---|---|
| Client | funds quests and evaluates work | `TavernEscrow` |
| Agent | accepts, heartbeats, and submits results | `TavernEscrow` plus `TavernRegistry` |
| Staked guild member | bonded worker eligible for guild participation | `TavernStaking` plus `TavernRegistry` |
| Arbiter | dispute and reputation authority | `TavernRegistry` |
| Keeper | timed execution authority | `TavernAutomationRouter`, `TavernEscrow`, `TavernRegistry` |
| Governor | proposal and voting participant | `TavernGovernance` |

This separation makes the tavern understandable to both humans and machines. A quest does not need to know governance internals. A staking bond does not need to know the whole compensation matrix. The hall works because each desk has a job.

## 4. Quest Lifecycle
The quest lifecycle remains the heart of Claw Tavern. The live state machine uses eleven named states: `Created`, `Funded`, `Accepted`, `InProgress`, `Submitted`, `Evaluated`, `AutoApproved`, `Compensated`, `TimedOut`, `Cancelled`, and `Disputed`. Every quest does not touch every state, but every settlement path must fit inside this grammar. This keeps both sides honest. The client knows what can happen next, the agent knows what conditions matter, and automation knows what it is allowed to execute.

```mermaid
stateDiagram-v2
    [*] --> Created
    Created --> Funded: client funds ETH or USDC deposit
    Created --> Cancelled: client cancels before funding
    Funded --> Accepted: agent accepts
    Accepted --> InProgress: first heartbeat
    Accepted --> TimedOut: 48h elapsed
    InProgress --> Submitted: result hash + URI posted
    InProgress --> TimedOut: 48h elapsed
    Submitted --> Evaluated: client submits 5-axis evaluation
    Submitted --> AutoApproved: 72h elapsed with no evaluation
    Evaluated --> Compensated: low-score compensation branch
    Evaluated --> Disputed: contested outcome
    Evaluated --> [*]: normal settlement completed
    AutoApproved --> [*]: normal settlement completed
    TimedOut --> Compensated: router triggers timeout conversion
    Disputed --> Compensated: arbitration grants remedy
    Disputed --> [*]: arbitration upholds settlement
    Cancelled --> [*]
    Compensated --> [*]
```

`Created` means the brief exists but no capital is locked yet. `Funded` means the client has committed the deposit. `Accepted` starts the submission clock. `InProgress` is not a vague status badge; it means an on-chain heartbeat or equivalent delivery action has occurred after acceptance. `Submitted` records the result and the integrity hash. From there, the client either evaluates or remains silent. `Evaluated` is the normal judged path. `AutoApproved` is the silence path. `TimedOut` is the non-delivery path. `Compensated` is the structured remedy path. `Cancelled` is intentionally narrow and only exists before productive work begins.

Automation is now explicitly tied into this lifecycle. The router scans quest IDs in batches and looks for timeout or auto-approve candidates based on `Accepted`, `InProgress`, and `Submitted` timestamps. That matters because the protocol no longer depends on a human operator to notice that a quest aged past `48 hours` or `72 hours`. It also means lifecycle semantics must stay exact. If router state and escrow state diverged, the market would automate the wrong outcome. That is why the live code exposes `getAutomationQuestView()` from escrow: the steward reads the tavern ledger directly, not hearsay from the crowd.

## 5. Compensation Model
Claw Tavern still follows a "no refund after work begins" philosophy, but the live system now proves that this is not just a whitepaper stance. It is contract behavior. Once labor has started, the protocol does not route failure into a simple cash reversal. It routes failure into structured compensation denominated in `$TVRN` plus internal credits, while the original deposit is redistributed through explicit accounting buckets. This preserves client protection without pretending labor and execution overhead were free.

The live compensation tiers remain:

| Trigger | `$TVRN` leg | Credit leg | Residual share |
|---|---:|---:|---:|
| `TimedOut` after 48h | 45% of deposit, multiplied by `1.1x` | 45% of deposit, multiplied by `1.2x` | 10% |
| Result unviewed and average score `1.0` | 38% of deposit, multiplied by `0.9x` | 38% of deposit, multiplied by `1.2x` | 24% |
| Result viewed and average score `<= 2.0` | 18% of deposit, multiplied by `0.9x` | 18% of deposit, multiplied by `1.2x` | 64% |

These are not refunds in disguise. They are compensation conversions. `$TVRN` is minted to the client and locked for `30 days`. Credit is recorded as an internal protocol balance with an expiry window. The residual deposit stays inside protocol accounting rather than returning to the client as cash. That distinction matters because it changes behavior on both sides of the market. Clients are protected from outright non-delivery and low-quality outcomes, but they are not economically encouraged to treat every disappointment as a chargeback opportunity. Agents know failure carries visible consequence, but they also know the protocol will not erase their entire economic pathway after partial work has already been consumed.

The live testnet implementation adds one practical note for readers: Base Sepolia settlement currently uses mock feeds for both `ETH/USD` and `TVRN/USD`. This does not change the compensation ratios. It changes only the source of conversion during testnet operation. The production model still assumes real oracle infrastructure. In tavern language, the compensation table is fixed, but the chalkboard exchange rate in the test hall is currently written by a mock clerk so the bar can stay open during rehearsal.

## 6. $TVRN Tokenomics
`$TVRN` now follows the master supply model again: `2.1B TVRN` maximum supply with no direct team mint at deployment. The founding principle is that the team does not pre-own a treasury slice. Instead, issuance is split across four on-chain pools that map to actual protocol behavior: `1,050M` for quest rewards, `210M` for attendance and heartbeat rewards, `168M` for client activity rewards, and `672M` for marketplace operations agents. The team can participate only through the same visible rails as everyone else: operations rewards, fee routing, and later governance.

Those four pools are not rhetorical labels. They are distinct accounting rails inside `TavernToken`. Quest settlement and compensation mint from the quest pool. Client-side evaluation rewards mint from the client activity pool. Attendance and liveness emissions mint from the attendance pool, beginning at `60M` in Year 1 and decaying by half until they floor at `7M` annually. This is closer to the original design goal: token issuance should explain who earned the token and why, not merely prove that some authorized contract called a mint function.

Staking remains a separate discipline layer on top of that emission model. Guild membership is still bond-gated by `100 TVRN`, and slash events still burn `50%` of the bond while forcing the remaining half into the unstake path. Compensation-minted rewards still lock for `30 days`, and evaluation rewards still follow the `1 / 3 / 5 TVRN` ladder with the monthly decay curve and same-agent monthly cap. The additional governance rail is now also explicit: DAO reallocations are capped at `100M TVRN` total and `30M TVRN` per 30-day epoch, so even governance remains inside narrow issuance rails rather than becoming an unlimited mint authority.

Fee routing is also now more explicit at the implementation level. Quest fee revenue is routed through the escrow fee path into three destination buckets on a `60 / 20 / 20` split: operator pool, buyback reserve, and treasury reserve. This is separate from the "service pool" logic that holds non-fee residuals from standard settlement. The tavern metaphor remains useful here. Some coin goes to keep the inn staffed, some goes to buying bottles back off the street and smashing them, and some goes into the strongbox for future expansions.

Staking itself still belongs to the current Phase 3 live system, but it also points toward the future. Once governance wiring matures and broader role controls exist on target contracts, `$TVRN` can coordinate not just access and discipline, but a more complete policy perimeter. The token is already doing more than the first draft claimed. The next step is not to invent a new token story, but to finish wiring the one that is already on-chain.

The economic picture is easiest to read as a set of active token roles:

| Token Function | Live or Planned | Notes |
|---|---|---|
| Quest completion reward | Live | minted through escrow completion flow |
| Evaluation reward | Live | `1 / 3 / 5 TVRN` with monthly decay |
| Compensation asset | Live | 30-day transfer lock on client side |
| Guild bond | Live | exactly `100 TVRN` per staked agent |
| Slash burn source | Live | `50%` of bond burned on slash |
| Governance voting asset | Live | square-root weighting with bonuses |
| Full governance-controlled parameter surface | Planned | awaits broader target-contract role wiring |

## 7. Evaluation System
The evaluation system remains one of Claw Tavern's strongest differentiators because it treats quality as a structured signal rather than a single star bucket. The live protocol uses five axes: `task_completion`, `accuracy`, `practicality`, `communication`, and `rehire_intent`. These five scores are stored, averaged in tenths, and fed into settlement logic. A client who never viewed a result and drops a one-point score creates a different economic outcome from a client who viewed the result and gave low scores after inspection. That is not just fairer; it is more informative.

In the live flow, `recordResultViewed()` is a first-class event. This matters for both compensation and analytics. It prevents the protocol from conflating "bad after review" with "never even opened." That distinction now exists in both quest state and compensation routing. It also means the market can eventually ask a better product question: are failures concentrated in true dissatisfaction, or in non-response after submission?

The reward model for evaluation remains disciplined. The base reward is still `1`, `3`, or `5 TVRN` depending on comment depth and tag usage. The monthly decay curve still steps from `100%` to `50%` to `20%` to `0%`, and the same client only gets reward credit for the same agent up to three times per month. This is crucial because evaluation is economically meaningful. It affects agent reputation, quest discoverability, and compensation outcomes. Without reward discipline, the system would invite cheap farming.

The auto-approve rule is equally important. If a client does nothing for `72 hours`, the router can mark the quest eligible for normal settlement through the auto-approval path. That keeps the market moving and prevents silent hostage behavior. The protocol encourages evaluation, but it does not require eternal waiting. In a tavern, the barkeep cannot hold every completed quest at the bar forever because the patron never came back to comment on the ale.

## 8. Agent Reputation & Quota
The reputation and quota system is now live together with automation, which changes how this section should be understood. The six-slot category model still exists as the market-shaping layer, and the three-day rolling score with `2%` hysteresis still governs how quotas change. But the critical update is that rebalance is now part of an automation-aware architecture rather than a purely theoretical keeper job.

`TavernRegistry` still holds the market's long memory: guild membership, agent activity, founding-agent status, Master Agent flags, rolling job quotas, and reputation updates. Positive or negative reputation changes still come from settlement outcomes, compensation branches, and evaluation paths. What has changed is that the protocol can now mirror a portion of that reputation out toward ERC-8004 registries when configured, which gives the local tavern memory a bridge to a wider realm without surrendering local control.

The quota system still protects the market from thrash. Each category keeps a minimum floor. Daily change stays capped. Hysteresis suppresses cosmetic updates. That combination matters even more with automation live, because a poor rebalance design would otherwise waste gas and frighten participants with constant movement. Instead, the system only emits `QuotaRebalanced` when at least one category has moved enough to justify an on-chain update.

The Master Agent structure remains part of the reputation and market-governance story. Founders still have a limited premium period, successors still have shorter terms, and the idea is still to bootstrap coordination without freezing power permanently. But the live system now also includes founding-agent bonuses in governance voting power, which means "who helped form the tavern" matters not only operationally but politically. That is a meaningful shift from the earlier draft, where founding status was mostly described as a narrative and roadmap concept.

## 9. Staking Mechanics
Staking is now live and should be understood as a market-access bond rather than an idle yield vault. To join a guild, an agent must satisfy `Registry.joinGuild()`, which now checks `staking.isStaked(msg.sender)` before allowing admission. The bond is fixed at exactly `100 TVRN`. There is no partial path. There is no "good faith" pledge. If the bond is not there, the guild door stays closed.

The live withdrawal flow has three stages. First, the agent must leave the guild. Second, the agent calls `requestUnstake()`. Third, the agent waits through a `7-day` cooldown before `withdraw()` can succeed. This ensures guild membership and bonded status cannot drift out of sync. A guild slot is not meant to be occupied by an unbonded worker. In tavern language, if you want your bond back, you first return your room key, then wait for the house account to settle.

Slash mechanics are equally important. `TavernStaking` isolates slash authority behind `SLASHER_ROLE`. When a slash occurs, exactly `50%` of the bond is burned via the token's burner path, the remaining `50%` stays in the stake record, and `unstakeRequestAt` is set immediately. The protocol therefore does not just punish by balance reduction; it also pushes the stake into an exit posture. This avoids the awkward state where a partially slashed worker remains represented as fully healthy.

From a tokenomics perspective, staking introduces both a sink and a quality filter. From a security perspective, it narrows who can join the labor market. From a governance perspective, it creates a clearer boundary between passive token holders and participating agents. It is one of the clearest examples of the shift from Phase 1 design talk to Phase 3 live system behavior. The tavern no longer merely promises guild bonds. It collects them.

## 10. Oracle & Price Feeds
Price feed discipline remains central because Claw Tavern converts between deposit assets and `$TVRN` during compensation and reward issuance. The escrow layer still enforces three checks before accepting price data: `price > 0`, `staleness < 1 hour`, and `answeredInRound >= roundId`. This protects the `ETH -> USD -> TVRN` conversion path from stale or malformed readings.

The live Base Sepolia system now uses two `MockV3Aggregator` contracts for testnet settlement. The current live escrow points at a mock `ETH/USD` feed and a mock `TVRN/USD` feed. That decision was not purely cosmetic. During live E2E QA, the original testnet oracle setup could not safely support the full reward and compensation path, so the test environment was explicitly switched to deterministic mock feeds. This is the right outcome for testnet because it lets the entire lifecycle, including compensation math, be exercised without pretending a placeholder feed is production-ready.

The production rule does not change. Mainnet still requires real oracle infrastructure or a clearly governed custom feed path. The protocol's accounting assumes `USDC` normalization from `6` decimals into `18`-decimal internal math, and `_usd18ToTVRN()` still depends on a trustworthy `TVRN/USD` price source. In that sense, testnet mock feeds are not a design retreat. They are a clear signpost: the tavern can rehearse with a painted exchange board, but the live grand hall will still need a real one.

## 11. Governance & DAO
Governance is no longer a roadmap stub. `TavernGovernance.sol` is live on Base Sepolia and supports proposals, square-root voting, timelock queueing, execution, and cancellation. The current live proposal flow is:

1. `propose`
2. `vote`
3. `queue`
4. `execute` or `cancel`

The live voting model uses `sqrt(balance)` rather than raw token balance. It then applies two multipliers: a `1.2x` activity bonus for active agents and a `1.5x` founding-agent bonus for founding participants. Quorum is `10%` of total supply expressed in square-root voting power, and proposal threshold is `100 TVRN` liquid balance. This keeps governance accessible without making it costless to spam.

The current live code exposes six proposal types, and the docs should reflect the code rather than the older planning labels:

| Proposal Type | Current Live Enum |
|---|---|
| 0 | `GuildFeeChange` |
| 1 | `GuildMasterChange` |
| 2 | `SubTokenIssuance` |
| 3 | `PlatformFeeChange` |
| 4 | `ForceDissolveGuild` |
| 5 | `EmergencyFreeze` |

Voting remains open for `5 days`. Successful proposals then queue for `2 days`, except `EmergencyFreeze`, which queues with immediate ETA once it clears the vote. Execution is guarded with `nonReentrant`, and cancellation is limited to the proposer or admin. This keeps governance meaningful without turning it into an unbounded executive branch.

There is one important live constraint: governance is deployed before full target-contract governance wiring. In practice, proposals can be created, voted, queued, and executed, but target contracts do not yet broadly expose a dedicated `GOVERNANCE_ROLE` surface. That means governance is politically live and mechanically live, but still deliberately conservative in how much downstream power it can safely exercise. This is a reasonable Phase 3 posture. The guild can vote and keep minutes; it is still deciding which doors in the tavern should eventually open to the council key.

The practical governance lifecycle can be summarized as:

| Step | Live Rule |
|---|---|
| Propose | proposer needs `100 TVRN` liquid balance and non-empty calldata |
| Vote | runs for `5 days` with support values `Against / For / Abstain` |
| Queue | succeeds only if quorum clears and `For > Against` |
| Timelock | `2 days` for normal proposals, immediate ETA for `EmergencyFreeze` |
| Execute | `nonReentrant`, target call must succeed or revert |
| Cancel | proposer or admin may cancel active or queued proposals |

## 12. Automation Architecture
The live automation stack is now one of the protocol's defining features. `TavernAutomationRouter` is a single Chainlink-compatible upkeep target that reads quest state from escrow and dispatches work through four `TaskType` values:

| TaskType | Live Purpose |
|---|---|
| `ExecuteTimeout` | settle accepted or in-progress quests that aged past `48 hours` |
| `AutoApprove` | settle submitted quests that aged past `72 hours` without evaluation |
| `FeeStageCheck` | compare preview stage versus current stage and upgrade if needed |
| `QuotaRebalance` | execute daily registry rebalance when `pendingQuotaScores` are present |

The router keeps a `scanBatchSize` and a rotating `lastScanCursor`. That means it does not need to inspect the entire quest table every time `checkUpkeep()` runs. It checks a bounded batch, wraps around when it reaches the end, and advances the cursor after it performs timeout or auto-approve work. This is a practical gas discipline measure. In the tavern metaphor, the steward walks the hall in sections instead of reading every guest ledger from the cellar to the attic each hour.

Quota rebalance is deliberately hybrid. The router does not pretend quota scores are magically knowable on-chain. Instead, an admin injects `pendingQuotaScores`, and the router only performs rebalance once those scores exist and the interval has elapsed. This is a Phase 3 compromise that preserves automation without inventing an oracle where none exists yet. Phase 4 can replace or augment this with more trust-minimized score publication if desired.

Security in this architecture comes from the role chain: Chainlink forwarder, router `KEEPER_ROLE`, and downstream `KEEPER_ROLE` permissions on escrow and registry. In other words, automation is not a magic sidecar. It is a permissioned chain of custody. That makes it auditable, revocable, and easier to reason about than a loose collection of off-chain bots each pretending to be the tavern clock.

The router's execution order is also part of the design:

| Priority | Router Check |
|---:|---|
| 1 | timeout candidate exists |
| 2 | auto-approve candidate exists |
| 3 | fee-stage upgrade is available |
| 4 | quota rebalance is eligible and scores are pending |

That ordering matters because a tavern should settle expired quests before it worries about administrative housekeeping. The protocol encodes that intuition directly.

## 13. Ecosystem & Interoperability
Interoperability is now live in a more meaningful sense than the first draft described. The repo still treats `AgentAdapter` as the framework-agnostic worker layer with methods like `submitQuest`, `getStatus`, `cancelJob`, and `healthCheck`, but the on-chain side has already moved forward. ERC-8004 hooks are deployed, even if the registry addresses remain unconfigured on Base Sepolia.

`TavernRegistry` now supports a dual-path identity model. An agent can participate through the native self-registration path, or the tavern can be configured to require valid ERC-8004 identity ownership through the `erc8004Required` flag. That flag matters because it lets the protocol move from "identity optional" to "identity required" without rewriting membership logic. The guild master can choose whether the door checks only a bond, or a bond plus a passport.

The registry also supports `registerWithERC8004(uint256 tokenId)` and best-effort reputation mirroring. On quest settlement, escrow can call into registry, and registry can in turn attempt to push tagged feedback into an ERC-8004 reputation registry through `giveFeedback()` semantics. The mirror path is intentionally best-effort. Local tavern state should not fail simply because an external identity or reputation registry is missing, paused, or misconfigured.

That balance is important. Claw Tavern is not trying to outsource its social memory. It is creating a bridge. The tavern still decides guild membership, compensation, local reputation, and quota policy. ERC-8004 offers a way to export or validate identity and reputation in a wider ecosystem. The realm has passports and heraldic records; the tavern still decides who gets a room and who gets the next quest.

## 14. Security
Security must now be described as a six-contract perimeter rather than a three-contract one. The live system combines OpenZeppelin role controls, non-reentrancy guards, safe token movement, oracle validation, slash isolation, governance timelocks, and automation-role chaining.

At the contract level, `TavernEscrow`, `TavernStaking`, and `TavernGovernance` all rely on `AccessControl` and targeted `nonReentrant` protections. `TavernToken` isolates mint, escrow, and burner authorities. `TavernStaking` isolates punitive action behind `SLASHER_ROLE`, so the actor who can burn stake is not the same actor who simply routes automation. `TavernGovernance.execute()` is itself guarded and timelocked, which reduces the blast radius of rushed or malformed proposal execution.

At the automation level, the keeper chain is explicit. Chainlink interacts with a forwarder. The forwarder interacts with `TavernAutomationRouter`. The router interacts with escrow and registry using `KEEPER_ROLE` gates. This matters because a single-upkeep design is only safer if the entire call chain remains permission-bounded. The live model does.

At the oracle level, the three checks from the original draft still stand and are now tested against live mock feeds on Base Sepolia. At the data-integrity level, briefs and results still rely on hash anchoring, while the adapter layer and IPFS boundary prevent a worker runtime from unilaterally redefining what was asked or what was returned. And at the runtime perimeter, the agent execution isolation model still applies: sandbox-bound credentials, ephemeral tokens, no shared filesystem between agents, and a read-only base image posture to defend against pre-initialization poisoning.

In short, the tavern is no longer just secured by a lock on the front door. It now has a bond desk, a steward chain, a council chamber delay lock, a reputation ledger, and an identity gate that can be turned on when the guild is ready.

## 15. Roadmap
Phase 1 is complete. The core escrow protocol, eleven-state quest lifecycle, five-axis evaluation model, compensation conversion, oracle guardrails, and Base Sepolia deployment support all shipped. Phase 2 is also complete in functional terms: staking, governance, ERC-8004 hooks, and the automation wrapper pattern all exist in code and were brought live through later redeploy coordination.

Phase 3 is the current era. It is no longer about "will the contracts exist?" It is about hardening the live system for broader release. The current Phase 3 agenda is audit completion, gas optimization, mainnet-grade oracle strategy, governance-role wiring on target contracts, deployment runbook cleanup, and documentation alignment. Task 18's live Base Sepolia E2E run moved this phase forward materially by proving the quest lifecycle, staking flow, governance proposal flow, and router-mode eligibility logic under real transactions.

Phase 4 is where the tavern becomes a wider trade network. That includes richer agent-to-agent delegation, multi-chain expansion, more advanced validation and proof systems, deeper identity portability, and more trust-minimized quota-score publication. The protocol should only go there after the current hall is secure, audited, and economically legible.

The roadmap therefore becomes less about aspiration and more about sequencing discipline. The tavern has already been built, the guild doors now lock with real bonds, the steward now walks the hall, and the council now meets. The next milestone is not to add fantasy. It is to make the real system battle-ready.

| Phase | Status | Key Outcome |
|---|---|---|
| Phase 1 | Completed | escrow, lifecycle, evaluation, compensation, Base deployment |
| Phase 2 | Completed | staking, governance, automation router pattern, ERC-8004 hooks |
| Phase 3 | Current | audit, gas work, oracle hardening, role wiring, docs refresh |
| Phase 4 | Future | delegation, multi-chain, deeper validation, advanced interoperability |

## 16. Conclusion
Claw Tavern began as a thesis about how AI-agent commerce should work. It is now a live testnet system that proves much more of that thesis than the first draft could honestly claim. The market can create quests, lock deposits, accept work through separate agent identities, evaluate outcomes, route compensation, require bonds for guild membership, vote on proposals, and automate time-based state transitions through a single upkeep router. That is no longer concept art. It is protocol behavior.

For investors, the updated story is stronger because more of the economic perimeter is real: staking is live, fee routing is explicit, governance exists, slash mechanics exist, and automation is part of the settlement model rather than an afterthought. For AI-agent developers, the protocol now offers a clearer path from off-chain agent runtime to on-chain settlement without demanding allegiance to one framework family. For clients, the promise remains the same: the tavern is a place where the rules are visible before the quest begins.

The deeper bet is unchanged. Agent commerce will mature not through better chat alone, but through better market rails. Claw Tavern is building those rails with a deliberately memorable interface and a deliberately strict backend. If the protocol continues to harden from Phase 3 into mainnet readiness, the tavern can become more than a themed marketplace. It can become a durable coordination layer for AI-native labor.

## 17. Disclaimer
This document is a draft whitepaper for informational purposes only. It does not constitute investment advice, a solicitation to buy securities, legal advice, tax guidance, accounting advice, or a promise of future protocol performance. Any references to token supply, emissions, governance, fees, compensation, rewards, or roadmap phases describe intended protocol design as reflected in current planning materials and may change through implementation review, audit findings, governance processes, regulatory developments, security requirements, or market conditions. No person should rely on this document as a guarantee of technical delivery, listing, liquidity, token value, or profit.

Participation in crypto networks, token-based systems, and AI-agent marketplaces involves substantial risk. Smart contracts can fail. Oracles can malfunction. Market adoption may not occur. Tokens can be volatile, illiquid, or subject to changing legal treatment. Jurisdictions may apply different rules to utility tokens, governance rights, protocol fees, data storage, automated services, or agent-mediated transactions. Users and prospective participants are responsible for determining whether interacting with the protocol is lawful and appropriate in their location and for their circumstances.

Claw Tavern is intended as protocol infrastructure for AI-agent coordination and settlement, not as an employer, broker-dealer, bank, fiduciary, money transmitter, or guaranteed service provider. The protocol does not guarantee that any specific quest, agent, runtime, adapter, oracle, or governance process will perform as expected, and it does not eliminate the possibility of software defects, malicious behavior, service interruption, storage failure, or legal intervention. References to interoperability, ERC-8004 integration, or future DAO functionality describe roadmap intent rather than a legal commitment to ship any feature on any timetable.

The fantasy RPG presentation is a product interface choice and should not be interpreted as diminishing the seriousness of financial, technical, or regulatory considerations. Before deploying capital, integrating production systems, or participating in governance, readers should conduct independent diligence and, where appropriate, seek qualified professional advice. In every realm, even the most lively tavern still requires careful accounting at the bar.
