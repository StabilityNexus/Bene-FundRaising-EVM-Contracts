import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  MIN_FUNDING,
  DEVELOPER_FEE_PERCENTAGE,
  ZERO_ADDRESS,
  buildConfig,
  deployFactoryFixture,
  deployVaultViaFactory,
  deployRejectingDeveloperVaultFixture,
  deployRejectingOwnerVaultFixture,
  deployBlacklistFundingVaultFixture,
} from "./fixtures";

describe("withdrawFunds resilience to a recipient that rejects the payout", function () {
  const ONE_ETH = ethers.parseEther("1");
  const FEE = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;
  const OWNER_SHARE = MIN_FUNDING - FEE;

  async function deployFactoryWithRejecterFixture() {
    const base = await deployFactoryFixture();
    const rejecter = await (await ethers.getContractFactory("RejectingReceiver")).deploy();
    await rejecter.waitForDeployment();
    return { ...base, rejecter };
  }

  describe("native ETH vault", function () {
    it("should still pay the owner when the developer fee address rejects ETH", async function () {
      const { vault, alice } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });

      await expect(vault.withdrawFunds()).to.not.be.reverted;

      // Only the fee the developer could not receive is left in the vault.
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(FEE);
    });

    it("should pay the owner their share and credit the rejected fee as claimable", async function () {
      const { vault, rejecter, owner, alice } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });

      await expect(vault.withdrawFunds()).to.changeEtherBalance(owner, OWNER_SHARE);

      expect(await vault.pendingWithdrawals(await rejecter.getAddress())).to.equal(FEE);
    });

    it("should emit WithdrawalCredited for the recipient that could not be paid", async function () {
      const { vault, rejecter, alice } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });

      await expect(vault.withdrawFunds())
        .to.emit(vault, "WithdrawalCredited")
        .withArgs(await rejecter.getAddress(), FEE);
    });

    it("should let the credited developer claim the fee to a different address", async function () {
      const { vault, rejecter, alice, stranger } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await vault.withdrawFunds();
      const claim = vault.interface.encodeFunctionData("claimPending", [stranger.address]);

      await expect(rejecter.execute(await vault.getAddress(), claim)).to.changeEtherBalance(stranger, FEE);

      expect(await vault.pendingWithdrawals(await rejecter.getAddress())).to.equal(0n);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
    });

    it("should emit PendingWithdrawalClaimed when a credit is claimed", async function () {
      const { vault, rejecter, alice, stranger } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await vault.withdrawFunds();
      const claim = vault.interface.encodeFunctionData("claimPending", [stranger.address]);

      await expect(rejecter.execute(await vault.getAddress(), claim))
        .to.emit(vault, "PendingWithdrawalClaimed")
        .withArgs(await rejecter.getAddress(), stranger.address, FEE);
    });

    it("should still pay the developer when the owner's withdrawal address rejects ETH", async function () {
      const { vault, rejecter, developer, alice } = await loadFixture(deployRejectingOwnerVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      const withdraw = vault.interface.encodeFunctionData("withdrawFunds");

      await expect(rejecter.execute(await vault.getAddress(), withdraw)).to.changeEtherBalance(developer, FEE);

      expect(await vault.pendingWithdrawals(await rejecter.getAddress())).to.equal(OWNER_SHARE);
    });

    it("should let an owner that cannot receive ETH claim the funds to a different address", async function () {
      const { vault, rejecter, alice, stranger } = await loadFixture(deployRejectingOwnerVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await rejecter.execute(await vault.getAddress(), vault.interface.encodeFunctionData("withdrawFunds"));
      const claim = vault.interface.encodeFunctionData("claimPending", [stranger.address]);

      await expect(rejecter.execute(await vault.getAddress(), claim)).to.changeEtherBalance(stranger, OWNER_SHARE);
    });

    it("should not pay credited funds out again on a later withdrawal", async function () {
      const { vault, rejecter, owner, alice } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await vault.withdrawFunds();
      await vault.connect(alice).purchaseTokens({ value: 2n * ONE_ETH });
      const secondFee = (2n * ONE_ETH * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds()).to.changeEtherBalance(owner, 2n * ONE_ETH - secondFee);

      expect(await vault.pendingWithdrawals(await rejecter.getAddress())).to.equal(FEE + secondFee);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(FEE + secondFee);
    });

    it("should not call a developer address that rejects ETH when the fee is zero", async function () {
      const { factory, pft, owner, alice, rejecter } = await loadFixture(deployFactoryWithRejecterFixture);
      const config = await buildConfig(
        {
          proofOfFundingToken: await pft.getAddress(),
          withdrawalAddress: owner.address,
          developerFeeAddress: await rejecter.getAddress(),
        },
        { developerFeePercentage: 0n },
      );
      const vault = await ethers.getContractAt(
        "FundingVault",
        await deployVaultViaFactory(factory, owner, pft, config),
      );
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });

      await expect(vault.withdrawFunds()).to.changeEtherBalance(owner, MIN_FUNDING);

      expect(await vault.pendingWithdrawals(await rejecter.getAddress())).to.equal(0n);
    });

    it("should fail to claim when nothing is pending", async function () {
      const { vault, alice } = await loadFixture(deployRejectingDeveloperVaultFixture);

      await expect(vault.connect(alice).claimPending(alice.address)).to.be.revertedWithCustomError(
        vault,
        "NothingToClaim",
      );
    });

    it("should fail to claim to the zero address", async function () {
      const { vault, rejecter, alice } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await vault.withdrawFunds();
      const claim = vault.interface.encodeFunctionData("claimPending", [ZERO_ADDRESS]);

      await expect(rejecter.execute(await vault.getAddress(), claim)).to.be.revertedWithCustomError(
        vault,
        "ZeroAddressRecipient",
      );
    });
  });

  describe("ERC20 vault with a funding token that can block recipients", function () {
    it("should still pay the owner when the developer is blocked from receiving the funding token", async function () {
      const { vault, blockable, owner, developer, alice } = await loadFixture(deployBlacklistFundingVaultFixture);
      await blockable.connect(alice).approve(await vault.getAddress(), MIN_FUNDING);
      await vault.connect(alice).purchaseTokens(MIN_FUNDING);
      await blockable.setBlocked(developer.address, true);

      await expect(vault.withdrawFunds()).to.changeTokenBalance(blockable, owner, OWNER_SHARE);

      expect(await vault.pendingWithdrawals(developer.address)).to.equal(FEE);
    });

    it("should let the blocked developer claim the credited fee to another address", async function () {
      const { vault, blockable, developer, alice, stranger } = await loadFixture(deployBlacklistFundingVaultFixture);
      await blockable.connect(alice).approve(await vault.getAddress(), MIN_FUNDING);
      await vault.connect(alice).purchaseTokens(MIN_FUNDING);
      await blockable.setBlocked(developer.address, true);
      await vault.withdrawFunds();

      await expect(vault.connect(developer).claimPending(stranger.address)).to.changeTokenBalance(
        blockable,
        stranger,
        FEE,
      );

      expect(await vault.pendingWithdrawals(developer.address)).to.equal(0n);
    });

    it("should still pay the developer when the owner is blocked, and let the owner claim elsewhere", async function () {
      const { vault, blockable, owner, developer, alice, stranger } = await loadFixture(
        deployBlacklistFundingVaultFixture,
      );
      await blockable.connect(alice).approve(await vault.getAddress(), MIN_FUNDING);
      await vault.connect(alice).purchaseTokens(MIN_FUNDING);
      await blockable.setBlocked(owner.address, true);

      await expect(vault.withdrawFunds()).to.changeTokenBalance(blockable, developer, FEE);
      expect(await vault.pendingWithdrawals(owner.address)).to.equal(OWNER_SHARE);

      await expect(vault.claimPending(stranger.address)).to.changeTokenBalance(blockable, stranger, OWNER_SHARE);
    });

    it("should fail to claim when nothing is pending", async function () {
      const { vault, alice } = await loadFixture(deployBlacklistFundingVaultFixture);

      await expect(vault.connect(alice).claimPending(alice.address)).to.be.revertedWithCustomError(
        vault,
        "NothingToClaim",
      );
    });

    it("should not pay credited funds out again on a later withdrawal", async function () {
      const { vault, blockable, owner, developer, alice } = await loadFixture(deployBlacklistFundingVaultFixture);
      await blockable.connect(alice).approve(await vault.getAddress(), MIN_FUNDING + 2n * ONE_ETH);
      await vault.connect(alice).purchaseTokens(MIN_FUNDING);
      await blockable.setBlocked(developer.address, true);
      await vault.withdrawFunds();
      await vault.connect(alice).purchaseTokens(2n * ONE_ETH);
      const secondFee = (2n * ONE_ETH * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds()).to.changeTokenBalance(blockable, owner, 2n * ONE_ETH - secondFee);

      expect(await vault.pendingWithdrawals(developer.address)).to.equal(FEE + secondFee);
      expect(await blockable.balanceOf(await vault.getAddress())).to.equal(FEE + secondFee);
    });
  });

  it("should keep refunds possible only before the minimum is reached (sanity for the shared helper)", async function () {
    const { vault, alice, deadline } = await loadFixture(deployRejectingDeveloperVaultFixture);
    await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
    await time.increaseTo(deadline + 1);

    await expect(vault.connect(alice).refundTokens()).to.changeEtherBalance(alice, ONE_ETH);
  });
});
