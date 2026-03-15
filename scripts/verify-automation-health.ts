import "dotenv/config";

import { readFile } from "node:fs/promises";

import hre from "hardhat";

import { resolveAutomationNetworkConfig } from "./utils/automationNetwork";

const ethers = (hre as unknown as { ethers: any }).ethers;

const KEEPER_ROLE = ethers.id("KEEPER_ROLE");
const ACTIVE_UPKEEP_SENTINEL = "4294967295";

type AutomationManifest = {
  chainlink?: {
    forwarders?: unknown[];
    linkToken?: string;
    automationForwarder?: unknown;
    automationRegistry?: unknown;
    automationRegistrar?: unknown;
  };
  permissions?: Array<{ grantee?: unknown }>;
  upkeeps?: Array<{
    forwarder?: string | null;
    name?: string;
    target?: string | null;
    upkeepId?: string | null;
  }>;
};

type DeploymentManifest = {
  addresses: {
    tavernEscrow: string;
    tavernRegistry: string;
    tavernAutomationRouter?: string | null;
  };
  deployer?: string;
  optionalRoleTargets?: {
    keeperAddress?: string | null;
  };
};

type LegacyCleanupSummary = {
  cancelledUpkeeps?: Array<{
    forwarder?: unknown;
  }>;
};

const REGISTRY_ABI = [
  "function getBalance(uint256 id) view returns (uint96)",
  "function getForwarder(uint256 upkeepID) view returns (address)",
  "function getUpkeep(uint256 id) view returns ((address target,uint32 performGas,bytes checkData,uint96 balance,address admin,uint64 maxValidBlocknumber,uint32 lastPerformedBlockNumber,uint96 amountSpent,bool paused,bytes offchainConfig))"
];

const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)"
];

const LINK_ABI = [
  "function decimals() view returns (uint8)"
];

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

function tryGetAddress(value: unknown): string | null {
  if (typeof value !== "string" || !ethers.isAddress(value)) {
    return null;
  }

  return ethers.getAddress(value);
}

function shorten(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function addCandidate(set: Set<string>, value: unknown): void {
  const address = tryGetAddress(value);

  if (address) {
    set.add(address);
  }
}

function getExpectedForwarders(manifest: AutomationManifest): string[] {
  const forwarders = new Set<string>();

  for (const value of manifest.chainlink?.forwarders ?? []) {
    const address = tryGetAddress(value);

    if (address) {
      forwarders.add(address);
    }
  }

  addCandidate(forwarders, manifest.chainlink?.automationForwarder);
  return Array.from(forwarders);
}

function getKnownKeeperCandidates(
  currentManifest: AutomationManifest,
  backupManifest: AutomationManifest | null,
  legacySummary: LegacyCleanupSummary | null,
  deployment: DeploymentManifest
): string[] {
  const candidates = new Set<string>();

  for (const address of getExpectedForwarders(currentManifest)) {
    candidates.add(address);
  }

  for (const address of backupManifest ? getExpectedForwarders(backupManifest) : []) {
    candidates.add(address);
  }

  addCandidate(candidates, currentManifest.chainlink?.automationRegistry);
  addCandidate(candidates, currentManifest.chainlink?.automationRegistrar);
  addCandidate(candidates, backupManifest?.chainlink?.automationRegistry);
  addCandidate(candidates, backupManifest?.chainlink?.automationRegistrar);

  for (const entry of currentManifest.permissions ?? []) {
    addCandidate(candidates, entry.grantee);
  }

  for (const entry of backupManifest?.permissions ?? []) {
    addCandidate(candidates, entry.grantee);
  }

  for (const upkeep of legacySummary?.cancelledUpkeeps ?? []) {
    addCandidate(candidates, upkeep.forwarder);
  }

  addCandidate(candidates, deployment.deployer);
  addCandidate(candidates, deployment.optionalRoleTargets?.keeperAddress);
  addCandidate(candidates, deployment.addresses.tavernAutomationRouter);

  return Array.from(candidates);
}

async function getCurrentRoleHolders(contract: any, candidates: string[]): Promise<string[]> {
  const holders: string[] = [];

  for (const account of candidates) {
    if (await contract.hasRole(KEEPER_ROLE, account)) {
      holders.push(account);
    }
  }

  return holders;
}

async function main(): Promise<void> {
  const currentNetwork = await ethers.provider.getNetwork();
  const automationNetwork = resolveAutomationNetworkConfig(currentNetwork.chainId);

  if (!automationNetwork) {
    throw new Error(
      `This health check supports Base Sepolia (84532) and Base Mainnet (8453). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const automationManifest = await readJsonFile<AutomationManifest>(automationNetwork.automationPath);
  const automationBackupManifest = await readJsonFile<AutomationManifest>(automationNetwork.automationBackupPath).catch(() => null);
  const deployment = await readJsonFile<DeploymentManifest>(automationNetwork.deploymentPath);
  const legacySummary = await readJsonFile<LegacyCleanupSummary>(automationNetwork.legacyCleanupPath).catch(() => null);

  if (!deployment) {
    throw new Error(`Deployment manifest not found at ${automationNetwork.deploymentPath}`);
  }

  const automationRegistryAddress = process.env[automationNetwork.registryEnvVar]?.trim()
    ? ethers.getAddress(process.env[automationNetwork.registryEnvVar]!.trim())
    : automationNetwork.defaultRegistry;
  const tavernRegistry = await ethers.getContractAt(
    ACCESS_CONTROL_ABI,
    deployment.addresses.tavernRegistry
  );
  const tavernEscrow = await ethers.getContractAt(
    ACCESS_CONTROL_ABI,
    deployment.addresses.tavernEscrow
  );
  const routerAddress = tryGetAddress(deployment.addresses.tavernAutomationRouter);
  const tavernRouter = routerAddress
    ? await ethers.getContractAt(ACCESS_CONTROL_ABI, routerAddress)
    : null;

  if (!automationManifest) {
    const preRegistrationCandidates = new Set<string>();
    addCandidate(preRegistrationCandidates, deployment.deployer);
    addCandidate(preRegistrationCandidates, deployment.optionalRoleTargets?.keeperAddress);
    addCandidate(preRegistrationCandidates, routerAddress);
    const candidates = Array.from(preRegistrationCandidates);
    const registryHolders = await getCurrentRoleHolders(tavernRegistry, candidates);
    const escrowHolders = await getCurrentRoleHolders(tavernEscrow, candidates);
    const routerHolders = tavernRouter ? await getCurrentRoleHolders(tavernRouter, candidates) : [];

    console.log(`[CHECK] Automation manifest not found at ${automationNetwork.automationPath}`);
    console.log(`[CHECK] ${automationNetwork.registerCommand} has not completed successfully yet.`);
    if (automationNetwork.name === "base") {
      console.log("[CHECK] Base mainnet currently needs at least 0.1 LINK to register the upkeep.");
    }
    console.log(
      `[CHECK] TavernRegistry KEEPER_ROLE holders (known seeds): ${registryHolders.length > 0 ? registryHolders.join(", ") : "none"}`
    );
    console.log(
      `[CHECK] TavernEscrow KEEPER_ROLE holders (known seeds): ${escrowHolders.length > 0 ? escrowHolders.join(", ") : "none"}`
    );
    if (tavernRouter && routerAddress) {
      console.log(
        `[CHECK] TavernAutomationRouter KEEPER_ROLE holders (known seeds): ${routerHolders.length > 0 ? routerHolders.join(", ") : "none"}`
      );
    }
    console.log(`[CHECK] Manifest matches on-chain: no`);
    process.exitCode = 1;
    return;
  }

  const routerActiveInManifest = Boolean(
    routerAddress &&
    (automationManifest.upkeeps ?? []).some((upkeep) => tryGetAddress(upkeep.target) === routerAddress)
  );
  const registry = await ethers.getContractAt(REGISTRY_ABI, automationRegistryAddress);
  const linkAddress = tryGetAddress(automationManifest.chainlink?.linkToken);
  const linkToken = linkAddress ? await ethers.getContractAt(LINK_ABI, linkAddress) : null;
  const linkDecimals = linkToken ? Number(await linkToken.decimals()) : 18;

  const manifestForwarders = new Set<string>(getExpectedForwarders(automationManifest));
  const knownCandidates = getKnownKeeperCandidates(
    automationManifest,
    automationBackupManifest,
    legacySummary,
    deployment
  );
  const registryHolders = await getCurrentRoleHolders(tavernRegistry, knownCandidates);
  const escrowHolders = await getCurrentRoleHolders(tavernEscrow, knownCandidates);
  const routerHolders = tavernRouter ? await getCurrentRoleHolders(tavernRouter, knownCandidates) : [];
  const allowedRegistryEscrow = new Set<string>();
  const allowedRouter = new Set<string>(manifestForwarders);

  if (deployment.deployer && ethers.isAddress(deployment.deployer)) {
    allowedRegistryEscrow.add(ethers.getAddress(deployment.deployer));
    allowedRouter.add(ethers.getAddress(deployment.deployer));
  }

  if (deployment.optionalRoleTargets?.keeperAddress && ethers.isAddress(deployment.optionalRoleTargets.keeperAddress)) {
    allowedRegistryEscrow.add(ethers.getAddress(deployment.optionalRoleTargets.keeperAddress));
    allowedRouter.add(ethers.getAddress(deployment.optionalRoleTargets.keeperAddress));
  }

  if (routerActiveInManifest && routerAddress) {
    allowedRegistryEscrow.add(routerAddress);
  } else {
    for (const forwarder of manifestForwarders) {
      allowedRegistryEscrow.add(forwarder);
    }
  }

  let manifestMatchesOnchain = true;

  for (const upkeep of automationManifest.upkeeps ?? []) {
    if (!upkeep.upkeepId || typeof upkeep.upkeepId !== "string") {
      manifestMatchesOnchain = false;
      console.log(`[CHECK] Upkeep ${upkeep.name ?? "unknown"} has no upkeepId in the manifest.`);
      continue;
    }

    const upkeepId = BigInt(upkeep.upkeepId);
    const onchainUpkeep = await registry.getUpkeep(upkeepId);
    const onchainForwarder = tryGetAddress(await registry.getForwarder(upkeepId));
    const active = onchainUpkeep.maxValidBlocknumber.toString() === ACTIVE_UPKEEP_SENTINEL;
    const funded = ethers.formatUnits(await registry.getBalance(upkeepId), linkDecimals);
    const manifestForwarder = tryGetAddress(upkeep.forwarder);
    const matchesForwarder = manifestForwarder === onchainForwarder;
    const manifestTarget = tryGetAddress((upkeep as any).target);
    const onchainTarget = tryGetAddress(onchainUpkeep.target);
    const matchesTarget = manifestTarget === onchainTarget;
    const isRouterUpkeep = Boolean(routerAddress && onchainTarget === routerAddress);
    const hasRegistryRole = !isRouterUpkeep && onchainForwarder
      ? await tavernRegistry.hasRole(KEEPER_ROLE, onchainForwarder)
      : false;
    const hasEscrowRole = !isRouterUpkeep && onchainForwarder
      ? await tavernEscrow.hasRole(KEEPER_ROLE, onchainForwarder)
      : false;
    const hasRouterRole = isRouterUpkeep && onchainForwarder && tavernRouter
      ? await tavernRouter.hasRole(KEEPER_ROLE, onchainForwarder)
      : false;

    if (!active || !matchesForwarder || !matchesTarget || (!isRouterUpkeep && (!hasRegistryRole || !hasEscrowRole)) || (isRouterUpkeep && !hasRouterRole)) {
      manifestMatchesOnchain = false;
    }

    console.log(
      `[CHECK] Upkeep ${upkeep.name ?? "unknown"} (id: ${shorten(upkeep.upkeepId)}) -> active: ${active ? "yes" : "no"}, funded: ${funded} LINK, target: ${onchainTarget ?? "none"}${matchesTarget ? "" : " (manifest target mismatch)"}, forwarder: ${onchainForwarder ?? "none"}${matchesForwarder ? "" : " (manifest forwarder mismatch)"}`
    );

    if (isRouterUpkeep) {
      console.log(
        `[CHECK] ${upkeep.name ?? "unknown"} forwarder role -> TavernAutomationRouter: ${hasRouterRole ? "yes" : "no"}`
      );
    } else {
      console.log(
        `[CHECK] ${upkeep.name ?? "unknown"} forwarder roles -> TavernRegistry: ${hasRegistryRole ? "yes" : "no"}, TavernEscrow: ${hasEscrowRole ? "yes" : "no"}`
      );
    }
  }

  if (routerActiveInManifest && routerAddress && tavernRouter) {
    const routerHasRegistryRole = await tavernRegistry.hasRole(KEEPER_ROLE, routerAddress);
    const routerHasEscrowRole = await tavernEscrow.hasRole(KEEPER_ROLE, routerAddress);
    if (!routerHasRegistryRole || !routerHasEscrowRole) {
      manifestMatchesOnchain = false;
    }
    console.log(
      `[CHECK] TavernAutomationRouter executor roles -> TavernRegistry: ${routerHasRegistryRole ? "yes" : "no"}, TavernEscrow: ${routerHasEscrowRole ? "yes" : "no"}`
    );
  }

  const staleRegistry = registryHolders.filter((holder) => !allowedRegistryEscrow.has(holder));
  const staleEscrow = escrowHolders.filter((holder) => !allowedRegistryEscrow.has(holder));
  const staleCombined = Array.from(new Set([...staleRegistry, ...staleEscrow]));
  const staleRouter = routerHolders.filter((holder) => !allowedRouter.has(holder));

  if (staleCombined.length > 0 || staleRouter.length > 0) {
    manifestMatchesOnchain = false;
  }

  console.log(
    `[CHECK] TavernRegistry KEEPER_ROLE holders: ${registryHolders.length > 0 ? registryHolders.join(", ") : "none"}`
  );
  console.log(
    `[CHECK] TavernEscrow KEEPER_ROLE holders: ${escrowHolders.length > 0 ? escrowHolders.join(", ") : "none"}`
  );
  if (tavernRouter && routerAddress) {
    console.log(
      `[CHECK] TavernAutomationRouter KEEPER_ROLE holders: ${routerHolders.length > 0 ? routerHolders.join(", ") : "none"}`
    );
  }
  console.log(
    `[CHECK] Stale KEEPER_ROLE holders: ${staleCombined.length > 0 ? staleCombined.join(", ") : "none"}`
  );
  if (tavernRouter && routerAddress) {
    console.log(
      `[CHECK] Stale TavernAutomationRouter KEEPER_ROLE holders: ${staleRouter.length > 0 ? staleRouter.join(", ") : "none"}`
    );
  }
  console.log(`[CHECK] Manifest matches on-chain: ${manifestMatchesOnchain ? "yes" : "no"}`);

  if (!manifestMatchesOnchain) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
