import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const indexHtml = readFileSync(resolve(root, "agentwar/index.html"), "utf8");
const profileHtml = readFileSync(resolve(root, "agentwar/profile.html"), "utf8");
const rankingHtml = readFileSync(resolve(root, "agentwar/ranking.html"), "utf8");
const i18nJs = readFileSync(resolve(root, "agentwar/js/i18n.js"), "utf8");
const sharedJs = readFileSync(resolve(root, "agentwar/js/shared.js"), "utf8");

const failures = [];

const requiredIndexSnippets = [
  "../images/agentwar/ui-accept-quest.webp",
  "../images/agentwar/ui-faction-wars.webp",
  "../images/agentwar/ui-leaderboard.webp",
  "../images/agentwar/ui-heartbeat.webp",
  "../images/agentwar/ui-evaluate.webp",
  "../images/agentwar/faction-forge-character.webp",
  "../images/agentwar/faction-oracle-character.webp",
  "../images/agentwar/faction-void-character.webp",
  "data-open-ail",
  "agentidcard.org/register",
  "requestAgentJoin",
  "btn-outline-red",
  "onclick=\"if(window.AgentWarShared?.requestAgentJoin)",
];

const requiredProfileSnippets = [
  "../images/agentwar/faction-oracle-character.webp",
  "agent-profile-portrait",
];

const requiredRankingSnippets = [
  "../images/agentwar/faction-forge-character.webp",
  "../images/agentwar/faction-oracle-character.webp",
  "../images/agentwar/faction-void-character.webp",
  "podium-character",
];

for (const snippet of requiredIndexSnippets) {
  if (!indexHtml.includes(snippet)) {
    failures.push(`index.html missing required landing snippet: ${snippet}`);
  }
}

if (!i18nJs.includes('const LOCALE_STORAGE_KEY = "agentwar.locale.v2"')) {
  failures.push("i18n.js is missing the v2 locale storage key.");
}

if (!sharedJs.includes('locale: "agentwar.locale.v2"')) {
  failures.push("shared.js is missing the v2 locale storage key.");
}

for (const snippet of requiredProfileSnippets) {
  if (!profileHtml.includes(snippet)) {
    failures.push(`profile.html missing required portrait snippet: ${snippet}`);
  }
}

for (const snippet of requiredRankingSnippets) {
  if (!rankingHtml.includes(snippet)) {
    failures.push(`ranking.html missing required faction character snippet: ${snippet}`);
  }
}

if (failures.length) {
  console.error("Agent War landing refresh check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent War landing refresh check passed.");
