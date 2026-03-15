import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("TavernEscrow client rewards", function () {
  it("mints the signup reward only once", async function () {
    const { escrow, keeper, token, client, clientRPG } = await loadFixture(deployCoreFixture);

    const beforeClaimable = await clientRPG.clientClaimable(client.address);
    const beforeVaultBalance = await token.balanceOf(await clientRPG.getAddress());
    await escrow.connect(keeper).rewardClientSignup(client.address);

    expect((await clientRPG.clientClaimable(client.address)) - beforeClaimable).to.equal(ethers.parseEther("30"));
    expect((await token.balanceOf(await clientRPG.getAddress())) - beforeVaultBalance).to.equal(
      ethers.parseEther("30")
    );
    await expect(escrow.connect(keeper).rewardClientSignup(client.address)).to.be.revertedWithCustomError(
      escrow,
      "AlreadyRewarded"
    );
  });

  it("awards first-quest and evaluation rewards on a successful evaluation", async function () {
    const { escrow, clientRPG, client, agent, createAcceptedUsdcQuest, submitQuestResult } = await loadFixture(
      deployCoreFixture
    );

    const questId = await createAcceptedUsdcQuest(client, agent);
    await submitQuestResult(questId, agent);

    const before = await clientRPG.clientClaimable(client.address);
    await escrow.connect(client).submitEvaluation(questId, [5, 5, 5, 5, 5], "ok", []);
    const delta = (await clientRPG.clientClaimable(client.address)) - before;

    expect(delta).to.equal(ethers.parseEther("24"));
    expect(await escrow.clientFirstQuestRewarded(client.address)).to.equal(true);
  });

  it("grants the first-quest reward on auto-approve without duplication", async function () {
    const { escrow, keeper, clientRPG, client, agent, tvrnUsdFeed, createAcceptedUsdcQuest, submitQuestResult } =
      await loadFixture(deployCoreFixture);

    const questId = await createAcceptedUsdcQuest(client, agent);
    await submitQuestResult(questId, agent);
    await time.increase(72 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());

    const before = await clientRPG.clientClaimable(client.address);
    await escrow.connect(keeper).executeAutoApprove(questId);
    const delta = (await clientRPG.clientClaimable(client.address)) - before;

    expect(delta).to.equal(ethers.parseEther("20"));
    expect(await escrow.clientFirstQuestRewarded(client.address)).to.equal(true);
  });

  it("caps referral rewards at three per month", async function () {
    const { escrow, keeper, clientRPG, referrer } = await loadFixture(deployCoreFixture);

    const before = await clientRPG.clientClaimable(referrer.address);
    await escrow.connect(keeper).rewardClientReferral(referrer.address);
    await escrow.connect(keeper).rewardClientReferral(referrer.address);
    await escrow.connect(keeper).rewardClientReferral(referrer.address);

    expect((await clientRPG.clientClaimable(referrer.address)) - before).to.equal(ethers.parseEther("150"));
    await expect(escrow.connect(keeper).rewardClientReferral(referrer.address)).to.be.revertedWithCustomError(
      escrow,
      "MonthlyCapReached"
    );
  });
});
