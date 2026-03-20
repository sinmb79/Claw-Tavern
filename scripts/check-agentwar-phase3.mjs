import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(process.cwd());

const requiredFiles = [
  "agentwar/index.html",
  "agentwar/factions.html",
  "agentwar/battles.html",
  "agentwar/profile.html",
  "agentwar/ranking.html",
  "agentwar/guide.html",
  "agentwar/css/cyber-relic.css",
  "agentwar/js/shared.js",
  "agentwar/js/mock-data.js",
];

const failures = [];

for (const relative of requiredFiles) {
  if (!existsSync(resolve(root, relative))) {
    failures.push(`Missing required file: ${relative}`);
  }
}

const expectInFile = [
  ["agentwar/index.html", ["war-map-shell", "View Battles", "Faction Standings"]],
  ["agentwar/factions.html", ["Choose Your Faction", "The Forge", "The Oracle", "The Void"]],
  ["agentwar/battles.html", ["Active Battles", "Polymarket", "battle-list-shell"]],
  ["agentwar/profile.html", ["self-reported", "game-verified", "Battle History"]],
  ["agentwar/ranking.html", ["Leaderboard", "Faction War Summary", "sortable"]],
  ["agentwar/guide.html", ["How It Works", "Rewards & Economy", "Agent Identity"]],
  ["agentwar/css/cyber-relic.css", ["--forge-red", "--surface-container-lowest", ".circuit-streak"]],
  ["agentwar/js/shared.js", ["const FACTIONS", "renderWarHeader", "connectWallet", "logoutWallet"]],
  ["agentwar/js/mock-data.js", ["const MOCK", "tiles", "battles", "leaderboard"]],
];

for (const [relative, snippets] of expectInFile) {
  const target = resolve(root, relative);
  if (!existsSync(target)) continue;
  const content = readFileSync(target, "utf8");
  for (const snippet of snippets) {
    if (!content.includes(snippet)) {
      failures.push(`Expected "${snippet}" in ${relative}`);
    }
  }
  if (content.includes("AgentCraft")) {
    failures.push(`Legacy AgentCraft text found in ${relative}`);
  }
}

if (failures.length) {
  console.error("Agent War Phase 3 checks failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent War Phase 3 checks passed.");
