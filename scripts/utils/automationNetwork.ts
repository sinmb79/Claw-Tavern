import path from "node:path";

export type AutomationNetworkName = "baseSepolia" | "base";

export type AutomationNetworkConfig = {
  name: AutomationNetworkName;
  displayName: string;
  supportedChainIds: bigint[];
  defaultRegistry: string;
  defaultRegistrar: string | null;
  registryEnvVar: string;
  registrarEnvVar: string;
  forwarderEnvVar: string;
  deploymentPath: string;
  automationPath: string;
  automationBackupPath: string;
  legacyCleanupPath: string;
  registerCommand: string;
  verifyCommand: string;
  cleanupCommand: string;
  cleanupExecuteCommand: string;
};

const ROOT = process.cwd();

const AUTOMATION_NETWORKS: Record<AutomationNetworkName, AutomationNetworkConfig> = {
  baseSepolia: {
    name: "baseSepolia",
    displayName: "Base Sepolia",
    supportedChainIds: [84532n, 31337n],
    defaultRegistry: "0x91D4a4C3D448c7f3CB477332B1c7D420a5810aC3",
    defaultRegistrar: null,
    registryEnvVar: "CHAINLINK_AUTOMATION_REGISTRY_ADDRESS",
    registrarEnvVar: "CHAINLINK_AUTOMATION_REGISTRAR_ADDRESS",
    forwarderEnvVar: "CHAINLINK_AUTOMATION_FORWARDER_ADDRESS",
    deploymentPath: path.join(ROOT, "deployments", "baseSepolia.json"),
    automationPath: path.join(ROOT, "deployments", "baseSepolia.automation.json"),
    automationBackupPath: path.join(ROOT, "deployments", "baseSepolia.automation.backup.json"),
    legacyCleanupPath: path.join(ROOT, "deployments", "baseSepolia.legacy-cleanup.json"),
    registerCommand: "npm run register:automation",
    verifyCommand: "npm run verify:automation",
    cleanupCommand: "npm run cleanup:automation",
    cleanupExecuteCommand: "npm run cleanup:automation:execute"
  },
  base: {
    name: "base",
    displayName: "Base Mainnet",
    supportedChainIds: [8453n],
    defaultRegistry: "0xf4bAb6A129164aBa9B113cB96BA4266dF49f8743",
    defaultRegistrar: "0xE28Adc50c7551CFf69FCF32D45d037e5F6554264",
    registryEnvVar: "MAINNET_CHAINLINK_AUTOMATION_REGISTRY_ADDRESS",
    registrarEnvVar: "MAINNET_CHAINLINK_AUTOMATION_REGISTRAR_ADDRESS",
    forwarderEnvVar: "MAINNET_CHAINLINK_AUTOMATION_FORWARDER_ADDRESS",
    deploymentPath: path.join(ROOT, "deployments", "base.json"),
    automationPath: path.join(ROOT, "deployments", "base.automation.json"),
    automationBackupPath: path.join(ROOT, "deployments", "base.automation.backup.json"),
    legacyCleanupPath: path.join(ROOT, "deployments", "base.legacy-cleanup.json"),
    registerCommand: "npm run register:automation:base",
    verifyCommand: "npm run verify:automation:base",
    cleanupCommand: "npm run cleanup:automation:base",
    cleanupExecuteCommand: "npm run cleanup:automation:base:execute"
  }
};

export function resolveAutomationNetworkConfig(chainId: bigint): AutomationNetworkConfig | null {
  for (const config of Object.values(AUTOMATION_NETWORKS)) {
    if (config.supportedChainIds.includes(chainId)) {
      return config;
    }
  }

  return null;
}

export function getAutomationNetworkConfigs(): AutomationNetworkConfig[] {
  return Object.values(AUTOMATION_NETWORKS);
}
