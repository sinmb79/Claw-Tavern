import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("TavernEscrow client withdrawals", function () {
  async function deployFixture() {
    return loadFixture(deployCoreFixture);
  }

  async function makeEligible(fixture: Awaited<ReturnType<typeof deployCoreFixture>>) {
    const { escrow, clientRPG, keeper, client, agent, tvrnUsdFeed, createAcceptedUsdcQuest, submitQuestResult } =
      fixture;

    await escrow.connect(keeper).rewardClientSignup(client.address);
    await clientRPG.setVerified(client.address, true);

    const questIds: bigint[] = [];
    for (let index = 0; index < 5; index += 1) {
      const questId = await createAcceptedUsdcQuest(client, agent);
      await submitQuestResult(questId, agent);
      questIds.push(questId);
    }

    await time.increase(30 * 24 * 60 * 60 + 72 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());

    for (const questId of questIds) {
      await escrow.connect(keeper).executeAutoApprove(questId);
    }
  }

  it("accumulates client rewards into the RPG claimable balance", async function () {
    const { escrow, keeper, client, clientRPG, token } = await deployFixture();

    await escrow.connect(keeper).rewardClientSignup(client.address);

    expect(await clientRPG.clientClaimable(client.address)).to.equal(ethers.parseEther("30"));
    expect(await token.balanceOf(await clientRPG.getAddress())).to.equal(ethers.parseEther("30"));
  });

  it("withdraws TVRN when the client is eligible", async function () {
    const fixture = await deployFixture();
    const { escrow, clientRPG, client, token } = fixture;

    await makeEligible(fixture);

    const beforeBalance = await token.balanceOf(client.address);
    await escrow.connect(client).clientWithdrawTVRN(ethers.parseEther("40"));

    expect((await token.balanceOf(client.address)) - beforeBalance).to.equal(ethers.parseEther("40"));
    expect(await clientRPG.clientClaimable(client.address)).to.equal(ethers.parseEther("10"));
    expect((await clientRPG.clientProfiles(client.address)).withdrawnThisMonth).to.equal(ethers.parseEther("40"));
  });

  it("reverts when the RPG contract is not configured", async function () {
    const { escrow, client } = await deployFixture();

    await escrow.setClientRPG(ethers.ZeroAddress);
    await expect(escrow.connect(client).clientWithdrawTVRN(1n)).to.be.revertedWithCustomError(escrow, "RPGNotSet");
  });

  it("reverts when the client is not eligible to withdraw", async function () {
    const { escrow, keeper, client, clientRPG } = await deployFixture();

    await escrow.connect(keeper).rewardClientSignup(client.address);
    await clientRPG.setVerified(client.address, true);
    await time.increase(30 * 24 * 60 * 60 + 1);

    const [eligible, reason] = await clientRPG.checkWithdrawalEligible(client.address, 1n);
    expect(eligible).to.equal(false);
    expect(reason).to.equal("LEVEL_TOO_LOW");
    await expect(escrow.connect(client).clientWithdrawTVRN(1n)).to.be.revertedWithCustomError(escrow, "MintFailed");
  });

  it("reverts when the requested amount exceeds the accumulated balance", async function () {
    const fixture = await deployFixture();
    const { escrow, client, clientRPG } = fixture;

    await makeEligible(fixture);

    const [eligible] = await clientRPG.checkWithdrawalEligible(client.address, ethers.parseEther("51"));
    expect(eligible).to.equal(true);
    await expect(escrow.connect(client).clientWithdrawTVRN(ethers.parseEther("51"))).to.be.revertedWithCustomError(
      escrow,
      "MintFailed"
    );
  });

  it("grants job completion EXP through the RPG on auto-approve", async function () {
    const { escrow, clientRPG, keeper, client, agent, tvrnUsdFeed, createAcceptedUsdcQuest, submitQuestResult } =
      await deployFixture();

    const questId = await createAcceptedUsdcQuest(client, agent);
    await submitQuestResult(questId, agent);
    await time.increase(72 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());
    await escrow.connect(keeper).executeAutoApprove(questId);

    const profile = await clientRPG.clientProfiles(client.address);
    expect(profile.totalJobsCompleted).to.equal(1n);
    expect(profile.exp).to.equal(20n);
  });

  it("grants evaluation EXP through the RPG on submitEvaluation", async function () {
    const { escrow, clientRPG, client, agent, tvrnUsdFeed, createAcceptedUsdcQuest, submitQuestResult } =
      await deployFixture();

    const questId = await createAcceptedUsdcQuest(client, agent);
    await submitQuestResult(questId, agent);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());
    await escrow.connect(client).submitEvaluation(questId, [5, 5, 5, 5, 5], "ok", []);

    const profile = await clientRPG.clientProfiles(client.address);
    expect(profile.totalJobsCompleted).to.equal(1n);
    expect(profile.exp).to.equal(23n);
  });

  it("registers the client profile when the signup reward is issued", async function () {
    const { escrow, keeper, client, clientRPG } = await deployFixture();

    await expect(escrow.connect(keeper).rewardClientSignup(client.address)).to.emit(clientRPG, "ClientRegistered");
  });
});
