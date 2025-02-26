// SPDX-License-Identifier: AEL
pragma solidity ^0.8.18;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title FundingVault
 * @author
 * @notice A contract that allows users to deposit ERC20 tokens and receive proof-of-funding tokens in return. Project owners can withdraw funds once the minimum funding amount is reached.
 */
contract FundingVault {
	// Errors
	error MinFundingAmountReached();
	error MinFundingAmountNotReached();
	error DeadlineNotPassed();
	error NotEnoughTokens();
	error OwnerOnly();
    error InvalidAmount();

	// State Variables
	using SafeERC20 for IERC20;

	IERC20 public immutable fundingToken;
	IERC20 public immutable proofOfFundingToken;
	uint256 public immutable minFundingAmount;
	uint256 public proofOfFundingTokenAmount;
	uint256 public timestamp;
	uint256 public  exchangeRate; // Numerator
    uint256 public constant DENOMINATOR = 100000; // Fixed denominator
	address public withdrawalAddress;
	address private developerFeeAddress;
	uint256 private developerFeePercentage;
	string public projectURL;
	string public projectTitle;
	string public projectDescription;
	uint256 private amountRaised;

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
		address fundingToken;
		address developerFeeAddress;
		uint256 developerFeePercentage;
	}

	// Events
	event TokensPurchased(address indexed from, uint256 indexed amount);
	event Refund(address indexed user, uint256 indexed amount);
	event FundsWithdrawn(address indexed user, uint256 amount);

	modifier onlyOwner() {
		if (msg.sender != withdrawalAddress) revert OwnerOnly();
		_;
	}

	constructor(Vault memory params) {
		proofOfFundingToken = IERC20(params.proofOfFundingToken);
		fundingToken = IERC20(params.fundingToken);
		proofOfFundingTokenAmount = params.proofOfFundingTokenAmount;
		minFundingAmount = params.minFundingAmount;
		timestamp = params.timestamp;
		exchangeRate = params.exchangeRate;
		withdrawalAddress = params.withdrawalAddress;
		developerFeeAddress = params.developerFeeAddress;
		developerFeePercentage = params.developerFeePercentage;
		projectURL = params.projectURL;
		projectTitle = params.projectTitle;
		projectDescription = params.projectDescription;
	}

	function purchaseTokens(uint256 amount) external {
		if (amount == 0) revert InvalidAmount();

		uint256 tokenAmount = (amount * exchangeRate) / DENOMINATOR;
		if (proofOfFundingToken.balanceOf(address(this)) < tokenAmount)
			revert NotEnoughTokens();

		fundingToken.safeTransferFrom(msg.sender, address(this), amount);
		proofOfFundingToken.safeTransfer(msg.sender, tokenAmount);

		amountRaised += amount;

		emit TokensPurchased(msg.sender, tokenAmount);
	}

	function refundTokens() external {
		if (block.timestamp < timestamp) revert DeadlineNotPassed();
		if (amountRaised >= minFundingAmount) revert MinFundingAmountReached();

		uint256 tokensHeld = proofOfFundingToken.balanceOf(msg.sender);
		uint256 refundAmount = (tokensHeld * DENOMINATOR) / exchangeRate;

		proofOfFundingToken.safeTransferFrom(
			msg.sender,
			address(this),
			tokensHeld
		);
		fundingToken.safeTransfer(msg.sender, refundAmount);

		emit Refund(msg.sender, refundAmount);
	}

	function withdrawFunds() external onlyOwner {
		if (amountRaised < minFundingAmount)
			revert MinFundingAmountNotReached();

		uint256 developerFee = (amountRaised * developerFeePercentage) / 100;
		uint256 amountToWithdraw = amountRaised - developerFee;

		fundingToken.safeTransfer(developerFeeAddress, developerFee);
		fundingToken.safeTransfer(withdrawalAddress, amountToWithdraw);

		emit FundsWithdrawn(msg.sender, amountToWithdraw);
	}

	function withdrawUnsoldTokens(
		uint256 UnsoldTokenAmount
	) external onlyOwner {
		if (proofOfFundingToken.balanceOf(address(this)) < UnsoldTokenAmount)
			revert NotEnoughTokens();

		proofOfFundingToken.safeTransferFrom(
			address(this),
			withdrawalAddress,
			UnsoldTokenAmount
		);
	}

	
	function addTokens(uint256 additionalTokens) external onlyOwner {
		proofOfFundingToken.safeTransferFrom(
			msg.sender,
			address(this),
			additionalTokens
		);
	}

    function redeem() external{
		if(block.timestamp < timestamp) revert DeadlineNotPassed();
		uint256 voucherAmount=proofOfFundingToken.balanceOf(msg.sender);
		proofOfFundingToken.safeTransferFrom(msg.sender, address(this), voucherAmount);
		fundingToken.safeTransfer(msg.sender, voucherAmount);
	}

	function getVault() external view returns (Vault memory) {
		return
			Vault({
				withdrawalAddress: withdrawalAddress,
				proofOfFundingToken: address(proofOfFundingToken),
				proofOfFundingTokenAmount: proofOfFundingTokenAmount,
				minFundingAmount: minFundingAmount,
				timestamp: timestamp,
				exchangeRate: exchangeRate,
				projectURL: projectURL,
				projectTitle: projectTitle,
				projectDescription: projectDescription,
				fundingToken: address(fundingToken),
				developerFeeAddress: developerFeeAddress,
				developerFeePercentage: developerFeePercentage
			});
	}
}
