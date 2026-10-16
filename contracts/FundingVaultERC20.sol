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
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VaultTypes} from "./VaultTypes.sol";

/**
 * @title FundingVault
 * @author Muhammad Zain Nasir
 * @notice A contract that allows users to deposit funds and receive proof-of-funding token in return box creator can call WithdrawFunds if there enough funds collected
 */
contract FundingVaultERC20 is ERC20, ReentrancyGuard {
    // Errors //
    error MinFundingAmountReached();
    error MinFundingAmountNotReached();
    error DeadlineNotPassed();
    error NotEnoughTokens();
    //error EthTransferFailed();
    //error EthTransferToDeveloperFailed();
    //error EthTransferToWithdrawalFailed();
    error NothingToClaim();
    error ZeroAddressRecipient();
    error OwnerOnly();

    // State Variables //
    using SafeERC20 for IERC20;
    IERC20 public immutable proofOfFundingToken; // The token that will be used as proof-of-funding token to incentivise contributions
    IERC20 public immutable fundingToken;
    uint256 public timestamp; // The date limit until which withdrawal or after which refund is allowed.
    uint256 public immutable minFundingAmount; // The minimum amount of ETH required in the contract to enable withdrawal.
    uint256 public exchangeRate; // The exchange rate of ETH per token
    address public withdrawalAddress; // WithdrawalAddress is also considered as owner of the Vault.
    address private developerFeeAddress; // Developer address
    uint256 private developerFeePercentage; // Developer percentage in funds collected
    string public projectURL; // A link or hash containing the project's information (e.g., GitHub repository).
    string public projectTitle; // Name of the Project
    string public projectDescription; // Short description of the project
    uint256 public totalSold; // Total funding ever received. Only ever increases.
    uint256 public totalRefunded; // Total funding ever refunded. Only ever increases.
    mapping(address => uint256) public pendingWithdrawals; // Payouts that could not be sent and wait to be claimed.
    uint256 private totalPending; // Sum of pendingWithdrawals, excluded from the next withdrawal.

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
    event WithdrawalCredited(address indexed recipient, uint256 amount);
    event PendingWithdrawalClaimed(
        address indexed account,
        address indexed to,
        uint256 amount
    );

    // Modifiers //

    modifier onlyOwner() {
        if (msg.sender != withdrawalAddress) revert OwnerOnly();
        _;
    }

    // Functions //

    constructor(VaultTypes.VaultConfig memory config) ERC20("Voucher", "VCHR") {
        proofOfFundingToken = IERC20(config.proofOfFundingToken);
        fundingToken = IERC20(config.fundingToken);
        minFundingAmount = config.minFundingAmount;
        timestamp = config.timestamp;
        exchangeRate = config.exchangeRate;
        withdrawalAddress = config.withdrawalAddress;
        developerFeeAddress = config.developerFeeAddress;
        developerFeePercentage = config.developerFeePercentage;
        projectURL = config.projectURL;
        projectTitle = config.projectTitle;
        projectDescription = config.projectDescription;
    }

    /**
     * @dev Allows users to deposit ERC20 funding Token and purchase proof-of-funding token based on exchange rate
     */
    function purchaseTokens(uint256 fundingAmount) external nonReentrant {
        // Credit what the vault actually received: a fee-on-transfer funding
        // token delivers less than fundingAmount.
        uint256 balanceBefore = fundingToken.balanceOf(address(this));
        fundingToken.safeTransferFrom(msg.sender, address(this), fundingAmount);
        uint256 received = fundingToken.balanceOf(address(this)) -
            balanceBefore;

        uint256 tokenAmount = received * exchangeRate;

        if (
            proofOfFundingToken.balanceOf(address(this)) - totalSupply() <
            tokenAmount
        ) revert NotEnoughTokens();

        _mint(msg.sender, tokenAmount);
        totalSold = totalSold + received;

        emit TokensPurchased(msg.sender, tokenAmount);
    }

    /**
     * @dev Allows users to exchange tokens for Eth (at exchange rate) if and only if the deadline has passed and the minimum number of tokens has not been sold.
     */

    function refundTokens() external nonReentrant {
        if (block.timestamp <= timestamp) revert DeadlineNotPassed();

        if (minimumReached()) revert MinFundingAmountReached();

        uint256 voucherAmount = balanceOf(msg.sender);
        uint256 refundAmount = voucherAmount / exchangeRate;

        _burn(msg.sender, voucherAmount);
        totalRefunded = totalRefunded + refundAmount;

        fundingToken.safeTransfer(msg.sender, refundAmount);

        emit Refund(msg.sender, refundAmount);
    }

    /**
     * @dev Allows Project owners to withdraw ERC20 funding Tokens if and only if the minimum number of tokens has been sold.
     * A recipient the funding token refuses to pay does not block the withdrawal: its share is credited to
     * pendingWithdrawals instead and can be claimed with claimPending.
     */

    function withdrawFunds() external onlyOwner nonReentrant {
        if (!minimumReached()) revert MinFundingAmountNotReached();

        uint256 fundsCollected = fundingToken.balanceOf(address(this)) -
            totalPending;
        uint256 developerFee = (fundsCollected * developerFeePercentage) / 100;
        uint256 amountToWithdraw = fundsCollected - developerFee;

        _payOrCredit(developerFeeAddress, developerFee);
        _payOrCredit(withdrawalAddress, amountToWithdraw);

        emit FundsWithdrawn(msg.sender, amountToWithdraw);
    }

    /**
     * @dev Sends the caller's credited payout to the given address. The recipient of a credit may be
     * blocked by the funding token, so it can name a different address.
     * @param to address that receives the credited amount
     */
    function claimPending(address to) external nonReentrant {
        if (to == address(0)) revert ZeroAddressRecipient();

        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToClaim();

        pendingWithdrawals[msg.sender] = 0;
        totalPending = totalPending - amount;

        fundingToken.safeTransfer(to, amount);

        emit PendingWithdrawalClaimed(msg.sender, to, amount);
    }

    /**
     * @dev Allows Project owners to withdraw unsold tokens from the contract at any time.
     * @param UnsoldTokenAmount amount to withdraw
     */

    function withdrawUnsoldTokens(
        uint256 UnsoldTokenAmount
    ) external onlyOwner {
        if (
            proofOfFundingToken.balanceOf(address(this)) - totalSupply() <
            UnsoldTokenAmount
        ) revert NotEnoughTokens();

        proofOfFundingToken.safeTransfer(withdrawalAddress, UnsoldTokenAmount);
    }

    /**
     * @dev Allows Project owners to  add more tokens to the contract at any time.
     * @param additionalTokens amount to add
     */
    function addTokens(uint256 additionalTokens) external onlyOwner {
        proofOfFundingToken.safeTransferFrom(
            msg.sender,
            address(this),
            additionalTokens
        );
    }

    /**
     * @dev Allows contributors to exchange vouchers for proof-of-funding tokens as soon as the minimum funding amount has been reached.
     */
    function redeem() external nonReentrant {
        if (!minimumReached()) revert MinFundingAmountNotReached();
        uint256 voucherAmount = balanceOf(msg.sender);
        _burn(msg.sender, voucherAmount);
        proofOfFundingToken.safeTransfer(msg.sender, voucherAmount);
    }

    /**
     * @dev Pays the amount to the recipient, or credits it to pendingWithdrawals if the funding token
     * refuses the transfer. Nothing is sent for a zero amount.
     */
    function _payOrCredit(address to, uint256 amount) private {
        if (amount == 0) return;

        if (!fundingToken.trySafeTransfer(to, amount)) {
            pendingWithdrawals[to] = pendingWithdrawals[to] + amount;
            totalPending = totalPending + amount;
            emit WithdrawalCredited(to, amount);
        }
    }

    /**
     * @notice The proof-of-funding tokens the vault currently holds: those reserved for outstanding
     * vouchers plus the unsold remainder.
     * @dev Read from the token balance rather than stored, so it cannot go stale after addTokens,
     * withdrawUnsoldTokens or redeem, and it is correct even when the token charges a transfer fee.
     */
    function proofOfFundingTokenAmount() public view returns (uint256) {
        return proofOfFundingToken.balanceOf(address(this));
    }

    /**
     * @notice Whether the net funding (sold minus refunded) has reached the minimum.
     * @dev Refunds are only possible while this is false, so once it turns true it stays true.
     */
    function minimumReached() public view returns (bool) {
        return totalSold - totalRefunded >= minFundingAmount;
    }

    /**
     * @notice Get funding vault details
     * @dev to access all necessary parameters of the funding vault
     */
    function getVault() external view returns (Vault memory) {
        Vault memory VaultDetails;
        VaultDetails.withdrawalAddress = withdrawalAddress;
        VaultDetails.proofOfFundingToken = address(proofOfFundingToken);
        VaultDetails.fundingToken = address(fundingToken);
        VaultDetails.proofOfFundingTokenAmount = proofOfFundingTokenAmount();
        VaultDetails.minFundingAmount = minFundingAmount;
        VaultDetails.timestamp = timestamp;
        VaultDetails.exchangeRate = exchangeRate;
        VaultDetails.projectURL = projectURL;
        VaultDetails.projectTitle = projectTitle;
        VaultDetails.projectDescription = projectDescription;
        return VaultDetails;
    }
}
