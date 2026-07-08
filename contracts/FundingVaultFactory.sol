// SPDX-License-Identifier: AEL

/**
 * Layout of the contract
 * version
 * imports
 * errors
 * interfaces, libraries, and contracts
 * type declarations
 * state variables
 * events
 * modifiers
 * functions
 *
 * layout of functions
 * external functions
 * public functions
 * internal functions
 * private functions
 * view functions
 * pure functions
 * getters
 */

pragma solidity ^0.8.19;

import {FundingVault} from "./FundingVault.sol";
import {FundingVaultERC20} from "./FundingVaultERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {VaultTypes} from "./VaultTypes.sol";

/**
 * @title FundingVaultFactory
 * @author Muhammad Zain Nasir
 * @notice This is the FundingVaultFactory contract that will be used for deployment and keeping track of all the funding vaults.
 */
contract FundingVaultFactory {
    // Errors //
    error CannotBeAZeroAddress();
    error deadlineCannotBeInThePast();
    error MinFundingAmountCanNotBeZero();
    error InvalidIndex();

    //Type declarations
    struct Vault {
        address vaultAddress;
        string title;
        string description;
        uint256 deadline;
    }

    // State Variables //
    mapping(uint256 => Vault) public vaults;

    using SafeERC20 for IERC20;
    //IERC20 private proofOfFundingToken;
    uint256 private s_fundingVaultIdCounter;

    // Events //
    event FundingVaultDeployed(address indexed fundingVault);
    event TransferTokens(
        address indexed token,
        address indexed recepient,
        uint256 amount
    );

    // Functions //

    /**
     * @notice Deploys a new funding vault.
     * @param config Configuration parameters for the funding vault.
     */
    function deployFundingVault(
        VaultTypes.VaultConfig calldata config
    ) external returns (address) {
        if (
            config.proofOfFundingToken == address(0) ||
            config.withdrawalAddress == address(0) ||
            config.developerFeeAddress == address(0)
        ) revert CannotBeAZeroAddress();

        if (block.timestamp > config.timestamp)
            revert deadlineCannotBeInThePast();

        if (config.minFundingAmount == 0) revert MinFundingAmountCanNotBeZero();

        s_fundingVaultIdCounter++;
        uint256 fundingVaultId = s_fundingVaultIdCounter;
        IERC20 proofOfFundingToken = IERC20(config.proofOfFundingToken);

        address vaultAddress;

        if (config.fundingToken == address(0)) {
            vaultAddress = address(new FundingVault(config));
        } else {
            vaultAddress = address(new FundingVaultERC20(config));
        }

        proofOfFundingToken.safeTransferFrom(
            msg.sender,
            vaultAddress,
            config.proofOfFundingTokenAmount
        );

        Vault storage vault = vaults[fundingVaultId];
        vault.vaultAddress = vaultAddress;
        vault.title = config.projectTitle;
        vault.description = config.projectDescription;
        vault.deadline = config.timestamp;

        emit FundingVaultDeployed(vaultAddress);
        return vaultAddress;
    }

    /**
     * @notice Get list of all funding vaults
     * @dev to access the list of all the available funding vaults on the platform
     */
    function getVaults(
        uint256 start,
        uint256 end
    ) external view returns (Vault[] memory) {
        if (end > s_fundingVaultIdCounter || start > end || start == 0)
            revert InvalidIndex();

        Vault[] memory allVaults = new Vault[](end - start + 1);

        for (uint i = start; i <= end; i++) {
            allVaults[i - start] = vaults[i];
        }
        return allVaults;
    }

    function getTotalNumberOfFundingVaults() external view returns (uint256) {
        return s_fundingVaultIdCounter;
    }
}
