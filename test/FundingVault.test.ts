import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PFT_AMOUNT,
  MIN_FUNDING,
  EXCHANGE_RATE,
  MAX_FUNDING,
  DEVELOPER_FEE_PERCENTAGE,
  buildConfig,
  deployNativeVaultFixture,
} from "./fixtures";

describe("FundingVault (native ETH funding)", function () {
  const ONE_ETH = ethers.parseEther("1");

  describe("creation via the factory", function () {
    it("should be registered in the factory as a non-ERC20 vault", async function () {
      const { factory, vault } = await loadFixture(deployNativeVaultFixture);

      const entry = await factory.vaults(1);

      expect(entry.vaultAddress).to.equal(await vault.getAddress());
      expect(entry.isERC20).to.equal(false);
    });

    it("should expose the configured parameters through getVault", async function () {
      const { vault, pft, owner, config } = await loadFixture(deployNativeVaultFixture);

      const details = await vault.getVault();

      expect(details.withdrawalAddress).to.equal(owner.address);
      expect(details.proofOfFundingToken).to.equal(await pft.getAddress());
      expect(details.proofOfFundingTokenAmount).to.equal(PFT_AMOUNT);
      expect(details.minFundingAmount).to.equal(MIN_FUNDING);
      expect(details.timestamp).to.equal(config.timestamp);
      expect(details.exchangeRate).to.equal(EXCHANGE_RATE);
    });

    it("should hold the PFT deposited by the factory", async function () {
      const { vault, pft } = await loadFixture(deployNativeVaultFixture);

      expect(await pft.balanceOf(await vault.getAddress())).to.equal(PFT_AMOUNT);
    });

    it("should be a Voucher ERC20 with no vouchers minted yet", async function () {
      const { vault } = await loadFixture(deployNativeVaultFixture);

      expect(await vault.name()).to.equal("Voucher");
      expect(await vault.symbol()).to.equal("VCHR");
      expect(await vault.totalSupply()).to.equal(0n);
    });
  });

  describe("purchaseTokens", function () {
    it("should mint vouchers at the exchange rate", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);

      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });

      expect(await vault.balanceOf(alice.address)).to.equal(ONE_ETH * EXCHANGE_RATE);
      expect(await vault.totalSupply()).to.equal(ONE_ETH * EXCHANGE_RATE);
    });

    it("should keep the contributed ETH in the vault", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);

      await expect(vault.connect(alice).purchaseTokens({ value: ONE_ETH })).to.changeEtherBalances(
        [alice, vault],
        [-ONE_ETH, ONE_ETH],
      );
    });

    it("should emit TokensPurchased with the voucher amount", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);

      await expect(vault.connect(alice).purchaseTokens({ value: ONE_ETH }))
        .to.emit(vault, "TokensPurchased")
        .withArgs(alice.address, ONE_ETH * EXCHANGE_RATE);
    });

    it("should accumulate vouchers across several contributors", async function () {
      const { vault, alice, bob } = await loadFixture(deployNativeVaultFixture);

      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await vault.connect(bob).purchaseTokens({ value: 2n * ONE_ETH });

      expect(await vault.balanceOf(alice.address)).to.equal(ONE_ETH * EXCHANGE_RATE);
      expect(await vault.balanceOf(bob.address)).to.equal(2n * ONE_ETH * EXCHANGE_RATE);
      expect(await vault.totalSupply()).to.equal(3n * ONE_ETH * EXCHANGE_RATE);
    });

    it("should allow buying exactly up to the PFT the vault holds", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);

      await vault.connect(alice).purchaseTokens({ value: MAX_FUNDING });

      expect(await vault.totalSupply()).to.equal(PFT_AMOUNT);
    });

    it("should fail when the purchase would mint more vouchers than the vault holds PFT", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);

      await expect(vault.connect(alice).purchaseTokens({ value: MAX_FUNDING + 1n })).to.be.revertedWithCustomError(
        vault,
        "NotEnoughTokens",
      );
    });

    it("should fail when earlier purchases already used up the available PFT", async function () {
      const { vault, alice, bob } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MAX_FUNDING });

      await expect(vault.connect(bob).purchaseTokens({ value: 1n })).to.be.revertedWithCustomError(
        vault,
        "NotEnoughTokens",
      );
    });

    it("should still accept purchases after the deadline (current behavior)", async function () {
      const { vault, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await time.increaseTo(deadline + 1);

      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });

      expect(await vault.balanceOf(alice.address)).to.equal(ONE_ETH * EXCHANGE_RATE);
    });
  });

  describe("accounting counters", function () {
    it("should start with nothing sold, nothing refunded and the minimum not reached", async function () {
      const { vault } = await loadFixture(deployNativeVaultFixture);

      expect(await vault.totalSold()).to.equal(0n);
      expect(await vault.totalRefunded()).to.equal(0n);
      expect(await vault.minimumReached()).to.equal(false);
    });

    it("should add every purchase to totalSold", async function () {
      const { vault, alice, bob } = await loadFixture(deployNativeVaultFixture);

      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await vault.connect(bob).purchaseTokens({ value: 2n * ONE_ETH });

      expect(await vault.totalSold()).to.equal(3n * ONE_ETH);
    });

    it("should count refunds in totalRefunded and leave totalSold untouched", async function () {
      const { vault, alice, bob, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await vault.connect(bob).purchaseTokens({ value: 3n * ONE_ETH });
      await time.increaseTo(deadline + 1);

      await vault.connect(bob).refundTokens();

      expect(await vault.totalSold()).to.equal(4n * ONE_ETH);
      expect(await vault.totalRefunded()).to.equal(3n * ONE_ETH);
    });

    it("should report the minimum reached exactly when sold minus refunded reaches it", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);

      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING - 1n });
      expect(await vault.minimumReached()).to.equal(false);

      await vault.connect(alice).purchaseTokens({ value: 1n });
      expect(await vault.minimumReached()).to.equal(true);
    });
  });

  describe("refundTokens", function () {
    it("should refund the contribution when the campaign failed", async function () {
      const { vault, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.changeEtherBalances([alice, vault], [ONE_ETH, -ONE_ETH]);

      expect(await vault.balanceOf(alice.address)).to.equal(0n);
      expect(await vault.totalSupply()).to.equal(0n);
    });

    it("should emit Refund with the refunded amount", async function () {
      const { vault, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.emit(vault, "Refund").withArgs(alice.address, ONE_ETH);
    });

    it("should refund each contributor only their own contribution", async function () {
      const { vault, alice, bob, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await vault.connect(bob).purchaseTokens({ value: 3n * ONE_ETH });
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(bob).refundTokens()).to.changeEtherBalance(bob, 3n * ONE_ETH);
      await expect(vault.connect(alice).refundTokens()).to.changeEtherBalance(alice, ONE_ETH);
    });

    it("should refund nothing a second time", async function () {
      const { vault, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await time.increaseTo(deadline + 1);
      await vault.connect(alice).refundTokens();

      await expect(vault.connect(alice).refundTokens()).to.changeEtherBalance(alice, 0n);
    });

    it("should fail when the deadline has not passed", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });

      await expect(vault.connect(alice).refundTokens()).to.be.revertedWithCustomError(vault, "DeadlineNotPassed");
    });

    it("should fail when the minimum funding amount was reached", async function () {
      const { vault, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.be.revertedWithCustomError(vault, "MinFundingAmountReached");
    });
  });

  describe("withdrawFunds", function () {
    it("should pay the owner the funds minus the developer fee", async function () {
      const { vault, owner, developer, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await time.increaseTo(deadline + 1);
      const fee = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds()).to.changeEtherBalances(
        [owner, developer, vault],
        [MIN_FUNDING - fee, fee, -MIN_FUNDING],
      );
    });

    it("should emit FundsWithdrawn with the owner's share", async function () {
      const { vault, owner, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await time.increaseTo(deadline + 1);
      const fee = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds())
        .to.emit(vault, "FundsWithdrawn")
        .withArgs(owner.address, MIN_FUNDING - fee);
    });

    it("should include funds from several contributors", async function () {
      const { vault, owner, developer, alice, bob, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: 6n * ONE_ETH });
      await vault.connect(bob).purchaseTokens({ value: 4n * ONE_ETH });
      await time.increaseTo(deadline + 1);
      const fee = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds()).to.changeEtherBalances([owner, developer], [MIN_FUNDING - fee, fee]);
    });

    it("should fail when the minimum funding amount was not reached", async function () {
      const { vault, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING - 1n });
      await time.increaseTo(deadline + 1);

      await expect(vault.withdrawFunds()).to.be.revertedWithCustomError(vault, "MinFundingAmountNotReached");
    });

    it("should fail when a non-owner tries to withdraw funds", async function () {
      const { vault, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).withdrawFunds()).to.be.revertedWithCustomError(vault, "OwnerOnly");
    });

    it("should allow withdrawal before the deadline once the minimum is reached (current behavior)", async function () {
      const { vault, owner, alice } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      const fee = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds()).to.changeEtherBalance(owner, MIN_FUNDING - fee);
    });
  });

  describe("redeem", function () {
    it("should exchange vouchers for PFT after a successful campaign", async function () {
      const { vault, pft, alice, bob, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: 6n * ONE_ETH });
      await vault.connect(bob).purchaseTokens({ value: 4n * ONE_ETH });
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).redeem()).to.changeTokenBalance(pft, alice, 6n * ONE_ETH * EXCHANGE_RATE);
      await expect(vault.connect(bob).redeem()).to.changeTokenBalance(pft, bob, 4n * ONE_ETH * EXCHANGE_RATE);

      expect(await vault.totalSupply()).to.equal(0n);
    });

    it("should burn the redeemed vouchers", async function () {
      const { vault, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await time.increaseTo(deadline + 1);

      await vault.connect(alice).redeem();

      expect(await vault.balanceOf(alice.address)).to.equal(0n);
    });

    it("should pay nothing a second time", async function () {
      const { vault, pft, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await time.increaseTo(deadline + 1);
      await vault.connect(alice).redeem();

      await expect(vault.connect(alice).redeem()).to.changeTokenBalance(pft, alice, 0n);
    });

    it("should fail when the deadline has not passed", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });

      await expect(vault.connect(alice).redeem()).to.be.revertedWithCustomError(vault, "DeadlineNotPassed");
    });

    it("should let a contributor redeem PFT even though the campaign failed (known issue)", async function () {
      const { vault, pft, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).redeem()).to.changeTokenBalance(pft, alice, ONE_ETH * EXCHANGE_RATE);

      // The refund right is burned with the vouchers and the ETH stays in the vault.
      await expect(vault.connect(alice).refundTokens()).to.changeEtherBalance(alice, 0n);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(ONE_ETH);
    });
  });

  describe("addTokens", function () {
    it("should let the owner add more PFT to the vault", async function () {
      const { vault, pft, owner } = await loadFixture(deployNativeVaultFixture);
      const extra = ethers.parseEther("100");
      await pft.approve(await vault.getAddress(), extra);

      await expect(vault.addTokens(extra)).to.changeTokenBalances(pft, [owner, vault], [-extra, extra]);
    });

    it("should let more vouchers be sold after adding PFT", async function () {
      const { vault, pft, alice } = await loadFixture(deployNativeVaultFixture);
      const extra = ethers.parseEther("100");
      await pft.approve(await vault.getAddress(), extra);
      await vault.addTokens(extra);

      await vault.connect(alice).purchaseTokens({ value: MAX_FUNDING + extra / EXCHANGE_RATE });

      expect(await vault.totalSupply()).to.equal(PFT_AMOUNT + extra);
    });

    it("should fail when non-owner tries to add tokens", async function () {
      const { vault, pft, alice } = await loadFixture(deployNativeVaultFixture);
      await pft.transfer(alice.address, 1n);
      await pft.connect(alice).approve(await vault.getAddress(), 1n);

      await expect(vault.connect(alice).addTokens(1n)).to.be.revertedWithCustomError(vault, "OwnerOnly");
    });

    it("should fail when the owner has not approved the vault", async function () {
      const { vault, pft } = await loadFixture(deployNativeVaultFixture);

      await expect(vault.addTokens(1n)).to.be.revertedWithCustomError(pft, "ERC20InsufficientAllowance");
    });
  });

  describe("withdrawUnsoldTokens", function () {
    it("should let the owner withdraw all unsold PFT", async function () {
      const { vault, pft, owner, alice } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      const unsold = PFT_AMOUNT - ONE_ETH * EXCHANGE_RATE;

      await expect(vault.withdrawUnsoldTokens(unsold)).to.changeTokenBalances(pft, [vault, owner], [-unsold, unsold]);
    });

    it("should fail when asking for more than the unsold PFT", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      const unsold = PFT_AMOUNT - ONE_ETH * EXCHANGE_RATE;

      await expect(vault.withdrawUnsoldTokens(unsold + 1n)).to.be.revertedWithCustomError(vault, "NotEnoughTokens");
    });

    it("should fail when non-owner tries to withdraw unsold tokens", async function () {
      const { vault, alice } = await loadFixture(deployNativeVaultFixture);

      await expect(vault.connect(alice).withdrawUnsoldTokens(1n)).to.be.revertedWithCustomError(vault, "OwnerOnly");
    });

    it("should keep vouchers redeemable after the owner withdraws the unsold PFT", async function () {
      const { vault, pft, alice, deadline } = await loadFixture(deployNativeVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
      await vault.withdrawUnsoldTokens(PFT_AMOUNT - MIN_FUNDING * EXCHANGE_RATE);
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).redeem()).to.changeTokenBalance(pft, alice, MIN_FUNDING * EXCHANGE_RATE);
      expect(await pft.balanceOf(await vault.getAddress())).to.equal(0n);
    });
  });

  describe("decimals handling", function () {
    it("should not be able to price below one PFT base unit per wei", async function () {
      const { factory, owner, developer, alice } = await loadFixture(deployNativeVaultFixture);
      const sixDecimalPft = await (await ethers.getContractFactory("MockERC20")).deploy("Six PFT", "SPFT", 6);
      const sixDecimalAmount = 1000n * 10n ** 6n;
      await sixDecimalPft.mint(owner.address, sixDecimalAmount);
      await sixDecimalPft.approve(await factory.getAddress(), sixDecimalAmount);
      await factory.deployFundingVault(
        await buildConfig(
          {
            proofOfFundingToken: await sixDecimalPft.getAddress(),
            withdrawalAddress: owner.address,
            developerFeeAddress: developer.address,
          },
          { proofOfFundingTokenAmount: sixDecimalAmount, exchangeRate: 1n },
        ),
      );
      const vault = await ethers.getContractAt("FundingVault", (await factory.vaults(2)).vaultAddress);

      // 1 ETH at rate 1 would need 1e18 PFT base units, far more than 1000 * 10^6.
      await expect(vault.connect(alice).purchaseTokens({ value: ONE_ETH })).to.be.revertedWithCustomError(
        vault,
        "NotEnoughTokens",
      );
      await vault.connect(alice).purchaseTokens({ value: sixDecimalAmount });
      expect(await vault.balanceOf(alice.address)).to.equal(sixDecimalAmount);
    });
  });
});
