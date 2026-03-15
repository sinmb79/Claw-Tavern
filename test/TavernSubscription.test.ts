import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

import { getWorkspaceContractFactory } from "../scripts/utils/hardhatContracts";
import { deployCoreFixture } from "./helpers/deployCoreFixture";

describe("TavernSubscription", function () {
  async function deployFixture() {
    const core = await deployCoreFixture();
    const { agent, other, recipient, usdc, registry, clientRPG, keeper, stakeAndJoinGuild } = core;

    await stakeAndJoinGuild(agent, 1, "gpt-agent");
    await stakeAndJoinGuild(other, 1, "claude-agent");

    const TavernSubscription = await getWorkspaceContractFactory("TavernSubscription");
    const subscription: any = await TavernSubscription.deploy(
      await usdc.getAddress(),
      recipient.address,
      await registry.getAddress()
    );
    await subscription.waitForDeployment();

    await subscription.setClientRPG(await clientRPG.getAddress());
    await subscription.grantRole(await subscription.KEEPER_ROLE(), keeper.address);
    await clientRPG.grantRole(await clientRPG.SUBSCRIPTION_ROLE(), await subscription.getAddress());

    const approveAndSubscribe = async (subscriber: any, subscribedAgent: any) => {
      const rate = await subscription.agentMonthlyRate(subscribedAgent.address);
      await usdc.connect(subscriber).approve(await subscription.getAddress(), rate);
      await subscription.connect(subscriber).subscribe(subscribedAgent.address);
      return rate;
    };

    return {
      ...core,
      subscription,
      operatorWallet: recipient,
      secondAgent: other,
      approveAndSubscribe
    };
  }

  it("stores the agent monthly rate and emits an event", async function () {
    const { subscription, agent } = await loadFixture(deployFixture);
    const rate = 100n * 10n ** 6n;

    await expect(subscription.connect(agent).setAgentMonthlyRate(rate))
      .to.emit(subscription, "AgentRateSet")
      .withArgs(agent.address, rate);

    expect(await subscription.agentMonthlyRate(agent.address)).to.equal(rate);
  });

  it("reverts when the rate is below the minimum", async function () {
    const { subscription, agent } = await loadFixture(deployFixture);

    await expect(subscription.connect(agent).setAgentMonthlyRate(9n * 10n ** 6n)).to.be.revertedWith(
      "Rate out of range"
    );
  });

  it("reverts when the rate is above the maximum", async function () {
    const { subscription, agent } = await loadFixture(deployFixture);

    await expect(subscription.connect(agent).setAgentMonthlyRate(10_001n * 10n ** 6n)).to.be.revertedWith(
      "Rate out of range"
    );
  });

  it("rejects rate updates from non-active agents", async function () {
    const { subscription, recipient } = await loadFixture(deployFixture);

    await expect(subscription.connect(recipient).setAgentMonthlyRate(100n * 10n ** 6n)).to.be.revertedWith(
      "Not active agent"
    );
  });

  it("creates a subscription and records the active period", async function () {
    const { subscription, usdc, client, agent, operatorWallet, approveAndSubscribe } = await loadFixture(
      deployFixture
    );
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    const beforeBalance = await usdc.balanceOf(agent.address);
    const beforeOperatorBalance = await usdc.balanceOf(operatorWallet.address);
    await approveAndSubscribe(client, agent);

    const subId = await subscription.clientAgentSub(client.address, agent.address);
    const sub = await subscription.subscriptions(subId);

    expect(subId).to.equal(1n);
    expect(sub.client).to.equal(client.address);
    expect(sub.agent).to.equal(agent.address);
    expect(sub.active).to.equal(true);
    expect(sub.cancelledByClient).to.equal(false);
    expect(sub.currentPeriodEnd).to.be.gt(sub.currentPeriodStart);
    expect((await usdc.balanceOf(agent.address)) - beforeBalance).to.equal(95n * 10n ** 6n);
    expect((await usdc.balanceOf(operatorWallet.address)) - beforeOperatorBalance).to.equal(5n * 10n ** 6n);
  });

  it("deducts a 5 percent fee from the monthly payment immediately", async function () {
    const { subscription, client, agent, usdc, operatorWallet, approveAndSubscribe } = await loadFixture(
      deployFixture
    );
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    const beforeOperatorBalance = await usdc.balanceOf(operatorWallet.address);
    await approveAndSubscribe(client, agent);

    expect((await usdc.balanceOf(operatorWallet.address)) - beforeOperatorBalance).to.equal(5n * 10n ** 6n);
  });

  it("renews an existing subscription in place", async function () {
    const { subscription, client, agent, approveAndSubscribe } = await loadFixture(deployFixture);
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    await approveAndSubscribe(client, agent);

    const subId = await subscription.clientAgentSub(client.address, agent.address);
    const firstEnd = (await subscription.subscriptions(subId)).currentPeriodEnd;

    await time.increase(5 * 24 * 60 * 60);
    await approveAndSubscribe(client, agent);

    const renewed = await subscription.subscriptions(subId);
    expect(await subscription.nextSubscriptionId()).to.equal(1n);
    expect(renewed.currentPeriodEnd).to.be.gt(firstEnd);
    expect(renewed.cancelledByClient).to.equal(false);
  });

  it("marks cancellation without ending the current period", async function () {
    const { subscription, client, agent, approveAndSubscribe } = await loadFixture(deployFixture);
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    await approveAndSubscribe(client, agent);

    const subId = await subscription.clientAgentSub(client.address, agent.address);
    await expect(subscription.connect(client).cancelSubscription(subId))
      .to.emit(subscription, "SubscriptionCancelled")
      .withArgs(subId, client.address, agent.address);

    const sub = await subscription.subscriptions(subId);
    expect(sub.cancelledByClient).to.equal(true);
    expect(await subscription.isSubscriptionActive(client.address, agent.address)).to.equal(true);
  });

  it("reports inactive after the subscription period has elapsed", async function () {
    const { subscription, client, agent, approveAndSubscribe } = await loadFixture(deployFixture);
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    await approveAndSubscribe(client, agent);
    await time.increase(30 * 24 * 60 * 60 + 1);

    expect(await subscription.isSubscriptionActive(client.address, agent.address)).to.equal(false);
  });

  it("lets a keeper expire a finished subscription", async function () {
    const { subscription, client, agent, keeper, approveAndSubscribe } = await loadFixture(deployFixture);
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    await approveAndSubscribe(client, agent);
    const subId = await subscription.clientAgentSub(client.address, agent.address);

    await time.increase(30 * 24 * 60 * 60 + 1);
    await expect(subscription.connect(keeper).expireSubscription(subId))
      .to.emit(subscription, "SubscriptionExpired")
      .withArgs(subId, client.address, agent.address);

    expect((await subscription.subscriptions(subId)).active).to.equal(false);
  });

  it("does not allow expiry before the period ends", async function () {
    const { subscription, client, agent, keeper, approveAndSubscribe } = await loadFixture(deployFixture);
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    await approveAndSubscribe(client, agent);
    const subId = await subscription.clientAgentSub(client.address, agent.address);

    await expect(subscription.connect(keeper).expireSubscription(subId)).to.be.revertedWith("Not expired yet");
  });

  it("leaves zero USDC in the subscription contract after subscribe", async function () {
    const { subscription, client, agent, usdc, approveAndSubscribe } = await loadFixture(deployFixture);
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    await approveAndSubscribe(client, agent);

    expect(await usdc.balanceOf(await subscription.getAddress())).to.equal(0n);
  });

  it("emits SubscriptionFeeDistributed when subscribe succeeds", async function () {
    const { subscription, client, agent, operatorWallet, usdc } = await loadFixture(deployFixture);
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    await usdc.connect(client).approve(await subscription.getAddress(), rate);

    await expect(subscription.connect(client).subscribe(agent.address))
      .to.emit(subscription, "SubscriptionFeeDistributed")
      .withArgs(client.address, agent.address, 5n * 10n ** 6n, operatorWallet.address);
  });

  it("grants subscription EXP through the RPG", async function () {
    const { subscription, client, agent, clientRPG, approveAndSubscribe } = await loadFixture(deployFixture);
    const rate = 100n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(rate);
    await approveAndSubscribe(client, agent);

    const profile = await clientRPG.clientProfiles(client.address);
    expect(profile.exp).to.equal(100n);
    expect(profile.level).to.equal(2n);
  });

  it("tracks separate subscriptions for different agents", async function () {
    const { subscription, client, agent, secondAgent, approveAndSubscribe } = await loadFixture(deployFixture);
    const firstRate = 100n * 10n ** 6n;
    const secondRate = 250n * 10n ** 6n;

    await subscription.connect(agent).setAgentMonthlyRate(firstRate);
    await subscription.connect(secondAgent).setAgentMonthlyRate(secondRate);
    await approveAndSubscribe(client, agent);
    await approveAndSubscribe(client, secondAgent);

    const firstId = await subscription.clientAgentSub(client.address, agent.address);
    const secondId = await subscription.clientAgentSub(client.address, secondAgent.address);

    expect(firstId).to.equal(1n);
    expect(secondId).to.equal(2n);
    expect((await subscription.subscriptions(firstId)).monthlyRateUsdc).to.equal(firstRate);
    expect((await subscription.subscriptions(secondId)).monthlyRateUsdc).to.equal(secondRate);
  });
});
