import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import {
  MIN_FUNDING,
  DEVELOPER_FEE_PERCENTAGE,
  buildConfig,
  deployFactoryFixture,
  deployVaultFundedIn,
  deployVaultViaFactory,
  deployRejectingDeveloperVaultFixture,
  deployRejectingOwnerVaultFixture,
} from "./fixtures";

// The owner's share goes to the address passed to withdrawFunds and a failure there reverts the whole call, so an
// owner that cannot receive the payout itself can send it somewhere else. The developer fee is different: the owner
// has no control over the developer address, so a failed developer-fee transfer must not block the owner. It is
// parked under the address that was owed it, and anyone can retry it, but it only ever goes to that address.
describe("withdrawFunds when a recipient rejects the payout", function () {
  const ONE_ETH = ethers.parseEther("1");
  const FEE = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;
  const OWNER_SHARE = MIN_FUNDING - FEE;

  async function deployZeroFeeRejectingDeveloperFixture() {
    const base = await deployFactoryFixture();
    const { factory, pft, owner } = base;
    const rejecter = await (await ethers.getContractFactory("RejectingReceiver")).deploy();
    await rejecter.waitForDeployment();
    const config = await buildConfig(
      {
        proofOfFundingToken: await pft.getAddress(),
        withdrawalAddress: owner.address,
        developerFeeAddress: await rejecter.getAddress(),
      },
      { developerFeePercentage: 0n },
    );
    const vault = await ethers.getContractAt("FundingVault", await deployVaultViaFactory(factory, owner, pft, config));
    return { ...base, rejecter, vault };
  }

  describe("native ETH vault: developer fee", function () {
    async function fundedVault() {
      const fixture = await loadFixture(deployRejectingDeveloperVaultFixture);
      await fixture.vault.connect(fixture.alice).purchaseTokens({ value: MIN_FUNDING });
      return fixture;
    }

    it("should not revert, and should pay the owner, when the developer address rejects ETH", async function () {
      const { vault, owner } = await fundedVault();

      await expect(vault.withdrawFunds(owner.address)).to.changeEtherBalance(owner, OWNER_SHARE);
    });

    it("should park the fee under the developer address and emit DeveloperFeeFailed", async function () {
      const { vault, rejecter, owner } = await fundedVault();

      await expect(vault.withdrawFunds(owner.address))
        .to.emit(vault, "DeveloperFeeFailed")
        .withArgs(await rejecter.getAddress(), FEE);

      expect(await vault.getPendingDeveloperFee(await rejecter.getAddress())).to.equal(FEE);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(FEE);
    });

    it("should still emit FundsWithdrawn for the owner's share", async function () {
      const { vault, owner } = await fundedVault();

      await expect(vault.withdrawFunds(owner.address))
        .to.emit(vault, "FundsWithdrawn")
        .withArgs(owner.address, OWNER_SHARE);
    });

    it("should let the recipient receive the fee through retryDeveloperFee once it accepts ETH again", async function () {
      const { vault, rejecter, owner } = await fundedVault();
      await vault.withdrawFunds(owner.address);
      await rejecter.setAccepting(true);
      const retry = vault.interface.encodeFunctionData("retryDeveloperFee", [await rejecter.getAddress()]);

      await expect(rejecter.execute(await vault.getAddress(), retry))
        .to.emit(vault, "DeveloperFeeRetried")
        .withArgs(await rejecter.getAddress(), FEE);

      expect(await vault.getPendingDeveloperFee(await rejecter.getAddress())).to.equal(0n);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
      expect(await ethers.provider.getBalance(await rejecter.getAddress())).to.equal(FEE);
    });

    it("should let anyone retry, and still pay only the recorded recipient and never the caller", async function () {
      const { vault, rejecter, owner, stranger } = await fundedVault();
      await vault.withdrawFunds(owner.address);
      await rejecter.setAccepting(true);

      await expect(vault.connect(stranger).retryDeveloperFee(await rejecter.getAddress())).to.changeEtherBalances(
        [rejecter, stranger, vault],
        [FEE, 0n, -FEE],
      );
    });

    it("should revert with NoPendingDeveloperFee when nothing is pending", async function () {
      const { vault, rejecter } = await fundedVault();

      await expect(vault.retryDeveloperFee(await rejecter.getAddress())).to.be.revertedWithCustomError(
        vault,
        "NoPendingDeveloperFee",
      );
    });

    it("should revert with NoPendingDeveloperFee for an address that was not the recorded recipient", async function () {
      const { vault, rejecter, owner, stranger } = await fundedVault();
      await vault.withdrawFunds(owner.address);
      await rejecter.setAccepting(true);

      await expect(vault.retryDeveloperFee(stranger.address)).to.be.revertedWithCustomError(
        vault,
        "NoPendingDeveloperFee",
      );
      expect(await vault.getPendingDeveloperFee(await rejecter.getAddress())).to.equal(FEE);
    });

    it("should revert with NoPendingDeveloperFee when the fee was already retried", async function () {
      const { vault, rejecter, owner } = await fundedVault();
      await vault.withdrawFunds(owner.address);
      await rejecter.setAccepting(true);
      await vault.retryDeveloperFee(await rejecter.getAddress());

      await expect(vault.retryDeveloperFee(await rejecter.getAddress())).to.be.revertedWithCustomError(
        vault,
        "NoPendingDeveloperFee",
      );
    });

    it("should revert with EthTransferFailed, and keep the fee pending, while the recipient still rejects ETH", async function () {
      const { vault, rejecter, owner } = await fundedVault();
      await vault.withdrawFunds(owner.address);

      await expect(vault.retryDeveloperFee(await rejecter.getAddress())).to.be.revertedWithCustomError(
        vault,
        "EthTransferFailed",
      );

      expect(await vault.getPendingDeveloperFee(await rejecter.getAddress())).to.equal(FEE);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(FEE);
    });

    it("should not pay the parked fee out again, or take a fee on it, in the next withdrawal", async function () {
      const { vault, rejecter, owner, alice } = await fundedVault();
      await vault.withdrawFunds(owner.address);
      await vault.connect(alice).purchaseTokens({ value: 2n * ONE_ETH });
      const secondFee = (2n * ONE_ETH * DEVELOPER_FEE_PERCENTAGE) / 100n;

      await expect(vault.withdrawFunds(owner.address)).to.changeEtherBalance(owner, 2n * ONE_ETH - secondFee);

      // The vault still holds exactly what it owes the developer: the first fee plus the second.
      expect(await vault.getPendingDeveloperFee(await rejecter.getAddress())).to.equal(FEE + secondFee);
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(FEE + secondFee);

      await rejecter.setAccepting(true);
      await expect(vault.retryDeveloperFee(await rejecter.getAddress())).to.changeEtherBalance(
        rejecter,
        FEE + secondFee,
      );
      expect(await ethers.provider.getBalance(await vault.getAddress())).to.equal(0n);
    });

    it("should not attempt the transfer, or park anything, when the developer fee is zero", async function () {
      const { vault, rejecter, owner, alice } = await loadFixture(deployZeroFeeRejectingDeveloperFixture);
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });

      const tx = await vault.withdrawFunds(owner.address);

      await expect(tx).to.changeEtherBalance(owner, MIN_FUNDING);
      await expect(tx).to.not.emit(vault, "DeveloperFeeFailed");
      expect(await vault.getPendingDeveloperFee(await rejecter.getAddress())).to.equal(0n);
    });

    it("should still allow refunds of a failed campaign when the developer address rejects ETH", async function () {
      const { vault, alice, deadline } = await loadFixture(deployRejectingDeveloperVaultFixture);
      await vault.connect(alice).purchaseTokens({ value: ONE_ETH });
      await time.increaseTo(deadline + 1);

      await expect(vault.connect(alice).refundTokens()).to.changeEtherBalance(alice, ONE_ETH);
    });
  });

  describe("native ETH vault: the owner's share is unchanged", function () {
    it("should still revert, and not pay or park the developer fee, when the given recipient rejects ETH", async function () {
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
      expect(await vault.getPendingDeveloperFee(developer.address)).to.equal(0n);
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
  });

  // The same behaviour for the ERC20 vault, against three ways a token can refuse a transfer or report success:
  //  - one that reverts for a blocked recipient (like a blacklisting stablecoin),
  //  - one that returns false for a blocked recipient (older tokens),
  //  - one that returns nothing at all on success (USDT-style), which must be treated as a success.
  const tokenKinds = [
    { label: "a token that reverts", contract: "MockBlacklistERC20" },
    { label: "a token that returns false", contract: "MockReturnFalseERC20" },
    { label: "a token that returns nothing", contract: "MockNoReturnERC20" },
  ] as const;

  for (const { label, contract } of tokenKinds) {
    describe(`ERC20 vault: developer fee with ${label}`, function () {
      const deployVault = () => deployVaultFundedIn(contract);
      const deployZeroFeeVault = () => deployVaultFundedIn(contract, { developerFeePercentage: 0n });

      async function fundedVault(fixture: typeof deployVault = deployVault) {
        const loaded = await loadFixture(fixture);
        const { vault, token, alice } = loaded;
        await token.connect(alice).approve(await vault.getAddress(), MIN_FUNDING + 2n * ONE_ETH);
        await vault.connect(alice).purchaseTokens(MIN_FUNDING);
        return loaded;
      }

      it("should pay the developer directly, with nothing parked, when the transfer succeeds", async function () {
        const { vault, token, owner, developer } = await fundedVault();

        await expect(vault.withdrawFunds(owner.address)).to.not.emit(vault, "DeveloperFeeFailed");

        expect(await token.balanceOf(developer.address)).to.equal(FEE);
        expect(await vault.getPendingDeveloperFee(developer.address)).to.equal(0n);
      });

      it("should not revert, and should pay the owner, when the developer cannot receive the token", async function () {
        const { vault, token, owner, developer } = await fundedVault();
        await token.setBlocked(developer.address, true);

        await vault.withdrawFunds(owner.address);

        expect(await token.balanceOf(owner.address)).to.equal(OWNER_SHARE);
      });

      it("should park the fee under the developer address and emit DeveloperFeeFailed", async function () {
        const { vault, token, owner, developer } = await fundedVault();
        await token.setBlocked(developer.address, true);

        await expect(vault.withdrawFunds(owner.address))
          .to.emit(vault, "DeveloperFeeFailed")
          .withArgs(developer.address, FEE);

        expect(await vault.getPendingDeveloperFee(developer.address)).to.equal(FEE);
        expect(await token.balanceOf(developer.address)).to.equal(0n);
        expect(await token.balanceOf(await vault.getAddress())).to.equal(FEE);
      });

      it("should let the recipient receive the fee through retryDeveloperFee once the token allows it", async function () {
        const { vault, token, owner, developer } = await fundedVault();
        await token.setBlocked(developer.address, true);
        await vault.withdrawFunds(owner.address);
        await token.setBlocked(developer.address, false);

        await expect(vault.connect(developer).retryDeveloperFee(developer.address))
          .to.emit(vault, "DeveloperFeeRetried")
          .withArgs(developer.address, FEE);

        expect(await token.balanceOf(developer.address)).to.equal(FEE);
        expect(await vault.getPendingDeveloperFee(developer.address)).to.equal(0n);
        expect(await token.balanceOf(await vault.getAddress())).to.equal(0n);
      });

      it("should let anyone retry, and still pay only the recorded recipient and never the caller", async function () {
        const { vault, token, owner, developer, stranger } = await fundedVault();
        await token.setBlocked(developer.address, true);
        await vault.withdrawFunds(owner.address);
        await token.setBlocked(developer.address, false);

        await vault.connect(stranger).retryDeveloperFee(developer.address);

        expect(await token.balanceOf(developer.address)).to.equal(FEE);
        expect(await token.balanceOf(stranger.address)).to.equal(0n);
      });

      it("should revert with NoPendingDeveloperFee when nothing is pending", async function () {
        const { vault, developer } = await fundedVault();

        await expect(vault.retryDeveloperFee(developer.address)).to.be.revertedWithCustomError(
          vault,
          "NoPendingDeveloperFee",
        );
      });

      it("should revert with NoPendingDeveloperFee for an address that was not the recorded recipient", async function () {
        const { vault, token, owner, developer, stranger } = await fundedVault();
        await token.setBlocked(developer.address, true);
        await vault.withdrawFunds(owner.address);

        await expect(vault.retryDeveloperFee(stranger.address)).to.be.revertedWithCustomError(
          vault,
          "NoPendingDeveloperFee",
        );
        expect(await vault.getPendingDeveloperFee(developer.address)).to.equal(FEE);
      });

      it("should revert, and keep the fee pending, while the token still blocks the developer", async function () {
        const { vault, token, owner, developer } = await fundedVault();
        await token.setBlocked(developer.address, true);
        await vault.withdrawFunds(owner.address);

        await expect(vault.retryDeveloperFee(developer.address)).to.be.reverted;

        expect(await vault.getPendingDeveloperFee(developer.address)).to.equal(FEE);
        expect(await token.balanceOf(await vault.getAddress())).to.equal(FEE);
      });

      it("should not pay the parked fee out again, or take a fee on it, in the next withdrawal", async function () {
        const { vault, token, owner, developer, alice } = await fundedVault();
        await token.setBlocked(developer.address, true);
        await vault.withdrawFunds(owner.address);
        await vault.connect(alice).purchaseTokens(2n * ONE_ETH);
        const secondFee = (2n * ONE_ETH * DEVELOPER_FEE_PERCENTAGE) / 100n;

        await vault.withdrawFunds(owner.address);

        expect(await token.balanceOf(owner.address)).to.equal(OWNER_SHARE + 2n * ONE_ETH - secondFee);
        expect(await vault.getPendingDeveloperFee(developer.address)).to.equal(FEE + secondFee);
        expect(await token.balanceOf(await vault.getAddress())).to.equal(FEE + secondFee);

        await token.setBlocked(developer.address, false);
        await vault.retryDeveloperFee(developer.address);
        expect(await token.balanceOf(developer.address)).to.equal(FEE + secondFee);
        expect(await token.balanceOf(await vault.getAddress())).to.equal(0n);
      });

      it("should not attempt the transfer, or park anything, when the developer fee is zero", async function () {
        const { vault, token, owner, developer } = await fundedVault(deployZeroFeeVault);
        await token.setBlocked(developer.address, true);

        await expect(vault.withdrawFunds(owner.address)).to.not.emit(vault, "DeveloperFeeFailed");

        expect(await token.balanceOf(owner.address)).to.equal(MIN_FUNDING);
        expect(await vault.getPendingDeveloperFee(developer.address)).to.equal(0n);
      });

      it("should still revert, and not pay or park the developer fee, when the given recipient is blocked", async function () {
        const { vault, token, developer, stranger } = await fundedVault();
        await token.setBlocked(stranger.address, true);

        await expect(vault.withdrawFunds(stranger.address)).to.be.reverted;

        expect(await token.balanceOf(developer.address)).to.equal(0n);
        expect(await token.balanceOf(await vault.getAddress())).to.equal(MIN_FUNDING);
        expect(await vault.getPendingDeveloperFee(developer.address)).to.equal(0n);
      });

      it("should let a blocked owner send its share to another address", async function () {
        const { vault, token, owner, developer, stranger } = await fundedVault();
        await token.setBlocked(owner.address, true);

        await vault.withdrawFunds(stranger.address);

        expect(await token.balanceOf(stranger.address)).to.equal(OWNER_SHARE);
        expect(await token.balanceOf(developer.address)).to.equal(FEE);
      });
    });
  }
});
