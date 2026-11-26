// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MockHookERC20, ITokenHookReceiver} from "./MockHookERC20.sol";

/**
 * @title GasBurningRecipient
 * @notice Test-only recipient that burns a configurable amount of gas when it
 * is paid, whether by a plain ETH transfer or by an ERC777-style token hook
 * (after register()). With gasToBurn set to a huge value it burns every bit of
 * gas it is given and so can never accept a payment; with a moderate value it
 * accepts once the gas is spent; with 0 (the default) it accepts at once.
 */
contract GasBurningRecipient is ITokenHookReceiver {
    uint256 public gasToBurn;

    function setGasToBurn(uint256 amount) external {
        gasToBurn = amount;
    }

    /// @notice Opts this contract in to the token's recipient hook.
    function register(MockHookERC20 token) external {
        token.registerHook();
    }

    receive() external payable {
        _burn();
    }

    function tokensReceived(address, address, uint256) external view override {
        _burn();
    }

    function tokensToSend(address, address, uint256) external override {}

    function _burn() private view {
        uint256 start = gasleft();
        while (start - gasleft() < gasToBurn) {}
    }
}
