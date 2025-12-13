import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

const createFundingVault: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployer } = await hre.getNamedAccounts();
  const { ethers } = hre;

  // ---------------- CONFIG ----------------

  const FUNDING_TOKEN_ADDRESS = "0xFUNDING_TOKEN_ADDRESS"; // e.g. USDT / DAI
  const PROOF_TOKEN_ADDRESS = "0xPROOF_TOKEN_ADDRESS";     // reward token

  const PROOF_TOKEN_AMOUNT = ethers.parseUnits("10000", 18); // reward supply
  const MIN_FUNDING_AMOUNT = ethers.parseUnits("1000", 18); // minimum funding
  const DEADLINE = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // +7 days
  const EXCHANGE_RATE = 1; // 1 funding token = 1 reward token

  const WITHDRAWAL_ADDRESS = deployer;
  const DEVELOPER_FEE_ADDRESS = deployer;
  const DEVELOPER_FEE_PERCENTAGE = 5;

  const PROJECT_URL = "https://github.com/your-repo";
  const PROJECT_TITLE = "ERC20 Fundraising Project";
  const PROJECT_DESCRIPTION = "Generic ERC20-based fundraising vault";

  // ---------------- CONTRACTS ----------------

  const factory = await ethers.getContract<Contract>(
    "FundingVaultFactory",
    deployer
  );

  const proofToken = await ethers.getContractAt(
    "IERC20",
    PROOF_TOKEN_ADDRESS,
    deployer
  );

  // ---------------- APPROVE TOKENS ----------------

  console.log("⏳ Approving proof tokens...");
  const approveTx = await proofToken.approve(
    await factory.getAddress(),
    PROOF_TOKEN_AMOUNT
  );
  await approveTx.wait();
  console.log("✅ Proof tokens approved");

  // ---------------- DEPLOY VAULT ----------------

  console.log("⏳ Creating Funding Vault...");
  const tx = await factory.deployFundingVault(
    FUNDING_TOKEN_ADDRESS,
    PROOF_TOKEN_ADDRESS,
    PROOF_TOKEN_AMOUNT,
    MIN_FUNDING_AMOUNT,
    DEADLINE,
    EXCHANGE_RATE,
    WITHDRAWAL_ADDRESS,
    DEVELOPER_FEE_ADDRESS,
    DEVELOPER_FEE_PERCENTAGE,
    PROJECT_URL,
    PROJECT_TITLE,
    PROJECT_DESCRIPTION
  );

  const receipt = await tx.wait();

  const event = receipt.logs?.find(
    (log: any) => log.fragment?.name === "FundingVaultDeployed"
  );

  console.log("🎉 Funding Vault created at:", event?.args?.fundingVault);
};

export default createFundingVault;

// run with: yarn deploy --tags CreateVault
createFundingVault.tags = ["CreateVault"];
