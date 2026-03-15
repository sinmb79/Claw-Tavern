import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { resolveAutomationNetworkConfig } from "./utils/automationNetwork";

const { network } = hre;
const ethers = (hre as unknown as { ethers: any }).ethers;

const KEEPER_ROLE = ethers.id("KEEPER_ROLE");

type AutomationManifest = {
  chainlink?: {
    automationForwarder?: unknown;
    forwarders?: unknown[];
    automationRegistry?: unknown;
    automationRegistrar?: unknown;
  };
  permissions?: Array<{ grantee?: unknown }>;
  upkeeps?: Array<{ target?: unknown }>;
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

type CleanupTarget = {
  address: string;
  label: string;
};

type RevocationRecord = {
  address: string;
  contract: string;
  label: string;
  status: "already-revoked" | "dry-run" | "revoked";
  txHash: string | null;
};

const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function revokeRole(bytes32 role, address account)"
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

async function buildTxOverrides(nonce: number): Promise<Record<string, bigint | number>> {
  const feeData = await ethers.provider.getFeeData();
  const overrides: Record<string, bigint | number> = { nonce };

  if (feeData.maxFeePerGas && feeData.maxPriorityFeePerGas) {
    overrides.maxFeePerGas = feeData.maxFeePerGas;
    overrides.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas;
  } else if (feeData.gasPrice) {
    overrides.gasPrice = feeData.gasPrice;
  }

  return overrides;
}

function tryGetAddress(value: unknown): string | null {
  if (typeof value !== "string" || !ethers.isAddress(value)) {
    return null;
  }

  return ethers.getAddress(value);
}

function getExpectedForwarders(manifest: AutomationManifest | null): string[] {
  const forwarders = new Set<string>();

  for (const candidate of manifest?.chainlink?.forwarders ?? []) {
    const address = tryGetAddress(candidate);

    if (address) {
      forwarders.add(address);
    }
  }

  const singleForwarder = tryGetAddress(manifest?.chainlink?.automationForwarder);

  if (singleForwarder) {
    forwarders.add(singleForwarder);
  }

  return Array.from(forwarders);
}

function addCandidate(set: Set<string>, value: unknown): void {
  const address = tryGetAddress(value);

  if (address) {
    set.add(address);
  }
}

function getKnownKeeperCandidates(
  currentManifest: AutomationManifest | null,
  backupManifest: AutomationManifest | null,
  legacySummary: LegacyCleanupSummary | null,
  deployment: DeploymentManifest
): string[] {
  const candidates = new Set<string>();

  for (const address of getExpectedForwarders(currentManifest)) {
    candidates.add(address);
  }

  for (const address of getExpectedForwarders(backupManifest)) {
    candidates.add(address);
  }

  addCandidate(candidates, currentManifest?.chainlink?.automationRegistry);
  addCandidate(candidates, currentManifest?.chainlink?.automationRegistrar);
  addCandidate(candidates, currentManifest?.chainlink?.automationForwarder);
  addCandidate(candidates, backupManifest?.chainlink?.automationRegistry);
  addCandidate(candidates, backupManifest?.chainlink?.automationRegistrar);
  addCandidate(candidates, backupManifest?.chainlink?.automationForwarder);

  for (const entry of currentManifest?.permissions ?? []) {
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

function buildCleanupTargets(
  holders: string[],
  labelPrefix: string,
  allowed: Set<string>
): CleanupTarget[] {
  return holders
    .filter((holder) => !allowed.has(holder))
    .map((holder) => ({
      address: holder,
      label: `${labelPrefix}:${holder}`
    }));
}

async function revokeTargets(
  contract: any,
  contractName: string,
  targets: CleanupTarget[],
  execute: boolean,
  nextNonce: number
): Promise<{ nextNonce: number; records: RevocationRecord[] }> {
  const records: RevocationRecord[] = [];
  let nonceCursor = nextNonce;

  for (const target of targets) {
    const stillHasRole = await contract.hasRole(KEEPER_ROLE, target.address);

    if (!stillHasRole) {
      records.push({
        address: target.address,
        contract: contractName,
        label: target.label,
        status: "already-revoked",
        txHash: null
      });
      continue;
    }

    if (!execute) {
      records.push({
        address: target.address,
        contract: contractName,
        label: target.label,
        status: "dry-run",
        txHash: null
      });
      continue;
    }

    const tx = await contract.revokeRole(
      KEEPER_ROLE,
      target.address,
      await buildTxOverrides(nonceCursor)
    );
    nonceCursor += 1;
    await tx.wait();

    records.push({
      address: target.address,
      contract: contractName,
      label: target.label,
      status: "revoked",
      txHash: tx.hash
    });
  }

  return {
    nextNonce: nonceCursor,
    records
  };
}

async function main(): Promise<void> {
  const currentNetwork = await ethers.provider.getNetwork();
  const automationNetwork = resolveAutomationNetworkConfig(currentNetwork.chainId);

  if (!automationNetwork) {
    throw new Error(
      `This cleanup supports Base Sepolia (84532) and Base Mainnet (8453). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const execute = process.argv.includes("--execute") || process.env.AUTOMATION_EXECUTE === "1";
  const automationManifest = await readJsonFile<AutomationManifest>(automationNetwork.automationPath);
  const automationBackupManifest = await readJsonFile<AutomationManifest>(automationNetwork.automationBackupPath);
  const deployment = await readJsonFile<DeploymentManifest>(automationNetwork.deploymentPath);
  const legacySummary = await readJsonFile<LegacyCleanupSummary>(automationNetwork.legacyCleanupPath);

  if (!automationManifest) {
    throw new Error(`Automation manifest not found at ${automationNetwork.automationPath}`);
  }

  if (!deployment) {
    throw new Error(`Deployment manifest not found at ${automationNetwork.deploymentPath}`);
  }

  const [signer] = await ethers.getSigners();
  let nextNonce = await ethers.provider.getTransactionCount(signer.address, "pending");
  const expectedForwarders = getExpectedForwarders(automationManifest);
  const allowed = new Set<string>();
  const knownCandidates = getKnownKeeperCandidates(
    automationManifest,
    automationBackupManifest,
    legacySummary,
    deployment
  );
  const routerAddress = tryGetAddress(deployment.addresses.tavernAutomationRouter);
  const routerActiveInManifest = Boolean(
    routerAddress &&
    (automationManifest.upkeeps ?? []).some((upkeep) => tryGetAddress(upkeep.target) === routerAddress)
  );

  if (deployment.deployer && ethers.isAddress(deployment.deployer)) {
    allowed.add(ethers.getAddress(deployment.deployer));
  }

  if (deployment.optionalRoleTargets?.keeperAddress && ethers.isAddress(deployment.optionalRoleTargets.keeperAddress)) {
    allowed.add(ethers.getAddress(deployment.optionalRoleTargets.keeperAddress));
  }

  if (routerActiveInManifest && routerAddress) {
    allowed.add(routerAddress);
  } else {
    for (const forwarder of expectedForwarders) {
      allowed.add(forwarder);
    }
  }

  const tavernRegistry = await ethers.getContractAt(
    ACCESS_CONTROL_ABI,
    deployment.addresses.tavernRegistry
  );
  const tavernEscrow = await ethers.getContractAt(
    ACCESS_CONTROL_ABI,
    deployment.addresses.tavernEscrow
  );

  const registryHolders = await getCurrentRoleHolders(tavernRegistry, knownCandidates);
  const escrowHolders = await getCurrentRoleHolders(tavernEscrow, knownCandidates);
  const staleRegistryTargets = buildCleanupTargets(registryHolders, "registry-stale", allowed);
  const staleEscrowTargets = buildCleanupTargets(escrowHolders, "escrow-stale", allowed);

  const registryResult = await revokeTargets(
    tavernRegistry,
    "TavernRegistry",
    staleRegistryTargets,
    execute,
    nextNonce
  );
  nextNonce = registryResult.nextNonce;

  const escrowResult = await revokeTargets(
    tavernEscrow,
    "TavernEscrow",
    staleEscrowTargets,
    execute,
    nextNonce
  );

  const summary = {
    generatedAt: new Date().toISOString(),
    mode: execute ? "execute" : "dry-run",
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId)
    },
    deployer: signer.address,
    expectedForwarders,
    scannedCandidates: knownCandidates,
    allowedKeeperRoleHolders: Array.from(allowed),
    currentHolders: {
      tavernRegistry: registryHolders,
      tavernEscrow: escrowHolders
    },
    staleCandidates: {
      tavernRegistry: staleRegistryTargets.map((target) => target.address),
      tavernEscrow: staleEscrowTargets.map((target) => target.address)
    },
    roleRevocations: [...registryResult.records, ...escrowResult.records],
    nextStep:
      staleRegistryTargets.length === 0 && staleEscrowTargets.length === 0
        ? "No stale KEEPER_ROLE holders were detected."
        : execute
          ? "Stale KEEPER_ROLE holders were revoked. Run verify:automation to confirm the final state."
          : "Dry-run only. Re-run with --execute to revoke stale KEEPER_ROLE holders."
  };

  await mkdir(path.dirname(automationNetwork.legacyCleanupPath), { recursive: true });
  await writeFile(automationNetwork.legacyCleanupPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  console.log(`[cleanup] mode: ${execute ? "execute" : "dry-run"}`);
  console.log(`[cleanup] expected forwarders: ${expectedForwarders.length > 0 ? expectedForwarders.join(", ") : "none"}`);
  console.log(`[cleanup] TavernRegistry stale holders: ${staleRegistryTargets.length > 0 ? staleRegistryTargets.map((target) => target.address).join(", ") : "none"}`);
  console.log(`[cleanup] TavernEscrow stale holders: ${staleEscrowTargets.length > 0 ? staleEscrowTargets.map((target) => target.address).join(", ") : "none"}`);
  console.log(`Legacy automation cleanup summary saved to ${automationNetwork.legacyCleanupPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
