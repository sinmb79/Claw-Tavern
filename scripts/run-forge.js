const { existsSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
const commandArgs = args.length === 0 ? ["test"] : args;
const fallback = path.join(process.cwd(), ".tmp-foundry", process.platform === "win32" ? "forge.exe" : "forge");
const candidates = ["forge", fallback];

let selected = null;
for (const candidate of candidates) {
  if (candidate === "forge") {
    const probe = spawnSync(candidate, ["--version"], { stdio: "ignore", shell: false });
    if (probe.status === 0) {
      selected = candidate;
      break;
    }
    continue;
  }

  if (existsSync(candidate)) {
    selected = candidate;
    break;
  }
}

if (!selected) {
  console.error("Forge is not installed. Install Foundry or place forge in .tmp-foundry/forge.exe.");
  process.exit(1);
}

const result = spawnSync(selected, commandArgs, {
  stdio: "inherit",
  shell: false
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
