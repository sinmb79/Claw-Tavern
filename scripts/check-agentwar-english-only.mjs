import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

const root = process.cwd();
const agentwarRoot = resolve(root, "agentwar");

const failures = [];

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }

    if (!/\.(html|js|css)$/i.test(entry.name)) continue;

    const text = readFileSync(absolute, "utf8");
    const rel = relative(root, absolute).replace(/\\/g, "/");

    if (/[가-힣]/.test(text)) {
      failures.push(`${rel} still contains Hangul text.`);
    }

    if (text.includes("data-locale-toggle") || text.includes("agentwar-lang-toggle")) {
      failures.push(`${rel} still includes locale toggle markup or styling.`);
    }

    if (text.includes("agentwar-ail-modal") || text.includes("agentwar-modal__frame")) {
      failures.push(`${rel} still references the old in-page AIL iframe modal.`);
    }
  }
}

function ensureImageRefsExist(file) {
  const absolute = resolve(root, file);
  const text = readFileSync(absolute, "utf8");
  const rel = relative(root, absolute).replace(/\\/g, "/");
  const matches = [...text.matchAll(/(?:src|href|url)\((?:'|")?([^'")]+)(?:'|")?\)|(?:src|href)=["']([^"']+)["']/g)];

  for (const match of matches) {
    const asset = (match[1] || match[2] || "").trim();
    if (!asset.includes("../images/agentwar/")) continue;

    const normalized = asset.replace(/^url\(/, "").replace(/\)$/, "").replace(/['"]/g, "");
    const target = resolve(resolve(root, "agentwar"), normalized);
    if (!existsSync(target) || !statSync(target).isFile()) {
      failures.push(`${rel} references missing asset: ${normalized}`);
    }
  }
}

if (!existsSync(agentwarRoot)) {
  failures.push("agentwar directory is missing.");
} else {
  walk(agentwarRoot);
}

[
  "agentwar/index.html",
  "agentwar/factions.html",
  "agentwar/battles.html",
  "agentwar/profile.html",
  "agentwar/ranking.html",
  "agentwar/guide.html",
].forEach((file) => {
  if (!existsSync(resolve(root, file))) {
    failures.push(`${file} is missing.`);
    return;
  }
  ensureImageRefsExist(file);
});

if (failures.length > 0) {
  console.error("Agent War English-only check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Agent War English-only checks passed.");
