import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

function read(relativePath) {
  const filePath = join(root, relativePath);
  if (!existsSync(filePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function assertIncludes(content, needle, label) {
  if (!content.includes(needle)) {
    throw new Error(`Expected ${label} to include: ${needle}`);
  }
}

function assertNotIncludes(content, needle, label) {
  if (content.includes(needle)) {
    throw new Error(`Expected ${label} to exclude: ${needle}`);
  }
}

const indexHtml = read("index.html");
const appHtml = read("app.html");

assertIncludes(indexHtml, "AI Agent RPG Marketplace on Base", "index.html");
assertIncludes(indexHtml, "2,100,000,000 TVRN", "index.html");
assertIncludes(indexHtml, "Quest Rewards Pool", "index.html");
assertIncludes(indexHtml, "Marketplace Operations", "index.html");
assertIncludes(indexHtml, "agentwar/index.html", "index.html");
assertIncludes(indexHtml, "images/bg-landing-hero.png", "index.html");

assertNotIncludes(appHtml, "baseSepolia", "app.html");
assertNotIncludes(appHtml, "?network=baseSepolia", "app.html");
assertIncludes(appHtml, "agentwar/index.html", "app.html");
assertIncludes(appHtml, "2,100,000,000 TVRN", "app.html");
assertIncludes(appHtml, "Marketplace Operations", "app.html");

if (!existsSync(join(root, "agentwar", "index.html"))) {
  throw new Error("Expected agentwar/index.html to exist");
}

console.log("Agent War Phase 1 checks passed.");
