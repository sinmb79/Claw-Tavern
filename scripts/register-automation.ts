import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

import { resolveAutomationNetworkConfig } from "./utils/automationNetwork";

const { network } = hre;
const ethers = (hre as unknown as { ethers: any }).ethers;

const CONDITION_TRIGGER = 0;
const DEFAULT_DAILY_CRON_UTC = "0 22 * * *";
const DEFAULT_FUNDING_LINK = 1_000_000_000_000_000_000n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ACTIVE_UPKEEP_SENTINEL = "4294967295";
const KEEPER_ROLE = ethers.id("KEEPER_ROLE");

type DeploymentManifest = {
  addresses: {
    tavernEscrow: string;
    tavernAutomationRouter?: string | null;
    tavernGovernance?: string | null;
    tavernRegistry: string;
    tavernToken: string;
  };
  constructorArgs?: {
    tavernToken?: null;
  };
};

type ExistingUpkeepEntry = Record<string, unknown> & {
  name?: unknown;
  upkeepId?: unknown;
  forwarder?: unknown;
  fundingAmountJuels?: unknown;
  registrationTxHash?: unknown;
  target?: unknown;
};

type ExistingAutomationManifest = {
  chainlink?: {
    automationForwarder?: string;
    automationRegistrar?: string;
    automationRegistry?: string;
    notes?: string[];
  };
  nextSteps?: string[];
  permissions?: unknown[];
  upkeeps?: ExistingUpkeepEntry[];
};

type CronField = {
  fieldType: number;
  interval: number;
  list: number[];
  listLength: number;
  rangeEnd: number;
  rangeStart: number;
  singleValue: number;
};

type UpkeepDefinition = {
  checkData: string;
  gasLimit: number;
  name: string;
  note: string;
  offchainConfig: string;
  registrationMode: "direct-target" | "placeholder-registration";
  schedule: Record<string, string | number>;
  selector: string;
  signature: string;
  target: string;
  triggerConfig: string;
  triggerLabel: "timeTrigger" | "conditionalTrigger";
};

type RegistrationParams = {
  adminAddress: string;
  amount: bigint;
  billingToken?: string;
  checkData: string;
  encryptedEmail: string;
  gasLimit: number;
  name: string;
  offchainConfig: string;
  triggerConfig: string;
  triggerType: number;
  upkeepContract: string;
};

type UpkeepRecord = {
  checkData: string;
  forwarder: string | null;
  fundingAmountJuels: string;
  gasLimit: number;
  name: string;
  note: string;
  offchainConfig: string;
  registrationMode: "direct-target" | "placeholder-registration";
  registrationTxHash: string | null;
  schedule: Record<string, string | number>;
  selector: string;
  signature: string;
  status: "already-registered" | "pending-approval" | "registered";
  target: string;
  trigger: "timeTrigger" | "conditionalTrigger";
  triggerConfig: string;
  upkeepId: string | null;
};

type ExistingUpkeepStatus = {
  entry: ExistingUpkeepEntry | undefined;
  forwarder: string | null;
  isActive: boolean;
  target: string | null;
  upkeepId: string | null;
};

type PermissionRecord = {
  contract: string;
  grantee: string;
  role: string;
  status: "already-granted" | "granted" | "skipped-no-code";
  txHash: string | null;
};

const REGISTRAR_PROBE_ABI = [
  "function typeAndVersion() view returns (string)",
  "function LINK() view returns (address)",
  "function getConfig() view returns (address keeperRegistry, uint256 minLINKJuels)",
  "function i_LINK() view returns (address)",
  "function getMinimumRegistrationAmount(address billingToken) view returns (uint256)",
  "function getRegistry() view returns (address)",
  "event RegistrationApproved(bytes32 indexed hash, string displayName, uint256 indexed upkeepId)"
];

const REGISTRAR21_ABI = [
  "function LINK() view returns (address)",
  "function getConfig() view returns (address keeperRegistry, uint256 minLINKJuels)",
  "function registerUpkeep((string name, bytes encryptedEmail, address upkeepContract, uint32 gasLimit, address adminAddress, uint8 triggerType, bytes checkData, bytes triggerConfig, bytes offchainConfig, uint96 amount) requestParams) returns (uint256)",
  "event RegistrationApproved(bytes32 indexed hash, string displayName, uint256 indexed upkeepId)"
];

const REGISTRAR23_ABI = [
  "function i_LINK() view returns (address)",
  "function getMinimumRegistrationAmount(address billingToken) view returns (uint256)",
  "function getRegistry() view returns (address)",
  "function registerUpkeep((address upkeepContract, uint96 amount, address adminAddress, uint32 gasLimit, uint8 triggerType, address billingToken, string name, bytes encryptedEmail, bytes checkData, bytes triggerConfig, bytes offchainConfig) requestParams) payable returns (uint256)",
  "event RegistrationApproved(bytes32 indexed hash, string displayName, uint256 indexed upkeepId)"
];

const REGISTRY_ABI = [
  "function getForwarder(uint256 upkeepID) view returns (address)",
  "function getState() view returns ((uint32 nonce,uint96 ownerLinkBalance,uint256 expectedLinkBalance,uint96 totalPremium,uint256 numUpkeeps,uint32 configCount,uint32 latestConfigBlockNumber,bytes32 latestConfigDigest,uint32 latestEpoch,bool paused) state,(uint32 paymentPremiumPPB,uint32 flatFeeMicroLink,uint32 checkGasLimit,uint24 stalenessSeconds,uint16 gasCeilingMultiplier,uint96 minUpkeepSpend,uint32 maxPerformGas,uint32 maxCheckDataSize,uint32 maxPerformDataSize,uint32 maxRevertDataSize,uint256 fallbackGasPrice,uint256 fallbackLinkPrice,address transcoder,address[] registrars,address upkeepPrivilegeManager) config,address[] signers,address[] transmitters,uint8 f)",
  "function getUpkeep(uint256 id) view returns ((address target,uint32 performGas,bytes checkData,uint96 balance,address admin,uint64 maxValidBlocknumber,uint32 lastPerformedBlockNumber,uint96 amountSpent,bool paused,bytes offchainConfig))"
];

const LINK_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)"
];

const ACCESS_CONTROL_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)"
];

function toJson<T>(value: T): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function tryGetAddress(value: unknown): string | null {
  if (typeof value !== "string" || !ethers.isAddress(value)) {
    return null;
  }

  return ethers.getAddress(value);
}

function tryGetNonZeroAddress(value: unknown): string | null {
  const address = tryGetAddress(value);
  return address && address !== ZERO_ADDRESS ? address : null;
}

function addressesMatch(left: string | null, right: string | null): boolean {
  if (!left || !right) {
    return false;
  }

  return ethers.getAddress(left) === ethers.getAddress(right);
}

function resolveRequiredAddress(
  envName: string,
  fallback: string | null,
  defaultValue: string | null = null
): string {
  const raw = process.env[envName]?.trim() || fallback || defaultValue || "";

  if (!ethers.isAddress(raw)) {
    throw new Error(`${envName} is not configured with a valid address.`);
  }

  return ethers.getAddress(raw);
}

function resolveOptionalAddress(envName: string, fallback: string | null = null): string | null {
  const raw = process.env[envName]?.trim() || fallback || "";

  if (!raw) {
    return null;
  }

  if (!ethers.isAddress(raw)) {
    throw new Error(`${envName} is not configured with a valid address.`);
  }

  return ethers.getAddress(raw);
}

function encodeJsonConfig(value: Record<string, string | number>): string {
  return ethers.hexlify(ethers.toUtf8Bytes(JSON.stringify(value)));
}

function createEmptyList(): number[] {
  return Array.from({ length: 26 }, () => 0);
}

function makeWildField(): CronField {
  return {
    fieldType: 0,
    interval: 0,
    list: createEmptyList(),
    listLength: 0,
    rangeEnd: 0,
    rangeStart: 0,
    singleValue: 0
  };
}

function parseCronField(rawField: string): CronField {
  const value = rawField.trim();

  if (value === "*") {
    return makeWildField();
  }

  if (value.includes(",")) {
    const items = value.split(",").map((item) => Number(item.trim()));

    if (items.length > 26 || items.some((item) => !Number.isInteger(item) || item < 0 || item > 255)) {
      throw new Error(`Unsupported cron list field: ${value}`);
    }

    const list = createEmptyList();

    for (let index = 0; index < items.length; index += 1) {
      list[index] = items[index];
    }

    return {
      fieldType: 4,
      interval: 0,
      list,
      listLength: items.length,
      rangeEnd: 0,
      rangeStart: 0,
      singleValue: 0
    };
  }

  if (value.includes("/")) {
    const parts = value.split("/");
    const interval = Number(parts[parts.length - 1]);

    if (!Number.isInteger(interval) || interval < 1 || interval > 255) {
      throw new Error(`Unsupported cron interval field: ${value}`);
    }

    return {
      fieldType: 2,
      interval,
      list: createEmptyList(),
      listLength: 0,
      rangeEnd: 0,
      rangeStart: 0,
      singleValue: 0
    };
  }

  if (value.includes("-")) {
    const [rangeStartRaw, rangeEndRaw] = value.split("-");
    const rangeStart = Number(rangeStartRaw);
    const rangeEnd = Number(rangeEndRaw);

    if (
      !Number.isInteger(rangeStart) ||
      !Number.isInteger(rangeEnd) ||
      rangeStart < 0 ||
      rangeEnd < 0 ||
      rangeStart > 255 ||
      rangeEnd > 255
    ) {
      throw new Error(`Unsupported cron range field: ${value}`);
    }

    return {
      fieldType: 3,
      interval: 0,
      list: createEmptyList(),
      listLength: 0,
      rangeEnd,
      rangeStart,
      singleValue: 0
    };
  }

  const singleValue = Number(value);

  if (!Number.isInteger(singleValue) || singleValue < 0 || singleValue > 255) {
    throw new Error(`Unsupported cron exact field: ${value}`);
  }

  return {
    fieldType: 1,
    interval: 0,
    list: createEmptyList(),
    listLength: 0,
    rangeEnd: 0,
    rangeStart: 0,
    singleValue
  };
}

function encodeCronTriggerConfig(cronExpressionUtc: string): string {
  const [minute, hour, day, month, dayOfWeek] = cronExpressionUtc.trim().split(/\s+/);

  if (!minute || !hour || !day || !month || !dayOfWeek) {
    throw new Error(`Invalid cron expression: ${cronExpressionUtc}`);
  }

  const fieldType =
    "tuple(uint8 fieldType,uint8 singleValue,uint8 interval,uint8 rangeStart,uint8 rangeEnd,uint8 listLength,uint8[26] list)";
  const specType = `tuple(${fieldType} minute,${fieldType} hour,${fieldType} day,${fieldType} month,${fieldType} dayOfWeek)`;

  return ethers.AbiCoder.defaultAbiCoder().encode(
    [specType],
    [
      {
        minute: parseCronField(minute),
        hour: parseCronField(hour),
        day: parseCronField(day),
        month: parseCronField(month),
        dayOfWeek: parseCronField(dayOfWeek)
      }
    ]
  );
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

async function backupJsonFile(filePath: string, value: unknown): Promise<string> {
  const backupPath = filePath.endsWith(".json")
    ? filePath.replace(/\.json$/i, ".backup.json")
    : `${filePath}.backup.json`;
  await writeFile(backupPath, toJson(value), "utf8");
  return backupPath;
}

async function discoverRegistrarFromRegistry(registryAddress: string): Promise<string | null> {
  const registry = await ethers.getContractAt(REGISTRY_ABI, registryAddress);
  const state = await registry.getState();
  const config = state[1] as { registrars?: string[] };
  const discovered = config.registrars?.find((value) => ethers.isAddress(value));

  return discovered ? ethers.getAddress(discovered) : null;
}

async function getRegistrarVersion(registrarAddress: string): Promise<string> {
  const registrar = await ethers.getContractAt(REGISTRAR_PROBE_ABI, registrarAddress);
  return String(await registrar.typeAndVersion());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveForwarder(
  keeperRegistry: any,
  upkeepId: bigint,
  attempts = 5,
  delayMs = 1_500
): Promise<string | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const rawForwarder = await keeperRegistry.getForwarder(upkeepId);

    if (rawForwarder && rawForwarder !== ZERO_ADDRESS) {
      return ethers.getAddress(rawForwarder);
    }

    if (attempt < attempts - 1) {
      await sleep(delayMs);
    }
  }

  return null;
}

async function isUpkeepActive(keeperRegistry: any, upkeepId: bigint): Promise<boolean> {
  try {
    const upkeep = await keeperRegistry.getUpkeep(upkeepId);
    return upkeep.maxValidBlocknumber.toString() === ACTIVE_UPKEEP_SENTINEL;
  } catch {
    return false;
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

async function ensureKeeperRole(
  contract: any,
  contractName: string,
  grantee: string,
  permissionRecords: PermissionRecord[],
  contractsAvailable: boolean,
  nextNonce: number
): Promise<number> {
  if (!contractsAvailable) {
    permissionRecords.push({
      contract: contractName,
      grantee,
      role: KEEPER_ROLE,
      status: "skipped-no-code",
      txHash: null
    });
    return nextNonce;
  }

  const hasRole = await contract.hasRole(KEEPER_ROLE, grantee);

  if (hasRole) {
    permissionRecords.push({
      contract: contractName,
      grantee,
      role: KEEPER_ROLE,
      status: "already-granted",
      txHash: null
    });
    return nextNonce;
  }

  const tx = await contract.grantRole(KEEPER_ROLE, grantee, await buildTxOverrides(nextNonce));
  await tx.wait();
  permissionRecords.push({
    contract: contractName,
    grantee,
    role: KEEPER_ROLE,
    status: "granted",
    txHash: tx.hash
  });
  return nextNonce + 1;
}

function buildUpkeepDefinitions(deployment: DeploymentManifest): UpkeepDefinition[] {
  const routerAddress = tryGetNonZeroAddress(deployment.addresses.tavernAutomationRouter);
  if (routerAddress) {
    const routerInterface = new ethers.Interface([
      "function performUpkeep(bytes)"
    ]);

    return [
      {
        name: "tavernAutomationRouter",
        target: routerAddress,
        signature: "performUpkeep(bytes)",
        selector: routerInterface.getFunction("performUpkeep")?.selector ?? "0x",
        gasLimit: 1_000_000,
        checkData: "0x",
        triggerConfig: "0x",
        offchainConfig: encodeJsonConfig({
          checkIntervalMinutes: 5,
          mode: "nativeRouter",
          tasks: "timeout,autoApprove,feeStage,quota"
        }),
        schedule: {
          checkIntervalMinutes: 5,
          mode: "nativeRouter"
        },
        triggerLabel: "conditionalTrigger",
        registrationMode: "direct-target",
        note: "Single native Automation upkeep routed through TavernAutomationRouter."
      }
    ];
  }

  const registryInterface = new ethers.Interface([
    "function dailyQuotaRebalance(uint256[6])"
  ]);
  const escrowInterface = new ethers.Interface([
    "function executeTimeout(uint256)",
    "function checkAndUpgradeFeeStage()"
  ]);

  return [
    {
      name: "dailyQuotaRebalance",
      target: deployment.addresses.tavernRegistry,
      signature: "dailyQuotaRebalance(uint256[6])",
      selector: registryInterface.getFunction("dailyQuotaRebalance")?.selector ?? "0x",
      gasLimit: 700_000,
      checkData: "0x",
      triggerConfig: encodeCronTriggerConfig(DEFAULT_DAILY_CRON_UTC),
      offchainConfig: encodeJsonConfig({
        cronUtc: DEFAULT_DAILY_CRON_UTC,
        localTimeKst: "07:00",
        mode: "timeTrigger"
      }),
      schedule: {
        cronUtc: DEFAULT_DAILY_CRON_UTC,
        localTimeKst: "07:00"
      },
      triggerLabel: "timeTrigger",
      registrationMode: "placeholder-registration",
      note:
        "Registered with a cron-style trigger config, but production execution still needs wrapper or resolver logic for six-slot score computation."
    },
    {
      name: "executeTimeout",
      target: deployment.addresses.tavernEscrow,
      signature: "executeTimeout(uint256)",
      selector: escrowInterface.getFunction("executeTimeout")?.selector ?? "0x",
      gasLimit: 700_000,
      checkData: "0x",
      triggerConfig: "0x",
      offchainConfig: encodeJsonConfig({
        checkIntervalMinutes: 15,
        mode: "conditionalTrigger"
      }),
      schedule: {
        checkIntervalMinutes: 15
      },
      triggerLabel: "conditionalTrigger",
      registrationMode: "placeholder-registration",
      note:
        "Registered as a conditional upkeep placeholder. Production execution still needs an offchain resolver or wrapper to select eligible questId values."
    },
    {
      name: "checkAndUpgradeFeeStage",
      target: deployment.addresses.tavernEscrow,
      signature: "checkAndUpgradeFeeStage()",
      selector: escrowInterface.getFunction("checkAndUpgradeFeeStage")?.selector ?? "0x",
      gasLimit: 350_000,
      checkData: "0x",
      triggerConfig: "0x",
      offchainConfig: encodeJsonConfig({
        checkIntervalMinutes: 60,
        mode: "conditionalTrigger"
      }),
      schedule: {
        checkIntervalMinutes: 60
      },
      triggerLabel: "conditionalTrigger",
      registrationMode: "direct-target",
      note:
        "Registered as a direct conditional upkeep target. A dedicated wrapper is still the cleaner production path because the escrow contract is not AutomationCompatible."
    }
  ];
}

function buildRegistrationParams(
  upkeep: UpkeepDefinition,
  adminAddress: string,
  amount: bigint,
  billingToken?: string
): RegistrationParams {
  return {
    adminAddress,
    amount,
    billingToken,
    checkData: upkeep.checkData,
    encryptedEmail: "0x",
    gasLimit: upkeep.gasLimit,
    name: upkeep.name,
    offchainConfig: upkeep.offchainConfig,
    triggerConfig: upkeep.triggerConfig,
    triggerType: CONDITION_TRIGGER,
    upkeepContract: upkeep.target
  };
}

function parseApprovalEvent(receiptLogs: Array<{ topics: string[]; data: string }>): bigint | null {
  const iface = new ethers.Interface([
    "event RegistrationApproved(bytes32 indexed hash, string displayName, uint256 indexed upkeepId)"
  ]);

  for (const log of receiptLogs) {
    try {
      const parsed = iface.parseLog(log);

      if (parsed?.name === "RegistrationApproved") {
        return parsed.args.upkeepId as bigint;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function main(): Promise<void> {
  const currentNetwork = await ethers.provider.getNetwork();
  const automationNetwork = resolveAutomationNetworkConfig(currentNetwork.chainId);

  if (!automationNetwork) {
    throw new Error(
      `This script supports Base Sepolia (84532) and Base Mainnet (8453). Connected chainId: ${currentNetwork.chainId.toString()}`
    );
  }

  const deployment = await readJsonFile<DeploymentManifest>(automationNetwork.deploymentPath);

  if (!deployment) {
    throw new Error(`Deployment manifest not found at ${automationNetwork.deploymentPath}`);
  }

  const existingAutomation = await readJsonFile<ExistingAutomationManifest>(automationNetwork.automationPath);
  const defaultRegistryFromManifest = tryGetAddress(existingAutomation?.chainlink?.automationRegistry);
  const configuredRegistryAddress = resolveRequiredAddress(
    automationNetwork.registryEnvVar,
    defaultRegistryFromManifest,
    automationNetwork.defaultRegistry
  );
  const existingRegistrar = tryGetAddress(existingAutomation?.chainlink?.automationRegistrar);
  const configuredRegistrar = resolveOptionalAddress(
    automationNetwork.registrarEnvVar,
    existingRegistrar ?? automationNetwork.defaultRegistrar
  );

  let registryAddress = configuredRegistryAddress;
  let registryCode = await ethers.provider.getCode(registryAddress);

  if (registryCode === "0x" && registryAddress !== automationNetwork.defaultRegistry) {
    const defaultRegistryCode = await ethers.provider.getCode(automationNetwork.defaultRegistry);

    if (defaultRegistryCode !== "0x") {
      console.warn(
        `Configured Chainlink registry ${registryAddress} has no code on the connected network. Falling back to ${automationNetwork.displayName} default ${automationNetwork.defaultRegistry}.`
      );
      registryAddress = automationNetwork.defaultRegistry;
      registryCode = defaultRegistryCode;
    }
  }

  if (registryCode === "0x") {
    console.log(`Chainlink registry code was not found at ${registryAddress}.`);
    console.log(`Set ${automationNetwork.registryEnvVar} to a live ${automationNetwork.displayName} registry and rerun.`);
    return;
  }

  const registrarAddress =
    configuredRegistrar ?? (await discoverRegistrarFromRegistry(registryAddress));

  if (!registrarAddress) {
    console.log("No Chainlink Automation registrar address was configured or discoverable from the registry.");
    console.log(`Set ${automationNetwork.registrarEnvVar} in .env and rerun.`);
    return;
  }

  const registrarCode = await ethers.provider.getCode(registrarAddress);

  if (registrarCode === "0x") {
    console.log(`Chainlink registrar code was not found at ${registrarAddress}.`);
    console.log(`Set ${automationNetwork.registrarEnvVar} to a live ${automationNetwork.displayName} registrar and rerun.`);
    return;
  }

  const registrarVersion = await getRegistrarVersion(registrarAddress);
  const [deployer] = await ethers.getSigners();
  let nextNonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  const adminAddress = resolveOptionalAddress("INITIAL_TEAM_ADDRESS") ?? deployer.address;

  const keeperRegistry = await ethers.getContractAt(REGISTRY_ABI, registryAddress);
  const isRegistrar23 = registrarVersion.includes("2.3");
  const registrar = await ethers.getContractAt(
    isRegistrar23 ? REGISTRAR23_ABI : REGISTRAR21_ABI,
    registrarAddress
  );
  const linkAddress = isRegistrar23
    ? ethers.getAddress(await registrar.i_LINK())
    : ethers.getAddress(await registrar.LINK());
  const linkToken = await ethers.getContractAt(LINK_ABI, linkAddress);

  const minLINKJuelsRaw = isRegistrar23
    ? await registrar.getMinimumRegistrationAmount(linkAddress)
    : (await registrar.getConfig())[1];
  const minLINKJuels = BigInt(minLINKJuelsRaw.toString());
  const fundingAmount = minLINKJuels > 0n ? minLINKJuels : DEFAULT_FUNDING_LINK;
  const upkeeps = buildUpkeepDefinitions(deployment);
  const routerAddress = tryGetNonZeroAddress(deployment.addresses.tavernAutomationRouter);
  const routerMode = Boolean(routerAddress && upkeeps.length === 1 && addressesMatch(upkeeps[0]?.target ?? null, routerAddress));
  const existingByName = new Map<string, ExistingUpkeepEntry>(
    (existingAutomation?.upkeeps ?? [])
      .filter((entry) => typeof entry.name === "string")
      .map((entry) => [String(entry.name), entry])
  );

  const existingStatuses = new Map<string, ExistingUpkeepStatus>();

  for (const upkeep of upkeeps) {
    const entry = existingByName.get(upkeep.name);
    const upkeepId =
      typeof entry?.upkeepId === "string" && entry.upkeepId.length > 0
        ? entry.upkeepId
        : null;
    let forwarder = tryGetNonZeroAddress(entry?.forwarder);
    let active = false;
    let target = tryGetAddress(entry?.target);

    if (upkeepId) {
      active = await isUpkeepActive(keeperRegistry, BigInt(upkeepId));

      if (active) {
        const onchainUpkeep = await keeperRegistry.getUpkeep(BigInt(upkeepId));
        target = tryGetAddress(onchainUpkeep.target) ?? target;

        if (!forwarder) {
          forwarder = await resolveForwarder(keeperRegistry, BigInt(upkeepId));
        }
      }
    }

    existingStatuses.set(upkeep.name, {
      entry,
      forwarder,
      isActive: active,
      target,
      upkeepId
    });
  }

  const newRegistrationsNeeded = upkeeps.filter((upkeep) => {
    const status = existingStatuses.get(upkeep.name);

    if (!status?.isActive) {
      return true;
    }

    return !addressesMatch(status.target, upkeep.target);
  }).length;

  const requiredLink = fundingAmount * BigInt(newRegistrationsNeeded);
  const linkBalance = BigInt((await linkToken.balanceOf(deployer.address)).toString());

  if (requiredLink > 0n && linkBalance < requiredLink) {
    const decimals = Number(await linkToken.decimals());
    console.log(
      `Insufficient LINK for registration. Need ${ethers.formatUnits(requiredLink, decimals)} LINK but only have ${ethers.formatUnits(linkBalance, decimals)} LINK.`
    );
    console.log(`Fund the deployer with ${ethers.formatUnits(requiredLink, decimals)} LINK on ${automationNetwork.displayName} and rerun ${automationNetwork.registerCommand}.`);
    return;
  }

  if (requiredLink > 0n) {
    const allowance = BigInt((await linkToken.allowance(deployer.address, registrarAddress)).toString());

    if (allowance < requiredLink) {
      console.log(`Approving ${requiredLink.toString()} juels to the Automation registrar...`);
      const approveTx = await linkToken.approve(
        registrarAddress,
        requiredLink,
        await buildTxOverrides(nextNonce)
      );
      nextNonce += 1;
      await approveTx.wait();
    }
  }

  const upkeepRecords: UpkeepRecord[] = [];
  const discoveredForwarders = new Set<string>();

  for (const upkeep of upkeeps) {
    const status = existingStatuses.get(upkeep.name);
    const existingUpkeepId = status?.upkeepId ?? null;
    const existingRecord = status?.entry;
    const existingTarget = status?.target ?? tryGetAddress(existingRecord?.target);
    const targetMatches = addressesMatch(existingTarget, upkeep.target);

    if (status?.isActive && existingUpkeepId && targetMatches) {
      if (status.forwarder) {
        discoveredForwarders.add(status.forwarder);
      }

      console.log(`Skipping ${upkeep.name}: upkeep ${existingUpkeepId} is still active on-chain.`);

      upkeepRecords.push({
        checkData: upkeep.checkData,
        forwarder: status.forwarder,
        fundingAmountJuels:
          typeof existingRecord?.fundingAmountJuels === "string"
            ? existingRecord.fundingAmountJuels
            : fundingAmount.toString(),
        gasLimit: upkeep.gasLimit,
        name: upkeep.name,
        note: upkeep.note,
        offchainConfig: upkeep.offchainConfig,
        registrationMode: upkeep.registrationMode,
        registrationTxHash:
          typeof existingRecord?.registrationTxHash === "string"
            ? existingRecord.registrationTxHash
            : null,
        schedule: upkeep.schedule,
        selector: upkeep.selector,
        signature: upkeep.signature,
        status: "already-registered",
        target: upkeep.target,
        trigger: upkeep.triggerLabel,
        triggerConfig: upkeep.triggerConfig,
        upkeepId: existingUpkeepId
      });
      continue;
    }

    if (status?.isActive && existingUpkeepId && !targetMatches) {
      console.log(
        `Re-registering ${upkeep.name}: target changed from ${existingTarget ?? "unknown"} to ${upkeep.target}.`
      );
    } else if (existingUpkeepId) {
      console.log(`Re-registering ${upkeep.name}: recorded upkeep ${existingUpkeepId} is no longer active.`);
    }

    const params = buildRegistrationParams(
      upkeep,
      adminAddress,
      fundingAmount,
      isRegistrar23 ? linkAddress : undefined
    );

    console.log(`Registering ${upkeep.name} through ${registrarVersion}...`);

    let predictedUpkeepId: bigint | null = null;

    if (!isRegistrar23) {
      try {
        predictedUpkeepId = await registrar.registerUpkeep.staticCall(params);
      } catch (error) {
        console.warn(`Static call for ${upkeep.name} did not return an upkeep id. Continuing with live tx.`);
        console.warn(error);
      }
    }

    const tx = await registrar.registerUpkeep(params, await buildTxOverrides(nextNonce));
    nextNonce += 1;
    const receipt = await tx.wait();
    const rawReceipt = await ethers.provider.getTransactionReceipt(tx.hash);
    const approvedUpkeepId = parseApprovalEvent(rawReceipt?.logs ?? receipt?.logs ?? []);
    const upkeepId = approvedUpkeepId ?? predictedUpkeepId;
    let forwarder: string | null = null;
    let recordStatus: UpkeepRecord["status"] = "pending-approval";

    if (upkeepId && upkeepId > 0n) {
      recordStatus = "registered";

      try {
        forwarder = await resolveForwarder(keeperRegistry, upkeepId);

        if (forwarder) {
          discoveredForwarders.add(forwarder);
        }
      } catch (error) {
        console.warn(`Registered ${upkeep.name} as upkeep ${upkeepId.toString()}, but forwarder lookup failed.`);
        console.warn(error);
      }
    } else {
      console.log(`${upkeep.name} submitted without an immediate upkeep id. Manual registrar approval may be required.`);
    }

    upkeepRecords.push({
      checkData: upkeep.checkData,
      forwarder,
      fundingAmountJuels: fundingAmount.toString(),
      gasLimit: upkeep.gasLimit,
      name: upkeep.name,
      note: upkeep.note,
      offchainConfig: upkeep.offchainConfig,
      registrationMode: upkeep.registrationMode,
      registrationTxHash: receipt?.hash ?? tx.hash,
      schedule: upkeep.schedule,
      selector: upkeep.selector,
      signature: upkeep.signature,
      status: recordStatus,
      target: upkeep.target,
      trigger: upkeep.triggerLabel,
      triggerConfig: upkeep.triggerConfig,
      upkeepId: upkeepId ? upkeepId.toString() : null
    });
  }

  const tavernRegistryCode = await ethers.provider.getCode(deployment.addresses.tavernRegistry);
  const tavernEscrowCode = await ethers.provider.getCode(deployment.addresses.tavernEscrow);
  const tavernRouterCode = routerAddress ? await ethers.provider.getCode(routerAddress) : "0x";
  const contractsAvailable = tavernRegistryCode !== "0x" && tavernEscrowCode !== "0x";
  const permissionRecords: PermissionRecord[] = [];

  if (contractsAvailable && !routerMode) {
    const tavernRegistryRoleContract = await ethers.getContractAt(
      ACCESS_CONTROL_ABI,
      deployment.addresses.tavernRegistry
    );
    const tavernEscrowRoleContract = await ethers.getContractAt(
      ACCESS_CONTROL_ABI,
      deployment.addresses.tavernEscrow
    );

    for (const forwarder of discoveredForwarders) {
      nextNonce = await ensureKeeperRole(
        tavernRegistryRoleContract,
        "TavernRegistry",
        forwarder,
        permissionRecords,
        contractsAvailable,
        nextNonce
      );
      nextNonce = await ensureKeeperRole(
        tavernEscrowRoleContract,
        "TavernEscrow",
        forwarder,
        permissionRecords,
        contractsAvailable,
        nextNonce
      );
    }
  }

  if (routerMode && routerAddress) {
    if (tavernRouterCode === "0x") {
      for (const forwarder of discoveredForwarders) {
        permissionRecords.push({
          contract: "TavernAutomationRouter",
          grantee: forwarder,
          role: KEEPER_ROLE,
          status: "skipped-no-code",
          txHash: null
        });
      }
    } else {
      const tavernRouterRoleContract = await ethers.getContractAt(
        ACCESS_CONTROL_ABI,
        routerAddress
      );

      for (const forwarder of discoveredForwarders) {
        nextNonce = await ensureKeeperRole(
          tavernRouterRoleContract,
          "TavernAutomationRouter",
          forwarder,
          permissionRecords,
          true,
          nextNonce
        );
      }
    }
  }

  const uniqueForwarders = Array.from(discoveredForwarders);
  const automationForwarder =
    uniqueForwarders.length === 1
      ? uniqueForwarders[0] ?? "TODO_AFTER_UPKEEP_REGISTRATION"
      : uniqueForwarders.length > 1
        ? "MULTIPLE_UPKEEP_FORWARDERS"
        : routerMode
          ? "TODO_AFTER_UPKEEP_REGISTRATION"
          : resolveOptionalAddress(
              automationNetwork.forwarderEnvVar,
              tryGetNonZeroAddress(existingAutomation?.chainlink?.automationForwarder)
            ) ?? "TODO_AFTER_UPKEEP_REGISTRATION";

  const manifest = {
    generatedAt: new Date().toISOString(),
    network: {
      name: network.name,
      chainId: Number(currentNetwork.chainId)
    },
    chainlink: {
      automationRegistry: registryAddress,
      automationRegistrar: registrarAddress,
      automationForwarder,
      forwarders: uniqueForwarders,
      linkToken: ethers.getAddress(linkAddress),
      registrarVersion,
      minLinkJuels: fundingAmount.toString(),
      notes: [
        ...(tryGetNonZeroAddress(deployment.addresses.tavernAutomationRouter)
          ? [
              "tavernAutomationRouter is deployed, so a single native conditional upkeep now targets the router contract directly.",
              "Router mode centralizes timeout, auto-approve, fee-stage, and quota-rebalance automation behind one checkUpkeep/performUpkeep target.",
              "In router mode, the Chainlink forwarder receives KEEPER_ROLE on TavernAutomationRouter while TavernRegistry and TavernEscrow stay gated behind the router contract."
            ]
          : [
              "dailyQuotaRebalance is registered with a cron-style trigger config for 22:00 UTC, which maps to 07:00 KST.",
              "executeTimeout and checkAndUpgradeFeeStage are registered as conditional upkeeps with offchain metadata for 15 minute and 60 minute scan intervals.",
              "The current Claw Tavern contracts do not expose Chainlink AutomationCompatible checkUpkeep/performUpkeep hooks, so wrapper or resolver infrastructure is still recommended before production execution."
            ]),
        "register-automation.ts now checks both on-chain upkeep activity and target alignment before skipping, grants KEEPER_ROLE to current forwarders, and writes a backup manifest before overwrite."
      ]
    },
    roleGrantMode: contractsAvailable ? "executed" : "manifest-only",
    permissions: permissionRecords,
    upkeeps: upkeepRecords,
    nextSteps:
      automationNetwork.name === "base"
        ? [
            `Run ${automationNetwork.verifyCommand} to confirm the upkeep, forwarder, and KEEPER_ROLE holders match on-chain.`,
            "Document the upkeep id and forwarder in DEPLOY_GUIDE.md and HANDOFF_RESUME.md once registration succeeds.",
            "Decide whether to revoke the temporary seed keeper after the Chainlink forwarder is active."
          ]
        : [
            `Run ${automationNetwork.verifyCommand} to confirm current upkeeps, forwarders, and KEEPER_ROLE holders still match on-chain.`,
            `Use ${automationNetwork.cleanupCommand} first in dry-run mode before any role revocation, then ${automationNetwork.cleanupExecuteCommand} only if stale holders are detected.`,
            "Replace the TVRN/USD placeholder feed before running compensation flows on live testnet quests."
          ]
  };

  await mkdir(path.dirname(automationNetwork.automationPath), { recursive: true });

  if (existingAutomation) {
    const backupPath = await backupJsonFile(automationNetwork.automationPath, existingAutomation);
    console.log(`Backed up existing automation manifest to ${backupPath}`);
  }

  await writeFile(automationNetwork.automationPath, toJson(manifest), "utf8");

  console.log(`Automation registration manifest saved to ${automationNetwork.automationPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
