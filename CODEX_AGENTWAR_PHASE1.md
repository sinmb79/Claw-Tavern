================================================================================
  CODEX TASK: CLAW TAVERN RESTRUCTURE + AGENT WAR INTEGRATION
  Phase 1 — Site Architecture Overhaul

  Role: Codex = Developer (구현)
  Reviewer: Cowork = Planner/Verifier (기획/검증)

  22B Labs | March 2026
================================================================================


## 0. CONTEXT — READ FIRST

### Architecture Decision
Claw Tavern is being restructured from a single SPA into a **3-file architecture**:

```
clawtavern.quest/
├── index.html              ← NEW: Claw Tavern Home (brand hub)
├── app.html                ← EXISTING: Marketplace (refactored from agentcraft.html)
└── agentwar/index.html     ← NEW: Agent War game (from v3 prototypes)
```

### Ecosystem Structure
```
Claw Tavern (Home Brand, Base Mainnet, TVRN Token)
├── Marketplace — Quest board, guilds, staking, NFT equipment (existing)
├── Agent War — Territory wars RPG, hex map, 3 factions (new)
└── TVRN Token — Shared across all Claw Tavern products

External (separate projects, linked as partners):
├── Agent ID Card (agentidcard.org) — Universal identity verification
├── Koinara (koinara.xyz) — Mission marketplace (World Land network)
└── The4Path (the4path-deploy.vercel.app) — 22B Labs hub
```

### On-Chain Contracts (Base Mainnet, DO NOT MODIFY)
```
TavernToken:       0x7E0185DF566269906711ada358cD816394e20447
TavernRegistry:    0xF19Fc7b03Af2704e9a8d7D11071dE92014B9A0ac
TavernClientRPG:   0xAAA156e23D8E89FBA9f17C3e4ff6ad42ed9fB4A3
TavernStaking:     0x8593D907FC46Ea84c2d6C74E78b04565DAD8860E
TavernGovernance:  0x46407450a1CeAB0F6BFd40e1df33D85fB1E088Ca
AutomationRouter:  0x5dfCd50a8412AebC87F97eE2fD890924643b40EC
```

### Already Completed (by Cowork prior session)
- [x] "AgentCraft" → "Agent War" text rename (0 occurrences remain)
- [x] Header: "Claw Tavern" (brand) + "Agent War" (game name)
- [x] Hero section: bg-landing-hero.png background applied
- [x] World Map: bg-warmap.png background applied
- [x] Home sidebar: "22B Labs Ecosystem" panel (Agent War/AIL/Koinara/The4Path)
- [x] Footer: Ecosystem + 22B Labs + Contact (email/twitter)
- [x] AGENTWAR_FACTIONS 3-faction data defined (Forge/Oracle/Void)
- [x] BG images copied to images/ folder (7 files: bg-warmap, bg-profile, bg-faction-select, bg-landing-hero, bg-leaderboard, bg-guide, bg-battle)
- [x] NFT catalog: 145 items with images in nft-images/standardized/
- [x] Agent Skill Tree system (5 branches, localStorage hybrid)
- [x] Agent ID Card integration (#identity route)
- [x] Tokenomics section exists BUT IS WRONG — must be corrected (see Task 1-3)


================================================================================
## TASK 1-1: CREATE index.html (Claw Tavern Home)
================================================================================

**Priority: P0**
**Output: NEW FILE — index.html**

### Purpose
Brand landing page for Claw Tavern. First thing visitors see.
NOT a complex SPA — clean, cinematic landing page.

### Required Sections

1. **Hero**
   - Title: "Claw Tavern"
   - Subtitle: "AI Agent RPG Marketplace on Base"
   - Background: images/bg-landing-hero.png (opacity 0.3-0.4)
   - Two CTA buttons:
     - "Enter Marketplace" → app.html
     - "Play Agent War" → agentwar/index.html
   - Wallet connect button (ethers.js v6, Base chain 8453)

2. **What is Claw Tavern**
   - Brief protocol description (3-4 sentences)
   - Key stats strip: Total Agents, Quests Completed, TVRN Staked (read from contracts)

3. **Ecosystem Cards** (2 columns or row)
   - **Marketplace** card → app.html
     - "Quest board, guilds, staking, NFT equipment"
     - Icon: storefront
   - **Agent War** card → agentwar/index.html
     - "Territory wars RPG — AI agents battle for hex map dominance"
     - Icon: swords
     - Badge: "NEW"

4. **TVRN Tokenomics** (CRITICAL — use correct data below)

   ```
   Total Supply: 2,100,000,000 TVRN
   Network: Base Mainnet (Chain 8453)
   Standard: ERC-20
   Contract: 0x7E0185DF566269906711ada358cD816394e20447

   4-Pool Distribution:
   ├── Quest Rewards Pool      1,050M (50%) — quest completion + Agent War round rewards
   ├── Attendance/Heartbeat      210M (10%) — agent liveness rewards, Year1: 60M, halving decay, floor 7M
   ├── Client Activity            168M  (8%) — evaluation rewards (1/3/5 TVRN ladder)
   └── Marketplace Operations     672M (32%) — infrastructure operator rewards

   Fee Routing (60/20/20):
   ├── Operator Pool         60%
   ├── Buyback & Burn        20% — TVRN purchased and permanently burned
   └── Treasury Reserve      20% — future expansion

   Staking:
   - Guild Bond: 100 TVRN (required for guild membership)
   - Slash: 50% burn on violation
   - Compensation rewards: 30-day transfer lock
   - Evaluation rewards: 1/3/5 TVRN with monthly decay (100%→50%→20%→0%)

   Governance:
   - Voting: sqrt(balance) weighting
   - Activity bonus: 1.2x for active agents
   - Founding bonus: 1.5x for founding participants
   - Quorum: 10% of total supply in sqrt voting power
   - Proposal threshold: 100 TVRN
   - DAO reallocation cap: 100M total, 30M per 30-day epoch
   ```

   **DO NOT** use the old numbers (1B supply, 40/20/15/15/10 split).
   Source of truth: WHITEPAPER_V2.md section 6.

5. **Partners & Ecosystem Links**
   - Agent ID Card (agentidcard.org) — fingerprint icon, #00e5ff
   - Koinara (koinara.xyz) — currency_exchange icon, #4ade80
   - The4Path (the4path-deploy.vercel.app) — route icon, #c084fc

6. **Footer**
   - Ecosystem links (same as above + Agent War)
   - Built by: 22B Labs
   - Contact: sinmb82@gmail.com
   - Twitter: @clawtavernquest
   - "© 2025 Claw Tavern — 22B Labs. Deployed on Base Mainnet (Chain 8453)"

### Design Requirements
- Dark theme: BG #0a0c14, cards #12141e
- Font: Cinzel (headings) + JetBrains Mono (data) + Space Grotesk (body)
- Gold accent: #d8a933 for TVRN/value displays
- Responsive (mobile-first)
- Tailwind CDN + Google Material Symbols
- ethers.js v6 CDN for wallet/contract reads
- NO backend required — all reads via ethers.js JsonRpcProvider


================================================================================
## TASK 1-2: REFACTOR agentcraft.html → app.html (Marketplace)
================================================================================

**Priority: P0**
**Output: MODIFY agentcraft.html → rename to app.html**

### What to Keep (DO NOT REMOVE)
- Quest Board (#quests) — full quest lifecycle with on-chain interaction
- Character Sheet (#character) — paperdoll, attributes, skill tree, quest history
- Character Create Wizard (#create) — faction select, class select, registration
- Equipment (#equipment) — NFT loadout
- Faction Wars (#wars) — leaderboard tabs
- Governance (#governance) — proposals, voting
- Tokens & Staking (#tokens) — balances, staking bond
- World Map (#world) — SVG hex map with faction HQs
- Game Guide (#guide) — lore, classes, equipment catalog (145 NFTs)
- Agent ID Card (#identity) — AIL registration/verification
- Register Agent (#register) — on-chain joinGuild
- All JS: wallet connection, contract interactions, ethers.js v6, routing

### What to Change
1. **Header brand text**: "Claw Tavern" (small) + "Marketplace" (large)
2. **Remove hero/landing section from #faction-select**:
   - Keep the faction grid for new users
   - Remove the big hero text ("Agent War" / subtitle / CTA buttons)
   - Users arriving at app.html already chose to enter Marketplace
3. **Add "Back to Home" link** in header → index.html
4. **Add "Play Agent War" link** in sidebar → agentwar/index.html
5. **Fix Tokenomics section** — replace current WRONG data with correct 4-pool system
   (Same spec as Task 1-1 section 4 above)
6. **Ensure all internal links work** with hash routing (no change needed if #hash)

### What NOT to Change
- On-chain contract addresses and ABIs
- FACTION_DEFINITIONS (6 factions) — these map to on-chain guild IDs
- CLASS_DEFINITIONS (5 classes)
- NFT_CATALOG (145 items)
- All wallet/contract interaction JS
- Existing CSS custom properties


================================================================================
## TASK 1-3: FIX TOKENOMICS (applies to BOTH index.html and app.html)
================================================================================

**Priority: P0 — CRITICAL**

### Problem
Current agentcraft.html has WRONG tokenomics:
- Shows 1,000,000,000 total supply (should be 2,100,000,000)
- Shows 5-bucket split: Quest 40%, Staking 20%, Treasury 15%, Team 15%, Liquidity 10%
- This does NOT match WHITEPAPER_V2.md or on-chain reality

### Correct Data (Source: WHITEPAPER_V2.md Section 6)

| Pool | Amount | Percentage | Purpose |
|------|--------|-----------|---------|
| Quest Rewards | 1,050,000,000 | 50% | Quest completion + Agent War round rewards |
| Attendance/Heartbeat | 210,000,000 | 10% | Agent liveness, Year1 60M halving to floor 7M |
| Client Activity | 168,000,000 | 8% | Evaluation rewards (1/3/5 TVRN ladder) |
| Marketplace Operations | 672,000,000 | 32% | Infrastructure operator rewards |
| **Total** | **2,100,000,000** | **100%** | |

Fee Routing: 60% operator / 20% buyback-burn / 20% treasury

Staking: 100 TVRN guild bond, 50% slash burn
Governance: sqrt(balance) voting, 1.2x activity, 1.5x founding
Evaluation rewards: 1/3/5 TVRN with monthly decay, same-agent 3x/month cap
Compensation: 30-day transfer lock

### Visual Requirements
- 4 horizontal progress bars (not 5) with correct percentages
- Color coding: Quest=#4ade80, Attendance=#60a5fa, Client=#c084fc, Operations=#f59e0b
- Fee routing visualization (60/20/20 flow diagram)
- Staking/governance info cards


================================================================================
## TASK 1-4: SCAFFOLD agentwar/ DIRECTORY
================================================================================

**Priority: P1**
**Output: NEW DIRECTORY + FILES**

### Directory Structure
```
agentwar/
├── index.html         ← Main game page (hex map + sidebar)
├── images/            ← Symlink or copy of ../images/bg-*.png
└── (future: battles.html, profile.html, ranking.html, guide.html)
```

### For This Phase: index.html Only (MVP)
- Placeholder page with:
  - Header: "Claw Tavern: Agent War"
  - Navigation back to clawtavern.quest (index.html)
  - Background: bg-warmap.png
  - "Coming Soon" content with Agent War description
  - 3-Faction showcase: Forge (#E94560), Oracle (#4A90D9), Void (#9B59B6)
  - Link to existing World Map in Marketplace (app.html#world)

### Agent War 3-Faction Data
```javascript
const AGENTWAR_FACTIONS = [
  { id: 2, name: "The Forge",  color: "#E94560", icon: "local_fire_department",
    desc: "Fire, lava, forges — industrial war machines" },
  { id: 4, name: "The Oracle", color: "#4A90D9", icon: "auto_awesome",
    desc: "Ice, stars, oracles — prophetic intelligence" },
  { id: 1, name: "The Void",   color: "#9B59B6", icon: "blur_on",
    desc: "Mist, void, darkness — shadow operatives" }
];
```
Note: IDs map to existing on-chain guild IDs (Forge=2, Oracle=4, Void=1).

### Reference Materials for Phase 3 (do NOT implement yet, just be aware)
These v3 HTML prototypes exist in `26.03.19. claw-tavern-v3/`:
- agentwar_map_sample.html (1187 lines) — hex map with battle system
- agentwar_faction_select.html (535 lines) — faction selection
- agentwar_battles.html (347 lines) — battle list
- agentwar_agent_profile.html (508 lines) — agent profile page
- agentwar_ranking.html (281 lines) — leaderboard
- agentwar_guide.html (522 lines) — game guide
- agentwar_landing.html (1221 lines) — marketing landing

Design system: `26.03.19. claw-tavern-v3/Agent Profile/DESIGN.md`
- "Cyber-Relic" aesthetic: dark fantasy + tech hybrid
- 0px border-radius (sharp edges)
- Forge Red #E94560, Oracle Blue #4A90D9, Void Purple #9B59B6
- Space Grotesk + Inter fonts
- No 1px borders for sectioning — use background color shifts


================================================================================
## TASK 1-5: UPDATE NAVIGATION (all files)
================================================================================

**Priority: P0**

### index.html Navigation
```
Header: [Claw Tavern Logo] [Marketplace] [Agent War] [Docs] | [Connect Wallet]
```

### app.html (Marketplace) Navigation
```
Header: [← Home] [Claw Tavern] Marketplace | [Base Mainnet] [Connect Wallet]
Sidebar: (keep existing nav items) + add "Agent War" link at top → agentwar/
```

### agentwar/index.html Navigation
```
Header: [← Home] [Claw Tavern] Agent War | [Base Mainnet] [Connect Wallet]
```

### Cross-Links Required
- index.html → app.html ("Enter Marketplace")
- index.html → agentwar/index.html ("Play Agent War")
- app.html → index.html ("← Home" or logo click)
- app.html → agentwar/index.html (sidebar link)
- agentwar/index.html → index.html ("← Home" or logo click)
- agentwar/index.html → app.html ("Visit Marketplace")


================================================================================
## TASK 1-6: COPY ASSETS TO PORTAL REPO
================================================================================

**Priority: P1**
**Repo: ClawTavern-Portal (sinmb79/ClawTavern-Portal.git)**

### Files to Copy
```
Claw-Tavern/                    → ClawTavern-Portal/
├── index.html (new)            → /index.html (or /game/)
├── app.html (renamed)          → /game/index.html
├── agentwar/index.html (new)   → /game/agentwar/index.html
├── images/bg-*.png (7 files)   → /game/images/
├── images/map.png              → /game/images/
└── nft-images/standardized/    → /game/nft-images/standardized/ (145 files)
```

### Portal Routing (Cloudflare Pages)
Current: clawtavern.quest/game → game/index.html
New routing needed:
- clawtavern.quest/ → index.html (Claw Tavern Home)
- clawtavern.quest/game → game/index.html (Marketplace)
- clawtavern.quest/agentwar → game/agentwar/index.html (Agent War)


================================================================================
## AVAILABLE ASSETS
================================================================================

### Background Images (already in images/)
| File | Usage |
|------|-------|
| bg-warmap.png | World Map / Agent War hex map background |
| bg-landing-hero.png | Home hero section |
| bg-profile.png | Agent/character profile pages |
| bg-faction-select.png | Faction selection screens |
| bg-leaderboard.png | Rankings/leaderboard |
| bg-guide.png | Game guide / documentation |
| bg-battle.png | Battle results screen |

### Faction Images (already in images/)
6 factions × 3 variants = 18 files:
- faction-{slug}-emblem.png (icon)
- faction-{slug}-banner.png (wide banner)
- faction-{slug}-character.png (full character art)
Slugs: nexus, void, forge, phantom, oracle, revenants

### Class Avatars (already in images/)
5 files: class-{name}-avatar.png
Names: warrior, mage, ranger, rogue, healer

### NFT Items (in nft-images/)
145 PNG files in nft-images/standardized/{id}.png (id: 1-145)
Metadata in nft-images/metadata/{id}.json
Categories: Equipment(60), Title(20), GuildDecoration(20), SpecialEvent(20), Contributor(25)


================================================================================
## ACCEPTANCE CRITERIA
================================================================================

### Phase 1 Complete When:
- [ ] index.html exists and loads as Claw Tavern Home
- [ ] index.html has CORRECT tokenomics (2.1B, 4-pool, 60/20/20 fees)
- [ ] index.html links to Marketplace (app.html) and Agent War (agentwar/)
- [ ] app.html is the renamed/refactored marketplace (all existing features work)
- [ ] app.html tokenomics section corrected to match WHITEPAPER_V2.md
- [ ] app.html has nav link back to Home and to Agent War
- [ ] agentwar/index.html exists as placeholder with 3-faction showcase
- [ ] All cross-navigation links work
- [ ] No "AgentCraft" text anywhere (already done, verify it stays)
- [ ] All existing on-chain interactions still work (wallet, quests, staking, governance)
- [ ] Brace/paren balance passes on all HTML files
- [ ] Assets copied to ClawTavern-Portal repo
- [ ] Both repos committed and pushed to GitHub

### DO NOT in Phase 1:
- Do NOT modify smart contracts
- Do NOT implement Agent War game logic (hex map, battles, Polymarket)
- Do NOT change WHITEPAPER_V2.md yet (that's Phase 2)
- Do NOT remove 6-faction system from Marketplace (on-chain dependency)
- Do NOT build Agent War backend (Cloudflare Workers — that's Phase 3)


================================================================================
## PHASE 2 PREVIEW (문서 업데이트 — next sprint)
================================================================================

Scope:
- WHITEPAPER_V2.md — add Agent War RPG section, ecosystem architecture
- MASTER_ROADMAP.md — add Agent War phases
- README.md — update project description
- ECOSYSTEM_ARCHITECTURE.md — new file, ecosystem diagram

## PHASE 3 PREVIEW (Agent War 서브페이지 — 2주 후)
================================================================================

Scope:
- agentwar/index.html → full hex map game (from agentwar_map_sample.html)
- agentwar/factions.html → faction selection (from agentwar_faction_select.html)
- agentwar/battles.html → battle list (from agentwar_battles.html)
- agentwar/profile.html → agent profile (from agentwar_agent_profile.html)
- agentwar/ranking.html → leaderboard (from agentwar_ranking.html)
- agentwar/guide.html → game guide (from agentwar_guide.html)
- Apply Cyber-Relic design system (from Agent Profile/DESIGN.md)
- Apply BG images to each page
- Cloudflare Workers + D1 backend (from AgentWar_Sprint1_Tasks_FINAL.txt)


================================================================================
  END OF CODEX TASK DOCUMENT
  Questions → ask Cowork (planner/verifier role)
================================================================================
