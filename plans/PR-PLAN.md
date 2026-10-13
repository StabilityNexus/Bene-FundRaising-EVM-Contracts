# Bene-EVM — PR Plan
## Contracts

**PR 1 — Clear out the scaffold-eth leftovers.** `YourContract.sol`, its deploy script and its test are still in the repo, and the deployed `YourContract.json` files are committed for both testnets. The factory's deploy script also still carries `tags = ["YourContract"]` from the starter kit.

**PR 2 — Set up the test infrastructure.** Shared fixtures, plus mock ERC20s for the awkward cases (fee-on-transfer, tokens with transfer hooks). This PR covers the paths that are supposed to work: creating a vault, funding it, redeeming after a successful campaign, refunding after a failed one, and the owner withdrawing. Worth noting nothing currently tests the factory at all, so that gets covered here too.

**PR 3 — Minimal CI.** Compile, test and lint on every PR. Deliberately before the fixes, so the fix PRs run under it rather than being added to it afterwards.

**PR 4 — The security fixes.** Each one gets a test demonstrating the problem first, then the fix, so the commit history shows the bug is real rather than just asserting it. Roughly in order of how much I think they matter:

The developer fee isn't enforced anywhere. The factory takes `developerFeeAddress` and `developerFeePercentage` straight from the caller and accepts anything from 0 to 100, so a vault created directly against the factory can pay the protocol nothing. The 4% and the treasury address only exist in the frontend.

A vault where `fundingToken` and `proofOfFundingToken` are the same address will drain its own collateral. The factory only checks for zero addresses, so this gets through, and then `withdrawFunds()` sweeps the whole token balance — including the PFTs backing outstanding vouchers. Redemptions revert afterwards.

`redeem()` only checks the deadline, not whether the campaign reached its minimum, which is issue #19. Same code in both vaults. There's no double claim, since redeeming burns the vouchers, but the owner's PFTs leave the vault while the funding sits stranded and unwithdrawable.

`purchaseTokens()` has no deadline check while `refundTokens()` decrements `amountRaised`, and together those let a failed campaign be pushed back above its minimum after the deadline. Anyone still holding vouchers then finds refunds reverting.

The ERC20 vault credits the full `fundingAmount` to `amountRaised` without checking what actually arrived, so a fee-on-transfer funding token leaves the vault short of its own accounting and the last contributors to refund can't.

The ERC20 purchase path checks capacity, then transfers, then mints. A token with transfer hooks can re-enter between those steps and pass the capacity check twice.

`withdrawFunds()` can be permanently blocked. If either the fee address or the withdrawal address is a contract that rejects transfers, the call always reverts — and since refunds are already disabled once the minimum is reached, the funds are stuck. `onlyOwner` is the withdrawal address itself and can't be changed.

`withdrawFunds()` also has no deadline check, so the owner can withdraw the moment the minimum is hit rather than waiting for the campaign to end.

`proofOfFundingTokenAmount` is stored and returned by `getVault()` but never actually enforced, and never updated by `addTokens()`, `withdrawUnsoldTokens()` or `redeem()`. The frontend treats it as the total, so the numbers drift once any of those are called.

The factory doesn't verify how much PFT it actually received. The vault can't over-mint, since minting is capped against its real balance, but with a fee-on-transfer PFT the stored amount ends up overstated.

Smaller things in the same PR: `redeem()`, `addTokens()` and `withdrawUnsoldTokens()` emit no events; `withdrawUnsoldTokens()` works mid-campaign with no deadline constraint; and `hardhat.config.ts` hard-codes both a default deployer private key and an Etherscan API key.

**PR 5 — Coverage and static analysis.** Push coverage toward the 90% target and add the threshold to CI once there's something to measure. The checklist also asks for property tests, which Hardhat doesn't do natively, so this PR picks a tool for it — Foundry, Echidna or fast-check.

**PR 6 — OpenSSF Scorecard workflow.** The README badges can't work until this is merged and has run on the default branch.

**PR 7 — Redeploy and reconnect.** Deploy the fixed contracts, update the frontend's factory address and ABIs to match, and verify on each network.

**PR 8 — `Deployments.md`.** Using the StabilityNexus template, documenting everything including the existing Sepolia, Arbitrum Sepolia and Citrea Testnet deployments, which should be marked as legacy and vulnerable.

---

## Both repos

**PR 9 — Branding.** A `brand/` folder in each repo with the SVG logo, a proper favicon and icon set, a defined colour palette and typography, and a `Brand.md` describing them. The palette and typography also need wiring into `tailwind.config.js`, which currently has an empty `theme.extend`. Two things to fix along the way: the frontend's `rel="icon"` currently hotlinks the org's GitHub avatar URL rather than serving a local file, and `public/Readmefooter.svg` in the contracts repo is 0 bytes — it's been empty in every commit that touched it, so I'd copy the valid version from the frontend repo.

**PR 10 — Repo quality documentation.** `MAINTAINERS.md`, `AGENTS.md` and `.coderabbit.yaml` for both repos, plus the Scorecard badges. `CONTRIBUTING.md` needs writing from scratch in the frontend and rewriting in the contracts repo, where it's still unmodified Scaffold-ETH 2 text that never mentions Bene. The contracts README also needs a pass: there's a stray quote on the end of the YouTube link, a stale `/packages/hardhat/contracts` path, a clone URL under the old repo name, `yarn deploy` where the project uses npm, some leftover Ergo wording (`base58`, `dev_addr`), the fee-as-constant claim mentioned above, and no test/build/run instructions.

**PR 11 — Automated security review.** Add the AOSSIE `security-review` and `security-remediation` skills to both repos, run them, fix what they find, and commit both reports. Better before PR 7, so anything they turn up doesn't force a second redeploy.

**PR 12 — `BestPracticesChecklist.md`.** Last, since it summarises everything else.

---

## Frontend

**PR 13 — Remove the SaaS dependencies.** There are two things violating the no-WalletConnect/Reown/SaaS requirement.

RainbowKit is the main one. Only `App.tsx` and `Navbar.tsx` import it, so the change is smaller than it sounds — I tried it in a scratch copy, swapping in `createConfig` with `injected()` connectors, and `tsc` and `vite build` both passed, 22 packages dropped out, the main chunk went from about 1.09 MB to about 509 kB, and the built bundle had no WalletConnect strings left in it. Worth flagging that `App.tsx` currently passes the literal `"YOUR_PROJECT_ID"` placeholder, and RainbowKit quietly substitutes its own shared demo project ID for that, so WalletConnect connections today are running on a demo ID that could be rate-limited or revoked. One caveat: WalletConnect stays in the lockfile regardless, because `wagmi@2.12.29` depends on `@wagmi/connectors@5.3.7` where it's a hard dependency. Clearing it from the lockfile needs wagmi 3.x, which wants TypeScript ≥ 5.9.3 against the repo's ~5.6.2, so I'd suggest that as a separate follow-up rather than bundling it here.

The second is `@microlink/react`, which calls out to `api.microlink.io`.

This PR also has to rebuild two things RainbowKit was providing: wrong-network handling and a wallet picker. Without chain switching, `useAccount().chain` comes back undefined on any network other than Citrea, which leaves every action button disabled while the user is actually connected.

**PR 14 — SEO and discoverability.** `index.html` currently has only a `<title>`, so this adds the full metadata and Open Graph tags, a `sitemap.xml`, and a `robots.txt` that allows crawling, blocks `/pr-preview/` paths and points at the sitemap. All three of those return 404 on the live site right now. The `og:image` needs to be an absolute PNG URL rather than the SVG, since Twitter, LinkedIn and Discord won't render SVG — `public/Benelogo.png` is already there for it.

**PR 15 — Functional fixes.** These are the things that stop someone actually completing a flow:

- Deep links 404 on GitHub Pages, since `BrowserRouter` has no `404.html` fallback. Even with one, the details page throws, because it reads `location.state` without handling null.
- "Add PKT" calls `addTokens` with no prior `approve`, and the vault pulls with `safeTransferFrom`, so it always reverts.
- There are fixed 6-second sleeps instead of waiting for receipts. `Create` approves, sleeps, then calls `deployFundingVault`, which fails if the approval hasn't been mined, and there's no feedback beyond `console.log`.
- `parseEther` and `formatEther` are used for PFT and funding-token amounts, so a 6-decimal token displays wrong by a factor of 10¹².
- "Funds Collected" reads the vault's native balance, which is always 0 for ERC20 vaults and drops to 0 after the owner withdraws.
- `Home` shows at most 11 vaults. The "More Projects" button is an `<a href="">` with a condition that can never be true, and the search box has no handler attached.
- The factory address, chain ID, fee address and 4% fee are all hard-coded.
- `href={vaultDetails.projectURL}` renders an unvalidated string straight from on-chain data.
- Some stale copy — "Redeem your vouchers for CAT", "Add PKT".

**PR 16 — Repo quality and CI.** The existing workflow only builds and deploys, and only on push to main, so this adds lint and typecheck on pull requests. Note that `--max-warnings 0` will fail until the `react-refresh` warning at `App.tsx:23` is fixed; the Vite chunk-size warning goes away with PR 13.

**PR 17 — Crypto-specific requirements.** Terms of Use content, a footer link to it, the first-visit modal requiring agreement, and the Stability Nexus logo in the footer. Sequenced after PR 13, since that rewrites `App.tsx`.
