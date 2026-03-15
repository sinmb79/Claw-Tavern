import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

describe("TavernClientRPG", function () {
  async function deployFixture() {
    const [deployer, client, escrowSigner, keeper, other] = await ethers.getSigners();

    const TavernToken = await getWorkspaceContractFactory("TavernToken");
    const token: any = await TavernToken.deploy();
    await token.waitForDeployment();

    const TavernClientRPG = await getWorkspaceContractFactory("TavernClientRPG");
    const rpg: any = await TavernClientRPG.deploy(await token.getAddress(), escrowSigner.address);
    await rpg.waitForDeployment();

    await token.grantRole(await token.MINTER_ROLE(), await rpg.getAddress());
    await rpg.grantRole(await rpg.ESCROW_ROLE(), escrowSigner.address);
    await rpg.grantRole(await rpg.KEEPER_ROLE(), keeper.address);

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
      other,
      token,
      rpg,
      grantJobs,
      grantReferrals
    };
  }

  it("registers a client with default profile values", async function () {
    const { rpg, escrowSigner, client } = await loadFixture(deployFixture);

    await expect(rpg.connect(escrowSigner).registerClient(client.address)).to.emit(rpg, "ClientRegistered");

    const profile = await rpg.clientProfiles(client.address);
    expect(profile.registeredAt).to.be.gt(0n);
    expect(profile.level).to.equal(1n);
    expect(profile.exp).to.equal(0n);
  });

  it("levels up from Lv1 to Lv2 at 100 EXP", async function () {
    const { rpg, escrowSigner, client, grantJobs } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await grantJobs(4);
    await expect(rpg.connect(escrowSigner).grantJobCompleteEXP(client.address))
      .to.emit(rpg, "LevelUp")
      .withArgs(client.address, 1n, 2n, 100n);

    const profile = await rpg.clientProfiles(client.address);
    expect(profile.level).to.equal(2n);
    expect(profile.exp).to.equal(100n);
  });

  it("tracks multiple level thresholds correctly", async function () {
    const { rpg, escrowSigner, client, grantReferrals } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await grantReferrals(2);
    expect((await rpg.clientProfiles(client.address)).level).to.equal(2n);

    await grantReferrals(8);
    expect((await rpg.clientProfiles(client.address)).level).to.equal(3n);

    await grantReferrals(30);
    const profile = await rpg.clientProfiles(client.address);
    expect(profile.exp).to.equal(2000n);
    expect(profile.level).to.equal(4n);
  });

  it("returns eligible when all withdrawal conditions are met", async function () {
    const { rpg, escrowSigner, client, grantJobs } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await rpg.setVerified(client.address, true);
    await grantJobs(5);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, ethers.parseEther("100"));
    expect(eligible).to.equal(true);
    expect(reason).to.equal("");
  });

  it("blocks withdrawal when level is too low", async function () {
    const { rpg, escrowSigner, client } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await rpg.setVerified(client.address, true);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("LEVEL_TOO_LOW");
  });

  it("blocks withdrawal when completed jobs are insufficient", async function () {
    const { rpg, escrowSigner, client, grantReferrals } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await rpg.setVerified(client.address, true);
    await grantReferrals(2);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("INSUFFICIENT_JOBS");
  });

  it("blocks withdrawal when the account is too new", async function () {
    const { rpg, escrowSigner, client, grantJobs } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await rpg.setVerified(client.address, true);
    await grantJobs(5);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("ACCOUNT_TOO_NEW");
  });

  it("blocks withdrawal when the client is not verified", async function () {
    const { rpg, escrowSigner, client, grantJobs } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await grantJobs(5);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("NOT_VERIFIED");
  });

  it("blocks withdrawal when the monthly cap would be exceeded", async function () {
    const { rpg, escrowSigner, client, grantJobs } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await rpg.setVerified(client.address, true);
    await grantJobs(5);
    await time.increase(30 * 24 * 60 * 60 + 1);
    await rpg.connect(escrowSigner).recordWithdrawal(client.address, ethers.parseEther("90"));

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, ethers.parseEther("11"));
    expect(eligible).to.equal(false);
    expect(reason).to.equal("MONTHLY_CAP_EXCEEDED");
  });

  it("blocks withdrawal when the client is banned", async function () {
    const { rpg, escrowSigner, client, grantJobs } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await rpg.setVerified(client.address, true);
    await grantJobs(5);
    await time.increase(30 * 24 * 60 * 60 + 1);
    await rpg.banClient(client.address);

    const [eligible, reason] = await rpg.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("BANNED");
  });

  it("records withdrawals and resets the monthly bucket when needed", async function () {
    const { rpg, escrowSigner, client } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
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

  it("migrates a finished season into legacy bonus EXP", async function () {
    const { rpg, escrowSigner, keeper, client, grantReferrals } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await grantReferrals(40);
    expect((await rpg.clientProfiles(client.address)).level).to.equal(4n);

    await time.increase(180 * 24 * 60 * 60 + 1);
    await rpg.connect(keeper).startNewSeason();
    await rpg.connect(escrowSigner).grantEvalEXP(client.address);

    const profile = await rpg.clientProfiles(client.address);
    const snapshot = await rpg.seasonSnapshots(1n, client.address);
    expect(snapshot.finalLevel).to.equal(4n);
    expect(snapshot.finalExp).to.equal(2000n);
    expect(profile.exp).to.equal(303n);
    expect(profile.level).to.equal(2n);
  });

  it("preserves lifetime completed jobs across season resets", async function () {
    const { rpg, escrowSigner, keeper, client, grantJobs } = await loadFixture(deployFixture);

    await rpg.connect(escrowSigner).registerClient(client.address);
    await grantJobs(5);
    await time.increase(180 * 24 * 60 * 60 + 1);
    await rpg.connect(keeper).startNewSeason();
    await rpg.connect(escrowSigner).grantEvalEXP(client.address);

    const profile = await rpg.clientProfiles(client.address);
    expect(profile.totalJobsCompleted).to.equal(5n);
    expect(await rpg.clientLastActiveSeason(client.address)).to.equal(2n);
  });
});
