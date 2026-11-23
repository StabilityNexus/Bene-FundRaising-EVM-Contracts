import { expect } from "chai";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const PROJECT_ROOT = path.resolve(__dirname, "..");
// Hardhat's well-known public test account #1. Never holds real funds.
const PUBLIC_TEST_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// A developer's local .env would be loaded by dotenv in the child process and defeat the "not set" cases.
function localEnvDefinesDeployerKey(): boolean {
  const envFile = path.join(PROJECT_ROOT, ".env");
  return fs.existsSync(envFile) && /^\s*DEPLOYER_PRIVATE_KEY\s*=\s*\S+/m.test(fs.readFileSync(envFile, "utf8"));
}

// Runs the hardhat CLI in a child process with the secrets unset unless they are passed in env.
function runHardhat(args: string, env: Record<string, string>) {
  const childEnv: NodeJS.ProcessEnv = { ...process.env };
  delete childEnv.HARDHAT_NETWORK;
  Object.assign(childEnv, env);
  for (const name of ["DEPLOYER_PRIVATE_KEY", "ETHERSCAN_API_KEY"]) {
    if (!(name in env)) delete childEnv[name];
  }
  return spawnSync(`npx hardhat ${args}`, { cwd: PROJECT_ROOT, shell: true, encoding: "utf8", env: childEnv });
}

describe("hardhat.config.ts secrets handling", function () {
  this.timeout(120_000);

  describe("source", function () {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, "hardhat.config.ts"), "utf8");

    it("should not contain a hardcoded private key", function () {
      expect(source).to.not.match(/0x[0-9a-fA-F]{64}/);
    });

    it("should not contain a hardcoded Etherscan API key", function () {
      expect(source).to.not.contain("DNXJA8RX2Q3VZ4URQIWP7Z68CJXQZSC6AW");
    });
  });

  describe("live networks", function () {
    it("should fail clearly when DEPLOYER_PRIVATE_KEY is not set", function () {
      if (localEnvDefinesDeployerKey()) this.skip();
      const result = runHardhat("compile --network sepolia", {});

      expect(result.status).to.not.equal(0);
      expect(`${result.stdout}${result.stderr}`).to.contain("DEPLOYER_PRIVATE_KEY");
    });

    it("should use the key from the environment when it is set", function () {
      const result = runHardhat("compile --network sepolia", { DEPLOYER_PRIVATE_KEY: PUBLIC_TEST_KEY });

      expect(result.status, `${result.stdout}${result.stderr}`).to.equal(0);
    });
  });

  describe("account scripts on a live network", function () {
    // yarn generate and yarn account are how a developer gets the key in the first place, so the
    // key requirement must not block them (HARDHAT_NETWORK=sepolia selects a live network).
    beforeEach(function () {
      if (localEnvDefinesDeployerKey()) this.skip();
    });

    it("should let yarn generate create a deployer key when none exists", function () {
      const envFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bene-generate-")), ".env");
      try {
        const result = runHardhat("run scripts/generateAccount.ts", {
          HARDHAT_NETWORK: "sepolia",
          ENV_FILE_PATH: envFile,
        });

        expect(result.status, `${result.stdout}${result.stderr}`).to.equal(0);
        expect(fs.readFileSync(envFile, "utf8")).to.match(/DEPLOYER_PRIVATE_KEY=0x[0-9a-fA-F]{64}/);
      } finally {
        fs.rmSync(path.dirname(envFile), { recursive: true, force: true });
      }
    });

    it("should let yarn account report a missing key instead of being blocked by the guard", function () {
      const result = runHardhat("run scripts/listAccount.ts", { HARDHAT_NETWORK: "sepolia" });

      expect(result.status, `${result.stdout}${result.stderr}`).to.equal(0);
      expect(result.stdout).to.contain("You don't have a deployer account");
    });

    it("should still require the key for any other script", function () {
      const result = runHardhat("run scripts/someOtherScript.ts", { HARDHAT_NETWORK: "sepolia" });

      expect(result.status).to.not.equal(0);
      expect(`${result.stdout}${result.stderr}`).to.contain("DEPLOYER_PRIVATE_KEY is not set");
    });
  });

  describe("local networks", function () {
    it("should work on the hardhat network without any environment variables", function () {
      const result = runHardhat("compile --network hardhat", {});

      expect(result.status, `${result.stdout}${result.stderr}`).to.equal(0);
    });

    it("should work on localhost without any environment variables", function () {
      const result = runHardhat("compile --network localhost", {});

      expect(result.status, `${result.stdout}${result.stderr}`).to.equal(0);
    });
  });
});
