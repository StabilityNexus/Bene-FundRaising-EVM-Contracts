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
    error OwnerOnly();


    // State Variables //
    using SafeERC20 for IERC20;
    IERC20 public immutable proofOfFundingToken; // The token that will be used as proof-of-funding token to incentivise contributions
    IERC20 public immutable fundingToken; // The ERC20 token used to fund the vault
    uint256 public proofOfFundingTokenAmount; // The initial amount of proof-of-funding tokens deposited to the vault (for informational purposes)
    uint256 public timestamp; // The date limit until which withdrawal or after which refund is allowed.
    uint256 public immutable minFundingAmount; // The minimum amount of funding token required in the contract to enable withdrawal.
    uint256 public exchangeRate; // The exchange rate of funding token per proof-of-funding token
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
        address fundingToken;
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
        address _fundingToken, // The ERC20 token used for funding
        uint256 _proofOfFundingTokenAmount,  // The initial  proof-of-funding token amount which will be in fundingVault
        uint256 _minFundingAmount, // The minimum amount of funding token required to make withdraw of funds possible
        uint256 _timestamp, // The date (block height) limit until which withdrawal or after which refund is allowed.
        uint256 _exchangeRate, // The exchange rate of funding token per proof-of-funding token. 
        address _withdrawalAddress, // The address for withdrawal of funds
        address _developerFeeAddress, // The address for the developer fee
        uint256 _developerFeePercentage, // The percentage fee for the developer.
        string memory _projectURL, // A link or hash containing the project's information (e.g., GitHub repository).
        string memory _projectTitle, // Name of the Project
        string memory _projectDescription // Short description of the project
    )ERC20("Voucher", "VCHR") {
        
        proofOfFundingToken  = IERC20(_proofOfFundingToken);
        fundingToken = IERC20(_fundingToken);
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
    }

    
    /**
     * @dev Allows users to deposit ERC20 funding tokens and receive voucher tokens (VCHR) based on exchange rate
     * @param amount The amount of funding tokens to deposit
     */
    function purchaseTokens(uint256 amount) external {
        require(amount > 0, "Amount must be greater than 0");

        uint256 voucherAmount = amount * exchangeRate;

        // Check if enough proof-of-funding tokens are available for redemption
        if (proofOfFundingToken.balanceOf(address(this)) < voucherAmount) revert NotEnoughTokens();
        
        // Transfer funding tokens from user to this contract
        fundingToken.safeTransferFrom(msg.sender, address(this), amount);
        
        // Mint vouchers to user (VCHR tokens represent their participation)
        _mint(msg.sender, voucherAmount);

        amountRaised = amountRaised + amount;
        
        emit TokensPurchased(msg.sender, voucherAmount);
    }

    /**
     * @dev Allows users to exchange voucher tokens for funding tokens (at exchange rate) if and only if the deadline has passed and the minimum funding amount has not been reached.
     */
    function refundTokens() external {

        if (block.timestamp < timestamp)  revert DeadlineNotPassed();
        
        if (amountRaised >= minFundingAmount) revert MinFundingAmountReached();
        
        uint256 voucherAmount = balanceOf(msg.sender);
        uint256 refundAmount = voucherAmount / exchangeRate;

        _burn(msg.sender, voucherAmount);
       
        fundingToken.safeTransfer(msg.sender, refundAmount);
        
        emit Refund(msg.sender, refundAmount);       
    }

    /**
     * @dev Allows Project owners to withdraw funding tokens if and only if the minimum funding amount has been reached.
     */
    function withdrawFunds() external onlyOwner {
    
        if (amountRaised < minFundingAmount) revert MinFundingAmountNotReached();

        uint256 fundsCollected = fundingToken.balanceOf(address(this));
        uint256 developerFee = (fundsCollected * developerFeePercentage) / 100;
        uint256 amountToWithdraw = fundsCollected - developerFee;

        fundingToken.safeTransfer(developerFeeAddress, developerFee);

        fundingToken.safeTransfer(withdrawalAddress, amountToWithdraw);

        emit FundsWithdrawn(msg.sender, amountToWithdraw);
    }

    /**
     * @dev Allows Project owners to withdraw unsold proof-of-funding tokens from the contract at any time.
     * @param UnsoldTokenAmount amount to withdraw
    */
     function withdrawUnsoldTokens(uint256 UnsoldTokenAmount) external onlyOwner {
        if (proofOfFundingToken.balanceOf(address(this)) < UnsoldTokenAmount) revert NotEnoughTokens();
        
        proofOfFundingToken.safeTransfer(withdrawalAddress, UnsoldTokenAmount);
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
        VaultDetails.fundingToken = address(fundingToken);
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