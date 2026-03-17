import { ethers } from "hardhat";

import { deployCoreFixture } from "./deployCoreFixture";

export async function deployServiceMarketplaceFixture() {
  const core = await deployCoreFixture();

  const TavernEquipment = await ethers.getContractFactory("TavernEquipment");
  const equipment: any = await TavernEquipment.deploy("ipfs://metadata/");
  await equipment.waitForDeployment();

  const TavernGuild = await ethers.getContractFactory("TavernGuild");
  const guild: any = await TavernGuild.deploy(await equipment.getAddress());
  await guild.waitForDeployment();

  const TavernServiceRegistry = await ethers.getContractFactory("TavernServiceRegistry");
  const serviceRegistry: any = await TavernServiceRegistry.deploy(
    await guild.getAddress(),
    await core.escrow.getAddress(),
    await core.registry.getAddress(),
    await core.usdc.getAddress()
  );
  await serviceRegistry.waitForDeployment();

  const TavernMatchmaker = await ethers.getContractFactory("TavernMatchmaker");
  const matchmaker: any = await TavernMatchmaker.deploy(
    await serviceRegistry.getAddress(),
    await core.clientRPG.getAddress()
  );
  await matchmaker.waitForDeployment();

  await equipment.grantRole(await equipment.GUILD_ROLE(), await guild.getAddress());
  await guild.grantRole(await guild.SERVICE_REGISTRY_ROLE(), await serviceRegistry.getAddress());
  await guild.grantRole(await guild.ESCROW_ROLE(), await core.escrow.getAddress());
  await guild.grantRole(await guild.ESCROW_ROLE(), core.deployer.address);
  await serviceRegistry.grantRole(await serviceRegistry.ESCROW_ROLE(), await core.escrow.getAddress());
  await serviceRegistry.grantRole(await serviceRegistry.ESCROW_ROLE(), core.deployer.address);
  await core.escrow.grantRole(await core.escrow.SERVICE_REGISTRY_ROLE(), await serviceRegistry.getAddress());
  await core.escrow.setServiceRegistry(await serviceRegistry.getAddress());
  await core.clientRPG.setGuildContract(await guild.getAddress());
  await core.clientRPG.grantRole(await core.clientRPG.ESCROW_ROLE(), core.deployer.address);

  const ensureAgent = async (signer: any, guildId = 1, modelType = "service-agent") => {
    const rpgProfile = await core.clientRPG.clientProfiles(signer.address);
    if (rpgProfile.registeredAt === 0n) {
      await core.clientRPG.registerClient(signer.address);
    }
    const registryProfile = await core.registry.getAgent(signer.address);
    if (!registryProfile.isActive) {
      await core.stakeAndJoinGuild(signer, guildId, modelType);
    }
  };

  const registerService = async (
    signer: any,
    guildId: number,
    title = "Custom AI Chatbot",
    description = "Build and deploy a custom agent workflow.",
    tierPrices: [bigint, bigint, bigint] = [100_000_000n, 150_000_000n, 250_000_000n],
    tags: string[] = ["ai", "automation"]
  ) => {
    await ensureAgent(signer, 1, `${title.toLowerCase().replace(/\s+/g, "-")}-model`);
    const tx = await serviceRegistry.connect(signer).registerService(guildId, title, description, tierPrices, tags);
    await tx.wait();
    return await serviceRegistry.serviceCount();
  };

  return {
    ...core,
    equipment,
    guild,
    serviceRegistry,
    matchmaker,
    ensureAgent,
    registerService
  };
}
