import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import {
  PFT_AMOUNT,
  MIN_FUNDING,
  EXCHANGE_RATE,
  ZERO_ADDRESS,
  buildConfig,
  deployFactoryFixture,
  deployVaultViaFactory,
} from "./fixtures";

describe("FundingVaultFactory", function () {
  async function validBase() {
    const fixture = await loadFixture(deployFactoryFixture);
    const base = {
      proofOfFundingToken: await fixture.pft.getAddress(),
      withdrawalAddress: fixture.owner.address,
      developerFeeAddress: fixture.developer.address,
    };
    await fixture.pft.approve(await fixture.factory.getAddress(), PFT_AMOUNT);
    return { ...fixture, base };
  }

  describe("deployFundingVault", function () {
    it("should deploy a native ETH vault with a valid config", async function () {
      const { factory, pft, owner, base } = await validBase();
      const config = await buildConfig(base);

      await expect(factory.deployFundingVault(config)).to.emit(factory, "FundingVaultDeployed").withArgs(anyValue);

      expect(await factory.getTotalNumberOfFundingVaults()).to.equal(1n);
      const entry = await factory.vaults(1);
      expect(entry.title).to.equal(config.projectTitle);
      expect(entry.description).to.equal(config.projectDescription);
      expect(entry.deadline).to.equal(config.timestamp);
      expect(entry.isERC20).to.equal(false);

      const vault = await ethers.getContractAt("FundingVault", entry.vaultAddress);
      const details = await vault.getVault();
      expect(details.withdrawalAddress).to.equal(owner.address);
      expect(details.proofOfFundingToken).to.equal(await pft.getAddress());
      expect(details.proofOfFundingTokenAmount).to.equal(PFT_AMOUNT);
      expect(details.minFundingAmount).to.equal(MIN_FUNDING);
      expect(details.timestamp).to.equal(config.timestamp);
      expect(details.exchangeRate).to.equal(EXCHANGE_RATE);
      expect(details.projectURL).to.equal(config.projectURL);
      expect(details.projectTitle).to.equal(config.projectTitle);
      expect(details.projectDescription).to.equal(config.projectDescription);
    });

    it("should deploy an ERC20-funded vault when a funding token is given", async function () {
      const { factory, pft, fundingToken, base } = await validBase();
      const config = await buildConfig(base, { fundingToken: await fundingToken.getAddress() });

      await factory.deployFundingVault(config);

      const entry = await factory.vaults(1);
      expect(entry.isERC20).to.equal(true);
      const vault = await ethers.getContractAt("FundingVaultERC20", entry.vaultAddress);
      const details = await vault.getVault();
      expect(details.fundingToken).to.equal(await fundingToken.getAddress());
      expect(details.proofOfFundingToken).to.equal(await pft.getAddress());
    });

    it("should move the full PFT amount from the deployer into the new vault", async function () {
      const { factory, pft, owner, base } = await validBase();
      const config = await buildConfig(base);
      const before = await pft.balanceOf(owner.address);

      await factory.deployFundingVault(config);

      const vaultAddress = (await factory.vaults(1)).vaultAddress;
      expect(await pft.balanceOf(vaultAddress)).to.equal(PFT_AMOUNT);
      expect(await pft.balanceOf(owner.address)).to.equal(before - PFT_AMOUNT);
    });

    it("should make the withdrawal address the vault owner even when someone else deploys it", async function () {
      const { factory, pft, owner, alice, base } = await validBase();
      await pft.transfer(alice.address, PFT_AMOUNT);
      await pft.connect(alice).approve(await factory.getAddress(), PFT_AMOUNT);
      const config = await buildConfig({ ...base, withdrawalAddress: owner.address });

      await factory.connect(alice).deployFundingVault(config);

      const vault = await ethers.getContractAt("FundingVault", (await factory.vaults(1)).vaultAddress);
      expect(await vault.withdrawalAddress()).to.equal(owner.address);
      expect(await pft.balanceOf(alice.address)).to.equal(0n);
    });

    it("should accept a developer fee of exactly 100 percent", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig(base, { developerFeePercentage: 100n });

      await expect(factory.deployFundingVault(config)).to.emit(factory, "FundingVaultDeployed");
    });

    it("should accept a developer fee of zero percent", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig(base, { developerFeePercentage: 0n });

      await expect(factory.deployFundingVault(config)).to.emit(factory, "FundingVaultDeployed");
    });

    it("should fail when deploying with proofOfFundingToken as zero address", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig({ ...base, proofOfFundingToken: ZERO_ADDRESS });

      await expect(factory.deployFundingVault(config)).to.be.revertedWithCustomError(factory, "CannotBeAZeroAddress");
    });

    it("should fail when deploying with withdrawalAddress as zero address", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig({ ...base, withdrawalAddress: ZERO_ADDRESS });

      await expect(factory.deployFundingVault(config)).to.be.revertedWithCustomError(factory, "CannotBeAZeroAddress");
    });

    it("should fail when deploying with developerFeeAddress as zero address", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig({ ...base, developerFeeAddress: ZERO_ADDRESS });

      await expect(factory.deployFundingVault(config)).to.be.revertedWithCustomError(factory, "CannotBeAZeroAddress");
    });

    it("should fail when the funding token is the same as the proof-of-funding token", async function () {
      const { factory, pft, base } = await validBase();
      const config = await buildConfig(base, { fundingToken: await pft.getAddress() });

      await expect(factory.deployFundingVault(config)).to.be.revertedWithCustomError(
        factory,
        "FundingTokenSameAsProofOfFundingToken",
      );
    });

    it("should fail when the deadline is in the past", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig(base, { timestamp: (await time.latest()) - 1 });

      await expect(factory.deployFundingVault(config)).to.be.revertedWithCustomError(
        factory,
        "deadlineCannotBeInThePast",
      );
    });

    it("should fail when minFundingAmount is zero", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig(base, { minFundingAmount: 0n });

      await expect(factory.deployFundingVault(config)).to.be.revertedWithCustomError(
        factory,
        "MinFundingAmountCanNotBeZero",
      );
    });

    it("should fail when exchangeRate is zero", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig(base, { exchangeRate: 0n });

      await expect(factory.deployFundingVault(config)).to.be.revertedWithCustomError(
        factory,
        "ExchangeRateCanNotBeZero",
      );
    });

    it("should fail when developerFeePercentage is above 100", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig(base, { developerFeePercentage: 101n });

      await expect(factory.deployFundingVault(config)).to.be.revertedWithCustomError(factory, "InvalidFeePercentage");
    });

    it("should fail when the deployer has not approved the factory for the PFT", async function () {
      const { factory, pft, alice, base } = await validBase();
      await pft.transfer(alice.address, PFT_AMOUNT);
      const config = await buildConfig(base);

      await expect(factory.connect(alice).deployFundingVault(config)).to.be.revertedWithCustomError(
        pft,
        "ERC20InsufficientAllowance",
      );
    });

    it("should fail when the deployer does not hold enough PFT", async function () {
      const { factory, pft, alice, base } = await validBase();
      await pft.connect(alice).approve(await factory.getAddress(), PFT_AMOUNT);
      const config = await buildConfig(base);

      await expect(factory.connect(alice).deployFundingVault(config)).to.be.revertedWithCustomError(
        pft,
        "ERC20InsufficientBalance",
      );
    });

    it("should not register a vault when deployment reverts", async function () {
      const { factory, base } = await validBase();
      const config = await buildConfig(base, { exchangeRate: 0n });

      await expect(factory.deployFundingVault(config)).to.be.reverted;

      expect(await factory.getTotalNumberOfFundingVaults()).to.equal(0n);
    });

    it("should record the configured PFT amount even when the PFT charges a transfer fee (known issue)", async function () {
      const { factory, owner, developer } = await validBase();
      const feePft = await (await ethers.getContractFactory("MockFeeOnTransferERC20")).deploy("Fee PFT", "FPFT", 100);
      await feePft.mint(owner.address, PFT_AMOUNT);
      const config = await buildConfig({
        proofOfFundingToken: await feePft.getAddress(),
        withdrawalAddress: owner.address,
        developerFeeAddress: developer.address,
      });

      const vaultAddress = await deployVaultViaFactory(factory, owner, feePft, config);

      const vault = await ethers.getContractAt("FundingVault", vaultAddress);
      expect(await vault.proofOfFundingTokenAmount()).to.equal(PFT_AMOUNT);
      expect(await feePft.balanceOf(vaultAddress)).to.equal((PFT_AMOUNT * 99n) / 100n);
    });
  });

  describe("registry views", function () {
    async function deployThreeVaults() {
      const fixture = await loadFixture(deployFactoryFixture);
      const { factory, pft, fundingToken, owner, developer } = fixture;
      const base = {
        proofOfFundingToken: await pft.getAddress(),
        withdrawalAddress: owner.address,
        developerFeeAddress: developer.address,
      };
      const first = await buildConfig(base, { projectTitle: "First" });
      const second = await buildConfig(base, {
        projectTitle: "Second",
        fundingToken: await fundingToken.getAddress(),
      });
      const third = await buildConfig(base, { projectTitle: "Third" });
      const addresses: string[] = [];
      for (const config of [first, second, third]) {
        addresses.push(await deployVaultViaFactory(factory, owner, pft, config));
      }
      return { ...fixture, addresses };
    }

    it("should report zero vaults before any deployment", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);

      expect(await factory.getTotalNumberOfFundingVaults()).to.equal(0n);
    });

    it("should count every deployed vault", async function () {
      const { factory } = await deployThreeVaults();

      expect(await factory.getTotalNumberOfFundingVaults()).to.equal(3n);
    });

    it("should return all vaults in deployment order", async function () {
      const { factory, addresses } = await deployThreeVaults();

      const vaults = await factory.getVaults(1, 3);

      expect(vaults.map(v => v.title)).to.deep.equal(["First", "Second", "Third"]);
      expect(vaults.map(v => v.vaultAddress)).to.deep.equal(addresses);
      expect(vaults.map(v => v.isERC20)).to.deep.equal([false, true, false]);
    });

    it("should return a sub-range of vaults", async function () {
      const { factory } = await deployThreeVaults();

      const vaults = await factory.getVaults(2, 3);

      expect(vaults.map(v => v.title)).to.deep.equal(["Second", "Third"]);
    });

    it("should return a single vault when start equals end", async function () {
      const { factory } = await deployThreeVaults();

      const vaults = await factory.getVaults(3, 3);

      expect(vaults.length).to.equal(1);
      expect(vaults[0].title).to.equal("Third");
    });

    it("should fail getVaults when start is zero", async function () {
      const { factory } = await deployThreeVaults();

      await expect(factory.getVaults(0, 2)).to.be.revertedWithCustomError(factory, "InvalidIndex");
    });

    it("should fail getVaults when start is greater than end", async function () {
      const { factory } = await deployThreeVaults();

      await expect(factory.getVaults(3, 2)).to.be.revertedWithCustomError(factory, "InvalidIndex");
    });

    it("should fail getVaults when end is past the last vault", async function () {
      const { factory } = await deployThreeVaults();

      await expect(factory.getVaults(1, 4)).to.be.revertedWithCustomError(factory, "InvalidIndex");
    });

    it("should fail getVaults on an empty registry", async function () {
      const { factory } = await loadFixture(deployFactoryFixture);

      await expect(factory.getVaults(1, 1)).to.be.revertedWithCustomError(factory, "InvalidIndex");
    });
  });
});
