import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const htmlPath = path.resolve("portal-update/app/index.html");
const html = fs.readFileSync(htmlPath, "utf8").replace(/\r\n/g, "\n");
const brandHomePath = path.resolve("portal-update/index.html");
const brandHome = fs.readFileSync(brandHomePath, "utf8").replace(/\r\n/g, "\n");

function extractBetween(source, startMarker, endMarker) {
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Missing start marker: ${startMarker}`);

  const endIndex = source.indexOf(endMarker, startIndex);
  assert.notEqual(endIndex, -1, `Missing end marker: ${endMarker}`);

  return source.slice(startIndex, endIndex);
}

test("desktop top nav exposes home, marketplace, and profile", () => {
  const topNav = extractBetween(
    html,
    '<div class="hidden items-center gap-2 xl:flex">',
    '<div class="flex items-center gap-3">'
  );

  assert.match(topNav, /href="\/"[^>]*>Home</);
  assert.match(topNav, /data-route="find-agent"[^>]*>Marketplace</);
  assert.match(topNav, /data-route="rpg-profile"[^>]*>Profile</);
  assert.doesNotMatch(topNav, /data-route="home"/);
});

test("marketplace shell no longer renders the old desktop sidebar", () => {
  assert.doesNotMatch(html, /data-sidebar-group="marketplace"/);
  assert.doesNotMatch(html, /data-sidebar-group="tavern"/);
  assert.doesNotMatch(html, /lg:grid-cols-\[280px_minmax\(0,1fr\)\]/);
  assert.match(html, />Tools & Account</);
});

test("quest board owns the my quests toggle", () => {
  assert.match(html, /data-quest-view="all"/);
  assert.match(html, /data-quest-view="my-quests"/);
});

test("route groups and legacy redirect map support merged hosts", () => {
  const marketplaceRoutes = extractBetween(
    html,
    "const MARKETPLACE_ROUTES = [",
    "];\n    const TAVERN_ROUTES"
  );

  assert.match(html, /const MARKETPLACE_ROUTES = \[/);
  assert.match(html, /const TAVERN_ROUTES = \[/);
  assert.match(html, /const LEGACY_ROUTE_REDIRECTS = \{/);
  assert.match(html, /"overview":\s*\{\s*name:\s*"agent-dashboard"/);
  assert.match(html, /"my-quests":\s*\{\s*name:\s*"quest-board"/);
  assert.match(html, /"subscriptions":\s*\{\s*name:\s*"agent-dashboard"/);
  assert.doesNotMatch(marketplaceRoutes, /"home"/);
});

test("mobile nav exposes dashboard instead of subscriptions", () => {
  const mobileNav = extractBetween(
    html,
    '<nav class="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-[rgba(11,9,16,0.94)] px-3 py-3 backdrop-blur lg:hidden">',
    "</nav>"
  );

  assert.match(mobileNav, /data-route="agent-dashboard"/);
  assert.doesNotMatch(mobileNav, /data-route="subscriptions"/);
});

test("app defaults to find-agent and keeps home only as a fallback route", () => {
  assert.match(
    html,
    /if \(!raw\) \{\s*return \{ name: "find-agent", key: "find-agent", params: \{\} \};\s*\}/
  );
  assert.match(html, /id="route-home"/);
  assert.match(html, /if \(route\.name === "home"\)/);
});

test("app header links brand entry points back to root", () => {
  assert.match(html, /<a href="\/" class="flex items-center gap-3 text-\[var\(--ink\)\] no-underline">/);
  assert.match(html, /href="\/"[^>]*>\s*[\s\S]*Home</);
  assert.doesNotMatch(html, /data-route="home"/);
});

test("brand home is included in the deploy root with absolute site links", () => {
  assert.ok(fs.existsSync(brandHomePath), "Expected portal-update/index.html to exist");

  assert.match(brandHome, /href="\/favicon\.svg"/);
  assert.match(brandHome, /url\("\/images\/bg-landing-hero\.png"\)/);
  assert.match(brandHome, /href="\/"/);
  assert.match(brandHome, /href="\/app\/"/);
  assert.match(brandHome, /href="\/agentwar\/"/);
  assert.doesNotMatch(brandHome, /\.\/app\.html/);
  assert.doesNotMatch(brandHome, /\.\/agentwar\/index\.html/);
  assert.doesNotMatch(brandHome, /\.\/index\.html/);
  assert.doesNotMatch(brandHome, /\.\/favicon\.svg/);
});

test("deploy root includes shared assets and agent war pages", () => {
  assert.ok(fs.existsSync(path.resolve("portal-update/favicon.svg")));
  assert.ok(fs.existsSync(path.resolve("portal-update/images/bg-landing-hero.png")));
  assert.ok(fs.existsSync(path.resolve("portal-update/images/agentwar/faction-forge-banner.webp")));
  assert.ok(fs.existsSync(path.resolve("portal-update/agentwar/index.html")));
  assert.ok(fs.existsSync(path.resolve("portal-update/agentwar/battles.html")));
  assert.ok(fs.existsSync(path.resolve("portal-update/agentwar/css")));
  assert.ok(fs.existsSync(path.resolve("portal-update/agentwar/js")));
});

test("admin page is still preserved in the deploy root", () => {
  assert.ok(fs.existsSync(path.resolve("portal-update/admin.html")));
});

test("wallet connection supports injected multi-wallet discovery and chooser flow", () => {
  assert.match(html, /id="wallet-chooser-modal"/);
  assert.match(html, /availableWallets:\s*\[\]/);
  assert.match(html, /activeWalletProvider:\s*null/);
  assert.match(html, /function chooseWalletProvider\(/);
  assert.match(html, /window\.dispatchEvent\(new Event\("eip6963:requestProvider"\)\)/);
  assert.match(html, /async function ensureConfiguredNetwork\(selectedWallet = null\)/);
});

test("wallet chooser listeners are bound in bootstrap instead of register-agent rendering", () => {
  const attachEvents = extractBetween(
    html,
    "function attachEvents() {",
    "\n    async function bootstrap()"
  );
  const registerAgentView = extractBetween(
    html,
    "function renderRegisterAgentView() {",
    "\n    function renderGuildHallView()"
  );

  assert.match(attachEvents, /refs\.walletChooserClose\.addEventListener/);
  assert.match(attachEvents, /refs\.walletChooserList\.addEventListener/);
  assert.doesNotMatch(registerAgentView, /walletChooserClose\.addEventListener|walletChooserList\.addEventListener/);
});

test("task 40 terminology uses specialty, tasks, profile, and wallet in the remaining UI shell", () => {
  assert.match(html, />Browse by Specialty</);
  assert.match(html, />My Tasks</);
  assert.match(html, />Open Profile</);
  assert.match(html, />Open Wallet</);
  assert.match(html, /Join Specialty &amp; Register Agent/);
  assert.match(html, />Service Specialty</);
  assert.match(html, />Create a Task</);
  assert.match(html, /Task #\$\{quest\.questId\}/);
  assert.match(html, /Base Mainnet Specialty Directory/);

  assert.doesNotMatch(html, />Guild Showcase</);
  assert.doesNotMatch(html, />Quest Board</);
  assert.doesNotMatch(html, />Join a Guild</);
  assert.doesNotMatch(html, />Create a Quest</);
  assert.doesNotMatch(html, />Service Guild Category</);
});

test("marketplace wallet flow includes an Agent ID Card identity gate before wallet connection", () => {
  assert.match(html, /id="marketplace-identity-modal"/);
  assert.match(html, /id="marketplace-identity-open"/);
  assert.match(html, /id="marketplace-identity-complete"/);
  assert.match(html, /https:\/\/www\.agentidcard\.org\/register/);
  assert.match(html, /fetch\("\/api\/identity\/session"/);
  assert.doesNotMatch(html, /agentwar\.ail\.registered[^]*ensureConfiguredNetwork/);
  assert.match(html, /async function submitAilJwt\(/);
  assert.match(html, /e\.origin === "https:\/\/www\.agentidcard\.org"/);

  const attachEvents = extractBetween(
    html,
    "function attachEvents() {",
    "\n    async function bootstrap()"
  );

  assert.match(
    attachEvents,
    /if \(appState\.account\) \{\s*await disconnectWalletSession\(\);\s*return;\s*\}\s*const identityReady = await ensureMarketplaceIdentityGate\(\);\s*if \(!identityReady\) \{\s*return;\s*\}\s*await ensureConfiguredNetwork\(\);/s
  );
});

test("brand home wallet flow also requires Agent ID Card before connection", () => {
  assert.match(brandHome, /fetch\("\/api\/identity\/session"/);
  assert.doesNotMatch(brandHome, /agentwar\.ail\.registered/);
  assert.match(brandHome, /https:\/\/www\.agentidcard\.org\/register/);
  assert.match(brandHome, /async function submitAilJwt\(/);
  assert.match(brandHome, /e\.origin === "https:\/\/www\.agentidcard\.org"/);
});
