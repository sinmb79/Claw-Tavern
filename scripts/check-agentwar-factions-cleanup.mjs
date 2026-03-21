import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const file = resolve(process.cwd(), "agentwar/factions.html");
const html = readFileSync(file, "utf8");
const failures = [];

const forbiddenSnippets = [
  'class="arena-icon"',
  'class="f-emblem"',
  "../images/agentwar/faction-forge-emblem.webp",
  "../images/agentwar/faction-oracle-emblem.webp",
  "../images/agentwar/faction-void-emblem.webp",
];

for (const snippet of forbiddenSnippets) {
  if (html.includes(snippet)) {
    failures.push(`Forbidden factions UI snippet still present: ${snippet}`);
  }
}

const requiredSnippets = [
  "../images/agentwar/faction-forge-character.webp",
  "../images/agentwar/faction-oracle-character.webp",
  "../images/agentwar/faction-void-character.webp",
  "max-width: 1180px",
  "padding: 26px 22px 20px",
  "min-height: 520px;",
  "justify-content: flex-end;",
  "padding: 24px 18px 18px;",
  "text-align: center;",
  "justify-content: center;",
  "letter-spacing: 0.5px;",
  "letter-spacing: 1.5px;",
  "width: 100%;",
  "height: 100%;",
  "object-fit: contain;",
  "object-position: center bottom;",
  'class="f-meta"',
  'class="f-select"',
  "SELECT FACTION",
];

for (const snippet of requiredSnippets) {
  if (!html.includes(snippet)) {
    failures.push(`Expected factions layout snippet missing: ${snippet}`);
  }
}

if (failures.length) {
  console.error("Agent War factions cleanup check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent War factions cleanup check passed.");
