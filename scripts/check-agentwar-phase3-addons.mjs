import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const failures = [];

function read(relPath) {
  return readFileSync(resolve(root, relPath), "utf8");
}

function expect(condition, message) {
  if (!condition) failures.push(message);
}

const pageFiles = [
  "agentwar/index.html",
  "agentwar/map.html",
  "agentwar/factions.html",
  "agentwar/battles.html",
  "agentwar/profile.html",
  "agentwar/ranking.html",
  "agentwar/guide.html",
];

expect(existsSync(resolve(root, "agentwar/js/i18n.js")), "Missing required file: agentwar/js/i18n.js");

for (const file of pageFiles) {
  const text = read(file);
  expect(text.includes('<html lang="en">'), `${file} must default to <html lang="en">`);
  expect(text.includes("./js/i18n.js"), `${file} must load ./js/i18n.js`);
}

const sharedJs = read("agentwar/js/shared.js");
expect(sharedJs.includes("openAILModal"), "agentwar/js/shared.js must expose openAILModal");
expect(sharedJs.includes("openLegalModal"), "agentwar/js/shared.js must expose openLegalModal");
expect(sharedJs.includes("agentwar.locale"), "agentwar/js/shared.js must persist locale selection");
expect(sharedJs.includes("agentwar.legal.accepted"), "agentwar/js/shared.js must persist legal modal acknowledgement");
expect(sharedJs.includes("https://www.agentidcard.org"), "agentwar/js/shared.js must embed the AIL origin");
expect(!sharedJs.includes("??/button>"), "agentwar/js/shared.js must not contain malformed modal button markup");

const themeCss = read("agentwar/css/agentwar-theme.css");
expect(themeCss.includes(".agentwar-modal"), "agentwar/css/agentwar-theme.css must style the shared modal");
expect(themeCss.includes(".agentwar-lang-toggle"), "agentwar/css/agentwar-theme.css must style the language toggle");
expect(themeCss.includes(".agentwar-legal-modal"), "agentwar/css/agentwar-theme.css must style the legal warning modal");

const indexHtml = read("agentwar/index.html");
expect(!indexHtml.includes('href="https://www.agentidcard.org/" class="nav-cta"'), "agentwar/index.html nav CTA must open AIL modal instead of leaving the page");
expect(!indexHtml.includes('href="https://www.agentidcard.org/" class="btn-outline-red"'), "agentwar/index.html hero join button must open AIL modal instead of leaving the page");

const factionsHtml = read("agentwar/factions.html");
expect(factionsHtml.includes("AgentWarShared.openAILModal"), "agentwar/factions.html confirm flow must use AgentWarShared.openAILModal");

const mapHtml = read("agentwar/map.html");
expect(!/\.map-area\s*\{[^}]*background:\s*var\(--bg-primary\);/m.test(mapHtml), "agentwar/map.html map container must not fully hide the body background image");

if (failures.length > 0) {
  console.error("Agent War Phase 3 addons check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent War Phase 3 addons checks passed.");
