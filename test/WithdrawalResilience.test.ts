import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  MIN_FUNDING,
  DEVELOPER_FEE_PERCENTAGE,
  deployRejectingDeveloperVaultFixture,
  deployRejectingOwnerVaultFixture,
  deployBlacklistFundingVaultFixture,
} from "./fixtures";

// The developer fee always goes to the fixed developer address and a failure there reverts the whole
// withdrawal. The owner's share goes to the address passed to withdrawFunds, so an owner that cannot
// receive the payout itself can send it somewhere else.
describe("withdrawFunds when a recipient rejects the payout", function () {
  const ONE_ETH = ethers.parseEther("1");
  const FEE = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;
  const OWNER_SHARE = MIN_FUNDING - FEE;

  describe("native ETH vault", function () {
    it("should revert when the developer fee address rejects ETH", async function () {
      const { vault, owner, alice } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });

      await expect(vault.withdrawFunds(owner.address)).to.be.revertedWithCustomError(vault, "EthTransferFailed");
    });

    it("should leave every balance untouched when the developer fee transfer fails", async function () {
      const { vault, owner, alice } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      const ownerBefore = await ethers.provider.getBalance(owner.address);

      await expect(vault.withdrawFunds(owner.address)).to.be.reverted;

      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(MIN_FUNDING);
      // The failed transaction only costs the owner gas, so nothing was paid out to them.
      expect(await ethers.provider.getBalance(owner.address)).to.be.lte(ownerBefore);
    });

    it("should revert, and not pay the developer, when the given recipient rejects ETH", async function () {
      const { vault, rejecter, developer, alice } = await loadFixture(deployRejectingOwnerVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      const developerBefore = await ethers.provider.getBalance(developer.address);
      const withdraw = vault.interface.encodeFunctionData("withdrawFunds", [await rejecter.getAddress()]);

      await expect(rejecter.execute(await vault.getAddress(), withdraw)).to.be.revertedWithCustomError(
        vault,
        "EthTransferFailed",
      );

      expect(await ethers.provider.getBalance(developer.address)).to.equal(developerBefore);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(MIN_FUNDING);
    });

    it("should let an owner that cannot receive ETH send its share to another address", async function () {
      const { vault, rejecter, developer, alice, stranger } = await loadFixture(deployRejectingOwnerVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      const withdraw = vault.interface.encodeFunctionData("withdrawFunds", [stranger.address]);

      await expect(rejecter.execute(await vault.getAddress(), withdraw)).to.changeEtherBalances(
        [stranger, developer],
        [OWNER_SHARE, FEE],
      );
    });

    it("should still allow refunds of a failed campaign when the developer address rejects ETH", async function () {
      const { vault, alice, deadline } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.changeEtherBalance(alice, ONE_ETH);
    });
  });

  describe("ERC20 vault with a funding token that can block recipients", function () {
    async function fundedVault() {
      const fixture = await loadFixture(deployBlacklistFundingVaultFixture);
      const { vault, blockable, alice } = fixture;
      await blockable.connect(alice).approve(await vault.getAddress(), MIN_FUNDING);
      await vault.connect(alice).purchaseTokens(MIN_FUNDING);
      return fixture;
    }

    it("should revert when the developer is blocked from receiving the funding token", async function () {
      const { vault, blockable, owner, developer } = await fundedVault();
      await blockable.setBlocked(developer.address, true);

      await expect(vault.withdrawFunds(owner.address)).to.be.revertedWithCustomError(blockable, "RecipientBlocked");

      expect(await blockable.balanceOf(await vault.getAddress())).to.equal(MIN_FUNDING);
    });

    it("should revert, and not pay the developer, when the given recipient is blocked", async function () {
      const { vault, blockable, developer, stranger } = await fundedVault();
      await blockable.setBlocked(stranger.address, true);

      await expect(vault.withdrawFunds(stranger.address)).to.be.revertedWithCustomError(blockable, "RecipientBlocked");

      expect(await blockable.balanceOf(developer.address)).to.equal(0n);
      expect(await blockable.balanceOf(await vault.getAddress())).to.equal(MIN_FUNDING);
    });

    it("should let a blocked owner send its share to another address", async function () {
      const { vault, blockable, owner, developer, stranger } = await fundedVault();
      await blockable.setBlocked(owner.address, true);

      await expect(vault.withdrawFunds(stranger.address)).to.changeTokenBalances(
        blockable,
        [stranger, developer],
        [OWNER_SHARE, FEE],
      );
    });
  });
});
