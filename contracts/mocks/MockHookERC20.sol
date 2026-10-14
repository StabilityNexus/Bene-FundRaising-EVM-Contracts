// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @notice ERC777-style hook interface used by MockHookERC20.
 */
interface ITokenHookReceiver {
    function tokensToSend(address from, address to, uint256 amount) external;

    function tokensReceived(address from, address to, uint256 amount) external;
}

/**
 * @title MockHookERC20
 * @notice Test-only ERC20 that calls ERC777-style hooks on transfers. A
 * contract opts in with registerHook() (standing in for the ERC1820 registry).
 * tokensToSend runs on the sender BEFORE balances change and tokensReceived on
 * the recipient AFTER, so a registered contract can re-enter its caller.
 * Hook reverts propagate.
 */
contract MockHookERC20 is ERC20 {
    mapping(address => bool) public hookRegistered;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {}

    function registerHook() external {
        hookRegistered[msg.sender] = true;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        bool isTransfer = from != address(0) && to != address(0);

        if (isTransfer && hookRegistered[from]) {
            ITokenHookReceiver(from).tokensToSend(from, to, value);
        }

        super._update(from, to, value);

        if (isTransfer && hookRegistered[to]) {
            ITokenHookReceiver(to).tokensReceived(from, to, value);
        }
    }
}
