import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import type { Contract } from "ethers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export const ZERO_ADDRESS = ethers.ZeroAddress;

export const ONE_DAY = 24 * 60 * 60;
export const CAMPAIGN_DURATION = 7 * ONE_DAY;

export const PFT_AMOUNT = ethers.parseEther("1000");
export const MIN_FUNDING = ethers.parseEther("10");
export const EXCHANGE_RATE = 10n;
export const DEVELOPER_FEE_PERCENTAGE = 5n;

// Maximum funding the vault can accept before it runs out of PFT to back vouchers.
export const MAX_FUNDING = PFT_AMOUNT / EXCHANGE_RATE;

const INITIAL_TOKEN_SUPPLY = ethers.parseEther("1000000");
const CONTRIBUTOR_FUNDING_BALANCE = ethers.parseEther("10000");

export type VaultConfig = {
  proofOfFundingToken: string;
  fundingToken: string;
  proofOfFundingTokenAmount: bigint;
  minFundingAmount: bigint;
  timestamp: number;
  exchangeRate: bigint;
  withdrawalAddress: string;
  developerFeeAddress: string;
  developerFeePercentage: bigint;
  projectURL: string;
  projectTitle: string;
  projectDescription: string;
};

/**
 * Builds a valid VaultConfig, overriding any field. The deadline defaults to
 * CAMPAIGN_DURATION after the latest block.
 */
export async function buildConfig(
  base: { proofOfFundingToken: string; withdrawalAddress: string; developerFeeAddress: string },
  overrides: Partial<VaultConfig> = {},
): Promise<VaultConfig> {
  return {
    fundingToken: ZERO_ADDRESS,
    proofOfFundingTokenAmount: PFT_AMOUNT,
    minFundingAmount: MIN_FUNDING,
    timestamp: (await time.latest()) + CAMPAIGN_DURATION,
    exchangeRate: EXCHANGE_RATE,
    developerFeePercentage: DEVELOPER_FEE_PERCENTAGE,
    projectURL: "https://example.org/project",
    projectTitle: "Test campaign",
    projectDescription: "A campaign used in tests",
    ...base,
    ...overrides,
  };
}

/**
 * Approves the factory for the PFT amount, deploys a vault through the factory
 * and returns the new vault's address.
 */
export async function deployVaultViaFactory(
  factory: Contract,
  creator: HardhatEthersSigner,
  pft: Contract,
  config: VaultConfig,
): Promise<string> {
  await pft.connect(creator).approve(await factory.getAddress(), config.proofOfFundingTokenAmount);
  await factory.connect(creator).deployFundingVault(config);
  const count = await factory.getTotalNumberOfFundingVaults();
  const entry = await factory.vaults(count);
  return entry.vaultAddress;
}

async function getSigners() {
  const [owner, developer, alice, bob, stranger] = await ethers.getSigners();
  return { owner, developer, alice, bob, stranger };
}

async function deployPft(owner: HardhatEthersSigner) {
  const pft = await (await ethers.getContractFactory("ParticipationToken")).deploy(INITIAL_TOKEN_SUPPLY, owner.address);
  await pft.waitForDeployment();
  return pft;
}

async function deployFactory() {
  const factory = await (await ethers.getContractFactory("FundingVaultFactory")).deploy();
  await factory.waitForDeployment();
  return factory;
}

async function deployFundingToken(owner: HardhatEthersSigner, holders: HardhatEthersSigner[]) {
  const token = await (await ethers.getContractFactory("FundingToken")).deploy(INITIAL_TOKEN_SUPPLY, owner.address);
  await token.waitForDeployment();
  for (const holder of holders) {
    await token.transfer(holder.address, CONTRIBUTOR_FUNDING_BALANCE);
  }
  return token;
}

/** A fresh factory plus an 18-decimal PFT and 18-decimal funding token. No vault is deployed. */
export async function deployFactoryFixture() {
  const signers = await getSigners();
  const factory = await deployFactory();
  const pft = await deployPft(signers.owner);
  const fundingToken = await deployFundingToken(signers.owner, [signers.alice, signers.bob]);
  return { factory, pft, fundingToken, ...signers };
}

/** A native-ETH FundingVault deployed through the factory by `owner`, who is also the withdrawal address. */
export async function deployNativeVaultFixture() {
  const base = await deployFactoryFixture();
  const { factory, pft, owner, developer } = base;
  const config = await buildConfig({
    proofOfFundingToken: await pft.getAddress(),
    withdrawalAddress: owner.address,
    developerFeeAddress: developer.address,
  });
  const vaultAddress = await deployVaultViaFactory(factory, owner, pft, config);
  const vault = await ethers.getContractAt("FundingVault", vaultAddress);
  return { ...base, vault, config, deadline: config.timestamp };
}

/** A FundingVaultERC20 (18-decimal funding token) deployed through the factory by `owner`. */
export async function deployERC20VaultFixture() {
  const base = await deployFactoryFixture();
  const { factory, pft, fundingToken, owner, developer } = base;
  const config = await buildConfig(
    {
      proofOfFundingToken: await pft.getAddress(),
      withdrawalAddress: owner.address,
      developerFeeAddress: developer.address,
    },
    { fundingToken: await fundingToken.getAddress() },
  );
  const vaultAddress = await deployVaultViaFactory(factory, owner, pft, config);
  const vault = await ethers.getContractAt("FundingVaultERC20", vaultAddress);
  return { ...base, vault, config, deadline: config.timestamp };
}

/** A FundingVaultERC20 funded in a 6-decimal token (USDC-like). The minimum is 10 whole tokens. */
export async function deploySixDecimalFundingVaultFixture() {
  const base = await deployFactoryFixture();
  const { factory, pft, owner, developer, alice, bob } = base;
  const usdc = await (await ethers.getContractFactory("MockERC20")).deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  for (const holder of [alice, bob]) {
    await usdc.mint(holder.address, 10_000n * 10n ** 6n);
  }
  const config = await buildConfig(
    {
      proofOfFundingToken: await pft.getAddress(),
      withdrawalAddress: owner.address,
      developerFeeAddress: developer.address,
    },
    { fundingToken: await usdc.getAddress(), minFundingAmount: 10n * 10n ** 6n },
  );
  const vaultAddress = await deployVaultViaFactory(factory, owner, pft, config);
  const vault = await ethers.getContractAt("FundingVaultERC20", vaultAddress);
  return { ...base, usdc, vault, config, deadline: config.timestamp };
}

/** A FundingVaultERC20 whose funding token burns 1% on every transfer. */
export async function deployFeeOnTransferFundingVaultFixture() {
  const base = await deployFactoryFixture();
  const { factory, pft, owner, developer, alice, bob } = base;
  const feeToken = await (await ethers.getContractFactory("MockFeeOnTransferERC20")).deploy("Fee Token", "FEE", 100);
  await feeToken.waitForDeployment();
  for (const holder of [alice, bob]) {
    await feeToken.mint(holder.address, CONTRIBUTOR_FUNDING_BALANCE);
  }
  const config = await buildConfig(
    {
      proofOfFundingToken: await pft.getAddress(),
      withdrawalAddress: owner.address,
      developerFeeAddress: developer.address,
    },
    { fundingToken: await feeToken.getAddress() },
  );
  const vaultAddress = await deployVaultViaFactory(factory, owner, pft, config);
  const vault = await ethers.getContractAt("FundingVaultERC20", vaultAddress);
  return { ...base, feeToken, vault, config, deadline: config.timestamp };
}

/** A FundingVaultERC20 whose funding token has ERC777-style hooks, plus a contributor that re-enters it. */
export async function deployHookFundingVaultFixture() {
  const base = await deployFactoryFixture();
  const { factory, pft, owner, developer } = base;
  const hookToken = await (await ethers.getContractFactory("MockHookERC20")).deploy("Hook Token", "HOOK");
  await hookToken.waitForDeployment();
  const config = await buildConfig(
    {
      proofOfFundingToken: await pft.getAddress(),
      withdrawalAddress: owner.address,
      developerFeeAddress: developer.address,
    },
    { fundingToken: await hookToken.getAddress() },
  );
  const vaultAddress = await deployVaultViaFactory(factory, owner, pft, config);
  const vault = await ethers.getContractAt("FundingVaultERC20", vaultAddress);
  const attacker = await (
    await ethers.getContractFactory("ReentrantFundingBuyer")
  ).deploy(vaultAddress, config.fundingToken);
  await attacker.waitForDeployment();
  await hookToken.mint(await attacker.getAddress(), ethers.parseEther("1000"));
  return { ...base, hookToken, attacker, vault, config, deadline: config.timestamp };
}

/** A native-ETH vault whose developer fee address is a contract that rejects ETH. */
export async function deployRejectingDeveloperVaultFixture() {
  const base = await deployFactoryFixture();
  const { factory, pft, owner } = base;
  const rejecter = await (await ethers.getContractFactory("RejectingReceiver")).deploy();
  await rejecter.waitForDeployment();
  const config = await buildConfig({
    proofOfFundingToken: await pft.getAddress(),
    withdrawalAddress: owner.address,
    developerFeeAddress: await rejecter.getAddress(),
  });
  const vaultAddress = await deployVaultViaFactory(factory, owner, pft, config);
  const vault = await ethers.getContractAt("FundingVault", vaultAddress);
  return { ...base, rejecter, vault, config, deadline: config.timestamp };
}

/**
 * A native-ETH vault whose withdrawal address (so its owner) and developer fee
 * address are both the same contract, which calls back into the vault while
 * withdrawFunds is paying it. It has to be the owner too, or onlyOwner would
 * reject the re-entrant call before any reentrancy guard ran.
 */
export async function deployReentrantDeveloperVaultFixture() {
  const base = await deployFactoryFixture();
  const { factory, pft, owner } = base;
  const attacker = await (await ethers.getContractFactory("ReentrantFeeReceiver")).deploy();
  await attacker.waitForDeployment();
  const attackerAddress = await attacker.getAddress();
  const config = await buildConfig({
    proofOfFundingToken: await pft.getAddress(),
    withdrawalAddress: attackerAddress,
    developerFeeAddress: attackerAddress,
  });
  const vaultAddress = await deployVaultViaFactory(factory, owner, pft, config);
  const vault = await ethers.getContractAt("FundingVault", vaultAddress);
  return { ...base, attacker, vault, config, deadline: config.timestamp };
}

/** A native-ETH vault whose withdrawal address (and so its owner) is a contract that rejects ETH. */
export async function deployRejectingOwnerVaultFixture() {
  const base = await deployFactoryFixture();
  const { factory, pft, owner, developer } = base;
  const rejecter = await (await ethers.getContractFactory("RejectingReceiver")).deploy();
  await rejecter.waitForDeployment();
  const config = await buildConfig({
    proofOfFundingToken: await pft.getAddress(),
    withdrawalAddress: await rejecter.getAddress(),
    developerFeeAddress: developer.address,
  });
  const vaultAddress = await deployVaultViaFactory(factory, owner, pft, config);
  const vault = await ethers.getContractAt("FundingVault", vaultAddress);
  return { ...base, rejecter, vault, config, deadline: config.timestamp };
}

/** A FundingVaultERC20 funded in a token that can block recipients (like a blacklisting stablecoin). */
export async function deployBlacklistFundingVaultFixture() {
  const base = await deployFactoryFixture();
  const { factory, pft, owner, developer, alice, bob } = base;
  const blockable = await (await ethers.getContractFactory("MockBlacklistERC20")).deploy("Blockable", "BLK");
  await blockable.waitForDeployment();
  for (const holder of [alice, bob]) {
    await blockable.mint(holder.address, CONTRIBUTOR_FUNDING_BALANCE);
  }
  const config = await buildConfig(
    {
      proofOfFundingToken: await pft.getAddress(),
      withdrawalAddress: owner.address,
      developerFeeAddress: developer.address,
    },
    { fundingToken: await blockable.getAddress() },
  );
  const vaultAddress = await deployVaultViaFactory(factory, owner, pft, config);
  const vault = await ethers.getContractAt("FundingVaultERC20", vaultAddress);
  return { ...base, blockable, vault, config, deadline: config.timestamp };
}
