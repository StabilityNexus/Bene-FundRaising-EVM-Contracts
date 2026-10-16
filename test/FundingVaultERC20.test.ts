import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  PFT_AMOUNT,
  MIN_FUNDING,
  EXCHANGE_RATE,
  MAX_FUNDING,
  DEVELOPER_FEE_PERCENTAGE,
  deployERC20VaultFixture,
  deploySixDecimalFundingVaultFixture,
  deployFeeOnTransferFundingVaultFixture,
  deployHookFundingVaultFixture,
} from "./fixtures";

describe("FundingVaultERC20 (ERC20 funding)", function () {
  const ONE_TOKEN = ethers.parseEther("1");

  async function contribute(
    vault: Awaited<ReturnType<typeof deployERC20VaultFixture>>["vault"],
    token: { connect: (signer: any) => any },
    buyer: any,
    amount: bigint,
  ) {
    await token.connect(buyer).approve(await vault.getAddress(), amount);
    await vault.connect(buyer).purchaseTokens(amount);
  }

  describe("creation via the factory", function () {
    it("should be registered in the factory as an ERC20 vault", async function () {
      const { factory, vault } = await loadFixture(deployERC20VaultFixture);

      const entry = await factory.vaults(1);

      expect(entry.vaultAddress).to.equal(await vault.getAddress());
      expect(entry.isERC20).to.equal(true);
    });

    it("should expose the funding token and configured parameters through getVault", async function () {
      const { vault, pft, fundingToken, owner, config } = await loadFixture(deployERC20VaultFixture);

      const details = await vault.getVault();

      expect(details.withdrawalAddress).to.equal(owner.address);
      expect(details.proofOfFundingToken).to.equal(await pft.getAddress());
      expect(details.fundingToken).to.equal(await fundingToken.getAddress());
      expect(details.proofOfFundingTokenAmount).to.equal(PFT_AMOUNT);
      expect(details.minFundingAmount).to.equal(MIN_FUNDING);
      expect(details.timestamp).to.equal(config.timestamp);
      expect(details.exchangeRate).to.equal(EXCHANGE_RATE);
    });

    it("should hold the PFT deposited by the factory", async function () {
      const { vault, pft } = await loadFixture(deployERC20VaultFixture);

      expect(await pft.balanceOf(await vault.getAddress())).to.equal(PFT_AMOUNT);
    });
  });

  describe("purchaseTokens", function () {
    it("should pull the funding tokens and mint vouchers at the exchange rate", async function () {
      const { vault, fundingToken, alice } = await loadFixture(deployERC20VaultFixture);
      await fundingToken.connect(alice).approve(await vault.getAddress(), ONE_TOKEN);

      await expect(vault.connect(alice).purchaseTokens(ONE_TOKEN)).to.changeTokenBalances(
        fundingToken,
        [alice, vault],
        [-ONE_TOKEN, ONE_TOKEN],
      );

      expect(await vault.balanceOf(alice.address)).to.equal(ONE_TOKEN * EXCHANGE_RATE);
    });

    it("should emit TokensPurchased with the voucher amount", async function () {
      const { vault, fundingToken, alice } = await loadFixture(deployERC20VaultFixture);
      await fundingToken.connect(alice).approve(await vault.getAddress(), ONE_TOKEN);

      await expect(vault.connect(alice).purchaseTokens(ONE_TOKEN))
        .to.emit(vault, "TokensPurchased")
        .withArgs(alice.address, ONE_TOKEN * EXCHANGE_RATE);
    });

    it("should accumulate vouchers across several contributors", async function () {
      const { vault, fundingToken, alice, bob } = await loadFixture(deployERC20VaultFixture);

      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      await contribute(vault, fundingToken, bob, 2n * ONE_TOKEN);

      expect(await vault.balanceOf(alice.address)).to.equal(ONE_TOKEN * EXCHANGE_RATE);
      expect(await vault.balanceOf(bob.address)).to.equal(2n * ONE_TOKEN * EXCHANGE_RATE);
      expect(await vault.totalSupply()).to.equal(3n * ONE_TOKEN * EXCHANGE_RATE);
    });

    it("should not accept native ETH", async function () {
      const { vault, alice } = await loadFixture(deployERC20VaultFixture);

      await expect(alice.sendTransaction({ to: await vault.getAddress(), value: ONE_TOKEN })).to.be.reverted;
    });

    it("should fail when the contributor has not approved the vault", async function () {
      const { vault, fundingToken, alice } = await loadFixture(deployERC20VaultFixture);

      await expect(vault.connect(alice).purchaseTokens(ONE_TOKEN)).to.be.revertedWithCustomError(
        fundingToken,
        "ERC20InsufficientAllowance",
      );
    });

    it("should fail when the contributor does not hold enough funding tokens", async function () {
      const { vault, fundingToken, stranger } = await loadFixture(deployERC20VaultFixture);
      await fundingToken.connect(stranger).approve(await vault.getAddress(), ONE_TOKEN);

      await expect(vault.connect(stranger).purchaseTokens(ONE_TOKEN)).to.be.revertedWithCustomError(
        fundingToken,
        "ERC20InsufficientBalance",
      );
    });

    it("should fail when the purchase would mint more vouchers than the vault holds PFT", async function () {
      const { vault, fundingToken, alice } = await loadFixture(deployERC20VaultFixture);
      await fundingToken.connect(alice).approve(await vault.getAddress(), MAX_FUNDING + 1n);

      await expect(vault.connect(alice).purchaseTokens(MAX_FUNDING + 1n)).to.be.revertedWithCustomError(
        vault,
        "NotEnoughTokens",
      );
    });

    it("should still accept purchases after the deadline (current behavior)", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await time.increaseTo(deadline + 1);

      await contribute(vault, fundingToken, alice, ONE_TOKEN);

      expect(await vault.balanceOf(alice.address)).to.equal(ONE_TOKEN * EXCHANGE_RATE);
    });
  });

  describe("accounting counters", function () {
    it("should start with nothing sold, nothing refunded and the minimum not reached", async function () {
      const { vault } = await loadFixture(deployERC20VaultFixture);

      expect(await vault.totalSold()).to.equal(0n);
      expect(await vault.totalRefunded()).to.equal(0n);
      expect(await vault.minimumReached()).to.equal(false);
    });

    it("should add every purchase to totalSold", async function () {
      const { vault, fundingToken, alice, bob } = await loadFixture(deployERC20VaultFixture);

      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      await contribute(vault, fundingToken, bob, 2n * ONE_TOKEN);

      expect(await vault.totalSold()).to.equal(3n * ONE_TOKEN);
    });

    it("should count refunds in totalRefunded and leave totalSold untouched", async function () {
      const { vault, fundingToken, alice, bob, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      await contribute(vault, fundingToken, bob, 3n * ONE_TOKEN);
      await time.increaseTo(deadline + 1);

      await vault.connect(bob).refundTokens();

      expect(await vault.totalSold()).to.equal(4n * ONE_TOKEN);
      expect(await vault.totalRefunded()).to.equal(3n * ONE_TOKEN);
    });

    it("should report the minimum reached exactly when sold minus refunded reaches it", async function () {
      const { vault, fundingToken, alice } = await loadFixture(deployERC20VaultFixture);

      await contribute(vault, fundingToken, alice, MIN_FUNDING - 1n);
      expect(await vault.minimumReached()).to.equal(false);

      await contribute(vault, fundingToken, alice, 1n);
      expect(await vault.minimumReached()).to.equal(true);
    });
  });

  describe("refundTokens", function () {
    it("should refund the contribution when the campaign failed", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.changeTokenBalances(
        fundingToken,
        [alice, vault],
        [ONE_TOKEN, -ONE_TOKEN],
      );

      expect(await vault.balanceOf(alice.address)).to.equal(0n);
    });

    it("should emit Refund with the refunded amount", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.emit(vault, "Refund").withArgs(alice.address, ONE_TOKEN);
    });

    it("should fail when the deadline has not passed", async function () {
      const { vault, fundingToken, alice } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);

      await expect(vault.connect(alice).refundTokens()).to.be.revertedWithCustomError(vault, "DeadlineNotPassed");
    });

    it("should fail when refunding exactly at the deadline", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      await time.setNextBlockTimestamp(deadline);

      await expect(vault.connect(alice).refundTokens()).to.be.revertedWithCustomError(vault, "DeadlineNotPassed");
    });

    it("should allow refunding one second after the deadline", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      await time.setNextBlockTimestamp(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.emit(vault, "Refund");
    });

    it("should fail when the minimum funding amount was reached", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING);
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.be.revertedWithCustomError(vault, "MinFundingAmountReached");
    });
  });

  describe("withdrawFunds", function () {
    it("should pay the owner the funding tokens minus the developer fee", async function () {
      const { vault, fundingToken, owner, developer, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING);
      await time.increaseTo(deadline + 1);
      const fee = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds()).to.changeTokenBalances(
        fundingToken,
        [owner, developer, vault],
        [MIN_FUNDING - fee, fee, -MIN_FUNDING],
      );
    });

    it("should emit FundsWithdrawn with the owner's share", async function () {
      const { vault, fundingToken, owner, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING);
      await time.increaseTo(deadline + 1);
      const fee = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds())
        .to.emit(vault, "FundsWithdrawn")
        .withArgs(owner.address, MIN_FUNDING - fee);
    });

    it("should fail when the minimum funding amount was not reached", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING - 1n);
      await time.increaseTo(deadline + 1);

      await expect(vault.withdrawFunds()).to.be.revertedWithCustomError(vault, "MinFundingAmountNotReached");
    });

    it("should fail when a non-owner tries to withdraw funds", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING);
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).withdrawFunds()).to.be.revertedWithCustomError(vault, "OwnerOnly");
    });

    it("should be callable again after more contributions arrive following a full withdrawal", async function () {
      const { vault, fundingToken, owner, developer, alice, bob } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING);
      await vault.withdrawFunds();
      expect(await fundingToken.balanceOf(await vault.getAddress())).to.equal(0n);

      await contribute(vault, fundingToken, bob, 2n * ONE_TOKEN);
      const fee = (2n * ONE_TOKEN * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds()).to.changeTokenBalances(
        fundingToken,
        [owner, developer, vault],
        [2n * ONE_TOKEN - fee, fee, -2n * ONE_TOKEN],
      );
    });

    it("should pay nothing and not fail when called again with no new funds", async function () {
      const { vault, fundingToken, owner, alice } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING);
      await vault.withdrawFunds();

      await expect(vault.withdrawFunds()).to.changeTokenBalance(fundingToken, owner, 0n);
    });

    it("should allow withdrawal before the deadline once the minimum is reached (current behavior)", async function () {
      const { vault, fundingToken, owner, alice } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING);
      const fee = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds()).to.changeTokenBalance(fundingToken, owner, MIN_FUNDING - fee);
    });
  });

  describe("redeem", function () {
    it("should exchange vouchers for PFT after a successful campaign", async function () {
      const { vault, fundingToken, pft, alice, bob, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, 6n * ONE_TOKEN);
      await contribute(vault, fundingToken, bob, 4n * ONE_TOKEN);
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).redeem()).to.changeTokenBalance(pft, alice, 6n * ONE_TOKEN * EXCHANGE_RATE);
      await expect(vault.connect(bob).redeem()).to.changeTokenBalance(pft, bob, 4n * ONE_TOKEN * EXCHANGE_RATE);

      expect(await vault.totalSupply()).to.equal(0n);
    });

    it("should let contributors redeem as soon as the minimum is reached, before the deadline", async function () {
      const { vault, fundingToken, pft, alice } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING);

      await expect(vault.connect(alice).redeem()).to.changeTokenBalance(pft, alice, MIN_FUNDING * EXCHANGE_RATE);
    });

    it("should fail when the minimum funding amount was not reached, before the deadline", async function () {
      const { vault, fundingToken, alice } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, MIN_FUNDING - 1n);

      await expect(vault.connect(alice).redeem()).to.be.revertedWithCustomError(vault, "MinFundingAmountNotReached");
    });

    it("should fail when the minimum funding amount was not reached, even after the deadline", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).redeem()).to.be.revertedWithCustomError(vault, "MinFundingAmountNotReached");
    });

    it("should keep the refund available to a contributor who could not redeem a failed campaign", async function () {
      const { vault, fundingToken, alice, deadline } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      await time.increaseTo(deadline + 1);
      await expect(vault.connect(alice).redeem()).to.be.reverted;

      await expect(vault.connect(alice).refundTokens()).to.changeTokenBalance(fundingToken, alice, ONE_TOKEN);
    });
  });

  describe("addTokens and withdrawUnsoldTokens", function () {
    it("should let the owner add more PFT to the vault", async function () {
      const { vault, pft, owner } = await loadFixture(deployERC20VaultFixture);
      const extra = ethers.parseEther("100");
      await pft.approve(await vault.getAddress(), extra);

      await expect(vault.addTokens(extra)).to.changeTokenBalances(pft, [owner, vault], [-extra, extra]);
    });

    it("should fail when non-owner tries to add tokens", async function () {
      const { vault, pft, alice } = await loadFixture(deployERC20VaultFixture);
      await pft.transfer(alice.address, 1n);
      await pft.connect(alice).approve(await vault.getAddress(), 1n);

      await expect(vault.connect(alice).addTokens(1n)).to.be.revertedWithCustomError(vault, "OwnerOnly");
    });

    it("should let the owner withdraw the unsold PFT", async function () {
      const { vault, fundingToken, pft, owner, alice } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      const unsold = PFT_AMOUNT - ONE_TOKEN * EXCHANGE_RATE;

      await expect(vault.withdrawUnsoldTokens(unsold)).to.changeTokenBalances(pft, [vault, owner], [-unsold, unsold]);
    });

    it("should fail when asking for more than the unsold PFT", async function () {
      const { vault, fundingToken, alice } = await loadFixture(deployERC20VaultFixture);
      await contribute(vault, fundingToken, alice, ONE_TOKEN);
      const unsold = PFT_AMOUNT - ONE_TOKEN * EXCHANGE_RATE;

      await expect(vault.withdrawUnsoldTokens(unsold + 1n)).to.be.revertedWithCustomError(vault, "NotEnoughTokens");
    });

    it("should fail when non-owner tries to withdraw unsold tokens", async function () {
      const { vault, alice } = await loadFixture(deployERC20VaultFixture);

      await expect(vault.connect(alice).withdrawUnsoldTokens(1n)).to.be.revertedWithCustomError(vault, "OwnerOnly");
    });
  });

  describe("with a 6-decimal funding token", function () {
    const USDC = 10n ** 6n;

    it("should mint vouchers as funding base units times the exchange rate", async function () {
      const { vault, usdc, alice } = await loadFixture(deploySixDecimalFundingVaultFixture);

      await contribute(vault, usdc, alice, 5n * USDC);

      expect(await vault.balanceOf(alice.address)).to.equal(5n * USDC * EXCHANGE_RATE);
    });

    it("should refund the exact contribution when the campaign failed", async function () {
      const { vault, usdc, alice, deadline } = await loadFixture(deploySixDecimalFundingVaultFixture);
      await contribute(vault, usdc, alice, 5n * USDC);
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.changeTokenBalance(usdc, alice, 5n * USDC);
    });

    it("should split the funds with the developer after the minimum is reached", async function () {
      const { vault, usdc, owner, developer, alice, deadline } = await loadFixture(deploySixDecimalFundingVaultFixture);
      await contribute(vault, usdc, alice, 10n * USDC);
      await time.increaseTo(deadline + 1);
      const fee = (10n * USDC * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds()).to.changeTokenBalances(usdc, [owner, developer], [10n * USDC - fee, fee]);
    });

    it("should keep 18 decimals on the voucher regardless of the funding token (current behavior)", async function () {
      const { vault } = await loadFixture(deploySixDecimalFundingVaultFixture);

      expect(await vault.decimals()).to.equal(18n);
    });
  });

  describe("with a fee-on-transfer funding token", function () {
    it("should credit only the amount the vault actually received", async function () {
      const { vault, feeToken, alice } = await loadFixture(deployFeeOnTransferFundingVaultFixture);
      const amount = ethers.parseEther("100");
      const received = (amount * 99n) / 100n;
      await feeToken.connect(alice).approve(await vault.getAddress(), amount);

      await vault.connect(alice).purchaseTokens(amount);

      expect(await feeToken.balanceOf(await vault.getAddress())).to.equal(received);
      expect(await vault.balanceOf(alice.address)).to.equal(received * EXCHANGE_RATE);
      expect(await vault.totalSold()).to.equal(received);
    });

    it("should emit TokensPurchased with the vouchers minted for the received amount", async function () {
      const { vault, feeToken, alice } = await loadFixture(deployFeeOnTransferFundingVaultFixture);
      const amount = ethers.parseEther("100");
      const received = (amount * 99n) / 100n;
      await feeToken.connect(alice).approve(await vault.getAddress(), amount);

      await expect(vault.connect(alice).purchaseTokens(amount))
        .to.emit(vault, "TokensPurchased")
        .withArgs(alice.address, received * EXCHANGE_RATE);
    });

    it("should be able to refund every contributor of a failed campaign in full", async function () {
      const { vault, feeToken, alice, bob, deadline } = await loadFixture(deployFeeOnTransferFundingVaultFixture);
      const amount = 4n * ONE_TOKEN;
      for (const buyer of [alice, bob]) {
        await feeToken.connect(buyer).approve(await vault.getAddress(), amount);
        await vault.connect(buyer).purchaseTokens(amount);
      }
      await time.increaseTo(deadline + 1);

      await vault.connect(alice).refundTokens();
      await expect(vault.connect(bob).refundTokens()).to.not.be.reverted;

      expect(await feeToken.balanceOf(await vault.getAddress())).to.equal(0n);
      expect(await vault.totalSupply()).to.equal(0n);
    });

    it("should not reach the minimum on funding the vault never received", async function () {
      const { vault, feeToken, alice } = await loadFixture(deployFeeOnTransferFundingVaultFixture);
      const amount = MIN_FUNDING; // nominally enough, but 1% is lost in transfer
      await feeToken.connect(alice).approve(await vault.getAddress(), amount);

      await vault.connect(alice).purchaseTokens(amount);

      expect(await vault.minimumReached()).to.equal(false);
    });
  });

  describe("with an ERC777-style funding token", function () {
    it("should block a hook from re-entering purchaseTokens so vouchers never exceed the PFT held", async function () {
      const { vault, pft, attacker } = await loadFixture(deployHookFundingVaultFixture);
      const amount = ethers.parseEther("60");

      // 60 funding units at rate 10 need 600 PFT; the vault holds 1000, so each call passes the capacity check alone.
      await expect(attacker.attack(amount, 1)).to.be.revertedWithCustomError(vault, "ReentrancyGuardReentrantCall");

      expect(await vault.totalSupply()).to.equal(0n);
      expect(await pft.balanceOf(await vault.getAddress())).to.equal(PFT_AMOUNT);
    });

    it("should mint normally when the hook does not re-enter", async function () {
      const { vault, attacker } = await loadFixture(deployHookFundingVaultFixture);
      const amount = ethers.parseEther("60");

      await attacker.attack(amount, 0);

      expect(await vault.balanceOf(await attacker.getAddress())).to.equal(amount * EXCHANGE_RATE);
    });
  });
});
