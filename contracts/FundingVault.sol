// SPDX-License-Identifier: AEL
pragma solidity ^0.8.18;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FundingVault
 * @author Muhammad Zain Nasir
 * @notice ERC20-based fundraising vault with generic token support
 */
contract FundingVault is ERC20 {
    using SafeERC20 for IERC20;

    // ---------------- Errors ----------------
    error MinFundingAmountReached();
    error MinFundingAmountNotReached();
    error DeadlineNotPassed();
    error NotEnoughTokens();
    error OwnerOnly();

    // ---------------- State Variables ----------------

    IERC20 public immutable fundingToken;          // ERC20 token used for fundraising (USDT, DAI, etc.)
    IERC20 public immutable proofOfFundingToken;   // ERC20 reward token

    uint256 public proofOfFundingTokenAmount;
    uint256 public immutable minFundingAmount;
    uint256 public timestamp;
    uint256 public exchangeRate;

    address public withdrawalAddress;
    address public developerFeeAddress;
    uint256 public developerFeePercentage;

    string public projectURL;
    string public projectTitle;
    string public projectDescription;

    uint256 public amountRaised;

    // ---------------- Struct ----------------

    struct Vault {
        address fundingToken;
        address proofOfFundingToken;
        uint256 proofOfFundingTokenAmount;
        uint256 minFundingAmount;
        uint256 timestamp;
        uint256 exchangeRate;
        address withdrawalAddress;
        string projectURL;
        string projectTitle;
        string projectDescription;
    }

    // ---------------- Events ----------------

    event TokensPurchased(address indexed user, uint256 fundingAmount, uint256 rewardAmount);
    event Refund(address indexed user, uint256 fundingAmount);
    event FundsWithdrawn(address indexed owner, uint256 amount);

    // ---------------- Modifiers ----------------

    modifier onlyOwner() {
        if (msg.sender != withdrawalAddress) revert OwnerOnly();
        _;
    }

    // ---------------- Constructor ----------------

    constructor(
        address _fundingToken,
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
    ) ERC20("Voucher", "VCHR") {
        fundingToken = IERC20(_fundingToken);
        proofOfFundingToken = IERC20(_proofOfFundingToken);

        proofOfFundingTokenAmount = _proofOfFundingTokenAmount;
        minFundingAmount = _minFundingAmount;
        timestamp = _timestamp;
        exchangeRate = _exchangeRate;

        withdrawalAddress = _withdrawalAddress;
        developerFeeAddress = _developerFeeAddress;
        developerFeePercentage = _developerFeePercentage;

        projectURL = _projectURL;
        projectTitle = _projectTitle;
        projectDescription = _projectDescription;
    }

    // ---------------- External Functions ----------------

    /**
     * @notice Fund the project using ERC20 tokens
     * @param fundingAmount Amount of ERC20 funding token
     */
    function purchaseTokens(uint256 fundingAmount) external {
        require(fundingAmount > 0, "Invalid amount");

        uint256 rewardAmount = fundingAmount * exchangeRate;

        if (
            proofOfFundingToken.balanceOf(address(this)) - totalSupply()
            < rewardAmount
        ) revert NotEnoughTokens();

        fundingToken.safeTransferFrom(
            msg.sender,
            address(this),
            fundingAmount
        );

        proofOfFundingToken.safeTransfer(msg.sender, rewardAmount);

        amountRaised += fundingAmount;

        emit TokensPurchased(msg.sender, fundingAmount, rewardAmount);
    }

    /**
     * @notice Refund users if minimum funding not reached
     */
    function refundTokens() external {
        if (block.timestamp < timestamp) revert DeadlineNotPassed();
        if (amountRaised >= minFundingAmount) revert MinFundingAmountReached();

        uint256 voucherAmount = balanceOf(msg.sender);
        uint256 refundAmount = voucherAmount / exchangeRate;

        _burn(msg.sender, voucherAmount);

        fundingToken.safeTransfer(msg.sender, refundAmount);

        emit Refund(msg.sender, refundAmount);
    }

    /**
     * @notice Withdraw raised funds (project owner)
     */
    function withdrawFunds() external onlyOwner {
        if (amountRaised < minFundingAmount) revert MinFundingAmountNotReached();

        uint256 totalFunds = fundingToken.balanceOf(address(this));
        uint256 developerFee = (totalFunds * developerFeePercentage) / 100;
        uint256 ownerAmount = totalFunds - developerFee;

        fundingToken.safeTransfer(developerFeeAddress, developerFee);
        fundingToken.safeTransfer(withdrawalAddress, ownerAmount);

        emit FundsWithdrawn(msg.sender, ownerAmount);
    }

    /**
     * @notice Withdraw unsold reward tokens
     */
    function withdrawUnsoldTokens(uint256 amount) external onlyOwner {
        if (
            proofOfFundingToken.balanceOf(address(this)) - totalSupply()
            < amount
        ) revert NotEnoughTokens();

        proofOfFundingToken.safeTransfer(withdrawalAddress, amount);
    }

    /**
     * @notice Add more reward tokens
     */
    function addTokens(uint256 amount) external onlyOwner {
        proofOfFundingToken.safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Redeem voucher tokens for reward tokens after deadline
     */
    function redeem() external {
        if (block.timestamp < timestamp) revert DeadlineNotPassed();

        uint256 voucherAmount = balanceOf(msg.sender);
        _burn(msg.sender, voucherAmount);

        proofOfFundingToken.safeTransfer(msg.sender, voucherAmount);
    }

    // ---------------- View Functions ----------------

    function getVault() external view returns (Vault memory) {
        return Vault({
            fundingToken: address(fundingToken),
            proofOfFundingToken: address(proofOfFundingToken),
            proofOfFundingTokenAmount: proofOfFundingTokenAmount,
            minFundingAmount: minFundingAmount,
            timestamp: timestamp,
            exchangeRate: exchangeRate,
            withdrawalAddress: withdrawalAddress,
            projectURL: projectURL,
            projectTitle: projectTitle,
            projectDescription: projectDescription
        });
    }
}
