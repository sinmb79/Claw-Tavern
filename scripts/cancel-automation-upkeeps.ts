import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { resolveAutomationNetworkConfig } from "./utils/automationNetwork";

const ethers = (hre as unknown as { ethers: any }).ethers;

const ACTIVE_UPKEEP_SENTINEL = "4294967295";

type AutomationManifest = {
  chainlink?: {
    automationRegistry?: unknown;
  };
  upkeeps?: Array<{
    name?: unknown;
    upkeepId?: unknown;
    target?: unknown;
  }>;
};

type CancelRecord = {
  name: string;
  upkeepId: string | null;
  manifestTarget: string | null;
  onchainTarget: string | null;
  admin: string | null;
  balanceJuels: string;
  status:
    | "skipped-no-id"
    | "skipped-admin-mismatch"
    | "already-cancelled"
    | "cancelled"
    | "withdrawn"
    | "pending-withdraw";
  cancelTxHash: string | null;
  withdrawTxHash: string | null;
  withdrawReadyBlock: string | null;
  note: string;
};

const REGISTRY_ABI = [
  "function typeAndVersion() view returns (string)",
  "function getBalance(uint256 id) view returns (uint96)",
  "function getCancellationDelay() view returns (uint256)",
  "function getUpkeep(uint256 id) view returns ((address target,uint32 performGas,bytes checkData,uint96 balance,address admin,uint64 maxValidBlocknumber,uint32 lastPerformedBlockNumber,uint96 amountSpent,bool paused,bytes offchainConfig))",
  "function cancelUpkeep(uint256 id)",
  "function withdrawFunds(uint256 id, address to)"
];

function tryGetAddress(value: unknown): string | null {
  if (typeof value !== "string" || !ethers.isAddress(value)) {
    return null;
  }

  return ethers.getAddress(value);
}

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

function toJson<T>(value: T): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForBlock(targetBlock: number): Promise<void> {
  while (true) {
    const currentBlock = await ethers.provider.getBlockNumber();
    if (currentBlock >= targetBlock) {
      return;
    }

    console.log(`[cancel-automation] waiting for block ${targetBlock} (current ${currentBlock})`);
    await sleep(2000);
  }
}

async function main(): Promise<void> {
  const currentNetwork = await ethers.provider.getNetwork();
  const automationNetwork = resolveAutomationNetworkConfig(currentNetwork.chainId);

  if (!automationNetwork) {
    throw new Error(
      `This cancellation helper supports Base Sepolia (84532) and Base Mainnet (8453). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const waitForWithdraw = process.argv.includes("--wait") || process.env.AUTOMATION_WAIT_FOR_WITHDRAW === "1";
  const summaryPath = automationNetwork.automationPath.replace(/\.json$/i, ".cancelled.json");
  const manifest = await readJsonFile<AutomationManifest>(automationNetwork.automationPath);

  if (!manifest) {
    throw new Error(`Automation manifest not found at ${automationNetwork.automationPath}`);
  }

  const registryAddress = tryGetAddress(process.env[automationNetwork.registryEnvVar])
    ?? tryGetAddress(manifest.chainlink?.automationRegistry)
    ?? automationNetwork.defaultRegistry;

  if (!registryAddress) {
    throw new Error(`Unable to resolve the Automation registry address for ${automationNetwork.displayName}.`);
  }

  const code = await ethers.provider.getCode(registryAddress);
  if (code === "0x") {
    throw new Error(`No Chainlink Automation registry code found at ${registryAddress}.`);
  }

  const [signer] = await ethers.getSigners();
  let nextNonce = await ethers.provider.getTransactionCount(signer.address, "pending");
  const registry = await ethers.getContractAt(REGISTRY_ABI, registryAddress);
  const cancellationDelay = Number(await registry.getCancellationDelay());
  const version = String(await registry.typeAndVersion());
  const records: CancelRecord[] = [];

  for (const upkeep of manifest.upkeeps ?? []) {
    const upkeepId = typeof upkeep.upkeepId === "string" && upkeep.upkeepId.length > 0
      ? upkeep.upkeepId
      : null;
    const name = typeof upkeep.name === "string" ? upkeep.name : "unknown";
    const manifestTarget = tryGetAddress(upkeep.target);

    if (!upkeepId) {
      records.push({
        name,
        upkeepId: null,
        manifestTarget,
        onchainTarget: null,
        admin: null,
        balanceJuels: "0",
        status: "skipped-no-id",
        cancelTxHash: null,
        withdrawTxHash: null,
        withdrawReadyBlock: null,
        note: "No upkeep id in automation manifest."
      });
      continue;
    }

    const upkeepInfo = await registry.getUpkeep(BigInt(upkeepId));
    const onchainTarget = tryGetAddress(upkeepInfo.target);
    const admin = tryGetAddress(upkeepInfo.admin);
    const active = upkeepInfo.maxValidBlocknumber.toString() === ACTIVE_UPKEEP_SENTINEL;
    const balanceJuels = (await registry.getBalance(BigInt(upkeepId))).toString();

    if (!admin || admin !== ethers.getAddress(signer.address)) {
      records.push({
        name,
        upkeepId,
        manifestTarget,
        onchainTarget,
        admin,
        balanceJuels,
        status: "skipped-admin-mismatch",
        cancelTxHash: null,
        withdrawTxHash: null,
        withdrawReadyBlock: upkeepInfo.maxValidBlocknumber.toString(),
        note: `Upkeep admin is ${admin ?? "unknown"}, not the current signer ${signer.address}.`
      });
      continue;
    }

    let cancelTxHash: string | null = null;
    let withdrawTxHash: string | null = null;
    let refreshedInfo = upkeepInfo;
    let withdrawReadyBlock = Number(refreshedInfo.maxValidBlocknumber.toString());

    if (active) {
      const cancelTx = await registry.cancelUpkeep(BigInt(upkeepId), await buildTxOverrides(nextNonce));
      nextNonce += 1;
      const cancelReceipt = await cancelTx.wait();
      cancelTxHash = cancelTx.hash;
      withdrawReadyBlock = Number(cancelReceipt.blockNumber) + cancellationDelay;
    }

    if (waitForWithdraw && withdrawReadyBlock > 0) {
      await waitForBlock(withdrawReadyBlock);
      refreshedInfo = await registry.getUpkeep(BigInt(upkeepId));
      withdrawReadyBlock = Number(refreshedInfo.maxValidBlocknumber.toString()) === Number(ACTIVE_UPKEEP_SENTINEL)
        ? withdrawReadyBlock
        : Number(refreshedInfo.maxValidBlocknumber.toString());
    }

    const currentBlock = await ethers.provider.getBlockNumber();
    const latestBalance = (await registry.getBalance(BigInt(upkeepId))).toString();

    if (
      refreshedInfo.maxValidBlocknumber.toString() !== ACTIVE_UPKEEP_SENTINEL
      && currentBlock >= withdrawReadyBlock
      && latestBalance !== "0"
    ) {
      const withdrawTx = await registry.withdrawFunds(
        BigInt(upkeepId),
        signer.address,
        await buildTxOverrides(nextNonce)
      );
      nextNonce += 1;
      await withdrawTx.wait();
      withdrawTxHash = withdrawTx.hash;
    }

    const finalBalance = withdrawTxHash ? "0" : latestBalance;
    let status: CancelRecord["status"] = "already-cancelled";
    let note = active
      ? `Cancelled upkeep. Cancellation delay is ${cancellationDelay} blocks.`
      : "Upkeep was already cancelled on-chain.";

    if (withdrawTxHash) {
      status = active ? "withdrawn" : "withdrawn";
      note = `Cancelled upkeep and withdrew remaining LINK to ${signer.address}.`;
    } else if (cancelTxHash) {
      status = currentBlock >= withdrawReadyBlock ? "cancelled" : "pending-withdraw";
      if (status === "pending-withdraw") {
        note = `Cancelled upkeep. Withdraw becomes available at block ${withdrawReadyBlock}.`;
      }
    } else if (finalBalance !== "0" && currentBlock < withdrawReadyBlock) {
      status = "pending-withdraw";
      note = `Already cancelled. Withdraw becomes available at block ${withdrawReadyBlock}.`;
    }

    records.push({
      name,
      upkeepId,
      manifestTarget,
      onchainTarget,
      admin,
      balanceJuels: finalBalance,
      status,
      cancelTxHash,
      withdrawTxHash,
      withdrawReadyBlock: refreshedInfo.maxValidBlocknumber.toString(),
      note
    });
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    network: {
      name: automationNetwork.name,
      displayName: automationNetwork.displayName,
      chainId: Number(currentNetwork.chainId)
    },
    registryAddress,
    registrarVersion: version,
    cancellationDelayBlocks: cancellationDelay,
    signer: signer.address,
    waitForWithdraw,
    records
  };

  await mkdir(path.dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, toJson(summary), "utf8");

  console.log(`[cancel-automation] registry: ${registryAddress}`);
  console.log(`[cancel-automation] signer: ${signer.address}`);
  console.log(`[cancel-automation] summary saved to ${summaryPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
