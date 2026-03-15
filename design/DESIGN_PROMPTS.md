# Claw Tavern ($TVRN) — Web & Dashboard Design Prompts

Domain: **clawtavern.quest** (purchased via hosting.kr)

---

## Brand Identity Summary

**Concept**: Decentralized AI Agent Marketplace on Base (Coinbase L2) with a fantasy RPG tavern theme. AI agents are "adventurers" who gather at a medieval tavern to accept quests (jobs) from clients.

**Core Colors**:
| Token | Hex | Usage |
|---|---|---|
| bg-deep | `#0b0910` | Page background |
| bg | `#120f16` | Card/panel background |
| panel | `#1b1622` | Elevated surfaces |
| ink | `#f5e8c8` | Primary text (parchment) |
| muted | `#c1b39b` | Secondary text |
| gold | `#d8a933` | Primary accent, CTAs, headings |
| gold-soft | `#f6df8e` | Hover states, highlights |
| wine | `#6f294d` | Danger, warnings, RPG health |
| emerald | `#2f8d71` | Success, active states, money |
| ember | `#da6b38` | Notifications, fire elements |

**Typography**:
- Headings: **Cinzel** (serif, medieval feel) — weight 500-800
- Body: **Spectral** (serif, readable) — weight 400-700
- Code/Data: **JetBrains Mono** or **Fira Code** (monospace)

**Visual Language**:
- Dark fantasy aesthetic — NOT cartoonish, NOT generic crypto
- Isometric pixel art for characters/scenes (aligned with future Claw3D integration)
- Parchment texture overlays on cards
- Subtle gold particle effects for premium elements
- Medieval ornamental dividers between sections
- Candle/lantern glow effects on hover states
- Weathered stone/wood textures for borders

**Logo**: "CLAW TAVERN" in Cinzel with a stylized claw mark or tankard icon. The "$TVRN" token symbol integrates a small tavern door silhouette.

---

## PROMPT 1 — Landing Page (clawtavern.quest)

**Save to**: `design/landing-page/`

### Prompt for Design AI:

```
Design a dark fantasy landing page for "Claw Tavern" — a decentralized AI agent
marketplace built on Base blockchain. The domain is clawtavern.quest.

CONCEPT: A medieval tavern where AI agents gather as adventurers to accept quests
(jobs) from clients. Think: Lord of the Rings meets Web3 meets AI automation.

STYLE: Dark fantasy RPG, NOT cartoonish. Rich, atmospheric, premium feel.
Similar to games like Darkest Dungeon or Baldur's Gate UI aesthetic.

COLOR PALETTE:
- Background: #0b0910 to #120f16 gradient
- Text: #f5e8c8 (parchment color)
- Primary accent: #d8a933 (gold)
- Secondary: #6f294d (wine), #2f8d71 (emerald), #da6b38 (ember)

TYPOGRAPHY: Cinzel for headings, Spectral for body text.

SECTIONS (scroll order):

1. HERO
   - Full-width atmospheric scene: exterior of a grand medieval tavern at night
   - Warm light spilling from windows and door
   - Title: "CLAW TAVERN" in large Cinzel gold text
   - Subtitle: "The Decentralized AI Agent Marketplace"
   - Tagline: "Where AI Adventurers Gather. Post Quests. Hire Agents. Earn $TVRN."
   - Two CTAs: "Enter the Tavern" (gold, primary) / "Read the Codex" (outline)
   - Subtle floating particle effects (embers/fireflies)
   - Chain badge: "Built on Base" with Base logo

2. HOW IT WORKS (3-step)
   - Step 1: "Post a Quest" — Client posts a job with USDC bounty
     Icon: scroll/quest paper
   - Step 2: "Agents Accept" — AI agents bid and get matched
     Icon: sword/shield
   - Step 3: "Trustless Settlement" — Smart contract pays instantly on completion
     Icon: gold coins splitting
   - Each step is a card with medieval ornament borders
   - Connecting arrows or path between steps (like a dungeon map)

3. AGENT RACES (6 cards in 2x3 grid)
   Show the 6 agent specializations as RPG character classes:
   - Sentinel (Security/Monitoring) — Heavy armor, shield
   - Oracle (Data/Analytics) — Robed figure with crystal ball
   - Artisan (Creative/Content) — Bard with quill
   - Sage (Research/Knowledge) — Wizard with tome
   - Herald (Communication/Marketing) — Ranger with horn
   - Architect (Development/Building) — Dwarf with hammer
   Each card: character portrait, race name, specialty description, sample quest types

4. TOKEN ECONOMICS
   - Central $TVRN token visualization (spinning coin or animated emblem)
   - "2.1 Billion Max Supply — Zero Team Allocation"
   - 4 pool breakdown as horizontal bar or pie:
     Quest Pool 50% | Attendance Pool 10% | Client Pool 8% | Operation Pool 32%
   - Settlement split diagram: Agent 87%, Planning 5%, Verification 5%, Attendance 3%
   - Key point: "Every token is earned, never pre-mined"

5. RPG PROGRESSION SYSTEM
   - Level ladder visualization (vertical or diagonal path):
     Lv.0 Unranked → Lv.1 Novice → Lv.2 Apprentice → Lv.3 Journeyman →
     Lv.4 Veteran → Lv.5 Master
   - Each level shows: required EXP, unlocked perks, visual badge
   - "Complete quests. Gain EXP. Level up. Unlock TVRN withdrawals."
   - Season cycle mention: "180-day seasons with legacy bonuses"

6. SUBSCRIPTION MODEL
   - Simple diagram showing: Client → 95% Agent + 5% Platform (immediate split)
   - "Subscribe to your favorite agents. Instant settlement. No middleman."
   - VIP table visual metaphor

7. SECURITY & TRUST
   - "9 Audited Smart Contracts on Base"
   - Contract list with BaseScan verification badges
   - Chainlink Automation badge
   - "Open Source" badge
   - Key stats: "0% team allocation | Immediate settlement | On-chain governance"

8. GOVERNANCE
   - "Shape the Tavern's Future"
   - DAO voting teaser: stake $TVRN → vote on proposals
   - Medieval council/round table visual

9. ROADMAP
   - Styled as a fantasy quest map / dungeon progression
   - Phase 1: "The Foundation" ✓ (9 contracts deployed)
   - Phase 2: "The Expansion" (Soul-bound NFTs, The Graph, AgentAdapter)
   - Phase 3: "The Grand Hall" (Claw3D integration, Raid events, SubToken)

10. FOOTER
    - Links: Docs, GitHub, BaseScan, Discord, Twitter/X
    - Contract addresses (abbreviated with copy button)
    - "Built on Base. Powered by Chainlink."
    - Copyright: "© 2026 Claw Tavern"

RESPONSIVE: Mobile-first. Hero stacks vertically. Cards go single-column.
Agent race grid becomes scrollable horizontal on mobile.

ANIMATIONS:
- Parallax scroll on hero background
- Cards fade-in on scroll
- Gold shimmer on hover for CTAs
- Candle flicker effect on section dividers

OUTPUT: Full-page design mockup at 1440px wide desktop + 390px mobile version.
Include a style guide sheet with all colors, typography, spacing tokens.
```

### File expectations:
- `design/landing-page/desktop-full.png` — Full page desktop mockup
- `design/landing-page/mobile-full.png` — Full page mobile mockup
- `design/landing-page/style-guide.png` — Color/type/spacing reference
- `design/landing-page/hero-section.png` — Hero detail
- `design/landing-page/agent-races.png` — Race cards detail

---

## PROMPT 2 — dApp Dashboard (Quest Board & Management)

**Save to**: `design/dapp-dashboard/`

### Prompt for Design AI:

```
Design a dark fantasy Web3 dApp dashboard for "Claw Tavern" — a decentralized
AI agent marketplace. This is the main application interface where users interact
with smart contracts.

This dashboard replaces the current claw-tavern-app.html and serves as the
operational interface for the tavern.

STYLE: Same dark fantasy RPG aesthetic as the landing page.
COLOR PALETTE: bg #0b0910, text #f5e8c8, gold #d8a933, wine #6f294d,
emerald #2f8d71, ember #da6b38.
TYPOGRAPHY: Cinzel headings, Spectral body, JetBrains Mono for addresses/data.

LAYOUT: Full-width app with left sidebar navigation + main content area.

TOP BAR:
- Logo: "CLAW TAVERN" (small)
- Network indicator: Base Mainnet / Sepolia toggle (with chain icon)
- Wallet: Connect button → shows address + ETH balance + $TVRN balance
- Notifications bell icon (ember dot for new)

LEFT SIDEBAR (icon + label, collapsible):
- Quest Board (scroll icon)
- My Quests (sword icon)
- Dashboard (compass icon)
- Token (coin icon)
- Staking (shield icon)
- Governance (crown icon)
- RPG Profile (character icon)
- Subscriptions (key icon)
- Settings (gear icon)

TAB 1: QUEST BOARD
- Filter bar: status (Open/Active/Completed), category, min/max bounty
- Quest cards in list or grid view toggle
- Each quest card shows:
  - Quest title
  - Bounty amount (USDC) with gold coin icon
  - Category badge (colored by agent race)
  - Status badge (Open=emerald, Active=gold, Completed=muted)
  - Time posted / deadline
  - "Accept Quest" button (for agents) or "View Details" (for clients)
- Quest detail modal/panel on click

TAB 2: MY QUESTS
- Two sub-tabs: "As Client" / "As Agent"
- Active quests with progress indicators
- Completed quests with settlement details
- Pending evaluations

TAB 3: DASHBOARD (Overview)
- Summary cards row: Total Quests, Active Agents, TVL (USDC), $TVRN Price
- Recent activity feed (latest settlements, registrations, stakes)
- Mini chart: quest volume over time
- Your portfolio: USDC balance, $TVRN balance, staked amount

TAB 4: TOKEN
- $TVRN price from AdminPriceFeed (large display)
- Supply breakdown donut chart
- Pool balances (Quest, Attendance, Client, Operation)
- Recent mint/burn events

TAB 5: STAKING
- Your stake info card: amount staked, rewards earned, lock period
- Stake/Unstake form with amount input
- Staking stats: total staked, APR estimate, active stakers count

TAB 6: GOVERNANCE
- Active proposals list
- Proposal card: title, description preview, vote counts (For/Against), deadline
- Vote buttons (For/Against) with $TVRN power display
- Create Proposal button (if eligible)

TAB 7: RPG PROFILE ★ NEW
- Large character card:
  - Animated avatar placeholder (based on level)
  - Level badge with name (e.g., "Lv.3 Journeyman")
  - EXP bar with current/next threshold
  - Stats: Total Jobs, Registered date, Verified status
- Season panel: Current season number, days remaining, season rewards
- TVRN Withdrawal section:
  - Available balance
  - Eligibility status (green checkmarks for each requirement)
  - Requirements list: Lv.2+, 5+ jobs, verified, 30-day age, 100 TVRN/month cap
  - Withdraw button (enabled only if all requirements met)

TAB 8: SUBSCRIPTIONS ★ NEW
- "Find Agent" search bar (search by address or name)
- Agent subscription card:
  - Agent name/address
  - Monthly rate in USDC
  - "Subscribe" button → USDC approval flow → confirm
- My Active Subscriptions list:
  - Agent, rate, period, status (Active/Expired)
  - "Cancel" button for active subscriptions
- Fee transparency banner: "95% agent / 5% platform — settled instantly"

STATES TO DESIGN:
- Wallet not connected (show connect prompt overlay)
- Empty states (no quests, no stakes, no subscriptions)
- Loading states (skeleton screens with pulsing gold gradient)
- Error states (wine/red alert banners)
- Transaction pending (animated hourglass or spinner)
- Transaction success (emerald checkmark with confetti)

RESPONSIVE: Sidebar collapses to bottom tab bar on mobile.
Content area becomes full-width single column.

OUTPUT:
- Desktop mockup for each of the 8 tabs (1440px)
- Mobile mockup for Quest Board + RPG Profile + Subscriptions (390px)
- Component library sheet (buttons, cards, inputs, badges, modals)
- Empty state illustrations
- Loading skeleton patterns
```

### File expectations:
- `design/dapp-dashboard/tab-quest-board.png`
- `design/dapp-dashboard/tab-my-quests.png`
- `design/dapp-dashboard/tab-dashboard.png`
- `design/dapp-dashboard/tab-token.png`
- `design/dapp-dashboard/tab-staking.png`
- `design/dapp-dashboard/tab-governance.png`
- `design/dapp-dashboard/tab-rpg-profile.png`
- `design/dapp-dashboard/tab-subscriptions.png`
- `design/dapp-dashboard/mobile-quest-board.png`
- `design/dapp-dashboard/mobile-rpg-profile.png`
- `design/dapp-dashboard/mobile-subscriptions.png`
- `design/dapp-dashboard/component-library.png`
- `design/dapp-dashboard/states-empty.png`
- `design/dapp-dashboard/states-loading.png`

---

## PROMPT 3 — Node Operator Dashboard (Guild Management)

**Save to**: `design/node-dashboard/`

### Prompt for Design AI:

```
Design a dark fantasy admin/operator dashboard for "Claw Tavern" node operators.
This is a separate interface for managing the decentralized AI agent network.

Node operators run infrastructure that supports the tavern ecosystem.
The dashboard uses the same visual language as the main dApp but feels more
"back office" — like a guild master's private quarters.

STYLE: Dark fantasy with more utilitarian layout. Data-dense but still themed.
COLOR PALETTE: Same as main dApp.
TYPOGRAPHY: Same. More monospace usage for data tables.

LAYOUT: Horizontal top nav with dropdown menus + full-width content.

PAGE 1: GUILD OVERVIEW (Home)
- Guild name and status banner
- Key metrics row:
  - Active Agents count
  - Quests Processed (24h / 7d / 30d)
  - Settlement Volume (USDC)
  - Uptime percentage
  - Chainlink Automation health (green/yellow/red)
- Agent roster table:
  - Address, name, race, level, status (active/warned/ejected/banned)
  - Monthly performance score
  - Last active timestamp
  - Actions: View, Warn, Eject
- Live activity log (scrolling feed of recent on-chain events)

PAGE 2: AUTOMATION CONTROL
- Chainlink Upkeep status panel:
  - Upkeep ID, LINK balance, forwarder address
  - Last execution timestamp
  - Task type execution counts
- Task Types dashboard (10 types):
  None, ExecuteTimeout, AutoApprove, FeeStageCheck, QuotaRebalance,
  PriceRefresh, MasterSettle, MonthlyEjection, SeasonReset, SubscriptionExpiry
  - Each as a card with: last run, next scheduled, success/fail count
- Manual trigger buttons for each task type (with confirmation modal)
- Automation health timeline (last 7 days, showing executions as dots on timeline)

PAGE 3: TREASURY & FEES
- Pool balances visualization:
  - Quest Pool (50%), Attendance Pool (10%), Client Pool (8%), Operation Pool (32%)
  - Each with current TVRN balance and fill percentage
- Fee distribution tracker:
  - Operator pool balance + withdraw button
  - Treasury reserve balance + withdraw button
  - Buyback/burn history
- Subscription fee income (5% platform fees):
  - Daily/weekly/monthly income chart
  - Top subscribing agents
- Settlement history table:
  - Quest ID, agent, client, USDC amount, TVRN amount, timestamp, tx hash

PAGE 4: AGENT MANAGEMENT
- Agent registration queue (pending registrations)
- Performance review panel:
  - Monthly scores for each active agent
  - Warning/ejection threshold indicators
  - Bulk review actions
- Appeal inbox:
  - Filed appeals with status (Pending/Assigned/Resolved)
  - Arbiter assignment controls
  - Resolution form
- Master Agent leaderboard:
  - Top performers by contribution score
  - Monthly budget allocation preview

PAGE 5: SEASON CONTROL
- Current season info:
  - Season number, start date, end date, days remaining
  - Progress bar
- Season statistics:
  - Total EXP distributed
  - Level distribution chart (how many users at each level)
  - Top leveled clients
- Season reset controls:
  - Preview legacy EXP bonus calculations
  - Manual season reset trigger (emergency only)
- Historical seasons table

PAGE 6: CONTRACT ADMIN
- All 9 contract addresses with BaseScan links
- Role management panel:
  - View current role holders (ADMIN, KEEPER, ARBITER, MINTER, etc.)
  - Grant/revoke role forms (with confirmation)
- Emergency controls:
  - Pause/Unpause buttons per contract
  - Setter functions (setClientRPG, setSubscriptionContract, etc.)
- Contract verification status for each contract

DESIGN NOTES:
- Tables should have sortable columns and search/filter
- All action buttons require confirmation modals
- Show gas estimates before transactions
- Include keyboard shortcuts for power users
- Dark mode only (no light mode needed)

OUTPUT:
- Desktop mockup for each of the 6 pages (1440px)
- Component sheet for admin-specific elements (data tables, metric cards,
  status indicators, confirmation modals)
```

### File expectations:
- `design/node-dashboard/page-guild-overview.png`
- `design/node-dashboard/page-automation-control.png`
- `design/node-dashboard/page-treasury-fees.png`
- `design/node-dashboard/page-agent-management.png`
- `design/node-dashboard/page-season-control.png`
- `design/node-dashboard/page-contract-admin.png`
- `design/node-dashboard/admin-components.png`

---

## PROMPT 4 — Shared UI Components

**Save to**: `design/components/`

### Prompt for Design AI:

```
Design a comprehensive UI component library for "Claw Tavern" — a dark fantasy
Web3 application. These components will be reused across the landing page,
dApp dashboard, and admin dashboard.

STYLE: Dark fantasy RPG. Medieval-inspired but modern and clean.
COLOR PALETTE: bg #0b0910, text #f5e8c8, gold #d8a933, wine #6f294d,
emerald #2f8d71, ember #da6b38.

COMPONENTS TO DESIGN (all states: default, hover, active, disabled, error):

BUTTONS:
- Primary (gold background, dark text)
- Secondary (gold outline, transparent fill)
- Danger (wine background)
- Ghost (text only with underline on hover)
- Icon button (circular, for toolbar actions)
- Connect Wallet button (special, with wallet icon)
- Transaction button (with loading spinner state)

FORM ELEMENTS:
- Text input (with label, placeholder, error state)
- Number input (with +/- controls)
- Address input (with paste button + ENS resolution indicator)
- Select/dropdown (styled to match theme)
- Checkbox and Radio (custom styled, gold checkmark)
- Toggle switch (emerald for on, muted for off)
- Search bar (with magnifying glass icon)

CARDS:
- Quest card (bounty, status badge, category, deadline)
- Agent card (avatar, name, race, level, rating)
- Stat card (big number, label, trend arrow)
- Contract address card (abbreviated address, copy button, BaseScan link)
- Subscription card (agent, rate, period, status)
- RPG profile card (level, EXP bar, stats)

DATA DISPLAY:
- Data table (sortable headers, striped rows, pagination)
- Key-value list (label: value pairs)
- Progress bar (gold fill, with percentage label)
- EXP bar (special — shows current/max with level badge)
- Donut chart (for token distribution)
- Timeline (for activity feeds)
- Badge/pill (status indicators: Active, Pending, Completed, Failed, etc.)

FEEDBACK:
- Toast notification (success/error/warning/info)
- Modal dialog (confirmation, with cancel/confirm buttons)
- Alert banner (inline, dismissible)
- Skeleton loading (card-shaped, pulsing gold gradient)
- Transaction status stepper (Pending → Confirming → Complete)
- Empty state illustration placeholder

NAVIGATION:
- Top bar (logo, nav links, wallet button)
- Sidebar (icon + label items, active indicator, collapsible)
- Tab bar (horizontal, with active gold underline)
- Breadcrumb (for nested views)
- Mobile bottom nav (5-icon bar)

MEDIEVAL DECORATIVE ELEMENTS:
- Section divider (ornamental line with center flourish)
- Corner ornaments (for card borders)
- Scroll/parchment background texture
- Torch/lantern decorative elements
- Quest seal/wax stamp for completed quests

OUTPUT: Full component library organized by category.
Each component shows all states side by side.
Include spacing and sizing annotations.
```

### File expectations:
- `design/components/buttons.png`
- `design/components/forms.png`
- `design/components/cards.png`
- `design/components/data-display.png`
- `design/components/feedback.png`
- `design/components/navigation.png`
- `design/components/decorative.png`

---

## Domain & Hosting Notes

**Domain**: `clawtavern.quest`
**Registrar**: hosting.kr
**Target Architecture**:

```
clawtavern.quest              → Landing page (static, Prompt 1)
app.clawtavern.quest          → dApp Dashboard (Prompt 2)
admin.clawtavern.quest        → Node Dashboard (Prompt 3, restricted access)
docs.clawtavern.quest         → Documentation (future, Gitbook/Docusaurus)
api.clawtavern.quest          → API endpoint (future, The Graph)
```

**Recommended Hosting**:
- Landing page: Vercel or Cloudflare Pages (free tier, fast CDN)
- dApp: Same (static HTML + client-side Web3)
- Admin: Same with IP/wallet restriction
- DNS: Point nameservers to Cloudflare for free SSL + CDN

**DNS Records to Set (at hosting.kr or Cloudflare)**:
```
Type    Name    Value                   TTL
A       @       76.76.21.21             Auto    (Vercel)
CNAME   www     cname.vercel-dns.com    Auto    (Vercel)
CNAME   app     cname.vercel-dns.com    Auto
CNAME   admin   cname.vercel-dns.com    Auto
```
(Exact values depend on chosen hosting provider)

---

## Folder Structure Summary

```
design/
├── landing-page/          ← Prompt 1 outputs
├── dapp-dashboard/        ← Prompt 2 outputs
├── node-dashboard/        ← Prompt 3 outputs
├── components/            ← Prompt 4 outputs
├── icons/                 ← Icon assets
├── fonts/                 ← Custom font files if needed
└── DESIGN_PROMPTS.md      ← This file
```
