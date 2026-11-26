// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockReturnFalseERC20
 * @notice Test-only ERC20 whose transfer() returns false instead of reverting
 * when the recipient is blocked, as some older tokens do. Nothing moves in that
 * case. transferFrom and everything else behave normally.
 */
contract MockReturnFalseERC20 is ERC20 {
    mapping(address => bool) public blocked;

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {}

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(
        address to,
        uint256 value
    ) public override returns (bool) {
        if (blocked[to]) return false;
        return super.transfer(to, value);
    }
}
