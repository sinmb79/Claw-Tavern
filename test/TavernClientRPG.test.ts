import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

function buildThresholds(): bigint[] {
  const thresholds: bigint[] = [0n];
  for (let level = 1; level <= 100; level += 1) {
    thresholds.push(BigInt(Math.floor(20 * Math.pow(level, 2.2))));
  }
  return thresholds;
}

describe("TavernClientRPG", function () {
  async function deployFixture() {
    const [deployer, client, escrowSigner, keeper, subscriptionSigner, other] = await ethers.getSigners();

    const TavernToken = await getWorkspaceContractFactory("TavernToken");
    const token: any = await TavernToken.deploy();
    await token.waitForDeployment();

    const TavernClientRPG = await getWorkspaceContractFactory("TavernClientRPG");
    const rpg: any = await TavernClientRPG.deploy(await token.getAddress(), escrowSigner.address);
    await rpg.waitForDeployment();

    const TavernEquipment = await ethers.getContractFactory("TavernEquipment");
    const equipment: any = await TavernEquipment.deploy("ipfs://metadata/");
    await equipment.waitForDeployment();

    await token.grantRole(await token.MINTER_ROLE(), await rpg.getAddress());
    await rpg.grantRole(await rpg.ESCROW_ROLE(), escrowSigner.address);
    await rpg.grantRole(await rpg.KEEPER_ROLE(), keeper.address);
    await rpg.grantRole(await rpg.SUBSCRIPTION_ROLE(), subscriptionSigner.address);
    await equipment.grantRole(await equipment.MINTER_ROLE(), await rpg.getAddress());
    await rpg.setEquipmentContract(await equipment.getAddress());

    await equipment.registerItem(61, 1, 0, 0, 0, true, "Wanderer");
    await equipment.registerItem(63, 1, 1, 0, 5000, true, "Pathfinder");
    await equipment.registerItem(65, 1, 2, 0, 1000, true, "Trailblazer");
    await equipment.registerItem(67, 1, 3, 0, 250, true, "Warden");
    await equipment.setLevelRewards(1, [61]);
    await equipment.setLevelRewards(2, [63]);
    await equipment.setLevelRewards(3, [65]);
    await equipment.setLevelRewards(4, [67]);

    const registerClient = async () => rpg.connect(escrowSigner).registerClient(client.address);

    const grantJobs = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        await rpg.connect(escrowSigner).grantJobCompleteEXP(client.address);
      }
    };

    const grantReferrals = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        await rpg.connect(escrowSigner).grantReferralEXP(client.address);
      }
    };

    return {
      deployer,
      client,
      escrowSigner,
      keeper,
      subscriptionSigner,
      other,
      token,
      rpg,
      equipment,
      registerClient,
      grantJobs,
      grantReferrals
    };
  }

  it("registers a client with default profile values and starter title reward", async function () {
    const { rpg, equipment, registerClient, client } = await loadFixture(deployFixture);

    await expect(registerClient()).to.emit(rpg, "ClientRegistered");

    const profile = await rpg.clientProfiles(client.address);
    expect(profile.registeredAt).to.be.gt(0n);
    expect(profile.level).to.equal(1n);
    expect(profile.exp).to.equal(0n);
    expect(await equipment.balanceOf(client.address, 61)).to.equal(1n);
  });

  it("matches the 20 * level^2.2 threshold table for all 100 levels", async function () {
    const { rpg } = await loadFixture(deployFixture);
    const expected = buildThresholds();

    for (let level = 1; level <= 100; level += 1) {
      expect(await rpg.levelThreshold(level)).to.equal(expected[level]);
    }
  });

  it("levels up from Lv1 to Lv2 after 100 EXP", async function () {
    const { rpg, registerClient, grantJobs, client, escrowSigner } = await loadFixture(deployFixture);

    await registerClient();
    await grantJobs(4);
    await expect(rpg.connect(escrowSigner).grantJobCompleteEXP(client.address))
      .to.emit(rpg, "LevelUp")
      .withArgs(client.address, 1n, 2n, 100n);

    const profile = await rpg.clientProfiles(client.address);
    expect(profile.level).to.equal(2n);
    expect(profile.exp).to.equal(100n);
  });

  it("mints level rewards on level-up", async function () {
    const { rpg, registerClient, grantJobs, equipment, client } = await loadFixture(deployFixture);

    await registerClient();
    await grantJobs(5);

    expect(await equipment.balanceOf(client.address, 63)).to.equal(1n);
    expect((await rpg.clientProfiles(client.address)).level).to.equal(2n);
  });

  it("mints every intermediate reward when a client jumps multiple levels", async function () {
    const { rpg, registerClient, equipment, escrowSigner, client } = await loadFixture(deployFixture);

    await rpg.setThresholds([0, 0, 10, 20, 30, ...Array.from({ length: 96 }, (_, index) => 40 + index)] as any);
    await registerClient();
    await rpg.connect(escrowSigner).grantReferralEXP(client.address);

    expect(await equipment.balanceOf(client.address, 63)).to.equal(1n);
    expect(await equipment.balanceOf(client.address, 65)).to.equal(1n);
    expect(await equipment.balanceOf(client.address, 67)).to.equal(1n);
    expect((await rpg.clientProfiles(client.address)).level).to.equal(15n);
  });

  it("caps level progression at 100", async function () {
    const { rpg, registerClient, escrowSigner, client } = await loadFixture(deployFixture);

    const capped = [0, ...Array.from({ length: 100 }, () => 1)];
    await rpg.setThresholds(capped as any);
    await registerClient();
    await rpg.connect(escrowSigner).grantReferralEXP(client.address);

    expect((await rpg.clientProfiles(client.address)).level).to.equal(100n);
  });

  it("returns eligible when all withdrawal conditions are met", async function () {
    const { rpg, registerClient, grantJobs, client } = await loadFixture(deployFixture);

    await registerClient();
    await rpg.setVerified(client.address, true);
    await grantJobs(5);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, ethers.parseEther("100"));
    expect(eligible).to.equal(true);
    expect(reason).to.equal("");
  });

  it("blocks withdrawal when level is too low", async function () {
    const { rpg, registerClient, client } = await loadFixture(deployFixture);

    await registerClient();
    await rpg.setVerified(client.address, true);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("LEVEL_TOO_LOW");
  });

  it("blocks withdrawal when completed jobs are insufficient", async function () {
    const { rpg, registerClient, grantReferrals, client } = await loadFixture(deployFixture);

    await registerClient();
    await rpg.setVerified(client.address, true);
    await grantReferrals(2);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("INSUFFICIENT_JOBS");
  });

  it("blocks withdrawal when the account is too new", async function () {
    const { rpg, registerClient, grantJobs, client } = await loadFixture(deployFixture);

    await registerClient();
    await rpg.setVerified(client.address, true);
    await grantJobs(5);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("ACCOUNT_TOO_NEW");
  });

  it("blocks withdrawal when the client is not verified", async function () {
    const { rpg, registerClient, grantJobs, client } = await loadFixture(deployFixture);

    await registerClient();
    await grantJobs(5);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("NOT_VERIFIED");
  });

  it("blocks withdrawal when the monthly cap would be exceeded", async function () {
    const { rpg, registerClient, grantJobs, client, escrowSigner } = await loadFixture(deployFixture);

    await registerClient();
    await rpg.setVerified(client.address, true);
    await grantJobs(5);
    await time.increase(30 * 24 * 60 * 60 + 1);
    await rpg.connect(escrowSigner).recordWithdrawal(client.address, ethers.parseEther("90"));

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, ethers.parseEther("11"));
    expect(eligible).to.equal(false);
    expect(reason).to.equal("MONTHLY_CAP_EXCEEDED");
  });

  it("blocks withdrawal when the client is banned", async function () {
    const { rpg, registerClient, grantJobs, client } = await loadFixture(deployFixture);

    await registerClient();
    await rpg.setVerified(client.address, true);
    await grantJobs(5);
    await time.increase(30 * 24 * 60 * 60 + 1);
    await rpg.banClient(client.address);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("BANNED");
  });

  it("records withdrawals and resets the monthly bucket when needed", async function () {
    const { rpg, registerClient, client, escrowSigner } = await loadFixture(deployFixture);

    await registerClient();
    await rpg.connect(escrowSigner).recordWithdrawal(client.address, ethers.parseEther("40"));

    let profile = await rpg.clientProfiles(client.address);
    const firstMonth = profile.lastWithdrawalMonth;
    expect(profile.withdrawnThisMonth).to.equal(ethers.parseEther("40"));
    expect(profile.lastWithdrawalAt).to.be.gt(0n);

    await time.increase(30 * 24 * 60 * 60 + 1);
    await rpg.connect(escrowSigner).recordWithdrawal(client.address, ethers.parseEther("10"));

    profile = await rpg.clientProfiles(client.address);
    expect(profile.withdrawnThisMonth).to.equal(ethers.parseEther("10"));
    expect(profile.lastWithdrawalMonth).to.be.gt(firstMonth);
  });

  it("grants subscription EXP through the dedicated role", async function () {
    const { rpg, registerClient, subscriptionSigner, client } = await loadFixture(deployFixture);

    await registerClient();
    await rpg.connect(subscriptionSigner).grantSubscriptionEXP(client.address);

    const profile = await rpg.clientProfiles(client.address);
    expect(profile.exp).to.equal(100n);
    expect(profile.level).to.equal(2n);
  });
});
