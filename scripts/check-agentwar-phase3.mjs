import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

const requiredFiles = [
  "agentwar/index.html",
  "agentwar/map.html",
  "agentwar/factions.html",
  "agentwar/battles.html",
  "agentwar/profile.html",
  "agentwar/ranking.html",
  "agentwar/guide.html",
  "agentwar/css/agentwar-theme.css",
  "agentwar/js/mock-data.js",
  "agentwar/js/shared.js",
  "images/bg-battle.png",
  "images/bg-faction-select.png",
  "images/bg-guide.png",
  "images/bg-landing-hero.png",
  "images/bg-leaderboard.png",
  "images/bg-profile.png",
  "images/bg-warmap.png",
];

const requiredRefs = new Map([
  ["agentwar/index.html", ["./css/agentwar-theme.css", "./js/mock-data.js", "./js/shared.js", "map.html", "guide.html", "../images/bg-landing-hero.png"]],
  ["agentwar/map.html", ["./css/agentwar-theme.css", "./js/mock-data.js", "./js/shared.js", "battles.html", "profile.html", "ranking.html", "guide.html", "../images/bg-warmap.png"]],
  ["agentwar/factions.html", ["./css/agentwar-theme.css", "./js/mock-data.js", "./js/shared.js", "../images/bg-faction-select.png"]],
  ["agentwar/battles.html", ["./css/agentwar-theme.css", "./js/mock-data.js", "./js/shared.js", "guide.html", "../images/bg-battle.png"]],
  ["agentwar/profile.html", ["./css/agentwar-theme.css", "./js/mock-data.js", "./js/shared.js", "guide.html", "../images/bg-profile.png"]],
  ["agentwar/ranking.html", ["./css/agentwar-theme.css", "./js/mock-data.js", "./js/shared.js", "guide.html", "../images/bg-leaderboard.png"]],
  ["agentwar/guide.html", ["./css/agentwar-theme.css", "./js/mock-data.js", "./js/shared.js", "../images/bg-guide.png"]],
]);

const forbiddenRefs = [
  "agentwar_landing.html",
  "agentwar_faction_select.html",
  "agentwar_battles.html",
  "agentwar_agent_profile.html",
  "agentwar_ranking.html",
  "agentwar_guide.html",
  "agentwar_map_sample.html",
];

const failures = [];

for (const file of requiredFiles) {
  if (!existsSync(resolve(root, file))) {
    failures.push(`Missing required file: ${file}`);
  }
}

for (const [file, refs] of requiredRefs) {
  const absolute = resolve(root, file);
  if (!existsSync(absolute)) continue;
  const text = readFileSync(absolute, "utf8");

  for (const ref of refs) {
    if (!text.includes(ref)) {
      failures.push(`${file} is missing required reference: ${ref}`);
    }
  }

  for (const forbidden of forbiddenRefs) {
    if (text.includes(forbidden)) {
      failures.push(`${file} still references prototype source name: ${forbidden}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Agent War Phase 3 redo check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent War Phase 3 redo checks passed.");
