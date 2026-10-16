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
import {VaultTypes} from "./VaultTypes.sol";

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
    error NothingToClaim();
    error ZeroAddressRecipient();
    error OwnerOnly();

    // State Variables //
    using SafeERC20 for IERC20;
    IERC20 public immutable proofOfFundingToken; // The token that will be used as proof-of-funding token to incentivise contributions
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
    event Redeemed(address indexed user, uint256 amount);
    event TokensAdded(address indexed owner, uint256 amount);
    event UnsoldTokensWithdrawn(address indexed owner, uint256 amount);
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
     * @dev Allows users to deposit Ether and purchase proof-of-funding token based on exchange rate
     */
    function purchaseTokens() external payable {
        uint256 tokenAmount = msg.value * exchangeRate;

        if (
            proofOfFundingToken.balanceOf(address(this)) - totalSupply() <
            tokenAmount
        ) revert NotEnoughTokens();
        _mint(msg.sender, tokenAmount);
        //proofOfFundingToken.safeTransfer(msg.sender,tokenAmount);

        totalSold = totalSold + msg.value;

        emit TokensPurchased(msg.sender, tokenAmount);
    }

    /**
     * @dev Allows users to exchange tokens for Eth (at exchange rate) if and only if the deadline has passed and the minimum number of tokens has not been sold.
     */

    function refundTokens() external {
        if (block.timestamp <= timestamp) revert DeadlineNotPassed();

        if (minimumReached()) revert MinFundingAmountReached();

        uint256 voucherAmount = balanceOf(msg.sender);
        uint256 refundAmount = voucherAmount / exchangeRate;

        _burn(msg.sender, voucherAmount);
        totalRefunded = totalRefunded + refundAmount;

        (bool ethTransferSuccess, ) = payable(msg.sender).call{
            value: refundAmount
        }("");

        if (!ethTransferSuccess) revert EthTransferFailed();

        emit Refund(msg.sender, refundAmount);
    }

    /**
     * @dev Allows Project owners to withdraw Eth if and only if the minimum number of tokens has been sold.
     * A recipient that cannot receive the payout does not block the withdrawal: its share is credited to
     * pendingWithdrawals instead and can be claimed with claimPending.
     */

    function withdrawFunds() external onlyOwner {
        if (!minimumReached()) revert MinFundingAmountNotReached();

        uint256 fundsCollected = address(this).balance - totalPending;
        uint256 developerFee = (fundsCollected * developerFeePercentage) / 100;
        uint256 amountToWithdraw = fundsCollected - developerFee;

        _payOrCredit(developerFeeAddress, developerFee);
        _payOrCredit(withdrawalAddress, amountToWithdraw);

        emit FundsWithdrawn(msg.sender, amountToWithdraw);
    }

    /**
     * @dev Sends the caller's credited payout to the given address. The recipient of a credit may not
     * be able to receive ETH itself, so it can name a different address.
     * @param to address that receives the credited amount
     */
    function claimPending(address payable to) external {
        if (to == address(0)) revert ZeroAddressRecipient();

        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToClaim();

        pendingWithdrawals[msg.sender] = 0;
        totalPending = totalPending - amount;

        (bool success, ) = to.call{value: amount}("");
        if (!success) revert EthTransferFailed();

        emit PendingWithdrawalClaimed(msg.sender, to, amount);
    }

    /**
     * @dev Allows Project owners to withdraw unsold tokens from the contract once the deadline has passed.
     * @param UnsoldTokenAmount amount to withdraw
     */

    function withdrawUnsoldTokens(
        uint256 UnsoldTokenAmount
    ) external onlyOwner {
        if (block.timestamp <= timestamp) revert DeadlineNotPassed();

        if (
            proofOfFundingToken.balanceOf(address(this)) - totalSupply() <
            UnsoldTokenAmount
        ) revert NotEnoughTokens();

        proofOfFundingToken.safeTransfer(withdrawalAddress, UnsoldTokenAmount);

        emit UnsoldTokensWithdrawn(msg.sender, UnsoldTokenAmount);
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

        emit TokensAdded(msg.sender, additionalTokens);
    }

    /**
     * @dev Allows contributors to exchange vouchers for proof-of-funding tokens as soon as the minimum funding amount has been reached.
     */
    function redeem() external {
        if (!minimumReached()) revert MinFundingAmountNotReached();
        uint256 voucherAmount = balanceOf(msg.sender);
        _burn(msg.sender, voucherAmount);
        proofOfFundingToken.safeTransfer(msg.sender, voucherAmount);

        emit Redeemed(msg.sender, voucherAmount);
    }

    /**
     * @dev Pays the amount to the recipient, or credits it to pendingWithdrawals if the transfer fails.
     * Nothing is sent for a zero amount, so a zero fee never calls the developer address.
     */
    function _payOrCredit(address to, uint256 amount) private {
        if (amount == 0) return;

        (bool success, ) = payable(to).call{value: amount}("");
        if (!success) {
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
