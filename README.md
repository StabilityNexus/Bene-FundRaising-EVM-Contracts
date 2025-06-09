
<!-- Don't delete it -->
<div name="readme-top"></div>

<!-- Organization Logo -->
<div align="center">
  <img alt="Stability Nexus" src="public/orglogo.svg" width="175">
  &nbsp;
  &nbsp;
  <img src="public/plusSign" width="30" height="175" />
  &nbsp;
  &nbsp;
  <img src="public/logo.svg" width="175" />
</div>

&nbsp;

<!-- Organization Name -->
<div align="center">

[![Static Badge](https://img.shields.io/badge/Stability_Nexus-/Bene-228B22?style=for-the-badge&labelColor=FFC517)](https://bene-evm.stability.nexus/)

</div>

<!-- Organization/Project Social Handles -->
<p align="center">
<!-- Telegram -->
<a href="https://t.me/StabilityNexus">
<img src="https://img.shields.io/badge/Telegram-black?style=flat&logo=telegram&logoColor=white&logoSize=auto&color=24A1DE" alt="Telegram Badge"/></a>
&nbsp;&nbsp;
<!-- X (formerly Twitter) -->
<a href="https://x.com/StabilityNexus">
<img src="https://img.shields.io/twitter/follow/StabilityNexus" alt="X (formerly Twitter) Badge"/></a>
&nbsp;&nbsp;
<!-- Discord -->
<a href="https://discord.gg/YzDKeEfWtS">
<img src="https://img.shields.io/discord/995968619034984528?style=flat&logo=discord&logoColor=white&logoSize=auto&label=Discord&labelColor=5865F2&color=57F287" alt="Discord Badge"/></a>
&nbsp;&nbsp;
<!-- Medium -->
<a href="https://news.stability.nexus/">
  <img src="https://img.shields.io/badge/Medium-black?style=flat&logo=medium&logoColor=black&logoSize=auto&color=white" alt="Medium Badge"></a>
&nbsp;&nbsp;
<!-- LinkedIn -->
<a href="https://linkedin.com/company/stability-nexus">
  <img src="https://img.shields.io/badge/LinkedIn-black?style=flat&logo=LinkedIn&logoColor=white&logoSize=auto&color=0A66C2" alt="LinkedIn Badge"></a>
&nbsp;&nbsp;
<!-- Youtube -->
<a href="https://www.youtube.com/@StabilityNexus">
  <img src="https://img.shields.io/youtube/channel/subscribers/UCZOG4YhFQdlGaLugr_e5BKw?style=flat&logo=youtube&logoColor=white&logoSize=auto&labelColor=FF0000&color=FF0000" alt="Youtube Badge"></a>
</p>

&nbsp;
<!-- Project core values and objective -->
<p align="center">
  <strong>
 Bene: Fundraising Platform is a decentralized application (DApp) that enables projects to receive funding and offer Proof-of-Funding tokens to people who provided funding.
  </strong>
</p>

---

# Bene-FundRaising-EVM-Contracts

 * /packages/hardhat/contracts


 * [Video Explaining the Bene Fundraising Protocol](https://www.youtube.com/watch?v=HHN31PkUxaU").

 * A frontend to interact with teh deployed contracts is deployed at [https://bene-evm.stability.nexus](https://bene-evm.stability.nexus).


## How it works

- Project owners can create a funding vault that holds an amount of proof-of-funding tokens (PFTs), setting:
  * the exchange rate that determines how many PFTs funders will receive per unit of funding.
  * the minimum amount of funding that the projects needs to start.
  * a deadline.
- Users who provide funding receive temporary proof-of-funding token vouchers (PFTVs).
- Project owners can only withdraw the provided funding if the minimum amount is reached before the deadline.
- If the minimum amount is not reached before the deadline, users may obtain a refund of the funding they had provided, by giving back their PFTVs.
- If the minimum amount is reached before the deadline, users may exchange their PFTVs for PFTs.


The use of PFTVs ensures that, during refunds, only users who participated in the current fundraising can get a refund. If PFTs were distributed immediately to funders, it would be impossible to distinguish funders from other PFT holders in the refund phase, and thus these other PFT holders could wrongly receive refunds.

### Parameters of the funding vault:
  
- **timestamp**: The timestamp limit until withdrawal or refund is allowed.
- **Minimum Funding Amount**: The minimum number of ETH needs to be raised to enable withdrawals or refunds.
- **Proof of funding Token Address**: The smart contract address for the Proof-of-Funding token (e.g., 0x123...abc)
- **Proof of funding Token Amount**: Total Proof of funding tokens for the vault
- **ETH/Token Exchange Rate**: The exchange rate of ETHs per token.
- **withdrawal Address**: The address to withdraw funds after raised successfully.
- **Project Title**: Title of the Project
- **Project URL**: URL of the Project
- **Project Description**: Description of the Project

### Constants

The following constants are defined in the contract:

- **Protocol Treasury Address** (`dev_addr`): The base58 address of the protocol treasury.
- **Protocol Fee** (`dev_fee`): The percentage fee taken by the protocol (e.g., `5` for 5%).


### Processes
 
The Bene Fundraising Platform supports seven main processes:

1. **funding vault Creation**:

   - Allows anyone to create a funding vault with the specified script and parameters.
   - The funding vault represents the project's request for funds in exchange for a specific amount of tokens.
   - The tokens in the funding vault are provided by the funding vault creator, that is, the project owner.

2. **Token Acquisition**:

   - Users are allowed to exchange ETHs for **Proof of Funding Token Vouchers (PFTVs)** (at exchange rate) until there are no more tokens left, even if the deadline has passed.
   - Users receive PFTVs in their own funding vaultes, which adhere to token standards, making them visible and transferable through ETH wallets.

3. **Refund Tokens**:

   - Users are allowed to exchange PFTVs for ETHs (at the exchange rate) if and only if the deadline has passed and the minimum number of tokens has not been sold.
   - This ensures that participants can retrieve their contributions if the funding goal is not met.

4. **Withdraw ETH**:

   - Project owners are allowed to withdraw ETHs if and only if the minimum number of tokens has been sold.
   - Project owners can only withdraw to the address specified in `withdrawal_address`.

5. **Withdraw Unsold Tokens**:

   - Project owners are allowed to withdraw unsold PFTs from the contract at any time.
   - Project owners can only withdraw to the address specified in `withdrawal_address`.

6. **Add Tokens**:

   - Project owners are allowed to add more PFTVs to the contract at any time.

7. **Redeem Tokens**:
   - Users are allowed to exchange **Proof of Funding Token Vouchers (PFTVs)** for **Proof-funding Tokens (PFTs)** if and only if the deadline has passed and the minimum number of tokens has been sold.


## Installation and Deployemnt

### Clone the Repository

```bash
git clone https://github.com/StabilityNexus/BenefactionPlatform-EVM
cd BenefactionPlatform-EVM
```

### Install Dependencies

```bash
npm install
```

### Deploy Contracts

```
yarn deploy
```


### Deployed Contracts

FundingVaultFactory Contract: 0x55cbF8284EDCd412bbac595b33Be1Ecdd04a79B7



