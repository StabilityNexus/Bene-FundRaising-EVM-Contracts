import { expect } from "chai";
import { ethers } from "hardhat";

describe("Test mocks", function () {
  describe("MockERC20", function () {
    it("should report the configured decimals", async function () {
      const token = await (await ethers.getContractFactory("MockERC20")).deploy("Six", "SIX", 6);

      expect(await token.decimals()).to.equal(6n);
    });

    it("should transfer the full amount without a fee", async function () {
      const [sender, receiver] = await ethers.getSigners();
      const token = await (await ethers.getContractFactory("MockERC20")).deploy("Six", "SIX", 6);
      await token.mint(sender.address, 1000n);

      await expect(token.transfer(receiver.address, 1000n)).to.changeTokenBalance(token, receiver, 1000n);
    });
  });

  describe("MockFeeOnTransferERC20", function () {
    async function deployFeeToken() {
      const [sender, receiver] = await ethers.getSigners();
      const token = await (await ethers.getContractFactory("MockFeeOnTransferERC20")).deploy("Fee", "FEE", 100);
      await token.mint(sender.address, 10_000n);
      return { token, sender, receiver };
    }

    it("should deliver less than the amount sent on transfer", async function () {
      const { token, receiver } = await deployFeeToken();

      await expect(token.transfer(receiver.address, 1000n)).to.changeTokenBalance(token, receiver, 990n);
    });

    it("should burn the fee from the total supply", async function () {
      const { token, receiver } = await deployFeeToken();

      await token.transfer(receiver.address, 1000n);

      expect(await token.totalSupply()).to.equal(9_990n);
    });

    it("should charge the fee on transferFrom too", async function () {
      const { token, sender, receiver } = await deployFeeToken();
      const [, , spender] = await ethers.getSigners();
      await token.approve(spender.address, 1000n);

      await expect(token.connect(spender).transferFrom(sender.address, receiver.address, 1000n)).to.changeTokenBalance(
        token,
        receiver,
        990n,
      );
    });

    it("should not charge a fee when minting", async function () {
      const { token, receiver } = await deployFeeToken();

      await expect(token.mint(receiver.address, 1000n)).to.changeTokenBalance(token, receiver, 1000n);
    });
  });
});
