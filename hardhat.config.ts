import * as dotenv from "dotenv";
dotenv.config();
import * as path from "path";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import "hardhat-gas-reporter";
import "solidity-coverage";
import "@nomicfoundation/hardhat-verify";
import "hardhat-deploy";
import "hardhat-deploy-ethers";

// Secrets come from the environment only (see .env.example); there are no fallback values.
const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
const etherscanApiKey = process.env.ETHERSCAN_API_KEY ?? "";

// Networks that never need a key from us: Hardhat's built-in network and a local node, which provides its own accounts.
const LOCAL_NETWORKS = ["hardhat", "localhost"];
// Tasks that only talk to a block explorer and do not sign anything.
const KEYLESS_TASKS = ["verify", "etherscan-verify"];
// The scripts behind yarn generate and yarn account. They create or report the deployer key, so they cannot
// require it. Matched by exact path, so no other script gets the exemption.
const KEYLESS_SCRIPTS = ["scripts/generateAccount.ts", "scripts/listAccount.ts"].map(script =>
  path.join(__dirname, script),
);

function cliTarget(): { network?: string; task?: string; script?: string } {
  const args = process.argv.slice(2);
  const networkFlag = args.indexOf("--network");
  const network = networkFlag >= 0 ? args[networkFlag + 1] : process.env.HARDHAT_NETWORK;
  const rest = networkFlag >= 0 ? args.filter((_, i) => i !== networkFlag && i !== networkFlag + 1) : args;
  const positional = rest.filter(arg => !arg.startsWith("-"));
  return { network, task: positional[0], script: positional[1] };
}

function isKeylessRun(task?: string, script?: string): boolean {
  if (task !== undefined && KEYLESS_TASKS.includes(task)) return true;
  // The config is loaded twice for "hardhat run": once by the CLI ("run <script>"), and again inside the child
  // process that executes the script, where argv[1] is the script itself and there is no task.
  if (KEYLESS_SCRIPTS.includes(path.resolve(process.argv[1] ?? ""))) return true;
  return task === "run" && script !== undefined && KEYLESS_SCRIPTS.includes(path.resolve(script));
}

const { network: requestedNetwork, task: requestedTask, script: requestedScript } = cliTarget();
if (
  requestedNetwork &&
  !LOCAL_NETWORKS.includes(requestedNetwork) &&
  !isKeylessRun(requestedTask, requestedScript) &&
  !deployerPrivateKey
) {
  throw new Error(
    "DEPLOYER_PRIVATE_KEY is not set. It is required for the " +
      requestedNetwork +
      " network: set it in your environment or in a .env file (yarn generate creates one).",
  );
}

// Live networks sign with the deployer key from the environment.
const liveAccounts = deployerPrivateKey ? [deployerPrivateKey] : [];
// forking rpc url
const forkingURL = process.env.FORKING_URL || "";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            // https://docs.soliditylang.org/en/latest/using-the-compiler.html#optimizer-options
            runs: 200,
          },
        },
      },
    ],
  },
  defaultNetwork: "hardhat",
  namedAccounts: {
    deployer: {
      // By default, it will take the first Hardhat account as the deployer
      default: 0,
    },
  },
  networks: {
    // View the networks that are pre-configured.
    // If the network you are looking for is not here you can add new network settings
    hardhat: {
      forking: {
        url: forkingURL,
        enabled: process.env.MAINNET_FORKING_ENABLED === "true",
      },
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    mainnet: {
      url: `https://cloudflare-eth.com`,
      accounts: liveAccounts,
    },
    sepolia: {
      url: `https://rpc2.sepolia.org`,
      accounts: liveAccounts,
    },
    arbitrum: {
      url: `https://arb1.arbitrum.io/rpc`,
      accounts: liveAccounts,
    },
    arbitrumSepolia: {
      url: `https://sepolia-rollup.arbitrum.io/rpc`,
      accounts: liveAccounts,
    },
    optimism: {
      url: `https://mainnet.optimism.io`,
      accounts: liveAccounts,
    },
    optimismSepolia: {
      url: `https://sepolia.optimism.io`,
      accounts: liveAccounts,
    },
    polygon: {
      url: `https://polygon-rpc.com`,
      accounts: liveAccounts,
    },
    polygonMumbai: {
      url: `https://rpc.ankr.com/polygon_mumbai`,
      accounts: liveAccounts,
    },
    polygonZkEvm: {
      url: `https://zkevm-rpc.com`,
      accounts: liveAccounts,
    },
    polygonZkEvmTestnet: {
      url: `https://rpc.public.zkevm-test.net`,
      accounts: liveAccounts,
    },
    gnosis: {
      url: "https://rpc.gnosischain.com",
      accounts: liveAccounts,
    },
    chiado: {
      url: "https://rpc.chiadochain.net",
      accounts: liveAccounts,
    },
    base: {
      url: "https://mainnet.base.org",
      accounts: liveAccounts,
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: liveAccounts,
    },
    scrollSepolia: {
      url: "https://sepolia-rpc.scroll.io",
      accounts: liveAccounts,
    },
    scroll: {
      url: "https://rpc.scroll.io",
      accounts: liveAccounts,
    },
    pgn: {
      url: "https://rpc.publicgoods.network",
      accounts: liveAccounts,
    },
    pgnTestnet: {
      url: "https://sepolia.publicgoods.network",
      accounts: liveAccounts,
    },
  },
  // configuration for harhdat-verify plugin
  etherscan: {
    apiKey: `${etherscanApiKey}`,
  },
  // configuration for etherscan-verify from hardhat-deploy plugin
  verify: {
    etherscan: {
      apiKey: `${etherscanApiKey}`,
    },
  },
  sourcify: {
    enabled: false,
  },
};

export default config;
