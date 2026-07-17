// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;


import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract FundingToken is ERC20, Ownable {

    constructor(uint256 initialSupply, address initialOwner) ERC20("FundingToken", "FTk") Ownable(msg.sender) {

        // Mint initial supply to the deployer of the contract
        _mint(initialOwner, initialSupply);
    }
     function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }

}
