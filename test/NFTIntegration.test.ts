import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("NFT integration", function () {
  async function deployRpgIntegrationFixture() {
    const core = await deployCoreFixture();
    const { clientRPG } = core;

    const TavernEquipment = await ethers.getContractFactory("TavernEquipment");
    const equipment: any = await TavernEquipment.deploy("ipfs://metadata/");
    await equipment.waitForDeployment();

    await equipment.grantRole(await equipment.MINTER_ROLE(), await clientRPG.getAddress());
    await clientRPG.setEquipmentContract(await equipment.getAddress());

    await equipment.registerItem(1, 0, 0, 1, 0, false, "Tattered Hood");
    await equipment.registerItem(3, 0, 1, 1, 5000, false, "Scout's Bandana");
    await equipment.setLevelRewards(1, [1]);
    await equipment.setLevelRewards(2, [3]);

    const thresholds = [0, 0, 20, ...Array.from({ length: 98 }, (_, index) => 100 + index)];
    await clientRPG.setThresholds(thresholds as any);

    return {
      ...core,
      equipment
    };
  }

  async function deployGuildIntegrationFixture() {
    const [serviceRegistry, escrowRole, client, agent] = await ethers.getSigners();

    const TavernEquipment = await ethers.getContractFactory("TavernEquipment");
    const equipment: any = await TavernEquipment.deploy("ipfs://metadata/");
    await equipment.waitForDeployment();

    const TavernGuild = await ethers.getContractFactory("TavernGuild");
    const guild: any = await TavernGuild.deploy(await equipment.getAddress());
    await guild.waitForDeployment();

    await equipment.grantRole(await equipment.GUILD_ROLE(), await guild.getAddress());
    await guild.grantRole(await guild.SERVICE_REGISTRY_ROLE(), serviceRegistry.address);
    await guild.grantRole(await guild.ESCROW_ROLE(), escrowRole.address);

    await equipment.registerItem(84, 2, 0, 0, 0, true, "Stone Fireplace");

    return {
      equipment,
      guild,
      serviceRegistry,
      escrowRole,
      founder: client,
      secondMember: agent
    };
  }

  it("mints and equips level rewards through the live escrow -> RPG -> equipment flow", async function () {
    const { equipment, clientRPG, escrow, client, agent, createAcceptedUsdcQuest, submitQuestResult } =
      await loadFixture(deployRpgIntegrationFixture);

    const questId = await createAcceptedUsdcQuest(client, agent);
    await submitQuestResult(questId, agent);
    await escrow.connect(client).submitEvaluation(
      questId,
      [5, 5, 5, 5, 5],
      "Outstanding work with clear deliverables and excellent follow-through.",
      ["quality"]
    );

    expect((await clientRPG.clientProfiles(client.address)).level).to.equal(2n);
    expect(await equipment.balanceOf(client.address, 1)).to.equal(1n);
    expect(await equipment.balanceOf(client.address, 3)).to.equal(1n);

    await equipment.connect(client).equip(3);
    expect((await equipment.getLoadout(client.address)).head).to.equal(3n);
  });

  it("mints guild decoration rewards after service-category milestones", async function () {
    const { guild, equipment, serviceRegistry, escrowRole, founder, secondMember } = await loadFixture(
      deployGuildIntegrationFixture
    );

    await guild.connect(serviceRegistry).addMember(4, founder.address);
    await guild.connect(serviceRegistry).addMember(4, secondMember.address);

    for (let i = 0; i < 6; i += 1) {
      await guild.connect(escrowRole).recordGuildCompletion(founder.address, 4, 50_000_000n);
    }
    for (let i = 0; i < 4; i += 1) {
      await guild.connect(escrowRole).recordGuildCompletion(secondMember.address, 4, 50_000_000n);
    }

    expect((await guild.guilds(4)).guildLevel).to.equal(2n);
    expect(await equipment.balanceOf(founder.address, 84)).to.equal(1n);
  });
});
