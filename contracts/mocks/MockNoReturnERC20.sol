// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title MockNoReturnERC20
 * @notice Test-only token in the style of USDT: transfer(), transferFrom() and
 * approve() succeed without returning anything, so a caller that insists on a
 * returned bool would wrongly treat them as failures. A transfer to a blocked
 * recipient reverts. It is deliberately not built on OpenZeppelin's ERC20,
 * whose functions return a bool.
 */
contract MockNoReturnERC20 {
    error RecipientBlocked(address account);

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
    }

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function mint(address to, uint256 amount) external {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 value) external {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
    }

    function transfer(address to, uint256 value) external {
        _move(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= value, "MockNoReturnERC20: allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - value;
        }
        _move(from, to, value);
    }

    function _move(address from, address to, uint256 value) private {
        if (blocked[to]) revert RecipientBlocked(to);
        require(balanceOf[from] >= value, "MockNoReturnERC20: balance");
        balanceOf[from] -= value;
        balanceOf[to] += value;
        emit Transfer(from, to, value);
    }
}
