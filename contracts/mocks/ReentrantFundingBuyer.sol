// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FundingVaultERC20} from "../FundingVaultERC20.sol";
import {MockHookERC20, ITokenHookReceiver} from "./MockHookERC20.sol";

/**
 * @title ReentrantFundingBuyer
 * @notice Test-only contributor that, from the funding token's tokensToSend
 * hook, re-enters FundingVaultERC20.purchaseTokens a configurable number of
 * times while the outer purchase is still in flight.
 */
contract ReentrantFundingBuyer is ITokenHookReceiver {
    FundingVaultERC20 public immutable vault;
    MockHookERC20 public immutable fundingToken;

    uint256 public purchaseAmount;
    uint256 public reentriesLeft;

    constructor(FundingVaultERC20 vault_, MockHookERC20 fundingToken_) {
        vault = vault_;
        fundingToken = fundingToken_;
    }

    function attack(uint256 amount, uint256 reentries) external {
        purchaseAmount = amount;
        reentriesLeft = reentries;

        fundingToken.registerHook();
        fundingToken.approve(address(vault), amount * (reentries + 1));
        vault.purchaseTokens(amount);
    }

    function tokensToSend(address, address, uint256) external override {
        if (reentriesLeft > 0) {
            reentriesLeft--;
            vault.purchaseTokens(purchaseAmount);
        }
    }

    function tokensReceived(address, address, uint256) external override {}
}
