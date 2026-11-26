import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { MIN_FUNDING, DEVELOPER_FEE_PERCENTAGE, deployGasBurningFixture } from "./fixtures";

// The developer fee is the one transfer in withdrawFunds the owner has no control over, so the gas it may use is
// capped. A recipient (or a token's recipient hook) that burns every bit of gas it is given can then neither make
// the withdrawal cost a fortune nor run it out of gas: the fee is parked instead, like any other failed transfer.
// The cap applies only to that first attempt. retryDeveloperFee forwards all gas, so a recipient that legitimately
// needs more than the cap can still be paid later.
describe("developer fee transfer gas cap", function () {
  const GAS_CAP = 200_000n;
  // The cap plus what it costs to park the fee (two fresh storage writes and an event), with generous slack.
  const MAX_EXTRA_GAS = GAS_CAP + 100_000n;
  const BURN_EVERYTHING = ethers.MaxUint256;
  const FEE = (MIN_FUNDING * DEVELOPER_FEE_PERCENTAGE) / 100n;
  const OWNER_SHARE = MIN_FUNDING - FEE;

  async function gasUsed(tx: Promise<any>) {
    return (await (await tx).wait())!.gasUsed as bigint;
  }

  async function ethSetup() {
    const fixture = await loadFixture(deployGasBurningFixture);
    const { alice, burner, developer, deployEthVault } = fixture;
    const normal = await deployEthVault(developer.address);
    const burning = await deployEthVault(await burner.getAddress());
    for (const vault of [normal, burning]) {
      await vault.connect(alice).purchaseTokens({ value: MIN_FUNDING });
    }
    return { ...fixture, normal, burning };
  }

  async function erc20Setup() {
    const fixture = await loadFixture(deployGasBurningFixture);
    const { alice, burner, developer, hookToken, deployErc20Vault } = fixture;
    const normal = await deployErc20Vault(developer.address);
    const burning = await deployErc20Vault(await burner.getAddress());
    for (const vault of [normal, burning]) {
      await hookToken.connect(alice).approve(await vault.getAddress(), MIN_FUNDING);
      await vault.connect(alice).purchaseTokens(MIN_FUNDING);
    }
    return { ...fixture, normal, burning };
  }

  describe("native ETH vault", function () {
    it("should cost about the normal gas plus the cap, not run away, when the developer address burns all its gas", async function () {
      const { owner, burner, normal, burning } = await ethSetup();
      await burner.setGasToBurn(BURN_EVERYTHING);

      const normalGas = await gasUsed(normal.withdrawFunds(owner.address));
      const burningGas = await gasUsed(burning.withdrawFunds(owner.address));

      expect(burningGas).to.be.lt(normalGas + MAX_EXTRA_GAS);
      expect(burningGas).to.be.lt(1_000_000n);
    });

    it("should still succeed with an ordinary gas limit when the developer address burns all its gas", async function () {
      const { owner, burner, burning } = await ethSetup();
      await burner.setGasToBurn(BURN_EVERYTHING);

      await expect(burning.withdrawFunds(owner.address, { gasLimit: 500_000n })).to.not.be.reverted;
    });

    it("should park the fee and pay the owner when the developer address burns all its gas", async function () {
      const { owner, burner, burning } = await ethSetup();
      await burner.setGasToBurn(BURN_EVERYTHING);

      const tx = await burning.withdrawFunds(owner.address);

      await expect(tx)
        .to.emit(burning, "DeveloperFeeFailed")
        .withArgs(await burner.getAddress(), FEE);
      await expect(tx).to.changeEtherBalance(owner, OWNER_SHARE);
      expect(await burning.getPendingDeveloperFee(await burner.getAddress())).to.equal(FEE);
    });

    it("should pay directly a developer address that needs less gas than the cap", async function () {
      const { owner, burner, burning } = await ethSetup();
      await burner.setGasToBurn(100_000n);

      const tx = await burning.withdrawFunds(owner.address);

      await expect(tx).to.not.emit(burning, "DeveloperFeeFailed");
      await expect(tx).to.changeEtherBalance(burner, FEE);
    });

    it("should park a fee for an address that needs more gas than the cap and pay it through retryDeveloperFee", async function () {
      const { owner, burner, burning } = await ethSetup();
      await burner.setGasToBurn(300_000n);

      await expect(burning.withdrawFunds(owner.address)).to.emit(burning, "DeveloperFeeFailed");

      // The retry forwards all gas, so the same address can now be paid.
      await expect(burning.retryDeveloperFee(await burner.getAddress())).to.changeEtherBalance(burner, FEE);
      expect(await burning.getPendingDeveloperFee(await burner.getAddress())).to.equal(0n);
    });

    it("should not cap the owner's share: an owner recipient that needs more than the cap is still paid", async function () {
      const { owner, burner, normal } = await ethSetup();
      await burner.setGasToBurn(300_000n);

      await expect(normal.withdrawFunds(await burner.getAddress())).to.changeEtherBalance(burner, OWNER_SHARE);
      expect(await normal.getPendingDeveloperFee(owner.address)).to.equal(0n);
    });
  });

  describe("ERC20 vault, funded in a token that calls a recipient hook", function () {
    it("should cost about the normal gas plus the cap, not run away, when the developer's token hook burns all its gas", async function () {
      const { owner, burner, normal, burning } = await erc20Setup();
      await burner.setGasToBurn(BURN_EVERYTHING);

      const normalGas = await gasUsed(normal.withdrawFunds(owner.address));
      const burningGas = await gasUsed(burning.withdrawFunds(owner.address));

      expect(burningGas).to.be.lt(normalGas + MAX_EXTRA_GAS);
      expect(burningGas).to.be.lt(1_000_000n);
    });

    it("should still succeed with an ordinary gas limit when the developer's token hook burns all its gas", async function () {
      const { owner, burner, burning } = await erc20Setup();
      await burner.setGasToBurn(BURN_EVERYTHING);

      await expect(burning.withdrawFunds(owner.address, { gasLimit: 500_000n })).to.not.be.reverted;
    });

    it("should park the fee and pay the owner when the developer's token hook burns all its gas", async function () {
      const { owner, burner, hookToken, burning } = await erc20Setup();
      await burner.setGasToBurn(BURN_EVERYTHING);

      const tx = await burning.withdrawFunds(owner.address);

      await expect(tx)
        .to.emit(burning, "DeveloperFeeFailed")
        .withArgs(await burner.getAddress(), FEE);
      expect(await hookToken.balanceOf(owner.address)).to.equal(OWNER_SHARE);
      expect(await burning.getPendingDeveloperFee(await burner.getAddress())).to.equal(FEE);
      expect(await hookToken.balanceOf(await burning.getAddress())).to.equal(FEE);
    });

    it("should pay directly a developer whose hook needs less gas than the cap", async function () {
      const { owner, burner, hookToken, burning } = await erc20Setup();
      await burner.setGasToBurn(100_000n);

      const tx = await burning.withdrawFunds(owner.address);

      await expect(tx).to.not.emit(burning, "DeveloperFeeFailed");
      expect(await hookToken.balanceOf(await burner.getAddress())).to.equal(FEE);
    });

    it("should park a fee whose hook needs more gas than the cap and pay it through retryDeveloperFee", async function () {
      const { owner, burner, hookToken, burning } = await erc20Setup();
      await burner.setGasToBurn(300_000n);

      await expect(burning.withdrawFunds(owner.address)).to.emit(burning, "DeveloperFeeFailed");

      await burning.retryDeveloperFee(await burner.getAddress());
      expect(await hookToken.balanceOf(await burner.getAddress())).to.equal(FEE);
      expect(await burning.getPendingDeveloperFee(await burner.getAddress())).to.equal(0n);
    });

    it("should not cap the owner's share: an owner recipient whose hook needs more than the cap is still paid", async function () {
      const { burner, hookToken, normal } = await erc20Setup();
      await burner.setGasToBurn(300_000n);

      await normal.withdrawFunds(await burner.getAddress());

      expect(await hookToken.balanceOf(await burner.getAddress())).to.equal(OWNER_SHARE);
    });
  });
});
