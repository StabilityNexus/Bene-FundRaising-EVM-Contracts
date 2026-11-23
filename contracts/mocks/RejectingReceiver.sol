// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RejectingReceiver
 * @notice Test-only contract that reverts on every plain ETH transfer but can
 * still make arbitrary calls through execute(). It stands in for a recipient
 * (such as a developer fee address or a vault's withdrawal address) that
 * cannot receive ETH.
 */
contract RejectingReceiver {
    receive() external payable {
        revert("RejectingReceiver: ETH not accepted");
    }

    function execute(
        address target,
        bytes calldata data
    ) external returns (bytes memory result) {
        bool success;
        (success, result) = target.call(data);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }
}
