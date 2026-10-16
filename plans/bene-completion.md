# Bene-EVM Production-Readiness Completion Plan

Covering both `Bene-FundRaising-EVM-Contracts` and `Bene-FundRaising-EVM-Frontend`, working against the GSoC completion checklist.

I've split this into PRs that each do one thing, so they're reviewable on their own. Happy to group them differently if you'd rather see fewer, larger ones.

---

## Contracts

**PR 1 — Clear out the scaffold-eth leftovers.** `YourContract.sol`, its deploy script and its test are still in the repo, and the deployed `YourContract.json` files are committed for both testnets. The factory's deploy script also still carries `tags = ["YourContract"]` from the starter kit.

**PR 2 — Set up the test infrastructure.** Shared fixtures, plus mock ERC20s for the awkward cases (fee-on-transfer, tokens with transfer hooks). This PR covers the paths that are supposed to work: creating a vault, funding it, redeeming after a successful campaign, refunding after a failed one, and the owner withdrawing. Worth noting nothing currently tests the factory at all, so that gets covered here too.

**PR 3 — Minimal CI.** Compile, test and lint on every PR. Deliberately before the fixes, so the fix PRs run under it rather than being added to it afterwards.

**PR 4 — The security fixes.** Each one gets a test demonstrating the problem first, then the fix, so the commit history shows the bug is real rather than just asserting it. Roughly in order of how much I think they matter:

A vault where `fundingToken` and `proofOfFundingToken` are the same address will drain its own collateral. The factory only checks for zero addresses, so this gets through, and then `withdrawFunds()` sweeps the whole token balance — including the PFTs backing outstanding vouchers. Redemptions revert afterwards.

`redeem()` is wrong in both directions. It checks only that the deadline has passed, and never checks whether the minimum was reached — that's issue #19, and it's the same code in both vaults. Comparing against Ergo, the equivalent action there (`isExchangeFundingTokens`) gates on `minimumReached` alone, with no block-limit check at all. So the fix is to add the minimum check and remove the time check: a campaign is successful the moment the minimum is met, and contributors should be able to exchange from that point rather than waiting.

The ERC20 vault credits the full `fundingAmount` to `amountRaised` without checking what actually arrived, so a fee-on-transfer funding token leaves the vault short of its own accounting and the last contributors to refund can't.

The ERC20 purchase path checks capacity, then transfers, then mints. A token with transfer hooks can re-enter between those steps and pass the capacity check twice.

`withdrawFunds()` can be permanently blocked. If either the fee address or the withdrawal address is a contract that rejects transfers, the call always reverts — and since refunds are already disabled once the minimum is reached, the funds are stuck. `onlyOwner` is the withdrawal address itself and can't be changed.

Accounting moves to the Ergo model. Instead of mutating `amountRaised` downward on refund, the vaults keep two monotonic counters — total sold and total refunded — and derive `minimumReached` as `sold - refunded >= minimum`. Nothing decreases, so the raised history stays intact and the success condition is auditable at any point.

The refund boundary becomes strictly after the waiting period, matching Ergo's `now > limit`. The EVM currently reverts on `block.timestamp < timestamp`, which allows a refund at exactly the limit; that becomes `<=`.

`withdrawFunds()` must remain callable more than once. Contributions can continue after a full withdrawal, so the owner needs to be able to withdraw the full balance again each time more arrives. The balance-based implementation already allows this, so the fix here is to make sure nothing added for the other issues introduces a one-shot guard, and to cover repeated withdrawal in the tests.

`proofOfFundingTokenAmount` is stored and returned by `getVault()` but never actually enforced, and never updated by `addTokens()`, `withdrawUnsoldTokens()` or `redeem()`. The frontend treats it as the total, so the numbers drift once any of those are called.

The factory doesn't verify how much PFT it actually received. The vault can't over-mint, since minting is capped against its real balance, but with a fee-on-transfer PFT the stored amount ends up overstated.

Smaller things in the same PR: `redeem()`, `addTokens()` and `withdrawUnsoldTokens()` emit no events; `withdrawUnsoldTokens()` works mid-campaign with no deadline constraint; and `hardhat.config.ts` hard-codes both a default deployer private key and an Etherscan API key.

Two things that were on this list have come off, after confirmation that they're working as intended. Post-deadline purchases are deliberate, and because the refund condition is meant to be live rather than latched, `refundTokens()` decrementing `amountRaised` is correct. And `withdrawFunds()` having no deadline check is right too — a campaign counts as successful the moment the minimum is reached, and the owner can withdraw from then on.

**PR 5 — Developer fee architecture.** Separated from the fixes above because it changes the interface rather than correcting behaviour. Following the design described in the channel: the factory holds `devFee` and `devAddress` as mutable state, changeable only by the current dev address, with the address change going through a two-step propose-and-accept so it can't be set to something unreachable — OpenZeppelin's `Ownable2Step` as the reference. The vault constructor takes the factory address and the fee as immutables, and reads the current dev address from the factory at payout time. `deployFundingVault()` stops taking either as a parameter. The result is that a campaign's fee is frozen at whatever it was when the campaign was created, while payments always reach the current address. The factory is initialised with a 5% fee, matching Ergo.

This changes `VaultTypes.VaultConfig`, both vault constructors and the factory signature, so the frontend's create flow and all four ABI files change with it. That makes the redeploy a dependency for the frontend work rather than a tidy-up at the end.

**PR 6 — Coverage and property tests.** Using Foundry. Push coverage toward the 90% target and add the threshold to CI once there's something to measure, plus the property tests the checklist asks for.

**PR 7 — OpenSSF Scorecard workflow.** The README badges can't work until this is merged and has run on the default branch.

**PR 8 — Redeploy and reconnect.** Deploy the fixed contracts, update the frontend's factory address and ABIs to match, and verify on each network.

**PR 9 — `Deployments.md`.** Using the StabilityNexus template, documenting everything including the existing Sepolia, Arbitrum Sepolia and Citrea Testnet deployments, which should be marked as legacy and vulnerable.

---

## Both repos

**PR 10 — Branding.** A `brand/` folder in each repo with the SVG logo, a proper favicon and icon set, a defined colour palette and typography, and a `Brand.md` describing them. The palette and typography also need wiring into `tailwind.config.js`, which currently has an empty `theme.extend`. Two things to fix along the way: the frontend's `rel="icon"` currently hotlinks the org's GitHub avatar URL rather than serving a local file, and `public/Readmefooter.svg` in the contracts repo is 0 bytes — it's been empty in every commit that touched it, so I'd copy the valid version from the frontend repo.

**PR 11 — Repo quality documentation.** `MAINTAINERS.md`, `AGENTS.md` and `.coderabbit.yaml` for both repos, plus the Scorecard badges. `CONTRIBUTING.md` needs writing from scratch in the frontend and rewriting in the contracts repo, where it's still unmodified Scaffold-ETH 2 text that never mentions Bene. The contracts README also needs a pass: there's a stray quote on the end of the YouTube link, a stale `/packages/hardhat/contracts` path, a clone URL under the old repo name, `yarn deploy` where the project uses npm, some leftover Ergo wording (`base58`, `dev_addr`), the fee-as-constant claim mentioned above, and no test/build/run instructions. Also worth adding the operation-conditions chart from one of the Bene presentations, updated for the PFTV mechanism, which would go here.

**PR 12 — Automated security review.** Add the AOSSIE `security-review` and `security-remediation` skills to both repos, run them, fix what they find, and commit both reports. Better before PR 8, so anything they turn up doesn't force a second redeploy.

**PR 13 — `BestPracticesChecklist.md`.** Last, since it summarises everything else.

---

## Frontend

**PR 14 — Remove the SaaS dependencies.** There are two things violating the no-WalletConnect/Reown/SaaS requirement.

RainbowKit is the main one. Only `App.tsx` and `Navbar.tsx` import it, so the change is smaller than it sounds — I tried it in a scratch copy, swapping in `createConfig` with `injected()` connectors, and `tsc` and `vite build` both passed, 22 packages dropped out, the main chunk went from about 1.09 MB to about 509 kB, and the built bundle had no WalletConnect strings left in it. Worth flagging that `App.tsx` currently passes the literal `"YOUR_PROJECT_ID"` placeholder, and RainbowKit quietly substitutes its own shared demo project ID for that, so WalletConnect connections today are running on a demo ID that could be rate-limited or revoked. One caveat: WalletConnect stays in the lockfile regardless, because `wagmi@2.12.29` depends on `@wagmi/connectors@5.3.7` where it's a hard dependency. Clearing it from the lockfile needs wagmi 3.x, which wants TypeScript ≥ 5.9.3 against the repo's ~5.6.2, so I'd suggest that as a separate follow-up rather than bundling it here.

The second is `@microlink/react`, which calls out to `api.microlink.io`.

This PR also has to rebuild two things RainbowKit was providing: wrong-network handling and a wallet picker. Without chain switching, `useAccount().chain` comes back undefined on any network other than Citrea, which leaves every action button disabled while the user is actually connected.

**PR 15 — SEO and discoverability.** `index.html` currently has only a `<title>`, so this adds the full metadata and Open Graph tags, a `sitemap.xml`, and a `robots.txt` that allows crawling, blocks `/pr-preview/` paths and points at the sitemap. All three of those return 404 on the live site right now. The `og:image` needs to be an absolute PNG URL rather than the SVG, since Twitter, LinkedIn and Discord won't render SVG — `public/Benelogo.png` is already there for it.

**PR 16 — Functional fixes.** These are the things that stop someone actually completing a flow:

- Deep links 404 on GitHub Pages, since `BrowserRouter` has no `404.html` fallback. Even with one, the details page throws, because it reads `location.state` without handling null.
- "Add PKT" calls `addTokens` with no prior `approve`, and the vault pulls with `safeTransferFrom`, so it always reverts.
- There are fixed 6-second sleeps instead of waiting for receipts. `Create` approves, sleeps, then calls `deployFundingVault`, which fails if the approval hasn't been mined, and there's no feedback beyond `console.log`.
- `parseEther` and `formatEther` are used for PFT and funding-token amounts, so a 6-decimal token displays wrong by a factor of 10¹².
- "Funds Collected" reads the vault's native balance, which is always 0 for ERC20 vaults and drops to 0 after the owner withdraws.
- `Home` shows at most 11 vaults. The "More Projects" button is an `<a href="">` with a condition that can never be true, and the search box has no handler attached.
- The factory address, chain ID, fee address and 4% fee are all hard-coded.
- `href={vaultDetails.projectURL}` renders an unvalidated string straight from on-chain data.
- Some stale copy — "Redeem your vouchers for CAT", "Add PKT".

**PR 17 — Repo quality and CI.** The existing workflow only builds and deploys, and only on push to main, so this adds lint and typecheck on pull requests. Note that `--max-warnings 0` will fail until the `react-refresh` warning at `App.tsx:23` is fixed; the Vite chunk-size warning goes away with PR 14.

**PR 18 — Crypto-specific requirements.** Terms of Use content, a footer link to it, the first-visit modal requiring agreement, and the Stability Nexus logo in the footer. Sequenced after PR 14, since that rewrites `App.tsx`.

---

## Notes

The `onlyOwner` restriction on `withdrawFunds()` stays as it is — it differs from Ergo, where anyone can trigger the withdrawal, but that difference is accepted.

PRs go in directly; no issue is opened first. This plan lives in `plans/` in the contracts repo.

---

## Sequence

The numbering above follows the document, grouped by repo. The order I'd actually work in is this:

**First, the contracts have to settle.** PRs 1 → 2 → 3 → 4 → 5. Scaffold cleanup, then the test infrastructure, then CI so everything after it runs under checks, then the security fixes, then the fee redesign. The fee work comes last of these because it changes the interface, and doing it after the fixes means the tests written in 2 and 4 are already there to catch regressions.

**Then the testing and review work that depends on finished contracts.** PR 6 (coverage and property tests with Foundry), then PR 12 (the security review skills). The review runs before the redeploy, so anything it turns up doesn't force a second one.

**Then deploy.** PR 8 (redeploy and reconnect), then PR 9 (`Deployments.md`), which can only be honest once there's something new to document.

**The frontend work waits on that.** PRs 14 → 15 → 16 → 17 → 18. The fee redesign changes `VaultConfig`, both vault constructors and the factory signature, so the create flow and all four ABI files change with it. Fixing the frontend against the old ABIs would mean doing it twice. PR 14 comes first within this group because it rewrites `App.tsx`, which 18 also touches.

**Documentation and branding can run alongside anything.** PRs 7, 10 and 11 have no dependency on the contract work, so they're useful to pick up whenever the contract side is blocked on a review or a decision. PR 7 (the Scorecard workflow) does need merging before the badges in PR 11 will render.

**PR 13 last**, since `BestPracticesChecklist.md` summarises everything else.

In short: **1 → 2 → 3 → 4 → 5 → 6 → 12 → 8 → 9 → 14 → 15 → 16 → 17 → 18**, with 7, 10 and 11 slotted in wherever there's a gap, and 13 at the end.
