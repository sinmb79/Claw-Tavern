import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("TavernEscrow fee withdrawal", function () {
  async function setUintStorage(contractAddress: string, slot: bigint, value: bigint) {
    await ethers.provider.send("hardhat_setStorageAt", [
      contractAddress,
      ethers.toBeHex(slot, 32),
      ethers.zeroPadValue(ethers.toBeHex(value), 32)
    ]);
    await ethers.provider.send("evm_mine", []);
  }

  async function findUintSlot(
    contractAddress: string,
    reader: () => Promise<bigint>,
    target: bigint,
    maxSlot = 64
  ): Promise<bigint> {
    for (let slot = 0; slot <= maxSlot; slot += 1) {
      const snapshot = await ethers.provider.send("evm_snapshot", []);
      await setUintStorage(contractAddress, BigInt(slot), target);
      const value = await reader();
      await ethers.provider.send("evm_revert", [snapshot]);

      if (value === target) {
        return BigInt(slot);
      }
    }

    throw new Error(`Unable to find storage slot for target value ${target.toString()}`);
  }

  it("withdraws operator, treasury, and buyback balances after settlement fees accrue", async function () {
    const { escrow, usdc, client, agent, recipient, deployer } = await loadFixture(deployCoreFixture);

    const feeStageSlot = await findUintSlot(
      await escrow.getAddress(),
      async () => BigInt(await escrow.currentFeeStage()),
      3n
    );
    await setUintStorage(await escrow.getAddress(), feeStageSlot, 3n);

    const depositAmount = 1_000n * 10n ** 6n;
    await escrow.connect(client).createQuest(
      await usdc.getAddress(),
      depositAmount,
      ethers.keccak256(ethers.toUtf8Bytes("fee-brief")),
      "ipfs://fee-brief"
    );
    const questId = await escrow.nextQuestId();
    await usdc.connect(client).approve(await escrow.getAddress(), depositAmount);
    await escrow.connect(client).fundQuestUSDC(questId);
    await escrow.connect(agent).acceptQuest(questId);
    await escrow
      .connect(agent)
      .submitResult(questId, ethers.keccak256(ethers.toUtf8Bytes("fee-result")), "ipfs://fee-result");
    await escrow.connect(client).submitEvaluation(questId, [5, 5, 5, 5, 5], "ok", []);

    const currency = await usdc.getAddress();
    expect(await escrow.operatorPoolBalance(currency)).to.equal(18n * 10n ** 6n);
    expect(await escrow.buybackReserveBalance(currency)).to.equal(6n * 10n ** 6n);
    expect(await escrow.treasuryReserveBalance(currency)).to.equal(6n * 10n ** 6n);

    const recipientBefore = await usdc.balanceOf(recipient.address);
    await expect(escrow.withdrawOperatorPool(currency, recipient.address, 18n * 10n ** 6n))
      .to.emit(escrow, "OperatorPoolWithdrawn")
      .withArgs(recipient.address, currency, 18n * 10n ** 6n);
    expect((await usdc.balanceOf(recipient.address)) - recipientBefore).to.equal(18n * 10n ** 6n);

    const treasuryBefore = await usdc.balanceOf(recipient.address);
    await expect(escrow.withdrawTreasuryReserve(currency, recipient.address, 6n * 10n ** 6n))
      .to.emit(escrow, "TreasuryWithdrawn")
      .withArgs(recipient.address, currency, 6n * 10n ** 6n);
    expect((await usdc.balanceOf(recipient.address)) - treasuryBefore).to.equal(6n * 10n ** 6n);

    const deployerBefore = await usdc.balanceOf(deployer.address);
    await expect(escrow.executeBuybackBurn(currency, 6n * 10n ** 6n))
      .to.emit(escrow, "BuybackExecuted")
      .withArgs(currency, 6n * 10n ** 6n);
    expect((await usdc.balanceOf(deployer.address)) - deployerBefore).to.equal(6n * 10n ** 6n);
  });
});
