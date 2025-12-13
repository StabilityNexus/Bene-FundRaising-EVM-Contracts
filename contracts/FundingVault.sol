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
 * constructor
 * receive function
 * fallback function
 * external functions
 * public functions
 * internal functions
 * private functions
 * view functions
 * pure functions
 * getters
 */
pragma solidity ^0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title FundingVault
 * @author Muhammad Zain Nasir
 * @notice A contract that allows users to deposit funds and receive proof-of-funding token in return box creator can call WithdrawFunds if there enough funds collected
 */
contract FundingVault is ERC20 {

    // Errors //
    error MinFundingAmountReached();
    error MinFundingAmountNotReached();
    error DeadlineNotPassed(); 
    error NotEnoughTokens(); 
    error EthTransferFailed();
    error EthTransferToDeveloperFailed();
    error EthTransferToWithdrawalFailed();
    error OwnerOnly();


    // State Variables //
    using SafeERC20 for IERC20;
    IERC20 public immutable proofOfFundingToken; // The token that will be used as proof-of-funding token to incentivise contributions
    uint256 public proofOfFundingTokenAmount; // The initial  proof-of-funding token amount which will be in fundingVault
    uint256 public timestamp; // The date limit until which withdrawal or after which refund is allowed.
    uint256 public immutable minFundingAmount; // The minimum amount of ETH required in the contract to enable withdrawal.
    uint256 public exchangeRate; // The exchange rate of ETH per token
    address public withdrawalAddress; // WithdrawalAddress is also considered as owner of the Vault. 
    address private developerFeeAddress; // Developer address
    uint256 private developerFeePercentage; // Developer percentage in funds collected
    string  public projectURL; // A link or hash containing the project's information (e.g., GitHub repository).
    string public projectTitle; // Name of the Project
    string public projectDescription; // Short description of the project
    uint256 private amountRaised; // Variable to know if minimum funding raised or not


    /** 
    * @dev A vault is represented as a struct  
    */ 

    struct Vault {
        address withdrawalAddress;
        address proofOfFundingToken;
        uint256 proofOfFundingTokenAmount;  
        uint256 minFundingAmount;
        uint256 timestamp;
        uint256 exchangeRate;
        string projectURL;
        string projectTitle;
        string projectDescription;
    }
    

    // Events //
    event TokensPurchased(address indexed from, uint256 indexed amount);
    event Refund(address indexed user, uint256 indexed amount);
    event FundsWithdrawn(address indexed user, uint256 amount);


    // Modifiers //

    modifier onlyOwner {
        if (msg.sender != withdrawalAddress)  revert OwnerOnly();
        _;
    }


    // Functions //
    
     constructor (
        address _proofOfFundingToken, // The token that will be used as proof-of-funding token to incentivise contributions
        uint256 _proofOfFundingTokenAmount,  // The initial  proof-of-funding token amount which will be in fundingVault
        uint256 _minFundingAmount, // The minimum amount required to make withdraw of funds possible
        uint256 _timestamp, // The date (block height) limit until which withdrawal or after which refund is allowed.
        uint256 _exchangeRate, // The exchange rate of eth per token. 
        address _withdrawalAddress, // The address for withdrawal of funds
        address _developerFeeAddress, // The address for the developer fee
        uint256 _developerFeePercentage, // The percentage fee for the developer.
        string memory _projectURL, // A link or hash containing the project's information (e.g., GitHub repository).
        string memory _projectTitle, // Name of the Project
        string memory _projectDescription // Short description of the project
    )ERC20("Voucher", "VCHR") {
        
        proofOfFundingToken  = IERC20(_proofOfFundingToken);
        proofOfFundingTokenAmount  = _proofOfFundingTokenAmount ;
        minFundingAmount = _minFundingAmount;
        timestamp = _timestamp;
        exchangeRate = _exchangeRate;
        withdrawalAddress = _withdrawalAddress;
        developerFeeAddress =  _developerFeeAddress;
        developerFeePercentage = _developerFeePercentage;
        projectURL = _projectURL;
        projectTitle = _projectTitle;
        projectDescription = _projectDescription;
        projectTitle = _projectTitle;
        projectDescription = _projectDescription;
    }

    
    /**
     * @dev Allows users to deposit Ether and purchase proof-of-funding token based on exchange rate
     */
    function purchaseTokens() external payable {

        uint256 tokenAmount = msg.value * exchangeRate;

        if (proofOfFundingToken.balanceOf(address(this)) < tokenAmount) revert NotEnoughTokens();
        _mint(msg.sender, tokenAmount);

        amountRaised = amountRaised + msg.value;
        
        emit TokensPurchased(msg.sender, tokenAmount);
    }

    /**
     * @dev Allows users to exchange tokens for Eth (at exchange rate) if and only if the deadline has passed and the minimum number of tokens has not been sold.
     */

    function refundTokens() external payable{

        if (block.timestamp < timestamp)  revert DeadlineNotPassed();
        
        if (amountRaised >= minFundingAmount) revert MinFundingAmountReached();
        
        uint256 voucherAmount = balanceOf(msg.sender);
        uint256 refundAmount = voucherAmount / exchangeRate;

        _burn(msg.sender, voucherAmount);
       
        (bool ethTransferSuccess, ) = payable(msg.sender).call{value: refundAmount}("");

        if (!ethTransferSuccess)   revert EthTransferFailed(); 
        
        emit Refund(msg.sender, refundAmount);       
    }

    /**
     * @dev Allows Project owners to withdraw Eth if and only if the minimum number of tokens has been sold.
     
     */

    function withdrawFunds() external onlyOwner {
    
        if (amountRaised < minFundingAmount) revert MinFundingAmountNotReached();

        uint256 fundsCollected = address(this).balance;
        uint256 developerFee = (fundsCollected * developerFeePercentage) / 100;
        uint256 amountToWithdraw = fundsCollected - developerFee;

        (bool successA, ) = payable(developerFeeAddress).call{value: developerFee}("");

        if (!successA) revert EthTransferToDeveloperFailed();

        (bool successB, ) = payable(withdrawalAddress).call{value: amountToWithdraw}("");

        if (!successB) revert EthTransferToWithdrawalFailed();

        emit FundsWithdrawn(msg.sender, amountToWithdraw);
    }

    /**
     * @dev Allows Project owners to withdraw unsold tokens from the contract at any time.
     * @param UnsoldTokenAmount amount to withdraw
    */

     function withdrawUnsoldTokens(uint256 UnsoldTokenAmount) external onlyOwner {
        if (proofOfFundingToken.balanceOf(address(this)) - totalSupply() < UnsoldTokenAmount) revert NotEnoughTokens();
        
        proofOfFundingToken.safeTransfer(withdrawalAddress,UnsoldTokenAmount);
       
     }

     /**
     * @dev Allows Project owners to  add more tokens to the contract at any time.
     * @param additionalTokens amount to add
    */
    function addTokens(uint256 additionalTokens) external onlyOwner {
        proofOfFundingToken.safeTransferFrom(msg.sender,address(this),additionalTokens);
    }

    function redeem() external {
        if (block.timestamp < timestamp)  revert DeadlineNotPassed();
        uint256 voucherAmount = balanceOf(msg.sender);
        _burn(msg.sender,voucherAmount);
        proofOfFundingToken.safeTransfer(msg.sender, voucherAmount);
    }

    /**
     * @notice Get funding vault details
     * @dev to access all necessary parameters of the funding vault
     */ 
    function getVault() external view returns(Vault memory)
    {
        Vault memory VaultDetails;
        VaultDetails.withdrawalAddress = withdrawalAddress;
        VaultDetails.proofOfFundingToken  = address(proofOfFundingToken);
        VaultDetails.proofOfFundingTokenAmount  = proofOfFundingTokenAmount ;
        VaultDetails.minFundingAmount = minFundingAmount;
        VaultDetails.timestamp = timestamp;
        VaultDetails.exchangeRate = exchangeRate;
        VaultDetails.projectURL = projectURL;
        VaultDetails.projectTitle = projectTitle;
        VaultDetails.projectDescription = projectDescription;
        return VaultDetails;
    }

}