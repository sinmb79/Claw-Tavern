import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

describe("TavernEquipment", function () {
  async function deployFixture() {
    const [deployer, minter, guild, alice, bob] = await ethers.getSigners();

    const TavernEquipment = await ethers.getContractFactory("TavernEquipment");
    const equipment: any = await TavernEquipment.deploy("ipfs://metadata/");
    await equipment.waitForDeployment();

    await equipment.grantRole(await equipment.MINTER_ROLE(), minter.address);
    await equipment.grantRole(await equipment.GUILD_ROLE(), guild.address);

    return {
      deployer,
      minter,
      guild,
      alice,
      bob,
      equipment
    };
  }

  it("registers items and exposes metadata", async function () {
    const { equipment } = await loadFixture(deployFixture);

    await equipment.registerItem(1, 0, 0, 1, 0, false, "Tattered Hood");

    const item = await equipment.getItem(1);
    expect(item.name).to.equal("Tattered Hood");
    expect(item.category).to.equal(0n);
    expect(item.rarity).to.equal(0n);
    expect(item.slot).to.equal(1n);
    expect(item.active).to.equal(true);
  });

  it("mints items and enforces max supply", async function () {
    const { equipment, guild, alice, bob } = await loadFixture(deployFixture);

    await equipment.registerItem(81, 2, 0, 0, 1, true, "Wooden Signboard");
    await equipment.connect(guild).mintGuildReward(alice.address, 81);

    expect(await equipment.balanceOf(alice.address, 81)).to.equal(1n);
    await expect(equipment.connect(guild).mintGuildReward(bob.address, 81)).to.be.revertedWith("Max supply reached");
  });

  it("mints the configured level rewards through the minter role", async function () {
    const { equipment, minter, alice } = await loadFixture(deployFixture);

    await equipment.registerItem(61, 1, 0, 0, 0, true, "Wanderer");
    await equipment.registerItem(63, 1, 1, 0, 5000, true, "Pathfinder");
    await equipment.setLevelRewards(1, [61]);
    await equipment.setLevelRewards(2, [63]);

    await equipment.connect(minter).mintLevelReward(alice.address, 1);
    await equipment.connect(minter).mintLevelReward(alice.address, 2);

    expect(await equipment.balanceOf(alice.address, 61)).to.equal(1n);
    expect(await equipment.balanceOf(alice.address, 63)).to.equal(1n);
  });

  it("equips and unequips items by slot", async function () {
    const { equipment, deployer, alice } = await loadFixture(deployFixture);

    await equipment.registerItem(1, 0, 0, 1, 0, false, "Tattered Hood");
    await equipment.adminMint(alice.address, 1);

    await equipment.connect(alice).equip(1);
    let loadout = await equipment.getLoadout(alice.address);
    expect(loadout.head).to.equal(1n);

    await equipment.connect(alice).unequip(1);
    loadout = await equipment.getLoadout(alice.address);
    expect(loadout.head).to.equal(0n);
  });

  it("equips a title separately from equipment", async function () {
    const { equipment, alice } = await loadFixture(deployFixture);

    await equipment.registerItem(61, 1, 0, 0, 0, true, "Wanderer");
    await equipment.adminMint(alice.address, 61);

    await equipment.connect(alice).equipTitle(61);

    const [tokenId, name] = await equipment.getActiveTitle(alice.address);
    expect(tokenId).to.equal(61n);
    expect(name).to.equal("Wanderer");
  });

  it("blocks transfers of soulbound items", async function () {
    const { equipment, alice, bob } = await loadFixture(deployFixture);

    await equipment.registerItem(61, 1, 0, 0, 0, true, "Wanderer");
    await equipment.adminMint(alice.address, 61);

    await expect(equipment.connect(alice).safeTransferFrom(alice.address, bob.address, 61, 1, "0x")).to.be.revertedWith(
      "Soulbound: non-transferable"
    );
  });

  it("allows transfers of non-soulbound equipment", async function () {
    const { equipment, alice, bob } = await loadFixture(deployFixture);

    await equipment.registerItem(1, 0, 0, 1, 0, false, "Tattered Hood");
    await equipment.adminMint(alice.address, 1);

    await equipment.connect(alice).safeTransferFrom(alice.address, bob.address, 1, 1, "0x");

    expect(await equipment.balanceOf(bob.address, 1)).to.equal(1n);
  });

  it("prevents duplicate ownership for the same wallet", async function () {
    const { equipment, alice } = await loadFixture(deployFixture);

    await equipment.registerItem(63, 1, 1, 0, 5000, true, "Pathfinder");
    await equipment.adminMint(alice.address, 63);

    await expect(equipment.adminMint(alice.address, 63)).to.be.revertedWith("Already owns item");
  });
});
