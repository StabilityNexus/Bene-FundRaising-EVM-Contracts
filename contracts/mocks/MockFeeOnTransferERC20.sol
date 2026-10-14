// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockFeeOnTransferERC20
 * @notice Test-only ERC20 that burns a fee (in basis points) from every
 * transfer, so the recipient receives less than the amount sent.
 * Minting and burning are fee-free.
 */
contract MockFeeOnTransferERC20 is ERC20 {
    uint256 private constant BPS_DENOMINATOR = 10_000;

    uint256 public immutable feeBps;

    constructor(
        string memory name_,
        string memory symbol_,
        uint256 feeBps_
    ) ERC20(name_, symbol_) {
        require(feeBps_ <= BPS_DENOMINATOR, "fee too high");
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }

        uint256 fee = (value * feeBps) / BPS_DENOMINATOR;
        if (fee > 0) {
            super._update(from, address(0), fee);
        }
        super._update(from, to, value - fee);
    }
}
