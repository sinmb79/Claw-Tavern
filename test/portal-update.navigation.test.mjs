import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const htmlPath = path.resolve("portal-update/app/index.html");
const html = fs.readFileSync(htmlPath, "utf8").replace(/\r\n/g, "\n");
const brandHomePath = path.resolve("portal-update/index.html");
const brandHome = fs.readFileSync(brandHomePath, "utf8").replace(/\r\n/g, "\n");
const callbackHtmlPath = path.resolve("portal-update/callback.html");

function extractBetween(source, startMarker, endMarker) {
  const startIndex = source.indexOf(startMarker);
  assert.notEqual(startIndex, -1, `Missing start marker: ${startMarker}`);

  const endIndex = source.indexOf(endMarker, startIndex);
  assert.notEqual(endIndex, -1, `Missing end marker: ${endMarker}`);

  return source.slice(startIndex, endIndex);
}

function extractCallbackScript(source) {
  const match = source.match(/<script>\s*([\s\S]*?)\s*<\/script>\s*<\/body>/);
  assert.ok(match, "Missing callback inline script");
  return match[1];
}

function runCallbackScenario(
  callbackHtml,
  { search = "", opener = null, storageThrows = false } = {}
) {
  const script = extractCallbackScript(callbackHtml);
  const events = [];
  const elements = {
    headline: { textContent: "", hidden: false },
    message: { textContent: "", hidden: false },
    details: { textContent: "", hidden: true }
  };
  const storage = new Map();

  const localStorage = {
    setItem(key, value) {
      events.push(`setItem:${key}`);
      if (storageThrows) {
        throw new Error("storage unavailable");
      }
      storage.set(key, String(value));
    },
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    removeItem(key) {
      storage.delete(key);
    }
  };

  const windowObj = {
    location: { search, origin: "https://www.clawtavern.quest" },
    opener,
    setTimeout(callback) {
      events.push("setTimeout");
      callback();
    },
    close() {
      events.push("close");
    }
  };

  if (windowObj.opener) {
    const originalPostMessage = windowObj.opener.postMessage;
    windowObj.opener.postMessage = (...args) => {
      events.push("postMessage");
      return originalPostMessage(...args);
    };
  }

  const context = vm.createContext({
    window: windowObj,
    document: {
      getElementById(id) {
        return elements[id];
      }
    },
    localStorage,
    URLSearchParams,
    Date
  });

  vm.runInContext(script, context);

  return { events, elements, storage };
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

test("marketplace wallet flow uses the new Agent ID Card OAuth client flow", () => {
  assert.match(html, /id="marketplace-identity-modal"/);
  assert.match(html, /id="marketplace-identity-open"/);
  assert.match(html, /id="marketplace-identity-complete"/);
  assert.doesNotMatch(html, /I already completed it/);
  assert.match(html, /Use Existing Agent ID Card/);
  assert.match(html, /Get New Agent ID Card/);
  assert.match(html, /\/api\/identity\/challenge/);
  assert.match(html, /\/api\/identity\/session/);
  assert.match(html, /https:\/\/api\.agentidcard\.org\/auth\/verify/);
  assert.match(html, /https:\/\/www\.clawtavern\.quest\/callback/);
  assert.doesNotMatch(html, /window\.location\.origin\s*\+\s*["'`]\/callback/);
  assert.doesNotMatch(html, /agentwar\.ail\.registered/);
  assert.match(html, /async function ensureMarketplaceIdentityGate\(/);

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

test("brand home wallet flow uses the new Agent ID Card OAuth client flow", () => {
  assert.doesNotMatch(brandHome, /I already completed it/);
  assert.match(brandHome, /Use Existing Agent ID Card/);
  assert.match(brandHome, /Get New Agent ID Card/);
  assert.match(brandHome, /\/api\/identity\/challenge/);
  assert.match(brandHome, /\/api\/identity\/session/);
  assert.match(brandHome, /https:\/\/api\.agentidcard\.org\/auth\/verify/);
  assert.match(brandHome, /https:\/\/www\.clawtavern\.quest\/callback/);
  assert.doesNotMatch(brandHome, /window\.location\.origin\s*\+\s*["'`]\/callback/);
  assert.doesNotMatch(brandHome, /agentwar\.ail\.registered/);
  assert.match(brandHome, /async function ensureIdentityGate\(/);
  assert.match(
    brandHome,
    /const identityReady = await ensureIdentityGate\(\);\s*if \(!identityReady\) \{\s*return;\s*\}\s*await discoverWallets\(\);/s
  );
});

test("callback route renders a recovery-safe completion page", () => {
  assert.ok(fs.existsSync(callbackHtmlPath), "Expected portal-update/callback.html to exist");

  const callbackHtml = fs.readFileSync(callbackHtmlPath, "utf8").replace(/\r\n/g, "\n");

  assert.match(callbackHtml, /Verification complete/i);
  assert.match(callbackHtml, /postMessage/);
  assert.match(callbackHtml, /code/);
  assert.match(callbackHtml, /state/);
  assert.match(callbackHtml, /clawtavern/i);
});

test("callback route requires both code and state before success handling", () => {
  const callbackHtml = fs.readFileSync(callbackHtmlPath, "utf8").replace(/\r\n/g, "\n");
  const result = runCallbackScenario(callbackHtml, { search: "?code=abc123" });

  assert.equal(result.elements.headline.textContent, "Verification incomplete");
  assert.match(result.elements.message.textContent, /code and state/i);
  assert.equal(result.events.length, 0);
  assert.equal(result.storage.size, 0);
});

test("callback route stores recovery before opener delivery and close", () => {
  const callbackHtml = fs.readFileSync(callbackHtmlPath, "utf8").replace(/\r\n/g, "\n");
  const opener = {
    closed: false,
    postMessage() {}
  };
  const result = runCallbackScenario(callbackHtml, {
    search: "?code=abc123&state=state-xyz",
    opener
  });

  const recoveryIndex = result.events.indexOf("setItem:clawtavern:oauth:recovery");
  const messageIndex = result.events.indexOf("postMessage");
  const closeIndex = result.events.indexOf("close");

  assert.notEqual(recoveryIndex, -1);
  assert.notEqual(messageIndex, -1);
  assert.notEqual(closeIndex, -1);
  assert.ok(recoveryIndex < messageIndex);
  assert.ok(recoveryIndex < closeIndex);
});

test("callback route renders provider errors before the code and state guard", () => {
  const callbackHtml = fs.readFileSync(callbackHtmlPath, "utf8").replace(/\r\n/g, "\n");
  const result = runCallbackScenario(callbackHtml, {
    search: "?error=access_denied&state=state-xyz"
  });

  assert.equal(result.elements.headline.textContent, "Verification failed");
  assert.match(result.elements.message.textContent, /could not finish/i);
  assert.equal(result.elements.details.hidden, false);
  assert.match(result.elements.details.textContent, /access_denied/);
  assert.equal(result.events.length, 0);
  assert.equal(result.storage.size, 0);
});

test("callback route stays open when opener and recovery both fail", () => {
  const callbackHtml = fs.readFileSync(callbackHtmlPath, "utf8").replace(/\r\n/g, "\n");
  const opener = {
    closed: false,
    postMessage() {
      throw new Error("postMessage failed");
    }
  };
  const result = runCallbackScenario(callbackHtml, {
    search: "?code=abc123&state=state-xyz",
    opener,
    storageThrows: true
  });

  assert.equal(result.elements.headline.textContent, "Verification complete");
  assert.match(result.elements.message.textContent, /did not pass the result back automatically/i);
  assert.ok(!result.events.includes("close"));
  assert.ok(!result.events.includes("setTimeout"));
  assert.ok(result.events.includes("postMessage"));
});

test("brand home keeps verification success separate from wallet continuation errors", () => {
  const completeIdentityVerification = extractBetween(
    brandHome,
    "async function completeIdentityVerification(payload) {",
    "\n    async function maybeResumeIdentityFromRecovery()"
  );
  const continuationCatch = extractBetween(
    completeIdentityVerification,
    'try {\n          await continuePendingIdentityFlow();',
    "\n        return true;"
  );

  assert.match(
    completeIdentityVerification,
    /await submitAuthCode\(payload\.code, payload\.state\);\s*clearStoredOauthRecovery\(\);\s*clearPendingOauthAttempt\(\);\s*closeIdentityModal\(\);\s*pushToast\("Agent ID Card verified\. Continue with wallet connection\.", "success"\);\s*try\s*\{\s*await continuePendingIdentityFlow\(\);/s
  );
  assert.match(
    continuationCatch,
    /catch \(error\) \{[\s\S]*pushToast\(/s
  );
  assert.doesNotMatch(
    continuationCatch,
    /openIdentityModal\(\)|clearPendingOauthAttempt\(\)|Verification failed/
  );
});

test("marketplace keeps verification success separate from wallet continuation errors", () => {
  const completeMarketplaceIdentityVerification = extractBetween(
    html,
    "async function completeMarketplaceIdentityVerification(payload) {",
    "\n    async function maybeResumeMarketplaceIdentityFromRecovery()"
  );
  const continuationCatch = extractBetween(
    completeMarketplaceIdentityVerification,
    'try {\n          await continuePendingMarketplaceIdentityFlow();',
    "\n        return true;"
  );

  assert.match(
    completeMarketplaceIdentityVerification,
    /await submitAuthCode\(payload\.code, payload\.state\);\s*clearStoredOauthRecovery\(\);\s*clearPendingMarketplaceOauthAttempt\(\);\s*closeMarketplaceIdentityModal\(\);\s*pushToast\("Agent ID Card verified\. Continue with wallet connection\.", "success"\);\s*try\s*\{\s*await continuePendingMarketplaceIdentityFlow\(\);/s
  );
  assert.match(
    continuationCatch,
    /catch \(error\) \{[\s\S]*pushToast\(/s
  );
  assert.doesNotMatch(
    continuationCatch,
    /openMarketplaceIdentityModal\(\)|clearPendingMarketplaceOauthAttempt\(\)|Verification failed/
  );
});

test("stale callback mismatch must not cancel a newer brand home oauth attempt", () => {
  const mismatchBranch = extractBetween(
    brandHome,
    "if (payload.state !== state.pendingOauthState) {",
    "\n\n      if (state.submittingIdentityCode) {"
  );

  assert.match(mismatchBranch, /clearStoredOauthRecovery\(\);/);
  assert.doesNotMatch(mismatchBranch, /clearPendingOauthAttempt\(\)/);
});

test("stale callback mismatch must not cancel a newer marketplace oauth attempt", () => {
  const mismatchBranch = extractBetween(
    html,
    "if (payload.state !== appState.pendingOauthState) {",
    "\n\n      if (appState.submittingIdentityCode) {"
  );

  assert.match(mismatchBranch, /clearStoredOauthRecovery\(\);/);
  assert.doesNotMatch(mismatchBranch, /clearPendingMarketplaceOauthAttempt\(\)/);
});
