import { readFile } from "node:fs/promises";
import path from "node:path";

import hre from "hardhat";

type ArtifactLike = {
  _format?: string;
  contractName?: string;
  sourceName?: string;
  abi: unknown[];
  bytecode?: string | { object?: string; linkReferences?: Record<string, unknown> };
  deployedBytecode?: string | { object?: string; linkReferences?: Record<string, unknown> };
  linkReferences?: Record<string, unknown>;
  deployedLinkReferences?: Record<string, unknown>;
};

async function readArtifactFile(contractName: string): Promise<ArtifactLike> {
  const candidates = [
    path.join(process.cwd(), "artifacts", "contracts", `${contractName}.sol`, `${contractName}.json`),
    path.join(process.cwd(), "artifacts", `${contractName}.sol`, `${contractName}.json`)
  ];

  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, "utf8");
      return JSON.parse(raw) as ArtifactLike;
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
  }

  throw new Error(`Artifact not found for ${contractName}. Checked: ${candidates.join(", ")}`);
}

function normalizeBytecode(value: ArtifactLike["bytecode"]): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value?.object === "string") {
    return value.object.startsWith("0x") ? value.object : `0x${value.object}`;
  }

  return "0x";
}

async function readNormalizedArtifact(contractName: string) {
  const artifact = await readArtifactFile(contractName);

  if (
    artifact._format &&
    artifact.contractName &&
    artifact.sourceName &&
    typeof artifact.bytecode === "string" &&
    typeof artifact.deployedBytecode === "string"
  ) {
    return artifact;
  }

  return {
    _format: "hh-sol-artifact-1",
    contractName,
    sourceName: `${contractName}.sol`,
    abi: artifact.abi,
    bytecode: normalizeBytecode(artifact.bytecode),
    deployedBytecode: normalizeBytecode(artifact.deployedBytecode),
    linkReferences:
      typeof artifact.bytecode === "object" && artifact.bytecode?.linkReferences
        ? artifact.bytecode.linkReferences
        : (artifact.linkReferences ?? {}),
    deployedLinkReferences:
      typeof artifact.deployedBytecode === "object" && artifact.deployedBytecode?.linkReferences
        ? artifact.deployedBytecode.linkReferences
        : (artifact.deployedLinkReferences ?? {})
  };
}

export async function getWorkspaceContractFactory(contractName: string, signer?: any) {
  const artifact = await readNormalizedArtifact(contractName);
  return hre.ethers.getContractFactoryFromArtifact(artifact as any, signer);
}

export async function getWorkspaceContractAt(contractName: string, address: string, signer?: any) {
  const artifact = await readNormalizedArtifact(contractName);
  return hre.ethers.getContractAt(artifact.abi as any, address, signer);
}
