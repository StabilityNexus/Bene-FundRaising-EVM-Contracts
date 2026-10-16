// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title ReentrantFeeReceiver
 * @notice Test-only contract that is both a native FundingVault's withdrawal
 * address (so it may call the owner-only withdrawFunds) and its developer fee
 * address. While withdrawFunds is paying it, it calls back into the vault once
 * from its receive hook and records whether that call succeeded and what it
 * reverted with. Being the owner matters: otherwise onlyOwner would stop the
 * re-entrant call before a reentrancy guard ever ran.
 */
contract ReentrantFeeReceiver {
    address public vault;
    bytes public reentrantCall;

    bool public attempted;
    bool public reentrySucceeded;
    bytes public reentryRevertData;

    /**
     * @param vault_ the vault to withdraw from and re-enter
     * @param reentrantCall_ calldata to send to the vault from the receive hook
     */
    function attack(address vault_, bytes calldata reentrantCall_) external {
        vault = vault_;
        reentrantCall = reentrantCall_;

        (bool success, bytes memory result) = vault_.call(
            abi.encodeWithSignature("withdrawFunds()")
        );
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    /**
     * @notice Lets a test make an arbitrary call to the vault as this contract
     * (e.g. claimPending). Returns instead of reverting so tests can inspect it.
     */
    function callVault(bytes calldata data) external returns (bool success, bytes memory result) {
        return vault.call(data);
    }

    receive() external payable {
        // Only the first payment tries to re-enter; later ones just accept ETH.
        if (attempted) return;
        attempted = true;

        (bool success, bytes memory result) = vault.call(reentrantCall);
        reentrySucceeded = success;
        reentryRevertData = result;
    }
}
