// SPDX-License-Identifier: AEL
pragma solidity ^0.8.19;

library VaultTypes {
    /**
     * @notice Configuration used to deploy a funding vault.
     * @param proofOfFundingToken The token used as proof-of-funding.
     * @param fundingToken The ERC20 token used for funding (e.g., DAI, USDC).
     * @param proofOfFundingTokenAmount Initial amount of proof-of-funding tokens deposited into the vault.
     * @param minFundingAmount Minimum amount required before funds can be withdrawn.
     * @param timestamp Deadline after which refunds are possible if the funding goal is not reached.
     * @param exchangeRate Number of voucher tokens minted per unit of donated currency.
     * @param withdrawalAddress Address that receives the raised funds.
     * @param developerFeeAddress Address that receives the developer fee.
     * @param developerFeePercentage Percentage fee paid to the developer.
     * @param projectURL URL or IPFS hash containing project information.
     * @param projectTitle Title of the project.
     * @param projectDescription Short description of the project.
     */

    struct VaultConfig {
        address proofOfFundingToken;
        address fundingToken;
        uint256 proofOfFundingTokenAmount;
        uint256 minFundingAmount;
        uint256 timestamp;
        uint256 exchangeRate;
        address withdrawalAddress;
        address developerFeeAddress;
        uint256 developerFeePercentage;
        string projectURL;
        string projectTitle;
        string projectDescription;
    }
}
