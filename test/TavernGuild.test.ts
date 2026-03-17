import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("TavernGuild", function () {
  async function deployFixture() {
    const [deployer, serviceRegistry, escrow, keeper, alice, bob, charlie] = await ethers.getSigners();

    const TavernEquipment = await ethers.getContractFactory("TavernEquipment");
    const equipment: any = await TavernEquipment.deploy("ipfs://metadata/");
    await equipment.waitForDeployment();

    const TavernGuild = await ethers.getContractFactory("TavernGuild");
    const guild: any = await TavernGuild.deploy(await equipment.getAddress());
    await guild.waitForDeployment();

    await equipment.grantRole(await equipment.GUILD_ROLE(), await guild.getAddress());
    await guild.grantRole(await guild.SERVICE_REGISTRY_ROLE(), serviceRegistry.address);
    await guild.grantRole(await guild.ESCROW_ROLE(), escrow.address);
    await guild.grantRole(await guild.KEEPER_ROLE(), keeper.address);

    await equipment.registerItem(84, 2, 1, 0, 0, true, "Enchanted Tapestry");
    await equipment.registerItem(86, 2, 2, 0, 0, true, "Grand Forge Banner");

    return {
      deployer,
      serviceRegistry,
      escrow,
      keeper,
      alice,
      bob,
      charlie,
      equipment,
      guild
    };
  }

  it("initializes the 8 predefined guilds", async function () {
    const { guild } = await loadFixture(deployFixture);

    expect((await guild.guilds(0)).name).to.equal("Artificers Guild");
    expect((await guild.guilds(7)).name).to.equal("Sentinel Guild");
    expect(await guild.GUILD_COUNT()).to.equal(8);
  });

  it("adds members through the service registry role", async function () {
    const { guild, serviceRegistry, alice } = await loadFixture(deployFixture);

    await guild.connect(serviceRegistry).addMember(0, alice.address);

    expect(await guild.isInGuild(alice.address, 0)).to.equal(true);
    expect(await guild.getMemberGuilds(alice.address)).to.deep.equal([0n]);
    expect((await guild.guilds(0)).memberCount).to.equal(1n);
  });

  it("supports multiple guild memberships and leaving one guild", async function () {
    const { guild, serviceRegistry, alice } = await loadFixture(deployFixture);

    await guild.connect(serviceRegistry).addMember(0, alice.address);
    await guild.connect(serviceRegistry).addMember(7, alice.address);

    expect(await guild.getMemberGuilds(alice.address)).to.deep.equal([0n, 7n]);

    await guild.connect(alice).leaveGuild(0);

    expect(await guild.isInGuild(alice.address, 0)).to.equal(false);
    expect(await guild.isInGuild(alice.address, 7)).to.equal(true);
    expect(await guild.memberGuild(alice.address)).to.equal(7n);
  });

  it("records completions, volume, and guild level ups", async function () {
    const { guild, serviceRegistry, escrow, alice } = await loadFixture(deployFixture);

    await guild.connect(serviceRegistry).addMember(2, alice.address);
    await guild.connect(escrow).recordGuildCompletion(alice.address, 2, 150_000_000n);

    const guildInfo = await guild.guilds(2);
    const member = await guild.guildMemberInfo(2, alice.address);

    expect(guildInfo.totalCompletions).to.equal(1n);
    expect(guildInfo.totalVolume).to.equal(150_000_000n);
    expect(guildInfo.guildExp).to.equal(20n);
    expect(guildInfo.guildLevel).to.equal(1n);
    expect(member.completions).to.equal(1n);
    expect(member.volume).to.equal(150_000_000n);
  });

  it("tracks per-guild ratings with 0.1 star precision", async function () {
    const { guild, serviceRegistry, escrow, alice } = await loadFixture(deployFixture);

    await guild.connect(serviceRegistry).addMember(4, alice.address);
    await guild.connect(escrow).recordRating(alice.address, 4, 47);
    await guild.connect(escrow).recordRating(alice.address, 4, 43);

    const member = await guild.guildMemberInfo(4, alice.address);
    expect(member.rating).to.equal(90n);
    expect(member.ratingCount).to.equal(2n);
    expect(await guild.getAverageRating(4, alice.address)).to.equal(45n);
  });

  it("mints milestone guild NFTs to the top contributor", async function () {
    const { guild, equipment, serviceRegistry, escrow, alice, bob } = await loadFixture(deployFixture);

    await guild.connect(serviceRegistry).addMember(0, alice.address);
    await guild.connect(serviceRegistry).addMember(0, bob.address);

    for (let i = 0; i < 7; i += 1) {
      await guild.connect(escrow).recordGuildCompletion(alice.address, 0, 25_000_000n);
    }
    for (let i = 0; i < 3; i += 1) {
      await guild.connect(escrow).recordGuildCompletion(bob.address, 0, 25_000_000n);
    }

    expect((await guild.guilds(0)).totalCompletions).to.equal(10n);
    expect(await equipment.balanceOf(alice.address, 84)).to.equal(1n);
    expect(await equipment.balanceOf(bob.address, 84)).to.equal(0n);
  });

  it("exposes maintenance readiness and updates the timestamp when performed", async function () {
    const { guild, keeper } = await loadFixture(deployFixture);

    expect(await guild.needsMaintenance()).to.equal(false);

    await time.increase(30 * 24 * 60 * 60 + 1);
    expect(await guild.needsMaintenance()).to.equal(true);

    const before = await guild.lastMaintenanceAt();
    await guild.connect(keeper).performMaintenance();
    const after = await guild.lastMaintenanceAt();

    expect(after).to.be.gt(before);
  });
});
