import "dotenv/config";

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt } from "./utils/hardhatContracts";

const { ethers, network } = hre;

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const DEPLOYMENT_PATH = path.join(process.cwd(), "deployments", "baseSepolia.json");
const RESULTS_PATH = path.join(process.cwd(), "test", "sepolia-smoke-test.json");
const ONE_TVRN_CENT = 1_000_000n;
const EXPECTED_MAX_SUPPLY = ethers.parseEther("2100000000");
const EXPECTED_QUEST_POOL = ethers.parseEther("1050000000");
const EXPECTED_ATTENDANCE_POOL = ethers.parseEther("210000000");
const EXPECTED_CLIENT_POOL = ethers.parseEther("168000000");
const EXPECTED_OPERATION_POOL = ethers.parseEther("672000000");
const AGENT_ETH_TOPUP = ethers.parseEther("0.00005");
const STAKE_TOPUP_REWARD_COUNT = 3;
const QUEST_DEPOSIT = ethers.parseEther("0.00001");
const PRICE_REFRESH_TEST_THRESHOLD = 1;
const PRICE_REFRESH_RESTORE_THRESHOLD = 50 * 60;
const PRICE_REFRESH_TASK = 5n;
const ORACLE_STALENESS_SECONDS = 60 * 60;

type DeploymentManifest = {
  generatedAt?: string;
  addresses: {
    adminPriceFeed?: string | null;
    tavernToken: string;
    tavernRegistry: string;
    tavernEscrow: string;
    tavernStaking: string;
    tavernGovernance: string;
    tavernAutomationRouter: string;
  };
  task25Redeploy?: {
    smokeTestPath?: string;
    smokeTestPassed?: boolean;
    smokeTestQuestId?: string;
    smokeTestExecutedAt?: string;
  };
};

type SmokeCheck = {
  name: string;
  status: "PASS" | "FAIL";
  details?: Record<string, unknown>;
  error?: string;
};

type SmokeResults = {
  generatedAt: string;
  network: {
    name: string;
    chainId: number;
  };
  deployer: string;
  addresses: DeploymentManifest["addresses"];
  questId: string | null;
  txHashes: string[];
  checks: SmokeCheck[];
  pass: boolean;
  error?: string;
};

function normalize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_, current) => (typeof current === "bigint" ? current.toString() : current))
  );
}

function toJson(value: unknown): string {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
}

async function readDeploymentManifest(): Promise<DeploymentManifest> {
  return JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as DeploymentManifest;
}

async function writeDeploymentManifest(manifest: DeploymentManifest): Promise<void> {
  await writeFile(DEPLOYMENT_PATH, toJson(manifest), "utf8");
}

function summarizeError(error: unknown): string {
  if (!error) {
    return "Unknown error";
  }

  const maybe = error as {
    shortMessage?: string;
    reason?: string;
    message?: string;
    errorName?: string;
    data?: string;
    info?: { error?: { data?: string } };
    error?: { data?: string };
  };

  return maybe.shortMessage ?? maybe.reason ?? maybe.message ?? maybe.errorName ?? String(error);
}

function extractRevertData(error: unknown): string[] {
  const maybe = error as {
    data?: string;
    error?: { data?: string };
    info?: { error?: { data?: string } };
  };

  return [
    maybe?.data,
    maybe?.error?.data,
    maybe?.info?.error?.data
  ].filter((value): value is string => typeof value === "string");
}

function assertRevertSignature(
  error: unknown,
  signature: string,
  label: string,
  options?: { allowBareRevert?: boolean }
): void {
  const selector = ethers.id(signature).slice(0, 10).toLowerCase();
  const message = summarizeError(error).toLowerCase();
  const matchesSelector = extractRevertData(error).some((value) => value.toLowerCase().startsWith(selector));
  const signatureName = signature.split("(")[0].toLowerCase();
  const allowBareRevert = options?.allowBareRevert === true;

  assert(
    matchesSelector ||
      message.includes(signatureName.toLowerCase()) ||
      message.includes("accesscontrol") ||
      (allowBareRevert && message.includes("execution reverted")),
    `${label} should revert with ${signature}, got: ${summarizeError(error)}`
  );
}

function parseEventArgs(contract: any, receipt: any, eventName: string): any | null {
  for (const log of receipt.logs ?? []) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === eventName) {
        return parsed.args;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function getQuestState(quest: any): number {
  return Number(quest.state ?? quest[5]);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readWithRetry<T>(
  reader: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  attempts = 8,
  delayMs = 1500
): Promise<T> {
  let lastValue: T | undefined;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      lastValue = await reader();
      if (predicate(lastValue)) {
        return lastValue;
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  if (lastError) {
    throw lastError;
  }

  throw new Error(`Timed out waiting for ${label}`);
}

async function buildFeeOverrides(multiplier = 2n): Promise<Record<string, bigint>> {
  const feeData = await ethers.provider.getFeeData();
  const overrides: Record<string, bigint> = {};
  const baseFee = feeData.maxFeePerGas ?? feeData.gasPrice;
  const priorityFee = feeData.maxPriorityFeePerGas ?? 1_000_000n;

  if (baseFee && baseFee > 0n) {
    overrides.maxFeePerGas = baseFee * multiplier;
  }

  if (priorityFee > 0n) {
    overrides.maxPriorityFeePerGas = priorityFee * multiplier;
  }

  return overrides;
}

function isNonceRetryable(error: unknown): boolean {
  const message = summarizeError(error).toLowerCase();
  return message.includes("nonce too low") || message.includes("replacement transaction underpriced");
}

async function collectManagedTx(
  txHashes: string[],
  txFactory: (overrides: Record<string, bigint>) => Promise<any>
): Promise<any> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const tx = await txFactory(await buildFeeOverrides(BigInt(attempt + 1)));
      const receipt = await tx.wait();
      txHashes.push(tx.hash);
      return receipt;
    } catch (error) {
      lastError = error;
      if (!isNonceRetryable(error) || attempt === 3) {
        throw error;
      }
      await sleep(1500);
    }
  }

  throw lastError;
}

async function refreshMockFeedIfStale(
  feedAddress: string,
  txHashes: string[]
): Promise<{ refreshed: boolean; price: bigint; updatedAt: bigint }> {
  const feed = await ethers.getContractAt(
    [
      "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
      "function setRoundData(int256,uint256)"
    ],
    feedAddress
  );
  const round = await feed.latestRoundData();
  const price = BigInt(round[1]);
  const updatedAt = BigInt(round[3]);
  const latestBlock = await ethers.provider.getBlock("latest");
  const latestTimestamp = BigInt(latestBlock?.timestamp ?? Math.floor(Date.now() / 1000));

  if (updatedAt > latestTimestamp - BigInt(ORACLE_STALENESS_SECONDS)) {
    return { refreshed: false, price, updatedAt };
  }

  await collectManagedTx(txHashes, (overrides) => feed.setRoundData(price, latestTimestamp, overrides));
  return { refreshed: true, price, updatedAt: latestTimestamp };
}

function recordCheck(
  checks: SmokeCheck[],
  name: string,
  details: Record<string, unknown> = {}
): void {
  checks.push({ name, status: "PASS", details });
}

async function main(): Promise<void> {
  const txHashes: string[] = [];
  const checks: SmokeCheck[] = [];
  const deployment = await readDeploymentManifest();
  const currentNetwork = await ethers.provider.getNetwork();

  if (currentNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `scripts/sepolia-smoke-test.ts only supports Base Sepolia (84532). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const [rawDeployer] = await ethers.getSigners();
  const deployer = new ethers.NonceManager(rawDeployer);
  const deployerAddress = await deployer.getAddress();

  const adminPriceFeedAddress = deployment.addresses.adminPriceFeed;
  assert(adminPriceFeedAddress, "baseSepolia.json must include addresses.adminPriceFeed before the smoke test can run");

  const token = await getWorkspaceContractAt("TavernToken", deployment.addresses.tavernToken, deployer) as any;
  const registry = await getWorkspaceContractAt("TavernRegistry", deployment.addresses.tavernRegistry, deployer) as any;
  const staking = await getWorkspaceContractAt("TavernStaking", deployment.addresses.tavernStaking, deployer) as any;
  const escrow = await getWorkspaceContractAt("TavernEscrow", deployment.addresses.tavernEscrow, deployer) as any;
  const router = await ethers.getContractAt("TavernAutomationRouter", deployment.addresses.tavernAutomationRouter, deployer) as any;
  const adminPriceFeed = await ethers.getContractAt("AdminPriceFeed", adminPriceFeedAddress, deployer) as any;

  const results: SmokeResults = {
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId)
    },
    deployer: deployerAddress,
    addresses: deployment.addresses,
    questId: null,
    txHashes,
    checks,
    pass: false
  };

  try {
    const [
      totalSupply,
      maxSupply,
      questPoolRemaining,
      attendancePoolRemaining,
      clientPoolRemaining,
      operationPoolRemaining
    ] = await Promise.all([
      token.totalSupply(),
      token.MAX_SUPPLY(),
      token.questPoolRemaining(),
      token.attendancePoolRemaining(),
      token.clientPoolRemaining(),
      token.operationPoolRemaining()
    ]);

    assert.equal(maxSupply, EXPECTED_MAX_SUPPLY, "MAX_SUPPLY should match 2.1B TVRN");
    assert(questPoolRemaining <= EXPECTED_QUEST_POOL, "Quest pool should not exceed its initial cap");
    assert(attendancePoolRemaining <= EXPECTED_ATTENDANCE_POOL, "Attendance pool should not exceed its initial cap");
    assert(clientPoolRemaining <= EXPECTED_CLIENT_POOL, "Client pool should not exceed its initial cap");
    assert(operationPoolRemaining <= EXPECTED_OPERATION_POOL, "Operation pool should not exceed its initial cap");
    assert.equal(
      totalSupply + questPoolRemaining + attendancePoolRemaining + clientPoolRemaining + operationPoolRemaining,
      EXPECTED_MAX_SUPPLY,
      "Pool accounting plus totalSupply should still equal MAX_SUPPLY"
    );
    recordCheck(checks, "Token bootstrap state", {
      totalSupply,
      maxSupply,
      questPoolRemaining,
      attendancePoolRemaining,
      clientPoolRemaining,
      operationPoolRemaining,
      pristineFreshState: totalSupply === 0n
    });

    const latestRound = await adminPriceFeed.latestRoundData();
    const latestAnswer = BigInt(latestRound.answer ?? latestRound[1]);
    const latestUpdatedAt = BigInt(latestRound.updatedAt ?? latestRound[3]);
    assert.equal(latestAnswer, ONE_TVRN_CENT, "AdminPriceFeed should start at $0.01");
    assert(
      latestUpdatedAt > 0n && latestUpdatedAt >= BigInt(Math.floor(Date.now() / 1000) - 3600),
      "AdminPriceFeed should be fresh"
    );
    assert.equal(await adminPriceFeed.isRefresher(deployment.addresses.tavernAutomationRouter), true, "Router should be an authorized refresher");
    recordCheck(checks, "AdminPriceFeed bootstrap state", {
      latestAnswer,
      latestUpdatedAt,
      routerIsRefresher: true
    });

    const agentWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    const agent = new ethers.NonceManager(agentWallet);
    const agentAddress = await agent.getAddress();

    await collectManagedTx(txHashes, (overrides) =>
      deployer.sendTransaction({
        to: agentAddress,
        value: AGENT_ETH_TOPUP,
        ...overrides
      })
    );

    await collectManagedTx(txHashes, (overrides) => escrow.rewardClientSignup(agentAddress, overrides));
    for (let i = 0; i < STAKE_TOPUP_REWARD_COUNT; i += 1) {
      await collectManagedTx(txHashes, (overrides) => escrow.rewardClientReferral(agentAddress, overrides));
    }

    const agentToken = await getWorkspaceContractAt("TavernToken", deployment.addresses.tavernToken, agent) as any;
    const agentRegistry = await getWorkspaceContractAt("TavernRegistry", deployment.addresses.tavernRegistry, agent) as any;
    const agentStaking = await getWorkspaceContractAt("TavernStaking", deployment.addresses.tavernStaking, agent) as any;
    const agentEscrow = await getWorkspaceContractAt("TavernEscrow", deployment.addresses.tavernEscrow, agent) as any;

    const stakeAmount = BigInt(await staking.STAKE_AMOUNT());
    const agentBalanceAfterRewards = await readWithRetry(
      async () => BigInt(await token.balanceOf(agentAddress)),
      (value) => value >= stakeAmount,
      "ephemeral agent reward balance"
    );
    assert(
      agentBalanceAfterRewards >= stakeAmount,
      `Agent should have enough TVRN to stake. Balance=${agentBalanceAfterRewards.toString()} stake=${stakeAmount.toString()}`
    );

    await collectManagedTx(txHashes, (overrides) =>
      agentToken.approve(deployment.addresses.tavernStaking, stakeAmount, overrides)
    );
    await collectManagedTx(txHashes, (overrides) => agentStaking.stake(overrides));
    await collectManagedTx(txHashes, (overrides) => agentRegistry.joinGuild(2, "task25-smoke-agent", overrides));

    const stakedVisible = await readWithRetry(
      async () => Boolean(await staking.isStaked(agentAddress)),
      (value) => value === true,
      "ephemeral agent stake visibility"
    );
    const activeVisible = await readWithRetry(
      async () => Boolean(await registry.isAgentActive(agentAddress)),
      (value) => value === true,
      "ephemeral agent active visibility"
    );
    assert.equal(stakedVisible, true, "Ephemeral agent should be staked");
    assert.equal(activeVisible, true, "Ephemeral agent should be active");
    recordCheck(checks, "Ephemeral agent bootstrap", {
      agentAddress,
      tokenBalanceAfterRewards: agentBalanceAfterRewards
    });

    const briefHash = ethers.keccak256(ethers.toUtf8Bytes("task25-smoke-brief"));
    const createReceipt = await collectManagedTx(txHashes, (overrides) =>
      escrow.createQuest(ethers.ZeroAddress, QUEST_DEPOSIT, briefHash, "ipfs://task25-smoke-brief", overrides)
    );
    const createdArgs = parseEventArgs(escrow, createReceipt, "QuestCreated");
    const questId = createdArgs?.questId ? BigInt(createdArgs.questId) : BigInt(await escrow.nextQuestId());
    results.questId = questId.toString();

    await collectManagedTx(txHashes, (overrides) =>
      escrow.fundQuestETH(questId, { value: QUEST_DEPOSIT, ...overrides })
    );
    await collectManagedTx(txHashes, (overrides) => agentEscrow.acceptQuest(questId, overrides));

    const planningAgent = ethers.Wallet.createRandom().address;
    const verificationAgent = ethers.Wallet.createRandom().address;
    await collectManagedTx(txHashes, (overrides) => escrow.assignPlanningAgent(questId, planningAgent, overrides));

    const resultHash = ethers.keccak256(ethers.toUtf8Bytes("task25-smoke-result"));
    await collectManagedTx(txHashes, (overrides) =>
      agentEscrow.submitResult(questId, resultHash, "ipfs://task25-smoke-result", overrides)
    );
    await collectManagedTx(txHashes, (overrides) => escrow.assignVerificationAgent(questId, verificationAgent, overrides));

    const submittedQuest = await escrow.quests(questId);
    assert.equal(getQuestState(submittedQuest), 4, "Smoke quest should be submitted");
    recordCheck(checks, "Quest create / fund / accept / submit", {
      questId,
      planningAgent,
      verificationAgent
    });

    const maxQuestDeposit = BigInt(await escrow.maxQuestDeposit());
    try {
      await escrow.createQuest.staticCall(
        ethers.ZeroAddress,
        maxQuestDeposit + 1n,
        ethers.keccak256(ethers.toUtf8Bytes("task25-too-large")),
        "ipfs://task25-too-large"
      );
      throw new Error("createQuest.staticCall unexpectedly succeeded above maxQuestDeposit");
    } catch (error) {
      assertRevertSignature(error, "EthDepositCapExceeded()", "Max deposit check");
    }
    recordCheck(checks, "Max quest deposit enforcement", { maxQuestDeposit });

    await collectManagedTx(txHashes, (overrides) => escrow.setSettlementPaused(true, overrides));
    const settlementPausedEnabled = await readWithRetry(
      async () => escrow.settlementPaused(),
      (value) => value === true,
      "settlementPaused enable"
    );
    assert.equal(settlementPausedEnabled, true, "settlementPaused should be true before the revert check");
    try {
      await escrow.submitEvaluation.staticCall(
        questId,
        [5, 5, 5, 5, 5],
        "Paused settlement smoke test",
        ["paused"],
        {}
      );
      throw new Error("submitEvaluation.staticCall unexpectedly succeeded while settlementPaused=true");
    } catch (error) {
      assertRevertSignature(error, "SettlementsPaused()", "Settlement pause check", {
        allowBareRevert: true
      });
    }
    await collectManagedTx(txHashes, (overrides) => escrow.setSettlementPaused(false, overrides));
    const settlementPausedRestored = await readWithRetry(
      async () => escrow.settlementPaused(),
      (value) => value === false,
      "settlementPaused reset"
    );
    assert.equal(settlementPausedRestored, false, "settlementPaused should be restored to false");
    recordCheck(checks, "Settlement pause enforcement");

    await collectManagedTx(txHashes, (overrides) => escrow.recordResultViewed(questId, overrides));

    const ethFeed = await ethers.getContractAt(
      [
        "function decimals() view returns (uint8)",
        "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"
      ],
      await escrow.ethUsdFeed(),
      deployer
    );
    const tvrnFeed = await ethers.getContractAt(
      [
        "function decimals() view returns (uint8)",
        "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"
      ],
      await escrow.tvrnUsdFeed(),
      deployer
    );
    const ethFeedRefresh = await refreshMockFeedIfStale(await escrow.ethUsdFeed(), txHashes);
    recordCheck(checks, "ETH/USD feed freshness", ethFeedRefresh);

    const currentFeeStage = Number(await escrow.currentFeeStage());
    const feeRateBps = BigInt(await escrow.feeRateBps(currentFeeStage));
    const bpsDenominator = BigInt(await escrow.BPS_DENOMINATOR());
    const agentTotalBps = BigInt(await escrow.AGENT_TOTAL_BPS());
    const agentCurrencyRatioBps = BigInt(await escrow.AGENT_CURRENCY_RATIO_BPS());
    const agentTvrnRatioBps = BigInt(await escrow.AGENT_TVRN_RATIO_BPS());
    const planningAgentBps = BigInt(await escrow.PLANNING_AGENT_BPS());
    const verificationAgentBps = BigInt(await escrow.VERIFICATION_AGENT_BPS());

    const feeAmount = (QUEST_DEPOSIT * feeRateBps) / bpsDenominator;
    const afterFee = QUEST_DEPOSIT - feeAmount;
    const expectedAgentCurrencyPayout =
      (afterFee * agentTotalBps * agentCurrencyRatioBps) / (bpsDenominator * bpsDenominator);
    const expectedPlanningPayout = (afterFee * planningAgentBps) / bpsDenominator;
    const expectedVerificationPayout = (afterFee * verificationAgentBps) / bpsDenominator;
    const expectedServiceIncrease =
      afterFee - expectedAgentCurrencyPayout - expectedPlanningPayout - expectedVerificationPayout;

    const ethRound = await ethFeed.latestRoundData();
    const tvrnRound = await tvrnFeed.latestRoundData();
    const ethPrice = BigInt(ethRound[1]);
    const tvrnPrice = BigInt(tvrnRound[1]);
    const ethDecimals = BigInt(await ethFeed.decimals());
    const tvrnDecimals = BigInt(await tvrnFeed.decimals());
    const agentTvrnCurrencyReference =
      (afterFee * agentTotalBps * agentTvrnRatioBps) / (bpsDenominator * bpsDenominator);
    const agentTvrnUsd18 = (agentTvrnCurrencyReference * ethPrice) / (10n ** ethDecimals);
    const expectedAgentTvrn = (agentTvrnUsd18 * (10n ** tvrnDecimals)) / tvrnPrice;

    const agentEthBefore = await ethers.provider.getBalance(agentAddress);
    const planningBalanceBefore = await ethers.provider.getBalance(planningAgent);
    const verificationBalanceBefore = await ethers.provider.getBalance(verificationAgent);
    const agentTvrnBefore = BigInt(await token.balanceOf(agentAddress));
    const servicePoolBefore = BigInt(await escrow.servicePoolBalance(ethers.ZeroAddress));

    await collectManagedTx(txHashes, (overrides) =>
      escrow.submitEvaluation(
        questId,
        [5, 5, 5, 5, 5],
        "Task 25 positive settlement smoke test",
        ["task25", "smoke"],
        overrides
      )
    );

    const settlementSnapshot = await readWithRetry(
      async () => {
        const quest = await escrow.quests(questId);
        const agentEth = await ethers.provider.getBalance(agentAddress);
        const planningEth = await ethers.provider.getBalance(planningAgent);
        const verificationEth = await ethers.provider.getBalance(verificationAgent);
        const agentTvrn = BigInt(await token.balanceOf(agentAddress));
        const servicePool = BigInt(await escrow.servicePoolBalance(ethers.ZeroAddress));

        return {
          quest,
          agentEth,
          planningEth,
          verificationEth,
          agentTvrn,
          servicePool
        };
      },
      (value) =>
        getQuestState(value.quest) === 5
        && value.agentEth - agentEthBefore === expectedAgentCurrencyPayout
        && value.planningEth - planningBalanceBefore === expectedPlanningPayout
        && value.verificationEth - verificationBalanceBefore === expectedVerificationPayout
        && value.agentTvrn - agentTvrnBefore === expectedAgentTvrn
        && value.servicePool - servicePoolBefore === expectedServiceIncrease,
      "settlement snapshot"
    );

    const evaluatedQuest = settlementSnapshot.quest;
    const agentEthAfter = settlementSnapshot.agentEth;
    const planningBalanceAfter = settlementSnapshot.planningEth;
    const verificationBalanceAfter = settlementSnapshot.verificationEth;
    const agentTvrnAfter = settlementSnapshot.agentTvrn;
    const servicePoolAfter = settlementSnapshot.servicePool;

    assert.equal(getQuestState(evaluatedQuest), 5, "Quest should be evaluated after submitEvaluation");
    assert.equal(agentEthAfter - agentEthBefore, expectedAgentCurrencyPayout, "Agent currency payout should match 87% * 70%");
    assert.equal(planningBalanceAfter - planningBalanceBefore, expectedPlanningPayout, "Planning agent payout should match 5%");
    assert.equal(verificationBalanceAfter - verificationBalanceBefore, expectedVerificationPayout, "Verification agent payout should match 5%");
    assert.equal(agentTvrnAfter - agentTvrnBefore, expectedAgentTvrn, "Agent TVRN mint should match 87% * 30%");
    assert.equal(servicePoolAfter - servicePoolBefore, expectedServiceIncrease, "Service pool increase should match retained settlement amount");
    recordCheck(checks, "Positive settlement distribution", {
      questId,
      feeAmount,
      expectedAgentCurrencyPayout,
      expectedPlanningPayout,
      expectedVerificationPayout,
      expectedAgentTvrn,
      expectedServiceIncrease
    });

    try {
      await escrow.governanceDowngradeFeeStage.staticCall(0);
      throw new Error("governanceDowngradeFeeStage.staticCall unexpectedly succeeded for a non-governance caller");
    } catch (error) {
      assertRevertSignature(
        error,
        "AccessControlUnauthorizedAccount(address,bytes32)",
        "Governance role gate"
      );
    }
    recordCheck(checks, "Governance role gate");

    const originalThreshold = BigInt(await router.priceRefreshThreshold());
    await collectManagedTx(txHashes, (overrides) => router.setPriceRefreshThreshold(PRICE_REFRESH_TEST_THRESHOLD, overrides));
    await sleep(2_500);
    const upkeepResult = await router.checkUpkeep("0x");
    const upkeepNeeded = Boolean(upkeepResult[0]);
    const performData = upkeepResult[1];
    const [taskType] = ethers.AbiCoder.defaultAbiCoder().decode(["uint8", "uint256"], performData);
    assert.equal(upkeepNeeded, true, "Router should flag stale AdminPriceFeed data once the threshold is lowered");
    assert.equal(BigInt(taskType), PRICE_REFRESH_TASK, "Router should return the PriceRefresh task");

    const beforeRefresh = await adminPriceFeed.latestRoundData();
    await collectManagedTx(txHashes, (overrides) => router.performUpkeep(performData, overrides));
    const afterRefresh = await adminPriceFeed.latestRoundData();
    assert(BigInt(afterRefresh[3]) >= BigInt(beforeRefresh[3]), "AdminPriceFeed should refresh through the router");
    await collectManagedTx(txHashes, (overrides) => router.setPriceRefreshThreshold(originalThreshold, overrides));
    recordCheck(checks, "Router price refresh task", {
      upkeepNeeded,
      taskType: BigInt(taskType),
      beforeUpdatedAt: BigInt(beforeRefresh[3]),
      afterUpdatedAt: BigInt(afterRefresh[3])
    });

    deployment.generatedAt = new Date().toISOString();
    deployment.task25Redeploy = {
      ...(deployment.task25Redeploy ?? {}),
      smokeTestExecutedAt: new Date().toISOString(),
      smokeTestPassed: true,
      smokeTestPath: "test/sepolia-smoke-test.json",
      smokeTestQuestId: questId.toString()
    };
    await writeDeploymentManifest(deployment);

    results.pass = true;
  } catch (error) {
    checks.push({
      name: "Smoke test failure",
      status: "FAIL",
      error: summarizeError(error)
    });
    results.error = summarizeError(error);
    throw error;
  } finally {
    await mkdir(path.dirname(RESULTS_PATH), { recursive: true });
    await writeFile(RESULTS_PATH, toJson(results), "utf8");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
