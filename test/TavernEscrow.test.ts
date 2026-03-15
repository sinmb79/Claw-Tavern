import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";

describe("TavernEscrow", function () {
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

  async function deployFixture() {
    const [deployer, client, agent, keeper, recipient] = await ethers.getSigners();
    const now = await time.latest();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const usdc: any = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const MockV3Aggregator = await ethers.getContractFactory("MockV3Aggregator");
    const ethUsdFeed: any = await MockV3Aggregator.deploy(8, 2_000n * 10n ** 8n, now);
    await ethUsdFeed.waitForDeployment();
    const tvrnUsdFeed: any = await MockV3Aggregator.deploy(8, 1n * 10n ** 8n, now);
    await tvrnUsdFeed.waitForDeployment();

    const TavernToken = await getWorkspaceContractFactory("TavernToken");
    const token: any = await TavernToken.deploy();
    await token.waitForDeployment();

    const TavernRegistry = await getWorkspaceContractFactory("TavernRegistry");
    const registry: any = await TavernRegistry.deploy(await token.getAddress());
    await registry.waitForDeployment();

    const TavernEscrow = await getWorkspaceContractFactory("TavernEscrow");
    const escrow: any = await TavernEscrow.deploy(
      await usdc.getAddress(),
      await token.getAddress(),
      await registry.getAddress(),
      await ethUsdFeed.getAddress(),
      await tvrnUsdFeed.getAddress()
    );
    await escrow.waitForDeployment();

    const TavernClientRPG = await getWorkspaceContractFactory("TavernClientRPG");
    const clientRPG: any = await TavernClientRPG.deploy(await token.getAddress(), await escrow.getAddress());
    await clientRPG.waitForDeployment();

    await token.grantRole(await token.MINTER_ROLE(), await escrow.getAddress());
    await token.grantRole(await token.MINTER_ROLE(), await clientRPG.getAddress());
    await token.grantRole(await token.ESCROW_ROLE(), await escrow.getAddress());
    await registry.grantRole(await registry.ARBITER_ROLE(), await escrow.getAddress());
    await registry.grantRole(await registry.KEEPER_ROLE(), keeper.address);
    await escrow.grantRole(await escrow.KEEPER_ROLE(), keeper.address);
    await clientRPG.grantRole(await clientRPG.ESCROW_ROLE(), await escrow.getAddress());
    await clientRPG.grantRole(await clientRPG.KEEPER_ROLE(), keeper.address);
    await escrow.setClientRPG(await clientRPG.getAddress());

    await usdc.transfer(client.address, 10_000n * 10n ** 6n);

    const createUsdcQuest = async (depositAmount: bigint = 100n * 10n ** 6n) => {
      await escrow.connect(client).createQuest(
        await usdc.getAddress(),
        depositAmount,
        ethers.keccak256(ethers.toUtf8Bytes("brief")),
        "ipfs://brief"
      );
      const questId = await escrow.nextQuestId();
      await usdc.connect(client).approve(await escrow.getAddress(), depositAmount);
      await escrow.connect(client).fundQuestUSDC(questId);
      await escrow.connect(agent).acceptQuest(questId);
      return questId;
    };

    const createEthQuest = async (depositAmount: bigint = 1n * 10n ** 18n) => {
      await escrow.connect(client).createQuest(
        ethers.ZeroAddress,
        depositAmount,
        ethers.keccak256(ethers.toUtf8Bytes("eth-brief")),
        "ipfs://eth-brief"
      );
      const questId = await escrow.nextQuestId();
      await escrow.connect(client).fundQuestETH(questId, { value: depositAmount });
      await escrow.connect(agent).acceptQuest(questId);
      return questId;
    };

    return {
      deployer,
      client,
      agent,
      keeper,
      recipient,
      usdc,
      ethUsdFeed,
      tvrnUsdFeed,
      token,
      registry,
      escrow,
      clientRPG,
      createUsdcQuest,
      createEthQuest
    };
  }

  it("compensates timed out quests after 48 hours", async function () {
    const { escrow, keeper, client, agent, tvrnUsdFeed, createUsdcQuest } = await loadFixture(
      deployFixture
    );

    const questId = await createUsdcQuest();
    await escrow.connect(agent).recordHeartbeat(questId);

    await time.increase(48 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());

    await expect(escrow.connect(keeper).executeTimeout(questId))
      .to.emit(escrow, "QuestTimedOut")
      .and.to.emit(escrow, "QuestCompensated");

    const quest = await escrow.quests(questId);
    expect(quest.state).to.equal(7n);
    expect(quest.compensated).to.equal(true);
    expect(await escrow.clientTvrnUnlockAt(client.address)).to.be.gt(0n);
    expect(await escrow.compensationKinds(questId)).to.equal(0n);
  });

  it("reverts compensation when a price feed is stale for more than one hour", async function () {
    const { escrow, keeper, ethUsdFeed, createEthQuest } = await loadFixture(deployFixture);

    const questId = await createEthQuest();

    const staleTimestamp = (await time.latest()) - (60 * 60 + 1);
    await ethUsdFeed.setRoundData(2_000n * 10n ** 8n, staleTimestamp);

    await time.increase(48 * 60 * 60 + 1);

    await expect(escrow.connect(keeper).executeTimeout(questId)).to.be.revertedWithCustomError(
      escrow,
      "OracleStalePrice"
    );
  });

  it("locks compensation TVRN transfers for 30 days", async function () {
    const { escrow, keeper, token, client, recipient, tvrnUsdFeed, createUsdcQuest } =
      await loadFixture(deployFixture);

    const questId = await createUsdcQuest(250n * 10n ** 6n);
    await time.increase(48 * 60 * 60 + 1);
    await tvrnUsdFeed.setRoundData(1n * 10n ** 8n, await time.latest());
    await escrow.connect(keeper).executeTimeout(questId);

    const balance = await token.balanceOf(client.address);
    expect(balance).to.be.gt(0n);

    await expect(token.connect(client).transfer(recipient.address, 1n)).to.be.revertedWith(
      "TVRN: transfer locked (30-day compensation lock)"
    );

    await time.increase(30 * 24 * 60 * 60 + 1);
    await expect(token.connect(client).transfer(recipient.address, 1n)).to.not.be.reverted;
  });

  it("does not emit QuotaRebalanced when all quota deltas stay below the 2% hysteresis", async function () {
    const { registry, keeper } = await loadFixture(deployFixture);

    const before = await Promise.all(
      Array.from({ length: 6 }, (_, index) => registry.jobQuota(index))
    );

    await expect(
      registry
        .connect(keeper)
        .dailyQuotaRebalance([1700, 1700, 1650, 1650, 1650, 1650])
    ).to.not.emit(registry, "QuotaRebalanced");

    const after = await Promise.all(
      Array.from({ length: 6 }, (_, index) => registry.jobQuota(index))
    );

    expect(after).to.deep.equal(before);
  });

  it("rejects quest creation above the configured USDC and ETH caps", async function () {
    const { client, usdc, escrow } = await loadFixture(deployFixture);

    await expect(
      escrow.connect(client).createQuest(
        await usdc.getAddress(),
        100_001n * 10n ** 6n,
        ethers.keccak256(ethers.toUtf8Bytes("over-usdc")),
        "ipfs://brief"
      )
    ).to.be.revertedWithCustomError(escrow, "UsdcDepositCapExceeded");

    await expect(
      escrow.connect(client).createQuest(
        ethers.ZeroAddress,
        101n * 10n ** 18n,
        ethers.keccak256(ethers.toUtf8Bytes("over-eth")),
        "ipfs://brief"
      )
    ).to.be.revertedWithCustomError(escrow, "EthDepositCapExceeded");
  });

  it("blocks client-side settlement when settlementPaused is enabled", async function () {
    const { escrow, client, agent, usdc } = await loadFixture(deployFixture);

    await escrow.connect(client).createQuest(
      await usdc.getAddress(),
      100n * 10n ** 6n,
      ethers.keccak256(ethers.toUtf8Bytes("brief")),
      "ipfs://brief"
    );
    const questId = await escrow.nextQuestId();
    await usdc.connect(client).approve(await escrow.getAddress(), 100n * 10n ** 6n);
    await escrow.connect(client).fundQuestUSDC(questId);
    await escrow.connect(agent).acceptQuest(questId);
    await escrow
      .connect(agent)
      .submitResult(questId, ethers.keccak256(ethers.toUtf8Bytes("result")), "ipfs://result");
    await escrow.setSettlementPaused(true);

    await expect(
      escrow.connect(client).submitEvaluation(questId, [5, 5, 5, 5, 5], "solid review", ["clear"])
    ).to.be.revertedWithCustomError(escrow, "SettlementsPaused");
  });

  it("blocks executeAutoApprove and executeTimeout while settlements are paused", async function () {
    const { escrow, keeper, createUsdcQuest } = await loadFixture(deployFixture);

    const timeoutQuestId = await createUsdcQuest();
    await time.increase(48 * 60 * 60 + 1);
    await escrow.setSettlementPaused(true);
    await expect(escrow.connect(keeper).executeTimeout(timeoutQuestId)).to.be.revertedWithCustomError(
      escrow,
      "SettlementsPaused"
    );

    const submittedQuestId = await createUsdcQuest();
    await escrow
      .connect((await ethers.getSigners())[2])
      .submitResult(submittedQuestId, ethers.keccak256(ethers.toUtf8Bytes("auto")), "ipfs://auto");
    await time.increase(72 * 60 * 60 + 1);
    await expect(escrow.connect(keeper).executeAutoApprove(submittedQuestId)).to.be.revertedWithCustomError(
      escrow,
      "SettlementsPaused"
    );
  });

  it("lets governance downgrade the fee stage once the role is granted", async function () {
    const { client, keeper, escrow } = await loadFixture(deployFixture);

    const feeStageSlot = await findUintSlot(
      await escrow.getAddress(),
      async () => BigInt(await escrow.currentFeeStage()),
      2n
    );
    await setUintStorage(await escrow.getAddress(), feeStageSlot, 2n);
    expect(await escrow.currentFeeStage()).to.equal(2n);

    await expect(escrow.connect(keeper).governanceDowngradeFeeStage(1)).to.be.reverted;
    await escrow.grantRole(await escrow.GOVERNANCE_ROLE(), client.address);

    await expect(escrow.connect(client).governanceDowngradeFeeStage(1))
      .to.emit(escrow, "FeeStageDowngraded")
      .withArgs(1n, 100n);

    expect(await escrow.currentFeeStage()).to.equal(1n);
    await expect(escrow.connect(client).governanceDowngradeFeeStage(1)).to.be.revertedWithCustomError(
      escrow,
      "NotADowngrade"
    );
  });
});
