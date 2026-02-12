// SPDX-License-Identifier: AEL
pragma solidity ^0.8.19;

import {FundingVault} from "./FundingVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FundingVaultFactory
 * @author Muhammad Zain Nasir
 * @notice Deploys and tracks ERC20-based FundingVaults
 */
contract FundingVaultFactory {
    using SafeERC20 for IERC20;

    // ---------------- Errors ----------------
    error CannotBeAZeroAddress();
    error DeadlineCannotBeInThePast();
    error MinFundingAmountCanNotBeZero();
    error InvalidIndex();

    // ---------------- Struct ----------------
    struct Vault {
        address vaultAddress;
        string title;
        string description;
        uint256 deadline;
    }

    // ---------------- State ----------------
    mapping(uint256 => Vault) public vaults;
    uint256 private s_fundingVaultIdCounter;

    // ---------------- Events ----------------
    event FundingVaultDeployed(address indexed fundingVault);

    // ---------------- Functions ----------------

    /**
     * @notice Deploy a new ERC20-based funding vault
     */
    function deployFundingVault(
        address _fundingToken,              // 🔥 NEW
        address _proofOfFundingToken,
        uint256 _proofOfFundingTokenAmount,
        uint256 _minFundingAmount,
        uint256 _timestamp,
        uint256 _exchangeRate,
        address _withdrawalAddress,
        address _developerFeeAddress,
        uint256 _developerFeePercentage,
        string memory _projectURL,
        string memory _projectTitle,
        string memory _projectDescription
    ) external returns (address) {

        if (
            _fundingToken == address(0) ||
            _proofOfFundingToken == address(0) ||
            _withdrawalAddress == address(0) ||
            _developerFeeAddress == address(0)
        ) revert CannotBeAZeroAddress();

        if (block.timestamp > _timestamp) revert DeadlineCannotBeInThePast();
        if (_minFundingAmount == 0) revert MinFundingAmountCanNotBeZero();

        s_fundingVaultIdCounter++;
        uint256 fundingVaultId = s_fundingVaultIdCounter;

        // 🔥 Deploy vault with GENERIC ERC20 support
        FundingVault fundingVault = new FundingVault(
            _fundingToken,
            _proofOfFundingToken,
            _proofOfFundingTokenAmount,
            _minFundingAmount,
            _timestamp,
            _exchangeRate,
            _withdrawalAddress,
            _developerFeeAddress,
            _developerFeePercentage,
            _projectURL,
            _projectTitle,
            _projectDescription
        );

        // Transfer initial proof tokens to vault
        IERC20(_proofOfFundingToken).safeTransferFrom(
            msg.sender,
            address(fundingVault),
            _proofOfFundingTokenAmount
        );

        // Store vault info
        vaults[fundingVaultId] = Vault({
            vaultAddress: address(fundingVault),
            title: _projectTitle,
            description: _projectDescription,
            deadline: _timestamp
        });

        emit FundingVaultDeployed(address(fundingVault));
        return address(fundingVault);
    }

    /**
     * @notice Get list of deployed vaults
     */
    function getVaults(
        uint256 start,
        uint256 end
    ) external view returns (Vault[] memory) {
        if (end > s_fundingVaultIdCounter || start > end || start == 0)
            revert InvalidIndex();

        Vault[] memory allVaults = new Vault[](end - start + 1);

        for (uint256 i = start; i <= end; i++) {
            allVaults[i - start] = vaults[i];
        }
        return allVaults;
    }

    function getTotalNumberOfFundingVaults() external view returns (uint256) {
        return s_fundingVaultIdCounter;
    }
}
