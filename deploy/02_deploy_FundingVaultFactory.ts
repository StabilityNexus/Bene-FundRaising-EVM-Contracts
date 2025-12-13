import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

/**
 * Deploys the FundingVaultFactory contract
 */
const deployFundingVaultFactory: DeployFunction = async function (
  hre: HardhatRuntimeEnvironment
) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("FundingVaultFactory", {
    from: deployer,
    log: true,
    autoMine: true,
  });

  const factory = await hre.ethers.getContract<Contract>(
    "FundingVaultFactory",
    deployer
  );

  console.log(
    "✅ FundingVaultFactory deployed. Total vaults:",
    await factory.getTotalNumberOfFundingVaults()
  );
};

export default deployFundingVaultFactory;

// 👇 correct tag name
deployFundingVaultFactory.tags = ["FundingVaultFactory"];
