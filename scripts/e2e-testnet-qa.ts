import "dotenv/config";

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { getWorkspaceContractAt } from "./utils/hardhatContracts";

const { ethers, network } = hre;

const BASE_SEPOLIA_CHAIN_ID = 84532n;
const RESULTS_PATH = path.join(process.cwd(), "test", "e2e-results.json");
const DEPLOYMENT_PATH = path.join(process.cwd(), "deployments", "baseSepolia.json");

const QUEST_STATE = {
  Created: 0,
  Funded: 1,
  Accepted: 2,
  InProgress: 3,
  Submitted: 4,
  Evaluated: 5,
  AutoApproved: 6,
  Compensated: 7,
  TimedOut: 8,
  Cancelled: 9,
  Disputed: 10
} as const;

const SUPPORT = {
  Against: 0,
  For: 1,
  Abstain: 2
} as const;

const RECOMMENDED_MIN_ETH = ethers.parseEther("0.01");
const OPERATIONAL_MIN_ETH = ethers.parseEther("0.00008");
const DEPLOYER_STAKE_AMOUNT = ethers.parseEther("100");
const AGENT_TVRN_TOPUP = ethers.parseEther("100");
const AGENT_ETH_TOPUP = ethers.parseEther("0.00004");
const HAPPY_PATH_DEPOSIT = ethers.parseEther("0.00001");
const CANCEL_DEPOSIT = ethers.parseEther("0.000002");
const CHECK_DEPOSIT = ethers.parseEther("0.000005");

type ScenarioStatus = "PASS" | "FAIL" | "SKIP";

type ScenarioResult = {
  scenario: string;
  status: ScenarioStatus;
  txHashes: string[];
  gasUsed: string;
  error?: string;
  notes?: string[];
  data?: Record<string, unknown>;
};

type QaResultsFile = {
  generatedAt: string;
  network: {
    name: string;
    chainId: number;
  };
  deployer: string;
  recommendedMinEth: string;
  operationalMinEth: string;
  compactMode: boolean;
  warnings: string[];
  firstQuestId: string | null;
  mockEthUsdFeed: string | null;
  mockTvrnUsdFeed: string | null;
  scenarios: ScenarioResult[];
  summary: {
    pass: number;
    fail: number;
    skip: number;
  };
};

type DeploymentManifest = {
  generatedAt?: string;
  deployer?: string;
  addresses: {
    tavernToken: string;
    tavernRegistry: string;
    tavernEscrow: string;
    tavernStaking: string;
    tavernGovernance: string;
    tavernAutomationRouter: string;
  };
  constructorArgs: {
    tavernEscrow: {
      usdc: string;
      tavernToken: string;
      registry: string;
      ethUsdFeed: string;
      tvrnUsdFeed: string;
    };
  };
  notes?: string[];
  e2eQa?: {
    executedAt: string;
    mockEthUsdFeed: string;
    mockTvrnUsdFeed: string;
    firstQuestId: string;
    pass: number;
    fail: number;
    skip: number;
    resultsPath: string;
  };
};

type ScenarioRuntime = {
  txHashes: string[];
  gasUsed: bigint;
  notes: string[];
  data: Record<string, unknown>;
};

type AgentContext = {
  signer: any;
  address: string;
  source: "ephemeral";
};

type QaContext = {
  deployment: DeploymentManifest;
  deployer: any;
  deployerAddress: string;
  token: any;
  registry: any;
  staking: any;
  escrow: any;
  governance: any;
  router: any;
  ethBalance: bigint;
  tokenBalance: bigint;
  compactMode: boolean;
  warnings: string[];
  firstQuestId: bigint | null;
  mockEthUsdFeed: string | null;
  mockTvrnUsdFeed: string | null;
  agent: AgentContext | null;
};

function normalize(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_, current) => (typeof current === "bigint" ? current.toString() : current))
  );
}

function toJson(value: unknown): string {
  return `${JSON.stringify(normalize(value), null, 2)}\n`;
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
  };

  return maybe.shortMessage ?? maybe.reason ?? maybe.message ?? maybe.errorName ?? String(error);
}

function containsCooldownError(error: unknown): boolean {
  return summarizeError(error).toLowerCase().includes("cooldown still active");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readDeploymentManifest(): Promise<DeploymentManifest> {
  return JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as DeploymentManifest;
}

async function writeDeploymentManifest(manifest: DeploymentManifest): Promise<void> {
  await writeFile(DEPLOYMENT_PATH, toJson(manifest), "utf8");
}

function ensureAddress(address: string): string {
  return ethers.getAddress(address);
}

function getQuestState(quest: any): number {
  return Number(quest.state ?? quest[5]);
}

function getQuestAgent(quest: any): string {
  return ensureAddress(quest.agent ?? quest[2]);
}

function getAgentGuildId(agent: any): bigint {
  return BigInt(agent.guildId ?? agent[0]);
}

function getAgentRank(agent: any): number {
  return Number(agent.rank ?? agent[1]);
}

function getAgentIsActive(agent: any): boolean {
  return Boolean(agent.isActive ?? agent[6]);
}

function getAgentModel(agent: any): string {
  return String(agent.modelType ?? agent[7]);
}

function getStakeInfoAmount(stakeInfo: any): bigint {
  return BigInt(stakeInfo.amount ?? stakeInfo[0]);
}

function getStakeInfoUnstakeAt(stakeInfo: any): bigint {
  return BigInt(stakeInfo.unstakeRequestAt ?? stakeInfo[1]);
}

function getProposalForVotes(proposal: any): bigint {
  return BigInt(proposal.forVotes ?? proposal[4]);
}

function getProposalState(proposal: any): number {
  return Number(proposal.state ?? proposal[10]);
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

async function collectTx(runtime: ScenarioRuntime, txPromise: Promise<any> | any, label: string): Promise<any> {
  const tx = await txPromise;
  const receipt = await tx.wait();
  runtime.txHashes.push(tx.hash);
  runtime.gasUsed += BigInt(receipt.gasUsed ?? 0n);
  runtime.notes.push(`${label}: ${tx.hash}`);
  return receipt;
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
  runtime: ScenarioRuntime,
  txFactory: (overrides: Record<string, bigint>) => Promise<any>,
  label: string
): Promise<any> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const overrides = await buildFeeOverrides(BigInt(attempt + 1));

    try {
      return await collectTx(runtime, txFactory(overrides), label);
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

async function readWithRetry<T>(
  reader: () => Promise<T>,
  predicate: (value: T) => boolean,
  label: string,
  attempts = 6,
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

async function runScenario(
  scenario: string,
  dependencies: string[],
  results: ScenarioResult[],
  runner: (runtime: ScenarioRuntime) => Promise<void>
): Promise<ScenarioResult> {
  const blocking = dependencies.find((name) => {
    const previous = results.find((result) => result.scenario === name);
    return previous && previous.status !== "PASS";
  });

  if (blocking) {
    return {
      scenario,
      status: "SKIP",
      txHashes: [],
      gasUsed: "0",
      notes: [`Skipped because dependency did not pass: ${blocking}`]
    };
  }

  const runtime: ScenarioRuntime = {
    txHashes: [],
    gasUsed: 0n,
    notes: [],
    data: {}
  };

  try {
    await runner(runtime);
    return {
      scenario,
      status: "PASS",
      txHashes: runtime.txHashes,
      gasUsed: runtime.gasUsed.toString(),
      notes: runtime.notes,
      data: Object.keys(runtime.data).length > 0 ? normalize(runtime.data) as Record<string, unknown> : undefined
    };
  } catch (error) {
    return {
      scenario,
      status: "FAIL",
      txHashes: runtime.txHashes,
      gasUsed: runtime.gasUsed.toString(),
      error: summarizeError(error),
      notes: runtime.notes,
      data: Object.keys(runtime.data).length > 0 ? normalize(runtime.data) as Record<string, unknown> : undefined
    };
  }
}

async function deployOrReuseMockFeed(
  signer: any,
  existingAddress: string | null,
  answer: bigint
): Promise<string> {
  if (existingAddress && ethers.isAddress(existingAddress)) {
    const candidate = ensureAddress(existingAddress);
    const code = await ethers.provider.getCode(candidate);
    if (code !== "0x") {
      return candidate;
    }
  }

  const factory = await ethers.getContractFactory("MockV3Aggregator", signer);
  const deployment = await factory.deploy(
    8,
    answer,
    Math.floor(Date.now() / 1000),
    await buildFeeOverrides()
  );
  await deployment.waitForDeployment();
  return await deployment.getAddress();
}

async function ensureMockPriceFeeds(context: QaContext): Promise<void> {
  const existingEth = context.deployment.e2eQa?.mockEthUsdFeed ?? null;
  const existingTvrn = context.deployment.e2eQa?.mockTvrnUsdFeed ?? null;
  const mockEthFeed = await deployOrReuseMockFeed(context.deployer, existingEth, 300_000_000_000n);
  const mockTvrnFeed = await deployOrReuseMockFeed(context.deployer, existingTvrn, 1_000_000n);

  const currentEthFeed = ensureAddress(await context.escrow.ethUsdFeed());
  const currentTvrnFeed = ensureAddress(await context.escrow.tvrnUsdFeed());

  if (currentEthFeed !== mockEthFeed || currentTvrnFeed !== mockTvrnFeed) {
    const tx = await context.escrow.setPriceFeeds(
      mockEthFeed,
      mockTvrnFeed,
      await buildFeeOverrides()
    );
    await tx.wait();
  }

  context.mockEthUsdFeed = mockEthFeed;
  context.mockTvrnUsdFeed = mockTvrnFeed;
  context.deployment.constructorArgs.tavernEscrow.ethUsdFeed = mockEthFeed;
  context.deployment.constructorArgs.tavernEscrow.tvrnUsdFeed = mockTvrnFeed;
  context.deployment.generatedAt = new Date().toISOString();

  const existingNotes = context.deployment.notes ?? [];
  const ethNote = `Task 18 set the Base Sepolia ETH/USD feed to MockV3Aggregator ${mockEthFeed}.`;
  const tvrnNote = `Task 18 set the Base Sepolia TVRN/USD feed to MockV3Aggregator ${mockTvrnFeed}.`;
  if (!existingNotes.includes(ethNote)) {
    existingNotes.push(ethNote);
  }
  if (!existingNotes.includes(tvrnNote)) {
    existingNotes.push(tvrnNote);
  }
  context.deployment.notes = existingNotes;

  await writeDeploymentManifest(context.deployment);
}

async function ensureAgent(context: QaContext, runtime: ScenarioRuntime): Promise<AgentContext> {
  if (context.agent) {
    return context.agent;
  }

  const wallet = ethers.Wallet.createRandom().connect(ethers.provider);
  const signer = new ethers.NonceManager(wallet);
  const address = await signer.getAddress();

  runtime.notes.push(`Prepared ephemeral agent wallet ${address}`);

  await collectManagedTx(
    runtime,
    (overrides) => context.deployer.sendTransaction({
      to: address,
      value: AGENT_ETH_TOPUP,
      ...overrides
    }),
    "Fund ephemeral agent ETH"
  );

  await collectManagedTx(
    runtime,
    (overrides) => context.token.transfer(address, AGENT_TVRN_TOPUP, overrides),
    "Fund ephemeral agent TVRN"
  );

  const token = await getWorkspaceContractAt("TavernToken", context.deployment.addresses.tavernToken, signer) as any;
  const staking = await getWorkspaceContractAt("TavernStaking", context.deployment.addresses.tavernStaking, signer) as any;
  const registry = await getWorkspaceContractAt("TavernRegistry", context.deployment.addresses.tavernRegistry, signer) as any;

  const staked = await staking.isStaked(address);
  if (!staked) {
    const allowance = BigInt(await token.allowance(address, context.deployment.addresses.tavernStaking));
    if (allowance < AGENT_TVRN_TOPUP) {
      await collectManagedTx(
        runtime,
        (overrides) => token.approve(context.deployment.addresses.tavernStaking, AGENT_TVRN_TOPUP, overrides),
        "Ephemeral agent approve staking"
      );
    }

    await collectManagedTx(runtime, (overrides) => staking.stake(overrides), "Ephemeral agent stake");
  }

  const active = await registry.isAgentActive(address);
  if (!active) {
    await collectManagedTx(
      runtime,
      (overrides) => registry.joinGuild(2, "claude-3.5", overrides),
      "Ephemeral agent join guild 2"
    );
  }

  context.agent = {
    signer,
    address,
    source: "ephemeral"
  };

  return context.agent;
}

async function createEthQuest(
  context: QaContext,
  runtime: ScenarioRuntime,
  depositAmount: bigint,
  briefLabel: string,
  briefUri: string
): Promise<bigint> {
  const before = BigInt(await context.escrow.nextQuestId());
  const briefHash = ethers.keccak256(ethers.toUtf8Bytes(briefLabel));

  const createReceipt = await collectManagedTx(
    runtime,
    (overrides) => context.escrow.createQuest(ethers.ZeroAddress, depositAmount, briefHash, briefUri, overrides),
    `Create quest (${briefLabel})`
  );

  const created = parseEventArgs(context.escrow, createReceipt, "QuestCreated");
  const questId = created?.questId ? BigInt(created.questId) : before + 1n;

  await readWithRetry(
    async () => BigInt(await context.escrow.nextQuestId()),
    (nextQuestId) => nextQuestId >= questId,
    `nextQuestId >= ${questId.toString()}`
  );

  await collectManagedTx(
    runtime,
    (overrides) => context.escrow.fundQuestETH(questId, { value: depositAmount, ...overrides }),
    `Fund quest ${questId.toString()}`
  );

  const quest = await readWithRetry(
    async () => context.escrow.quests(questId),
    (candidate) => getQuestState(candidate) === QUEST_STATE.Funded,
    `quest ${questId.toString()} funded state`
  );
  assert.equal(getQuestState(quest), QUEST_STATE.Funded, "Quest should be funded");

  return questId;
}

async function createQuestOnly(
  context: QaContext,
  runtime: ScenarioRuntime,
  depositAmount: bigint,
  briefLabel: string,
  briefUri: string
): Promise<bigint> {
  const before = BigInt(await context.escrow.nextQuestId());
  const briefHash = ethers.keccak256(ethers.toUtf8Bytes(briefLabel));

  const createReceipt = await collectManagedTx(
    runtime,
    (overrides) => context.escrow.createQuest(ethers.ZeroAddress, depositAmount, briefHash, briefUri, overrides),
    `Create quest (${briefLabel})`
  );

  const created = parseEventArgs(context.escrow, createReceipt, "QuestCreated");
  const questId = created?.questId ? BigInt(created.questId) : before + 1n;

  const quest = await readWithRetry(
    async () => context.escrow.quests(questId),
    (candidate) => getQuestState(candidate) === QUEST_STATE.Created,
    `quest ${questId.toString()} created state`
  );
  assert.equal(getQuestState(quest), QUEST_STATE.Created, "Quest should remain created");

  return questId;
}

async function main(): Promise<void> {
  const currentNetwork = await ethers.provider.getNetwork();
  if (currentNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID) {
    throw new Error(
      `scripts/e2e-testnet-qa.ts is configured for Base Sepolia (84532). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const [rawDeployer] = await ethers.getSigners();
  const deployer = new ethers.NonceManager(rawDeployer);
  const deployment = await readDeploymentManifest();

  const context: QaContext = {
    deployment,
    deployer,
    deployerAddress: await deployer.getAddress(),
    token: await getWorkspaceContractAt("TavernToken", deployment.addresses.tavernToken, deployer) as any,
    registry: await getWorkspaceContractAt("TavernRegistry", deployment.addresses.tavernRegistry, deployer) as any,
    staking: await getWorkspaceContractAt("TavernStaking", deployment.addresses.tavernStaking, deployer) as any,
    escrow: await ethers.getContractAt("TavernEscrow", deployment.addresses.tavernEscrow, deployer) as any,
    governance: await ethers.getContractAt("TavernGovernance", deployment.addresses.tavernGovernance, deployer) as any,
    router: await ethers.getContractAt("TavernAutomationRouter", deployment.addresses.tavernAutomationRouter, deployer) as any,
    ethBalance: 0n,
    tokenBalance: 0n,
    compactMode: false,
    warnings: [],
    firstQuestId: null,
    mockEthUsdFeed: null,
    mockTvrnUsdFeed: null,
    agent: null
  };

  context.ethBalance = await ethers.provider.getBalance(context.deployerAddress);
  context.tokenBalance = BigInt(await context.token.balanceOf(context.deployerAddress));

  assert(context.ethBalance > OPERATIONAL_MIN_ETH, `Need at least ${ethers.formatEther(OPERATIONAL_MIN_ETH)} ETH for compact live QA`);
  assert(context.tokenBalance >= DEPLOYER_STAKE_AMOUNT, "Need at least 100 TVRN for staking");

  if (context.ethBalance < RECOMMENDED_MIN_ETH) {
    context.compactMode = true;
    context.warnings.push(
      `Deployer ETH balance ${ethers.formatEther(context.ethBalance)} is below the recommended 0.01 ETH. Running Task 18 in compact live mode with smaller quest deposits.`
    );
  }

  const guildCount = BigInt(await context.registry.guildCount());
  assert(guildCount >= 5n, "Registry should have at least 5 founding guilds");
  const nextQuestId = BigInt(await context.escrow.nextQuestId());
  if (nextQuestId > 0n) {
    context.firstQuestId = 1n;
  }
  console.log(`Pre-flight | deployer: ${context.deployerAddress}`);
  console.log(`Pre-flight | ETH balance: ${ethers.formatEther(context.ethBalance)} ETH`);
  console.log(`Pre-flight | TVRN balance: ${ethers.formatEther(context.tokenBalance)} TVRN`);
  console.log(`Pre-flight | nextQuestId: ${nextQuestId.toString()}`);

  await ensureMockPriceFeeds(context);

  const results: ScenarioResult[] = [];

  results.push(
    await runScenario("Scenario 1 - Staking Flow", [], results, async (runtime) => {
      const alreadyStaked = await context.staking.isStaked(context.deployerAddress);
      if (!alreadyStaked) {
        const allowance = BigInt(await context.token.allowance(context.deployerAddress, context.deployment.addresses.tavernStaking));
        if (allowance < DEPLOYER_STAKE_AMOUNT) {
          await collectManagedTx(
            runtime,
            (overrides) => context.token.approve(context.deployment.addresses.tavernStaking, DEPLOYER_STAKE_AMOUNT, overrides),
            "Approve deployer stake"
          );
        }

        const receipt = await collectManagedTx(
          runtime,
          (overrides) => context.staking.stake(overrides),
          "Stake 100 TVRN"
        );
        const eventArgs = parseEventArgs(context.staking, receipt, "Staked");
        assert(eventArgs, "Staked event should be emitted");
      } else {
        runtime.notes.push("Deployer was already staked; treating scenario as idempotent pass.");
      }

      const isStaked = await readWithRetry(
        async () => context.staking.isStaked(context.deployerAddress),
        (value) => value === true,
        "deployer stake visibility"
      );
      const stakeInfo = await context.staking.getStakeInfo(context.deployerAddress);
      assert.equal(isStaked, true, "Deployer should be staked");
      assert.equal(getStakeInfoAmount(stakeInfo), DEPLOYER_STAKE_AMOUNT, "Stake amount should be 100 TVRN");

      runtime.data.isStaked = isStaked;
      runtime.data.stakeAmount = getStakeInfoAmount(stakeInfo).toString();
    })
  );

  results.push(
    await runScenario("Scenario 2 - Agent Registration", ["Scenario 1 - Staking Flow"], results, async (runtime) => {
      assert.equal(await context.staking.isStaked(context.deployerAddress), true, "Deployer should still be staked");

      const alreadyActive = await context.registry.isAgentActive(context.deployerAddress);
      if (!alreadyActive) {
        const receipt = await collectManagedTx(
          runtime,
          (overrides) => context.registry.joinGuild(1, "gpt-4o", overrides),
          "Join founding guild 1"
        );
        const eventArgs = parseEventArgs(context.registry, receipt, "AgentJoined");
        assert(eventArgs, "AgentJoined event should be emitted");
      } else {
        runtime.notes.push("Deployer was already an active agent; treating scenario as idempotent pass.");
      }

      const active = await readWithRetry(
        async () => context.registry.isAgentActive(context.deployerAddress),
        (value) => value === true,
        "deployer agent activation"
      );
      const agent = await context.registry.getAgent(context.deployerAddress);
      assert.equal(active, true, "Deployer should be active after joinGuild");
      assert.equal(getAgentGuildId(agent), 1n, "Guild ID should be 1");
      assert.equal(getAgentRank(agent), 0, "Rank should be Apprentice");
      assert.equal(getAgentIsActive(agent), true, "Agent profile should be active");

      runtime.data.guildId = getAgentGuildId(agent).toString();
      runtime.data.rank = getAgentRank(agent);
      runtime.data.modelType = getAgentModel(agent);
    })
  );

  results.push(
    await runScenario("Scenario 3 - Quest Lifecycle Happy Path", ["Scenario 2 - Agent Registration"], results, async (runtime) => {
      const agent = await ensureAgent(context, runtime);
  const agentRegistry = await getWorkspaceContractAt("TavernRegistry", context.deployment.addresses.tavernRegistry, agent.signer) as any;
      const agentEscrow = await ethers.getContractAt("TavernEscrow", context.deployment.addresses.tavernEscrow, agent.signer) as any;

      const agentProfileBefore = await context.registry.getAgent(agent.address);
      const questId = await createEthQuest(
        context,
        runtime,
        HAPPY_PATH_DEPOSIT,
        "task18-scenario3-brief",
        "ipfs://task18-scenario3-brief"
      );

      if (context.firstQuestId === null) {
        context.firstQuestId = questId;
      }

      await collectManagedTx(
        runtime,
        (overrides) => agentEscrow.acceptQuest(questId, overrides),
        `Agent accept quest ${questId.toString()}`
      );
      let quest = await readWithRetry(
        async () => context.escrow.quests(questId),
        (candidate) => getQuestState(candidate) === QUEST_STATE.Accepted,
        `quest ${questId.toString()} accepted state`
      );
      assert.equal(getQuestState(quest), QUEST_STATE.Accepted, "Quest should be accepted");
      assert.equal(getQuestAgent(quest), agent.address, "Agent address should match the ephemeral wallet");

      await collectManagedTx(
        runtime,
        (overrides) => agentEscrow.recordHeartbeat(questId, overrides),
        `Agent heartbeat quest ${questId.toString()}`
      );
      quest = await readWithRetry(
        async () => context.escrow.quests(questId),
        (candidate) => getQuestState(candidate) === QUEST_STATE.InProgress,
        `quest ${questId.toString()} in-progress state`
      );
      assert.equal(getQuestState(quest), QUEST_STATE.InProgress, "Quest should be in progress");

      const resultHash = ethers.keccak256(ethers.toUtf8Bytes("task18-scenario3-result"));
      await collectManagedTx(
        runtime,
        (overrides) => agentEscrow.submitResult(questId, resultHash, "ipfs://task18-scenario3-result", overrides),
        `Agent submit result ${questId.toString()}`
      );
      quest = await readWithRetry(
        async () => context.escrow.quests(questId),
        (candidate) => getQuestState(candidate) === QUEST_STATE.Submitted,
        `quest ${questId.toString()} submitted state`
      );
      assert.equal(getQuestState(quest), QUEST_STATE.Submitted, "Quest should be submitted");

      await collectManagedTx(
        runtime,
        (overrides) => context.escrow.recordResultViewed(questId, overrides),
        `Client view result ${questId.toString()}`
      );
      quest = await readWithRetry(
        async () => context.escrow.quests(questId),
        (candidate) => BigInt(candidate.resultViewedAt ?? candidate[10]) > 0n,
        `quest ${questId.toString()} resultViewedAt`
      );
      assert(BigInt(quest.resultViewedAt ?? quest[10]) > 0n, "resultViewedAt should be set");

      await collectManagedTx(
        runtime,
        (overrides) => context.escrow.submitEvaluation(
          questId,
          [5, 5, 5, 5, 5],
          "Excellent work on the test quest with clear reasoning, speed, and quality.",
          ["quality", "speed"],
          overrides
        ),
        `Client evaluate quest ${questId.toString()}`
      );

      quest = await readWithRetry(
        async () => context.escrow.quests(questId),
        (candidate) => getQuestState(candidate) === QUEST_STATE.Evaluated,
        `quest ${questId.toString()} evaluated state`
      );
      const evaluationAvg = await readWithRetry(
        async () => BigInt(await context.escrow.evaluationAvgScore(questId)),
        (value) => value === 50n,
        `quest ${questId.toString()} evaluation average`
      );
      const agentProfileAfter = await agentRegistry.getAgent(agent.address);
      assert.equal(getQuestState(quest), QUEST_STATE.Evaluated, "Quest should be evaluated");
      assert.equal(evaluationAvg, 50n, "Average score should be 50");
      assert(BigInt(agentProfileAfter.reputation ?? agentProfileAfter[2]) > BigInt(agentProfileBefore.reputation ?? agentProfileBefore[2]), "Agent reputation should increase");

      runtime.data.questId = questId.toString();
      runtime.data.agent = agent.address;
      runtime.data.evaluationAvgScore = evaluationAvg.toString();
      runtime.data.agentReputationBefore = BigInt(agentProfileBefore.reputation ?? agentProfileBefore[2]).toString();
      runtime.data.agentReputationAfter = BigInt(agentProfileAfter.reputation ?? agentProfileAfter[2]).toString();
    })
  );

  results.push(
    await runScenario("Scenario 4 - Quest Cancellation", [], results, async (runtime) => {
      const questId = await createQuestOnly(
        context,
        runtime,
        CANCEL_DEPOSIT,
        "task18-scenario4-cancel",
        "ipfs://task18-scenario4-cancel"
      );

      await collectManagedTx(
        runtime,
        (overrides) => context.escrow.cancelQuest(questId, overrides),
        `Cancel quest ${questId.toString()}`
      );
      const quest = await readWithRetry(
        async () => context.escrow.quests(questId),
        (candidate) => getQuestState(candidate) === QUEST_STATE.Cancelled,
        `quest ${questId.toString()} cancelled state`
      );
      assert.equal(getQuestState(quest), QUEST_STATE.Cancelled, "Quest should be cancelled");

      runtime.data.questId = questId.toString();
    })
  );

  results.push(
    await runScenario("Scenario 5 - Auto-Approve Eligibility Check", ["Scenario 3 - Quest Lifecycle Happy Path"], results, async (runtime) => {
      const agent = await ensureAgent(context, runtime);
      const agentEscrow = await ethers.getContractAt("TavernEscrow", context.deployment.addresses.tavernEscrow, agent.signer) as any;

      const questId = await createEthQuest(
        context,
        runtime,
        CHECK_DEPOSIT,
        "task18-scenario5-autoapprove",
        "ipfs://task18-scenario5-autoapprove"
      );

      await collectManagedTx(
        runtime,
        (overrides) => agentEscrow.acceptQuest(questId, overrides),
        `Agent accept quest ${questId.toString()}`
      );
      await collectManagedTx(
        runtime,
        (overrides) => agentEscrow.submitResult(
          questId,
          ethers.keccak256(ethers.toUtf8Bytes("task18-scenario5-result")),
          "ipfs://task18-scenario5-result",
          overrides
        ),
        `Agent submit result ${questId.toString()}`
      );

      const quest = await readWithRetry(
        async () => context.escrow.quests(questId),
        (candidate) => getQuestState(candidate) === QUEST_STATE.Submitted,
        `quest ${questId.toString()} submitted state`
      );
      assert.equal(getQuestState(quest), QUEST_STATE.Submitted, "Quest should be submitted");

      const upkeepResult = await context.router.checkUpkeep("0x");
      const upkeepNeeded = Boolean(upkeepResult[0]);
      assert.equal(upkeepNeeded, false, "Router should not auto-approve immediately");

      runtime.data.questId = questId.toString();
      runtime.data.submittedAt = BigInt(quest.submittedAt ?? quest[9]).toString();
      runtime.data.upkeepNeeded = upkeepNeeded;
    })
  );

  results.push(
    await runScenario("Scenario 6 - Timeout Eligibility Check", ["Scenario 3 - Quest Lifecycle Happy Path"], results, async (runtime) => {
      const agent = await ensureAgent(context, runtime);
      const agentEscrow = await ethers.getContractAt("TavernEscrow", context.deployment.addresses.tavernEscrow, agent.signer) as any;

      const questId = await createEthQuest(
        context,
        runtime,
        CHECK_DEPOSIT,
        "task18-scenario6-timeout",
        "ipfs://task18-scenario6-timeout"
      );

      await collectManagedTx(
        runtime,
        (overrides) => agentEscrow.acceptQuest(questId, overrides),
        `Agent accept quest ${questId.toString()}`
      );
      const quest = await readWithRetry(
        async () => context.escrow.quests(questId),
        (candidate) => getQuestState(candidate) === QUEST_STATE.Accepted,
        `quest ${questId.toString()} accepted state`
      );
      assert.equal(getQuestState(quest), QUEST_STATE.Accepted, "Quest should be accepted");

      const upkeepResult = await context.router.checkUpkeep("0x");
      const upkeepNeeded = Boolean(upkeepResult[0]);
      assert.equal(upkeepNeeded, false, "Router should not timeout a fresh accepted quest");

      runtime.data.questId = questId.toString();
      runtime.data.acceptedAt = BigInt(quest.acceptedAt ?? quest[8]).toString();
      runtime.data.upkeepNeeded = upkeepNeeded;
    })
  );

  results.push(
    await runScenario("Scenario 7 - Fee Stage Preview", [], results, async (runtime) => {
      const activeClientCount = BigInt(await context.escrow.activeClientCount());
      const activeAgentCount = BigInt(await context.escrow.activeAgentCount());
      const currentFeeStage = BigInt(await context.escrow.currentFeeStage());
      const previewFeeStage = BigInt(await context.escrow.previewFeeStage());

      assert.equal(currentFeeStage, 0n, "Current fee stage should remain 0");
      assert.equal(previewFeeStage, 0n, "Preview fee stage should remain 0");

      runtime.notes.push(`Active clients: ${activeClientCount.toString()}`);
      runtime.notes.push(`Active agents: ${activeAgentCount.toString()}`);
      runtime.data.activeClientCount = activeClientCount.toString();
      runtime.data.activeAgentCount = activeAgentCount.toString();
      runtime.data.currentFeeStage = currentFeeStage.toString();
      runtime.data.previewFeeStage = previewFeeStage.toString();
    })
  );

  results.push(
    await runScenario("Scenario 8 - Governance Proposal", [], results, async (runtime) => {
      const expectedProposalId = BigInt(await context.governance.nextProposalId());
      const callData = context.governance.interface.encodeFunctionData("quorum");

      const proposeReceipt = await collectManagedTx(
        runtime,
        (overrides) => context.governance.propose(
          3,
          context.deployment.addresses.tavernGovernance,
          callData,
          "Task 18 no-op governance proposal for live testnet QA",
          overrides
        ),
        `Create proposal ${expectedProposalId.toString()}`
      );
      const createdArgs = parseEventArgs(context.governance, proposeReceipt, "ProposalCreated");
      const proposalId = createdArgs?.id ? BigInt(createdArgs.id) : expectedProposalId;

      const votingPower = await readWithRetry(
        async () => BigInt(await context.governance.getVotingPower(context.deployerAddress, proposalId)),
        (value) => value > 0n,
        `proposal ${proposalId.toString()} voting power`
      );
      assert(votingPower > 0n, "Voting power should be positive");

      const voteReceipt = await collectManagedTx(
        runtime,
        (overrides) => context.governance.vote(proposalId, SUPPORT.For, overrides),
        `Vote for proposal ${proposalId.toString()}`
      );
      const voteArgs = parseEventArgs(context.governance, voteReceipt, "VoteCast");
      assert(voteArgs, "VoteCast event should be emitted");
      assert.equal(BigInt(voteArgs.votingPower ?? voteArgs[3]), votingPower, "VoteCast power should match");

      const hasVoted = await readWithRetry(
        async () => Boolean(await context.governance.hasVoted(proposalId, context.deployerAddress)),
        (value) => value === true,
        `proposal ${proposalId.toString()} hasVoted`
      );
      const proposalState = await readWithRetry(
        async () => Number(await context.governance.proposalState(proposalId)),
        (value) => value === 0,
        `proposal ${proposalId.toString()} state`
      );
      assert.equal(hasVoted, true, "Vote should be recorded");
      assert.equal(proposalState, 0, "Proposal should remain active during the voting window");

      runtime.data.proposalId = proposalId.toString();
      runtime.data.votingPower = votingPower.toString();
      runtime.data.forVotes = BigInt(voteArgs.votingPower ?? voteArgs[3]).toString();
    })
  );

  results.push(
    await runScenario("Scenario 9 - Staking Unstake Flow", ["Scenario 2 - Agent Registration"], results, async (runtime) => {
      const active = await context.registry.isAgentActive(context.deployerAddress);
      if (active) {
        await collectManagedTx(
          runtime,
          (overrides) => context.registry.leaveGuild(overrides),
          "Leave guild before unstake"
        );
      } else {
        runtime.notes.push("Deployer was already inactive before unstake; continuing.");
      }

      const isInactive = await readWithRetry(
        async () => context.registry.isAgentActive(context.deployerAddress),
        (value) => value === false,
        "deployer guild leave visibility"
      );
      assert.equal(isInactive, false, "Deployer should be inactive before requestUnstake");

      let stakeInfo = await context.staking.getStakeInfo(context.deployerAddress);
      if (getStakeInfoUnstakeAt(stakeInfo) === 0n) {
        const receipt = await collectManagedTx(
          runtime,
          (overrides) => context.staking.requestUnstake(overrides),
          "Request unstake"
        );
        const eventArgs = parseEventArgs(context.staking, receipt, "UnstakeRequested");
        assert(eventArgs, "UnstakeRequested event should be emitted");
      } else {
        runtime.notes.push("Unstake was already requested previously; reusing the existing cooldown.");
      }

      stakeInfo = await context.staking.getStakeInfo(context.deployerAddress);
      assert(getStakeInfoUnstakeAt(stakeInfo) > 0n, "unstakeRequestAt should be set");

      try {
        await context.staking.withdraw.staticCall();
        throw new Error("withdraw() unexpectedly succeeded before cooldown elapsed");
      } catch (error) {
        assert(containsCooldownError(error), `Expected cooldown revert, got: ${summarizeError(error)}`);
      }

      runtime.notes.push("Unstake requested. Withdraw remains blocked until the 7-day cooldown expires.");
      runtime.data.unstakeRequestAt = getStakeInfoUnstakeAt(stakeInfo).toString();
    })
  );

  results.push(
    await runScenario("Scenario 10 - ERC-8004 Config Check", [], results, async (runtime) => {
      const identityRegistry = ensureAddress(await context.registry.erc8004IdentityRegistry());
      const reputationRegistry = ensureAddress(await context.registry.erc8004ReputationRegistry());
      const required = Boolean(await context.registry.erc8004Required());
      const hasIdentity = Boolean(await context.registry.hasValidERC8004Identity(context.deployerAddress));

      assert.equal(identityRegistry, ethers.ZeroAddress, "Identity registry should be zero");
      assert.equal(reputationRegistry, ethers.ZeroAddress, "Reputation registry should be zero");
      assert.equal(required, false, "ERC-8004 should not be required yet");
      assert.equal(hasIdentity, false, "Deployer should not have a valid ERC-8004 identity");

      runtime.notes.push("ERC-8004 code is live but unconfigured on testnet, which is the expected state.");
      runtime.data.identityRegistry = identityRegistry;
      runtime.data.reputationRegistry = reputationRegistry;
      runtime.data.required = required;
      runtime.data.hasIdentity = hasIdentity;
    })
  );

  const resultsFile: QaResultsFile = {
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId)
    },
    deployer: context.deployerAddress,
    recommendedMinEth: RECOMMENDED_MIN_ETH.toString(),
    operationalMinEth: OPERATIONAL_MIN_ETH.toString(),
    compactMode: context.compactMode,
    warnings: context.warnings,
    firstQuestId: context.firstQuestId?.toString() ?? null,
    mockEthUsdFeed: context.mockEthUsdFeed,
    mockTvrnUsdFeed: context.mockTvrnUsdFeed,
    scenarios: results,
    summary: {
      pass: results.filter((result) => result.status === "PASS").length,
      fail: results.filter((result) => result.status === "FAIL").length,
      skip: results.filter((result) => result.status === "SKIP").length
    }
  };

  await mkdir(path.dirname(RESULTS_PATH), { recursive: true });
  await writeFile(RESULTS_PATH, toJson(resultsFile), "utf8");

  context.deployment.generatedAt = new Date().toISOString();
  context.deployment.e2eQa = {
    executedAt: new Date().toISOString(),
    mockEthUsdFeed: context.mockEthUsdFeed ?? ethers.ZeroAddress,
    mockTvrnUsdFeed: context.mockTvrnUsdFeed ?? ethers.ZeroAddress,
    firstQuestId: context.firstQuestId?.toString() ?? "0",
    pass: resultsFile.summary.pass,
    fail: resultsFile.summary.fail,
    skip: resultsFile.summary.skip,
    resultsPath: "test/e2e-results.json"
  };
  await writeDeploymentManifest(context.deployment);

  console.log("\n=== E2E QA Summary ===");
  for (const result of results) {
    console.log(
      `${result.status} | ${result.scenario} | ${result.txHashes.length} txns | gas: ${result.gasUsed}`
    );
    if (result.error) {
      console.log(`  error: ${result.error}`);
    }
  }
  console.log(
    `\nTotal: ${resultsFile.summary.pass} PASS, ${resultsFile.summary.fail} FAIL, ${resultsFile.summary.skip} SKIP`
  );
  console.log(`Mock ETH/USD Feed: ${context.mockEthUsdFeed ?? "not set"}`);
  console.log(`Mock TVRN/USD Feed: ${context.mockTvrnUsdFeed ?? "not set"}`);
  console.log(`First quest ID: ${context.firstQuestId?.toString() ?? "not created"}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
