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
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FundingVaultFactory
 * @author Muhammad Zain Nasir
 * @notice This is the FundingVaultFactory contract that will be used for deployment and keeping track of all the funding vaults.
 */
contract FundingVaultFactory{

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
    IERC20 private proofOfFundingToken;
    uint256 private s_fundingVaultIdCounter;


    // Events //
    event FundingVaultDeployed(address indexed fundingVault);
    event TransferTokens(address indexed token, address indexed recepient, uint256 amount);

    // Functions //

    /**
     * @param _proofOfFundingToken The token that will be used as proof-of-funding token to incentivise donators
     * @param _proofOfFundingTokenAmount The initial  proof-of-funding token amount which will be in fundingVault
     * @param _minFundingAmount The minimum amount required to make withdraw of funds possible
     * @param _timestamp The date (block height) limit until which withdrawal or after which refund is allowed.
     * @param _withdrawalAddress The address for withdrawal of funds
     * @param _developerFeeAddress the address for the developer fee
     * @param _developerFeePercentage the percentage fee for the developer.
     * @param _projectURL A link or hash containing the project's information (e.g., GitHub repository).
     */
    function deployFundingVault (
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
        if (_proofOfFundingToken == address(0) || _withdrawalAddress == address(0) || _developerFeeAddress == address(0))  revert CannotBeAZeroAddress();

        if (block.timestamp > _timestamp) revert deadlineCannotBeInThePast();
        
        if (_minFundingAmount == 0) revert MinFundingAmountCanNotBeZero();



        s_fundingVaultIdCounter++;
        uint256 fundingVaultId = s_fundingVaultIdCounter;
        proofOfFundingToken = IERC20(_proofOfFundingToken);

        FundingVault fundingVault = new FundingVault (
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

        proofOfFundingToken.safeTransferFrom(msg.sender,address(fundingVault),_proofOfFundingTokenAmount);

        Vault storage vault = vaults[fundingVaultId];
        vault.vaultAddress = address(fundingVault);
        vault.title = _projectTitle;
        vault.description = _projectDescription;
        vault.deadline = _timestamp;
        
        emit FundingVaultDeployed(address(fundingVault));     
        return address(fundingVault);
    }

     /**
     * @notice Get list of all funding vaults
     * @dev to access the list of all the available funding vaults on the platform 
     */ 
    function getVaults(uint256 start, uint256 end) external view returns(Vault[] memory)
    {
        if (end > s_fundingVaultIdCounter || start > end || start == 0)  revert InvalidIndex();

        Vault[] memory allVaults = new Vault[](end - start + 1);

        for (uint i = start; i <= end;i++)
        {
            allVaults[i - start] = vaults[i];
        }
        return allVaults;
    }

    function getTotalNumberOfFundingVaults() external view returns (uint256) {
        return s_fundingVaultIdCounter;
    }
}