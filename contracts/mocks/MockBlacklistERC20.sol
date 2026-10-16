// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockBlacklistERC20
 * @notice Test-only ERC20 that reverts any transfer to a blocked address,
 * like a stablecoin that can blacklist recipients.
 */
contract MockBlacklistERC20 is ERC20 {
    error RecipientBlocked(address account);

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

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        if (blocked[to]) revert RecipientBlocked(to);
        super._update(from, to, value);
    }
}
