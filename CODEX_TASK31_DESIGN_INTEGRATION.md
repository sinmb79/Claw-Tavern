# CODEX TASK 31 — Design Integration: Rebuild Frontend from Design Mockups

**Objective**: Replace the current `claw-tavern-app.html` with a production-quality frontend built from the professional design mockups in `design/web-page/`. The new frontend must combine the visual design with all existing Web3 contract integration logic, PLUS the new NFT equipment system and guild system.

**Priority**: This replaces the previously issued Task 31 (RPG/Subscription UI tabs). That task is now absorbed into this broader redesign.

**IMPORTANT — Architecture changes since original design mockups**:
1. **Season system is REMOVED** — no seasons, no season control page, no season references anywhere
2. **Level system changed** — now formula-based `20 * level^2.2`, capped at Lv.100 (was fixed 6 levels)
3. **2 new contracts added**: `TavernEquipment` (ERC-1155 NFTs) + `TavernGuild` (guild system) → total 11 contracts
4. **NFT inventory/equipment UI** must be added to the RPG Profile tab
5. **Guild page** must be added as a new tab in app.html
6. **Admin "Season Control" page** → replaced with **"NFT & Guild Admin"** page

Read `NFT_SYSTEM_DESIGN.md` for the full NFT system spec (145 items, 6 rarity tiers, equipment slots, guild levels, contributor tracks).

---

## Source Materials

### Design HTML files (in `design/web-page/`):

**dApp Pages (8 tabs)**:
| Page | Desktop | Mobile |
|------|---------|--------|
| Quest Board | `Quest Board (Desktop)/code.html` | `Quest Board (Mobile/code.html` |
| My Quests | `My Quests (Desktop)/code.html` | — |
| Overview/Dashboard | `Overview (Desktop)/code.html` | — |
| Token | `Token (Desktop)/code.html` | — |
| Staking | `Staking (Desktop)/code.html` | — |
| Governance | `Governance (Desktop)/code.html` | — |
| RPG Profile | `RPG Profile (Desktop)/code.html` | `RPG Profile (Mobile)/code.html` |
| Subscriptions | `Subscriptions (Desktop)/code.html` | `sucriptions (Mobile)/code.html` |

**Admin/Node Dashboard (6 pages)**:
| Page | File |
|------|------|
| Guild Overview | `Admin-Guild Overview/code.html` |
| Automation Control | `Admin-Automation Control/code.html` |
| Treasury & Fees | `Admin-Treasury & Fees/code.html` |
| Agent Management | `Admin-Agent Management/code.html` |
| ~~Season Control~~ → **NFT & Guild Admin** | `Admin-Season Control/code.html` (repurpose layout, replace content) |
| Contract Admin | `Admin-Contract Admin/code.html` |

**Landing Page**:
| Page | File |
|------|------|
| Desktop | `landing-page/code.html` |
| Mobile | `landing-page(mobile)/code.html` |

**Reference**:
| File | Purpose |
|------|---------|
| `Claw Tavern Component Library/code.html` | Reusable component patterns |
| `Claw Tavern Style Guide/code.html` | Color, typography, spacing tokens |

### Existing Web3 logic (in current `claw-tavern-app.html`):
- Network configs (Sepolia + Mainnet addresses for 9 contracts — will expand to 11)
- ABI fragments for all 9 contracts (add EQUIPMENT_ABI + GUILD_ABI)
- Wallet connection (ethers.js v6)
- Contract initialization (`getOptionalContract` pattern)
- Quest board read/write functions
- Staking/Governance interaction
- Tab switching logic
- Transaction handling with explorer links
- Address rendering utilities

### New NFT System Reference:
- Read `NFT_SYSTEM_DESIGN.md` for full item catalog (145 items across 9 categories)
- Equipment slots: Head, Body, Weapon, Shield, Cloak, Accessory
- Title system with color coding by level range
- Guild system with guild levels (same `20 * level^2.2` formula)
- Soulbound vs tradeable items
- 6 rarity tiers: Common (gray), Uncommon (green), Rare (blue), Epic (purple), Legendary (orange), Mythic (red/gold)

---

## Part 1 — Produce Three Separate HTML Files

Split the output into three standalone HTML files:

### 1-A. `index.html` — Landing Page
- Based on: `landing-page/code.html` + `landing-page(mobile)/code.html`
- Pure marketing page, NO Web3 required
- CTA "Enter the Tavern" → links to `app.html` (or `app.clawtavern.quest`)
- CTA "Read the Codex" → links to docs (placeholder `#`)
- Fully responsive (desktop + mobile)
- Footer: contract addresses, social links, Base/Chainlink badges

### 1-B. `app.html` — dApp Dashboard (replaces `claw-tavern-app.html`)
- Merge ALL 8 tab designs with existing Web3 logic
- This is the main user-facing application
- Must include all existing contract integration + new RPG/Subscription integration

### 1-C. `admin.html` — Node Operator Dashboard
- Based on: all 6 Admin pages
- Separate app for operators/admins
- Same Web3 connection but with admin-specific contract calls

---

## Part 2 — Normalize Design System

The design mockups have inconsistent configs. Normalize to a single Tailwind config:

```javascript
tailwind.config = {
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "bg-deep": "#0b0910",
        "bg": "#120f16",
        "panel": "#1b1622",
        "panel-strong": "#221c2a",
        "ink": "#f5e8c8",
        "muted": "#c1b39b",
        "gold": "#d8a933",
        "gold-soft": "#f6df8e",
        "wine": "#6f294d",
        "emerald": "#2f8d71",
        "ember": "#da6b38",
        "line": "rgba(245, 232, 200, 0.12)",
        "mist": "rgba(245, 232, 200, 0.08)",
        "base-blue": "#0052ff",
      },
      fontFamily: {
        "display": ["Cinzel", "serif"],
        "body": ["Spectral", "serif"],
        "mono": ["JetBrains Mono", "monospace"],
      },
    },
  },
}
```

Rules:
- ALL pages use Cinzel for headings (NOT Newsreader)
- ALL pages use Spectral for body text
- ALL pages use JetBrains Mono for addresses, data, code
- Background is always `#0b0910` → `#120f16`
- Primary accent is always `#d8a933` (gold)
- Material Symbols Outlined for icons (already used in all designs)

---

## Part 3 — Build `app.html` (dApp Dashboard)

This is the most critical file. It must merge design + Web3 logic + NFT system.

### 3-A. Structure

```
┌─────────────────────────────────────────┐
│ Top Bar: Logo | Network | Wallet        │
├──────┬──────────────────────────────────┤
│ Side │ Main Content Area                │
│ bar  │ (switches based on active tab)   │
│      │                                  │
│ 🏠   │  Overview                        │
│ ⚔️   │  Quest Board                     │
│ 📋   │  My Quests                       │
│ 🧙   │  RPG Profile & Equipment (NEW)   │
│ ⚔️🛡️ │  Guild (NEW)                     │
│ 🪙   │  Token                           │
│ 🛡️   │  Staking                         │
│ 👑   │  Governance                      │
│ 🔑   │  Subscriptions                   │
├──────┴──────────────────────────────────┤
│ Status Bar: Connected | Chain | Block   │
└─────────────────────────────────────────┘
```

Use left sidebar navigation (as shown in Quest Board design) instead of top tabs. **9 tabs total** (was 8; added Guild tab).

### 3-B. Migrate Web3 Logic

Copy ALL JavaScript from current `claw-tavern-app.html` into the new file:

1. **CONFIG object** — network configs with all 11 contract addresses (Sepolia + Mainnet). Add `tavernEquipment` and `tavernGuild` to both network configs (addresses TBD — use placeholder `"0x0000000000000000000000000000000000000000"` for now, will be filled after Task 32 deployment)
2. **ABI constants** — all ABI fragments (REGISTRY_ABI, ESCROW_ABI, TOKEN_ABI, STAKING_ABI, GOVERNANCE_ABI, ROUTER_ABI, PRICE_FEED_ABI, RPG_ABI, SUBSCRIPTION_ABI, **EQUIPMENT_ABI**, **GUILD_ABI**)
3. **Wallet connection** — ethers.js BrowserProvider, signer management
4. **Contract initialization** — `initContracts()` with `getOptionalContract` pattern
5. **All existing functions** — quest loading, staking, governance, address rendering, tx building
6. **Network switching** — Sepolia/Mainnet toggle with chain switching

### 3-C. Add New Web3 Functions for RPG & Equipment Tab

**NOTE: Season system is REMOVED.** No `currentSeasonNumber()` calls. Level system is now formula-based, capped at 100.

Level name mapping (for display):
```javascript
const LEVEL_NAMES = {
  0: "Unranked", 1: "Novice", 2: "Apprentice", 3: "Journeyman",
  4: "Veteran", 5: "Master", 6: "Elder", 7: "Champion",
  8: "Legend", 9: "Mythic", 10: "Sovereign"
};
// Levels 11-100 display as "Lv.XX" (no name)
```

Title color mapping:
```javascript
const TITLE_COLORS = {
  // level range → CSS color
  1: "#FFFFFF", 2: "#FFFFFF", 3: "#FFFFFF", 4: "#FFFFFF",   // White
  5: "#2f8d71", 6: "#2f8d71",                                 // Green
  7: "#4a9eff", 8: "#4a9eff",                                 // Blue
  9: "#9b59b6",                                                // Purple
  10: "#d8a933"                                                // Gold (animated)
};
```

Rarity color mapping:
```javascript
const RARITY_COLORS = {
  0: "#9ca3af", // Common — gray
  1: "#2f8d71", // Uncommon — green
  2: "#4a9eff", // Rare — blue
  3: "#9b59b6", // Epic — purple
  4: "#da6b38", // Legendary — orange
  5: "#d8a933"  // Mythic — red/gold
};
```

```javascript
async function loadRPGProfile() {
  if (!appState.contracts.clientRPG || !appState.userAddress) return;
  try {
    const profile = await appState.contracts.clientRPG.clientProfiles(appState.userAddress);
    // Map to RPG Profile design:
    // profile.level → Level name + number (Lv.5 Master, Lv.42, etc.)
    // profile.exp → EXP progress bar (current / next level threshold)
    // profile.totalJobsCompleted → Character Stats
    // profile.verified → Verification badge
    // profile.registeredAt → Member since date
    // profile.withdrawnThisMonth → Withdrawal used this month
    // NO season display — seasons removed
    updateRPGDOM(profile);
  } catch (err) {
    showError("rpg", err.message);
  }
}

async function loadEquipment() {
  if (!appState.contracts.equipment || !appState.userAddress) return;
  try {
    // Load equipped loadout (6 slots)
    const loadout = await appState.contracts.equipment.getLoadout(appState.userAddress);
    // Load active title
    const activeTitle = await appState.contracts.equipment.activeTitle(appState.userAddress);
    // Load owned item balances (batch query for all 145 items)
    const ownedItems = [];
    for (let id = 1; id <= 145; id++) {
      const bal = await appState.contracts.equipment.balanceOf(appState.userAddress, id);
      if (bal > 0n) ownedItems.push(id);
    }
    updateEquipmentDOM(loadout, activeTitle, ownedItems);
  } catch (err) {
    showError("equipment", err.message);
  }
}

async function equipItem(tokenId) {
  if (!appState.contracts.equipment || !appState.signer) return;
  try {
    const tx = await appState.contracts.equipment.equip(tokenId);
    await tx.wait();
    await loadEquipment(); // refresh
  } catch (err) {
    showError("equip", err.message);
  }
}

async function equipTitle(tokenId) {
  if (!appState.contracts.equipment || !appState.signer) return;
  try {
    const tx = await appState.contracts.equipment.equipTitle(tokenId);
    await tx.wait();
    await loadEquipment();
  } catch (err) {
    showError("title", err.message);
  }
}

async function checkWithdrawalEligibility(amount) {
  if (!appState.contracts.clientRPG || !appState.userAddress) return;
  try {
    const [eligible, reason] = await appState.contracts.clientRPG.checkWithdrawalEligible(
      appState.userAddress,
      ethers.parseEther(amount.toString())
    );
    updateEligibilityDOM(eligible, reason);
  } catch (err) {
    showError("rpg-withdrawal", err.message);
  }
}
```

### 3-C2. RPG Profile Tab Layout

The RPG Profile tab now has **3 sub-sections**:

**Sub-section 1: Character Overview**
```
┌──────────────────────────────────────────────┐
│  [Character Avatar]   Lv.7 Champion          │
│  [Equipment Visual]   ████████░░ 1,270 EXP   │
│                       Title: "Trailblazer"    │
│  Equipped:            (blue title color)      │
│  Head: Dragonbone Horns (Epic)                │
│  Body: Obsidian Battlesuit (Epic)             │
│  Weapon: Enchanted Greatsword (Rare)          │
│  Shield: Crystal Aegis (Rare)                 │
│  Cloak: Starlight Cowl (Epic)                 │
│  Accessory: Eye of the Oracle (Epic)          │
├──────────────────────────────────────────────┤
│  Stats:                                       │
│  Jobs Completed: 142  │  Member Since: 2026   │
│  Verified: ✓          │  Monthly Cap: 78/100  │
└──────────────────────────────────────────────┘
```

**Sub-section 2: Inventory Grid**
```
┌──────────────────────────────────────────────┐
│ Filter: [All] [Equipment] [Titles] [Badges]  │
│ Sort: [Rarity] [Recently Acquired]           │
├──────────────────────────────────────────────┤
│ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐  │
│ │ 🗡️  │ │ 🛡️  │ │ 👑 │ │ 🧥 │ │ 💍 │ │ 📜 │  │
│ │Epic│ │Rare│ │Epic│ │Rare│ │Com │ │Unc │  │
│ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘  │
│ (click to view detail / equip / unequip)     │
└──────────────────────────────────────────────┘
```

**Sub-section 3: NFT Collection Catalog**
```
┌──────────────────────────────────────────────┐
│ 145 Items Total │ 23 Owned │ 122 Locked      │
│ Progress: ████░░░░░ 15.9%                    │
├──────────────────────────────────────────────┤
│ Locked items shown grayed-out with earn      │
│ condition tooltip (e.g. "Reach Lv.5")        │
└──────────────────────────────────────────────┘
```

### 3-C3. New Guild Tab

Add a **new Guild tab** (not in original design mockups — build from scratch matching the design system):

```
┌──────────────────────────────────────────────┐
│ Guild: Dragons of the Claw    GLv.12         │
│ Members: 18/50  │  Total Quests: 245         │
│ Guild EXP: ████████░░ 2,738 / 3,388         │
├──────────────────────────────────────────────┤
│ Guild Hall Decorations:                      │
│ [Wooden Signboard] [Iron Chandelier]         │
│ [Stone Fireplace] [Enchanted Tapestry]       │
│ [Crystal Sconces]                            │
├──────────────────────────────────────────────┤
│ Member List:                                 │
│ 🟢 0xABC...123  Lv.9 Mythic    Agent        │
│ 🟢 0xDEF...456  Lv.7 Champion  Agent        │
│ 🟡 0xGHI...789  Lv.4 Veteran   Client       │
│ ...                                          │
├──────────────────────────────────────────────┤
│ [Leave Guild]  [Transfer Master] (if master) │
└──────────────────────────────────────────────┘

OR if not in a guild:
┌──────────────────────────────────────────────┐
│ You are not in a guild.                      │
│                                              │
│ [Create Guild] (requires 1,000 TVRN stake)   │
│ [Browse Guilds] → list of active guilds      │
│ [Join Guild] → enter guild ID                │
└──────────────────────────────────────────────┘
```

Guild Web3 functions:
```javascript
async function loadGuild() {
  if (!appState.contracts.guild || !appState.userAddress) return;
  try {
    const membership = await appState.contracts.guild.members(appState.userAddress);
    if (membership.guildId > 0n) {
      const guild = await appState.contracts.guild.guilds(membership.guildId);
      const members = await appState.contracts.guild.getGuildMembers(membership.guildId);
      updateGuildDOM(guild, members, membership);
    } else {
      showNoGuildDOM();
    }
  } catch (err) {
    showError("guild", err.message);
  }
}

async function createGuild(name) {
  if (!appState.contracts.guild || !appState.signer) return;
  try {
    // Need TVRN approval for stake
    const stakeAmount = ethers.parseEther("1000");
    const allowance = await appState.contracts.token.allowance(
      appState.userAddress, CONFIG.addresses.tavernGuild
    );
    if (allowance < stakeAmount) {
      const approveTx = await appState.contracts.token.approve(
        CONFIG.addresses.tavernGuild, stakeAmount
      );
      await approveTx.wait();
    }
    const tx = await appState.contracts.guild.createGuild(name);
    await tx.wait();
    await loadGuild();
  } catch (err) {
    showError("create-guild", err.message);
  }
}

async function joinGuild(guildId) {
  if (!appState.contracts.guild || !appState.signer) return;
  try {
    const tx = await appState.contracts.guild.joinGuild(guildId);
    await tx.wait();
    await loadGuild();
  } catch (err) {
    showError("join-guild", err.message);
  }
}
```

### 3-D. Add New Web3 Functions for Subscription Tab

Based on existing SUBSCRIPTION_ABI (`subscriptions`, `agentMonthlyRate`, `subscribe`):

```javascript
async function lookupAgentRate(agentAddress) {
  if (!appState.contracts.subscription) return;
  try {
    const rate = await appState.contracts.subscription.agentMonthlyRate(agentAddress);
    updateAgentRateDOM(agentAddress, rate);
  } catch (err) {
    showError("subscription", err.message);
  }
}

async function subscribeToAgent(agentAddress) {
  if (!appState.contracts.subscription || !appState.signer) return;
  try {
    const rate = await appState.contracts.subscription.agentMonthlyRate(agentAddress);
    // 1. Check USDC allowance
    const usdc = new ethers.Contract(CONFIG.usdcAddress, ERC20_ABI, appState.signer);
    const allowance = await usdc.allowance(appState.userAddress, CONFIG.addresses.tavernSubscription);
    if (allowance < rate) {
      const approveTx = await usdc.approve(CONFIG.addresses.tavernSubscription, rate);
      await approveTx.wait();
    }
    // 2. Subscribe
    const tx = await appState.contracts.subscription.subscribe(agentAddress);
    const receipt = await tx.wait();
    showSuccess("Subscribed!", receipt.hash);
  } catch (err) {
    showError("subscription", err.message);
  }
}
```

### 3-E. Map Design Sections to Contract Data

| Design Element | Contract Call | Notes |
|---|---|---|
| Quest Board cards | `TavernEscrow.getQuest(id)` | Existing logic |
| Quest status badges | quest state enum | Existing logic |
| Overview metrics (Total Quests, Active Agents, TVL) | Registry + Escrow reads | Existing logic |
| Token price display | `AdminPriceFeed.latestAnswer()` | Existing logic |
| Token pool balances | `TavernEscrow.poolBalance(poolId)` | Existing logic |
| Staking info | `TavernStaking.stakes(address)` | Existing logic |
| Governance proposals | `TavernGovernance.proposals(id)` | Existing logic |
| RPG character portrait | Static image based on level | New — use level→image mapping |
| RPG level/EXP/stats | `TavernClientRPG.clientProfiles(address)` | New — NO season calls |
| RPG EXP to next level | `TavernClientRPG.levelThreshold(level+1)` | New — formula-based |
| RPG withdrawal check | `TavernClientRPG.checkWithdrawalEligible()` | New |
| **Equipment loadout** | `TavernEquipment.getLoadout(address)` | **New — 6 slots** |
| **Active title** | `TavernEquipment.activeTitle(address)` | **New — title display** |
| **Owned NFTs** | `TavernEquipment.balanceOf(addr, tokenId)` | **New — inventory** |
| **Item metadata** | `TavernEquipment.items(tokenId)` | **New — item details** |
| **Equip/unequip** | `TavernEquipment.equip(tokenId)` | **New — equipment action** |
| **Equip title** | `TavernEquipment.equipTitle(tokenId)` | **New — title action** |
| **Remaining supply** | `TavernEquipment.getRemainingSupply(tokenId)` | **New — scarcity display** |
| **Guild info** | `TavernGuild.guilds(guildId)` | **New — guild page** |
| **Guild membership** | `TavernGuild.members(address)` | **New — user's guild** |
| **Guild member list** | `TavernGuild.getGuildMembers(guildId)` | **New — member roster** |
| **Create/Join/Leave guild** | `TavernGuild.createGuild/joinGuild/leaveGuild` | **New — guild actions** |
| Subscription agent rate | `TavernSubscription.agentMonthlyRate()` | New |
| Subscribe action | `TavernSubscription.subscribe()` | New |

### 3-F. Responsive Behavior

- Desktop (≥1024px): Sidebar + content layout
- Tablet (768-1023px): Collapsed sidebar (icons only) + content
- Mobile (<768px): Sidebar becomes bottom tab bar (as shown in mobile designs)

---

## Part 4 — Build `admin.html` (Node Dashboard)

### 4-A. Structure

Use horizontal top nav (as shown in Admin-Guild Overview design):
- Dashboard | Guild | Automation | Treasury | Management | **NFT & Guild Admin** | Contracts

**NOTE: "Season Control" page is REPLACED with "NFT & Guild Admin" page.** Seasons are removed from the system entirely.

### 4-B. Web3 Integration

Same wallet/contract setup as `app.html` (11 contracts now), plus admin-specific calls:

| Admin Page | Key Contract Calls |
|---|---|
| Guild Overview | `Registry.getAgentCount()`, `Registry.agents(addr)`, event logs |
| Automation Control | `Router.getUpkeepConfig()`, task type stats (GuildMaintenance replaces SeasonReset), manual triggers |
| Treasury & Fees | `Escrow.poolBalance()`, `Escrow.withdrawOperatorPool()` |
| Agent Management | `Registry.monthlyEjectionReview()`, `Registry.resolveAppeal()` |
| **NFT & Guild Admin** | `TavernEquipment.registerItem()`, `TavernEquipment.adminMint()`, `TavernEquipment.totalMinted()`, `TavernEquipment.setItemActive()`, `TavernGuild.guilds()`, guild stats overview |
| Contract Admin | Role management via `AccessControl.grantRole/revokeRole` (now 11 contracts) |

### 4-B2. NFT & Guild Admin Page Layout

This replaces the original "Season Control" page:

```
┌──────────────────────────────────────────────┐
│ NFT System Overview                          │
│ Total Items: 145  │  Total Minted: 12,458    │
│ Unique Holders: 3,291                        │
├──────────────────────────────────────────────┤
│ Item Registry (table):                       │
│ ID | Name              | Rarity | Minted/Max │
│  1 | Tattered Hood     | Common | 1,204/∞    │
│  2 | Iron Helm         | Common |   892/∞    │
│ ...                                          │
│ 10 | Veil of First Light| Mythic |   3/10    │
├──────────────────────────────────────────────┤
│ Admin Actions:                               │
│ [Manual Mint] tokenId: ___ to: 0x___         │
│ [Toggle Item Active] tokenId: ___            │
│ [Register New Item] (batch form)             │
├──────────────────────────────────────────────┤
│ Guild Overview:                              │
│ Total Guilds: 47  │  Total Members: 891      │
│ Top Guilds by Level:                         │
│ #1 Dragons of Claw  GLv.23  52 members       │
│ #2 Shadow Protocol   GLv.19  38 members      │
│ ...                                          │
└──────────────────────────────────────────────┘
```

### 4-C. Access Control

Add a simple admin check on load:
```javascript
async function checkAdminAccess() {
  const isAdmin = await contracts.escrow.hasRole(DEFAULT_ADMIN_ROLE, userAddress);
  if (!isAdmin) {
    showAccessDenied();
    return false;
  }
  return true;
}
```

---

## Part 5 — Build `index.html` (Landing Page)

### 5-A. Clean Up Design HTML

Take `landing-page/code.html` and:
- Normalize tailwind config to match Part 2 standard
- Replace any hardcoded Newsreader references with Cinzel/Spectral
- Ensure responsive behavior matches `landing-page(mobile)/code.html`
- Add real links:
  - "Enter the Tavern" → `./app.html`
  - BaseScan links → real contract addresses from manifest
  - Social links → placeholder `#` (to be filled later)

### 5-B. SEO & Meta Tags

Add proper meta tags:
```html
<meta name="description" content="Claw Tavern — The Decentralized AI Agent Marketplace on Base. Post quests, hire AI agents, earn $TVRN.">
<meta property="og:title" content="Claw Tavern | Decentralized AI Agent Marketplace">
<meta property="og:description" content="Where AI Adventurers Gather. Post Quests. Hire Agents. Earn $TVRN.">
<meta property="og:type" content="website">
<meta property="og:url" content="https://clawtavern.quest">
<meta name="twitter:card" content="summary_large_image">
```

---

## Part 6 — Extract Shared CSS/Components

Create a shared `<style>` block (or inline at top of each file) containing:

- Medieval border utility (`.medieval-border`)
- Gold shimmer animation (`.shimmer-gold`)
- Panel classes (`.panel`, `.panel-soft`)
- Ornament divider (`.ornament`)
- Scrollbar styling (`.terminal-scroll`)
- Toast notification styles
- Transaction status indicator styles
- Skeleton loading animation

Reference the Component Library design (`Claw Tavern Component Library/code.html`) for standard patterns.

---

## Part 7 — Verification

### 7-A. Parse Test
```bash
# For each HTML file:
node -e "const fs=require('fs'); const h=fs.readFileSync('FILE','utf8'); const m=h.match(/<script[\s\S]*?<\/script>/g)||[]; m.forEach((s,i)=>{try{new Function(s.replace(/<\/?script[^>]*>/g,''));console.log(i,': OK')}catch(e){console.log(i,': ERROR',e.message)}})"
```

### 7-B. Visual Comparison
Open each file in browser and compare against the corresponding `screen.png` in `design/web-page/`.

### 7-C. Web3 Smoke Test (Sepolia)
1. Open `app.html`, connect MetaMask to Base Sepolia
2. Verify all 8 tabs load without console errors
3. Verify Quest Board shows data
4. Verify RPG Profile shows client profile
5. Verify Subscription tab can look up agent rates
6. Verify staking/governance tabs work

### 7-D. TypeScript-free Validation
Since these are standalone HTML files with inline JS, run:
```bash
npx tsc --noEmit  # Ensure existing project still compiles
```

---

## File Output

```
claw-tavern/
├── index.html          ← NEW: Landing page
├── app.html            ← NEW: dApp dashboard (replaces claw-tavern-app.html)
├── admin.html          ← NEW: Node operator dashboard
├── claw-tavern-app.html  ← KEEP: Original as backup (do NOT delete)
```

---

## Acceptance Checklist

### Landing Page (`index.html`)
- [ ] All sections from design rendered correctly
- [ ] Responsive (desktop + mobile)
- [ ] CTAs link to app.html
- [ ] SEO meta tags present
- [ ] No JavaScript errors in console
- [ ] Normalized Cinzel/Spectral typography

### dApp Dashboard (`app.html`)
- [ ] All 9 tabs present with correct sidebar navigation (Overview, Quest Board, My Quests, RPG Profile, Guild, Token, Staking, Governance, Subscriptions)
- [ ] Design matches `design/web-page/` screenshots (for existing 8 pages)
- [ ] Guild tab built from scratch matching design system
- [ ] All existing Web3 logic migrated from `claw-tavern-app.html`
- [ ] All 11 contract addresses (Sepolia + Mainnet) present (2 new as placeholders)
- [ ] EQUIPMENT_ABI and GUILD_ABI added
- [ ] Wallet connect works
- [ ] Network switching works
- [ ] Quest Board loads and displays quests
- [ ] RPG Profile loads client data — **NO season references**
- [ ] RPG Profile shows level with formula-based name (Lv.1-10 named, 11+ numeric)
- [ ] RPG Profile shows EXP progress bar to next level
- [ ] Equipment loadout display (6 slots with item images)
- [ ] Inventory grid with rarity color coding
- [ ] NFT collection catalog (145 items, owned vs locked)
- [ ] Equip/unequip item actions
- [ ] Title selection with color by level range
- [ ] Guild page: create/join/leave guild
- [ ] Guild page: member list, guild level, decoration display
- [ ] Subscription tab loads agent rates from TavernSubscription
- [ ] Subscribe flow works (approval → subscribe → tx link)
- [ ] Withdrawal eligibility checker works
- [ ] Responsive (sidebar → bottom nav on mobile)
- [ ] No console errors
- [ ] **Zero season references** in entire file

### Admin Dashboard (`admin.html`)
- [ ] All 6 pages present with top navigation
- [ ] Design matches Admin screenshots (except Season → NFT Admin)
- [ ] Admin access check on load
- [ ] Guild Overview shows agent roster
- [ ] Automation Control shows task type cards (**GuildMaintenance** not SeasonReset)
- [ ] Treasury shows pool balances
- [ ] Agent Management shows performance data
- [ ] **NFT & Guild Admin** page (replaces Season Control): item registry table, manual mint, toggle active, guild overview
- [ ] Contract Admin shows role management for **11 contracts**
- [ ] No console errors
- [ ] **Zero season references** in entire file

### General
- [ ] Normalized Tailwind config across all 3 files
- [ ] Consistent color palette and typography
- [ ] `npx tsc --noEmit` still passes
- [ ] Original `claw-tavern-app.html` preserved as backup
- [ ] Rarity colors consistent: Common(gray), Uncommon(green), Rare(blue), Epic(purple), Legendary(orange), Mythic(red/gold)
- [ ] Title colors consistent: Lv.1-4(white), 5-6(green), 7-8(blue), 9(purple), 10(gold animated)
