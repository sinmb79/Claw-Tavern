# Claw Tavern NFT System Design — Demand-Based Supply Model

---

## 1. User Base Projections

### Growth Phases

| Phase | Timeline | Active Users | Agents | Clients | Guilds |
|-------|----------|-------------|--------|---------|--------|
| Launch | Month 1-3 | 100-500 | 30-100 | 70-400 | 0-5 |
| Growth | Month 4-12 | 500-5,000 | 100-500 | 400-4,500 | 5-50 |
| Mature | Year 2-3 | 5,000-50,000 | 500-5,000 | 4,500-45,000 | 50-500 |
| Scale | Year 3+ | 50,000+ | 5,000+ | 45,000+ | 500+ |

### Level System — Capped at Lv.100, Formula-Based

**Formula: `threshold = 20 * level^2.2`**

Levels cap at 100. Named tiers for Lv.0-10; beyond that, numeric levels with NFT milestones every 5 levels.

**Sample thresholds:**

| Lv | Name | EXP Required | Client Casual | Client Active | Agent | Master Agent | Guild Master (L) |
|----|------|-------------|---------------|---------------|-------|--------------|------------------|
| 0 | Unranked | 0 | — | — | — | — | — |
| 1 | Novice | 20 | instant | instant | instant | instant | instant |
| 2 | Apprentice | 92 | <1mo | <1mo | <1mo | <1mo | <1mo |
| 3 | Journeyman | 213 | 1.4mo | <1mo | <1mo | <1mo | <1mo |
| 4 | Veteran | 388 | 2.6mo | <1mo | <1mo | <1mo | <1mo |
| 5 | Master | 621 | 4.2mo | 1.5mo | 1mo | <1mo | <1mo |
| 6 | Elder | 914 | 6.1mo | 2.2mo | 1.5mo | 1mo | <1mo |
| 7 | Champion | 1,270 | 8.5mo | 3mo | 2.1mo | 1.3mo | <1mo |
| 8 | Legend | 1,691 | 11.4mo | 4mo | 2.8mo | 1.8mo | 1.2mo |
| 9 | Mythic | 2,180 | 14.6mo | 5.1mo | 3.7mo | 2.3mo | 1.6mo |
| 10 | Sovereign | 2,738 | 18.4mo | 6.5mo | 4.6mo | 2.9mo | 2mo |
| 15 | — | 6,770 | 45mo | 16mo | 11.4mo | 7.1mo | 4.9mo |
| 20 | — | 12,973 | 87mo | 31mo | 21.8mo | 13.7mo | 9.3mo |
| 30 | — | 31,944 | 214mo | 75mo | 53.7mo | 33.6mo | 22.9mo |
| 50 | — | 89,637 | 602mo | 211mo | 150.6mo | 94.4mo | 64.2mo |
| 75 | — | 219,968 | — | 519mo | 369.7mo | 231.5mo | 157.6mo |
| 100 | — | 502,377 | — | — | 844.3mo (~70yr) | 528.8mo (~44yr) | 360.1mo (~30yr) |

**Design philosophy:** Lv.100 is a lifetime achievement. Only the most dedicated guild masters could theoretically reach it in ~30 years. This creates an unattainable aspirational target that drives engagement — humans are motivated by goals just beyond reach.

### Role-Based Monthly EXP Rates

| Role | Monthly EXP | Basis |
|------|------------|-------|
| Client (casual) | ~149 | Few chats (20), occasional quests (60), some streaks (60), rare referral (9) |
| Client (active) | ~424 | Regular chats (20), 8 quests (160), evals (24), weekly streaks (120), referrals (50), 1 sub (50) |
| Agent | ~595 | Job completions (300), evals (75), streaks (120), subscriptions (100) |
| Master Agent | ~950 | Heavy completions (500), evals (150), streaks (120), subs (100), referrals (80) |
| Guild Master (small) | ~700 | Agent base + guild quest bonuses |
| Guild Master (medium) | ~1,050 | Agent base + medium guild bonuses |
| Guild Master (large) | ~1,395 | Agent base + large guild bonuses + management bonuses |

### Level Distribution Projection (10,000 Users, 2 years)

```
Lv.0          3.8%    (376 users — registered but inactive)
Lv.1-4       35.2%    (3,519 users — casual / light engagement)
Lv.5-8       25.1%    (2,508 users — regular to committed users)
Lv.9-12      18.3%    (1,832 users — dedicated users)
Lv.13-18     11.4%    (1,143 users — power users / agents)
Lv.19-25      4.8%    (478 users — elite tier)
Lv.26-40      1.2%    (120 users — prestige tier)
Lv.41+        0.2%    (24 users — legendary territory)

Average: Lv.8 | Median: Lv.6 | Max observed: ~Lv.35
```

### EXP Sources

| Activity | EXP | Frequency (active user) | Monthly EXP |
|----------|-----|------------------------|-------------|
| Free Chat | 1 | 20x/month | 20 |
| Job Complete | 20 | 8x/month | 160 |
| Evaluation Submit | 3 | 8x/month | 24 |
| Weekly Streak | 30 | 4x/month | 120 |
| Referral | 50 | 1x/month | 50 |
| Subscription | 100 | 0.5x/month | 50 |

**Active user monthly EXP ≈ 424 EXP/month**

### Smart Contract Implementation

```solidity
uint256 public constant MAX_LEVEL = 100;

// 20 * level^2.2 via integer approximation
function levelThreshold(uint256 level) public pure returns (uint256) {
    if (level == 0) return 0;
    if (level > MAX_LEVEL) return type(uint256).max; // effectively unreachable
    // Uses precomputed lookup table for gas efficiency
    return _thresholds[level];
}
```

**Why polynomial (not exponential):** Exponential curves (e.g., 1.65^level) grow too fast — Lv.15 would take 300+ months for power users. Polynomial `level^2.2` keeps mid-game achievable while making the endgame (Lv.50+) a true lifetime pursuit. The Lv.100 cap serves as a mythical ceiling that inspires without frustrating.

---

## 2. Guild Growth Model

### Guild Quest Volume by Size

| Guild Size | Monthly Quests | Monthly Guild EXP | Notes |
|-----------|---------------|-------------------|-------|
| 3 members | ~20 | ~400 | Startup guild |
| 5 members | ~35 | ~700 | Small active guild |
| 10 members | ~65 | ~1,300 | Growing guild |
| 15 members | ~100 | ~2,000 | Established guild |
| 25 members | ~165 | ~3,300 | Medium guild |
| 40 members | ~260 | ~5,200 | Large guild |
| 50 members | ~325 | ~6,500 | Major guild |
| 80 members | ~520 | ~10,400 | Mega guild |

### Guild Level Progression (Option B formula applied to guilds)

Guilds use the same `20 * level^2.2` formula but earn EXP collectively from member quests.

| Guild Level | EXP Required | 3-member Guild | 15-member Guild | 50-member Guild |
|-------------|-------------|----------------|-----------------|-----------------|
| GLv.5 | 621 | 1.6mo | <1mo | <1mo |
| GLv.10 | 2,738 | 6.8mo | 1.4mo | <1mo |
| GLv.20 | 12,973 | 32.4mo | 6.5mo | 2mo |
| GLv.30 | 31,944 | 79.9mo | 16mo | 4.9mo |
| GLv.50 | 89,637 | 224mo (18.7yr) | 44.8mo (3.7yr) | 13.8mo (1.1yr) |

### Guild Growth Plateau Model

Guilds naturally plateau at different sizes based on available agents and market conditions:

| Guild Type | Plateau Size | Typical GLv at 2yr | Decoration Tier |
|-----------|-------------|-------------------|-----------------|
| Startup | ~5 members | GLv.15-20 | Basic (Common + Uncommon) |
| Small | ~15 members | GLv.25-35 | Intermediate (+ Rare) |
| Medium | ~40 members | GLv.40-50 | Advanced (+ Epic) |
| Large | ~80 members | GLv.50+ | Full (+ Legendary) |

---

## 3. Rarity Tier System

| Tier | Color | Max Supply per Item | Estimated Holders at 10K Users |
|------|-------|--------------------|---------------------------------|
| Common | Gray | Unlimited (mintable) | Anyone who levels up |
| Uncommon | Green | 5,000 | ~2,500 |
| Rare | Blue | 1,000 | ~500 |
| Epic | Purple | 250 | ~100 |
| Legendary | Orange | 50 | ~25 |
| Mythic | Red/Gold | 10 | ~5 |

**Supply Rationale**:
- **Common** (unlimited): Ensures every participant gets something. Engagement driver.
- **Uncommon** (5K): Achievable by dedicated users. Light scarcity.
- **Rare** (1K): Meaningful scarcity. Requires real commitment.
- **Epic** (250): Prestige items. Top 1-2% of user base.
- **Legendary** (50): Extremely scarce. Status symbols.
- **Mythic** (10): Near-unique. Only the most dedicated or first achievers.

---

## 4. NFT Item Catalog — 145 Items

### Category A: Character Equipment (60 items)

Equipment slots: **Head, Body, Weapon, Shield, Cloak, Accessory** (6 slots)

Each slot × 10 items across rarity tiers = 60 items

#### A1. Head Slot (10 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 1 | Tattered Hood | Common | ∞ | Reach Lv.1 |
| 2 | Iron Helm | Common | ∞ | Complete 5 quests |
| 3 | Scout's Bandana | Uncommon | 5,000 | Reach Lv.2 |
| 4 | Runed Circlet | Uncommon | 5,000 | Complete 20 quests |
| 5 | Silver Crown | Rare | 1,000 | Reach Lv.3 |
| 6 | Phoenix Feather Helm | Rare | 1,000 | 10 consecutive weekly streaks |
| 7 | Dragonbone Horns | Epic | 250 | Reach Lv.5 |
| 8 | Crown of the Arbiter | Epic | 250 | Resolve 50 disputes (agent) |
| 9 | Sovereign's Diadem | Legendary | 50 | Reach Lv.8 |
| 10 | Veil of the First Light | Mythic | 10 | First 10 users to reach Lv.10 |

#### A2. Body Slot (10 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 11 | Linen Tunic | Common | ∞ | Reach Lv.1 |
| 12 | Traveler's Coat | Common | ∞ | Verified account |
| 13 | Chainmail Vest | Uncommon | 5,000 | Reach Lv.2 |
| 14 | Enchanted Robe | Uncommon | 5,000 | Subscribe to 3 agents |
| 15 | Mithril Plate | Rare | 1,000 | Reach Lv.4 |
| 16 | Stormweaver Garb | Rare | 1,000 | Complete 50 quests |
| 17 | Obsidian Battlesuit | Epic | 250 | Reach Lv.6 |
| 18 | Celestial Vestments | Epic | 250 | Earn 50,000 total EXP |
| 19 | Armor of the Tavern Keeper | Legendary | 50 | Reach Lv.9 |
| 20 | Ethereal Mantle | Mythic | 10 | Top 10 EXP holders all-time |

#### A3. Weapon Slot (10 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 21 | Wooden Staff | Common | ∞ | Reach Lv.1 |
| 22 | Iron Dagger | Common | ∞ | Complete 3 quests |
| 23 | Steel Longsword | Uncommon | 5,000 | Reach Lv.2 |
| 24 | Frost Wand | Uncommon | 5,000 | Refer 3 users |
| 25 | Enchanted Greatsword | Rare | 1,000 | Reach Lv.3 |
| 26 | Shadow Daggers | Rare | 1,000 | Complete 30 quests in 1 month |
| 27 | Molten Warhammer | Epic | 250 | Reach Lv.5 |
| 28 | Vorpal Blade of Truth | Epic | 250 | 100% evaluation approval rate (min 20) |
| 29 | Starfall Scepter | Legendary | 50 | Reach Lv.8 |
| 30 | Excalibur of the Claw | Mythic | 10 | First 10 to 100,000 EXP |

#### A4. Shield Slot (10 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 31 | Wooden Buckler | Common | ∞ | Reach Lv.1 |
| 32 | Round Shield | Common | ∞ | Stake any amount of TVRN |
| 33 | Kite Shield | Uncommon | 5,000 | Reach Lv.2 |
| 34 | Ward of the Watcher | Uncommon | 5,000 | Participate in 1 governance vote |
| 35 | Crystal Aegis | Rare | 1,000 | Reach Lv.4 |
| 36 | Dragon Scale Shield | Rare | 1,000 | Stake ≥ 10,000 TVRN for 90 days |
| 37 | Bastion of Ages | Epic | 250 | Reach Lv.6 |
| 38 | Mirror of Deflection | Epic | 250 | Vote in 20 governance proposals |
| 39 | Wall of the Immortals | Legendary | 50 | Reach Lv.9 |
| 40 | Aegis of Genesis | Mythic | 10 | Active in first 30 days of launch |

#### A5. Cloak Slot (10 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 41 | Worn Travel Cloak | Common | ∞ | Reach Lv.1 |
| 42 | Hooded Cape | Common | ∞ | 7-day login streak |
| 43 | Silk Mantle | Uncommon | 5,000 | Reach Lv.3 |
| 44 | Shadowstep Cloak | Uncommon | 5,000 | Complete 10 quests |
| 45 | Windrunner's Shroud | Rare | 1,000 | Reach Lv.4 |
| 46 | Cloak of Many Tasks | Rare | 1,000 | Use 3 different agent races |
| 47 | Starlight Cowl | Epic | 250 | Reach Lv.7 |
| 48 | Void Cloak | Epic | 250 | 100 total quests completed |
| 49 | Mantle of the Founder | Legendary | 50 | First 50 registered users |
| 50 | Wings of Ascension | Mythic | 10 | Reach Lv.10 |

#### A6. Accessory Slot (10 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 51 | Copper Ring | Common | ∞ | Register account |
| 52 | Adventurer's Pendant | Common | ∞ | Complete first quest |
| 53 | Silver Amulet | Uncommon | 5,000 | Reach Lv.2 |
| 54 | Rune-etched Bracer | Uncommon | 5,000 | Earn 1,000 EXP |
| 55 | Sapphire Signet Ring | Rare | 1,000 | Reach Lv.4 |
| 56 | Chain of Command | Rare | 1,000 | Create a guild |
| 57 | Eye of the Oracle | Epic | 250 | Reach Lv.7 |
| 58 | Amulet of Infinite Wisdom | Epic | 250 | 200 total quests |
| 59 | Ring of the Tavern Lords | Legendary | 50 | Top 50 all-time quest completions |
| 60 | Heart of the Claw | Mythic | 10 | Hold all 5 Legendary items simultaneously |

---

### Category B: Title NFTs (20 items)

Titles display above character names with color coding.

| # | Title | Color | Rarity | Max Supply | Earn Condition |
|---|-------|-------|--------|------------|----------------|
| 61 | Wanderer | Gray | Common | ∞ | Reach Lv.1 |
| 62 | Seeker | Gray | Common | ∞ | Complete 5 quests |
| 63 | Pathfinder | Green | Uncommon | 5,000 | Reach Lv.2 |
| 64 | Questrunner | Green | Uncommon | 5,000 | Complete 15 quests |
| 65 | Trailblazer | Blue | Rare | 1,000 | Reach Lv.3 |
| 66 | Keeper of Secrets | Blue | Rare | 1,000 | Verified + 30 quests |
| 67 | Warden | Purple | Epic | 250 | Reach Lv.5 |
| 68 | Oathbound | Purple | Epic | 250 | 365-day account age |
| 69 | Dragonslayer | Orange | Legendary | 50 | Reach Lv.8 |
| 70 | The Eternal | Red/Gold | Mythic | 10 | Reach Lv.10 |
| 71 | First Blood | Red | Legendary | 1 | First user to complete a quest on mainnet |
| 72 | Pioneer | Orange | Legendary | 50 | First 50 mainnet quest completers |
| 73 | Benefactor | Blue | Rare | 1,000 | Refer 10 users |
| 74 | Grand Patron | Purple | Epic | 250 | Subscribe to 10 agents simultaneously |
| 75 | Iron Will | Blue | Rare | 1,000 | 52 consecutive weekly streaks (1 year) |
| 76 | Voice of the Realm | Purple | Epic | 250 | Create 5 passed governance proposals |
| 77 | Stakeholder | Green | Uncommon | 5,000 | Stake ≥ 1,000 TVRN |
| 78 | Diamond Hands | Blue | Rare | 1,000 | Stake ≥ 50,000 TVRN for 180 days |
| 79 | Guild Master | Purple | Epic | 250 | Create a guild with 10+ members |
| 80 | The Sovereign | Red/Gold | Mythic | 10 | First 10 to hold every Epic+ title |

---

### Category C: Guild Decoration Items (20 items)

Earned by guild masters or as guild-level achievements. Applied to guild hall visual.

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 81 | Wooden Signboard | Common | ∞ | Create a guild |
| 82 | Iron Chandelier | Common | ∞ | Guild reaches 3 members |
| 83 | Stone Fireplace | Uncommon | 5,000 | Guild reaches 5 members |
| 84 | Enchanted Tapestry | Uncommon | 5,000 | Guild completes 10 quests total |
| 85 | Crystal Sconces | Rare | 1,000 | Guild reaches 10 members |
| 86 | Grand Oak Table | Rare | 1,000 | Guild completes 50 quests total |
| 87 | Trophy Wall | Rare | 1,000 | Guild has 5 members at Lv.3+ |
| 88 | Arcane Fountain | Epic | 250 | Guild reaches 25 members |
| 89 | Dragon Skull Mount | Epic | 250 | Guild completes 200 quests total |
| 90 | Throne of Command | Epic | 250 | Guild has a Lv.7+ member |
| 91 | Hall of Champions | Legendary | 50 | Guild reaches 50 members |
| 92 | Celestial Ceiling Mural | Legendary | 50 | Guild avg level ≥ 5 |
| 93 | Portal of Realms | Legendary | 50 | Top 50 guilds by total quest volume |
| 94 | Crown Jewel Display | Mythic | 10 | Top 10 guilds all-time |
| 95 | The Infinity Hearth | Mythic | 10 | First 10 guilds to 1,000 quests |
| 96 | Banner: Iron | Common | ∞ | Guild 1-month anniversary |
| 97 | Banner: Silver | Uncommon | 5,000 | Guild 3-month anniversary |
| 98 | Banner: Gold | Rare | 1,000 | Guild 6-month anniversary |
| 99 | Banner: Platinum | Epic | 250 | Guild 1-year anniversary |
| 100 | Banner: Diamond | Legendary | 50 | Guild 2-year anniversary |

---

### Category D: Special / Event Items (20 items)

Limited edition items tied to events, milestones, or cross-promotions.

| # | Item Name | Type | Rarity | Max Supply | Earn Condition |
|---|-----------|------|--------|------------|----------------|
| 101 | Genesis Badge | Badge | Legendary | 500 | Active during launch week |
| 102 | Tavern Founding Stone | Accessory | Epic | 250 | Active during first month |
| 103 | Base Chain Emblem | Badge | Rare | 1,000 | First 1,000 mainnet transactions |
| 104 | Chainlink Oracle Eye | Accessory | Epic | 250 | Complete quest using oracle pricing |
| 105 | TVRN Hodler Ring | Accessory | Rare | 1,000 | Hold ≥ 10,000 TVRN for 90 days |
| 106 | Bug Hunter Badge | Badge | Epic | 250 | Report valid bug via governance |
| 107 | Community Hero Cape | Cloak | Legendary | 50 | Top community contributors (manual) |
| 108 | Raid Champion Trophy | Trophy | Epic | 250 | Win first raid event (future) |
| 109 | Claw3D Pioneer | Badge | Legendary | 50 | First 50 Claw3D integration users |
| 110 | Seasonal Frost Crown | Head | Rare | 1,000 | Event: Winter campaign |
| 111 | Harvest Moon Staff | Weapon | Rare | 1,000 | Event: Autumn campaign |
| 112 | Spring Bloom Cloak | Cloak | Rare | 1,000 | Event: Spring campaign |
| 113 | Summer Flame Shield | Shield | Rare | 1,000 | Event: Summer campaign |
| 114 | Perfect 10 Medal | Badge | Epic | 250 | 10 consecutive 5-star evaluations |
| 115 | Subscription Patron Seal | Badge | Rare | 1,000 | Maintain 3 subscriptions for 6 months |
| 116 | Governance Speaker's Robe | Body | Epic | 250 | 50 governance votes cast |
| 117 | The OG Scroll | Accessory | Mythic | 100 | Pre-launch registrants |
| 118 | Cross-Chain Voyager | Badge | Epic | 250 | Future: bridge TVRN to another chain |
| 119 | 1M EXP Club | Badge | Mythic | 10 | Reach 1,000,000 EXP (beyond Lv.100 cap) |
| 120 | The Completionist | Badge | Mythic | 1 | First user to own 100+ unique items |

---

### Category E: Contributor NFT Tracks (25 items)

5 separate progression tracks rewarding sustained contribution in specific roles. Each track has 5 items at escalating rarity, earned by cumulative activity — not level.

#### E1. Client Track (5 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 121 | First Quest Seal | Common | ∞ | Post first quest as client |
| 122 | Trusted Patron Badge | Uncommon | 5,000 | Complete 25 quests as client |
| 123 | Power Buyer Insignia | Rare | 1,000 | Spend ≥ 10,000 USDC total on quests |
| 124 | Whale Client Crown | Epic | 250 | Spend ≥ 100,000 USDC total + 100 quests |
| 125 | The Architect's Eye | Legendary | 50 | Top 50 all-time quest posters by volume |

#### E2. Agent Track (5 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 126 | First Completion Star | Common | ∞ | Complete first quest as agent |
| 127 | Reliable Agent Badge | Uncommon | 5,000 | Complete 50 quests + ≥ 4.5 avg rating |
| 128 | Speed Demon Gauntlet | Rare | 1,000 | Complete 100 quests within deadline |
| 129 | Master Craftsman Seal | Epic | 250 | Complete 500 quests + ≥ 4.8 avg rating |
| 130 | Legendary Agent Mantle | Legendary | 50 | Top 50 agents by lifetime earnings |

#### E3. Guild Track (5 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 131 | Guild Founder's Hammer | Common | ∞ | Create a guild |
| 132 | Growing Guild Banner | Uncommon | 5,000 | Guild reaches 10 active members |
| 133 | Guild Strategist Medal | Rare | 1,000 | Guild completes 100 total quests |
| 134 | Mega Guild Throne | Epic | 250 | Guild reaches 50 members + GLv.30 |
| 135 | Empire Builder Crown | Legendary | 50 | Top 50 guilds by combined member EXP |

#### E4. Governance Track (5 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 136 | First Vote Scroll | Common | ∞ | Cast first governance vote |
| 137 | Active Voter Pin | Uncommon | 5,000 | Vote in 10 governance proposals |
| 138 | Proposal Author Quill | Rare | 1,000 | Create 3 proposals that pass |
| 139 | Senate Elder Robe | Epic | 250 | Vote in 50 proposals + author 5 passed |
| 140 | Oracle of the Realm | Legendary | 50 | Top 50 governance participants by activity |

#### E5. Operations Track (5 items)

| # | Item Name | Rarity | Max Supply | Earn Condition |
|---|-----------|--------|------------|----------------|
| 141 | First Report Badge | Common | ∞ | Submit first bug report or feedback |
| 142 | Vigilant Eye Pin | Uncommon | 5,000 | Report 5 valid issues |
| 143 | Bug Slayer Sword | Rare | 1,000 | Report 20 valid issues + 3 critical |
| 144 | System Guardian Shield | Epic | 250 | Significant operational contribution (manual) |
| 145 | The Sentinel | Legendary | 50 | Core contributor recognition (manual award) |

---

## 5. Supply Summary

| Rarity | Items | Total Mintable Supply | % of Catalog |
|--------|-------|----------------------|--------------|
| Common | 29 items | Unlimited | 20% of items |
| Uncommon | 27 items | 135,000 total | 19% |
| Rare | 35 items | 35,000 total | 24% |
| Epic | 33 items | 8,250 total | 23% |
| Legendary | 17 items | 901 total | 12% |
| Mythic | 4 items (+special) | 131 total | 3% |
| **Total** | **145 items** | **~179,282 + ∞ Common** | |

### Demand vs Supply at Scale

| User Milestone | Active Users | Common Holders | Uncommon Gap | Rare Gap | Epic Gap |
|----------------|-------------|----------------|-------------|---------|---------|
| 1,000 users | 1,000 | All | Surplus | Surplus | Surplus |
| 10,000 users | 10,000 | All | Slight scarcity | Moderate scarcity | High scarcity |
| 50,000 users | 50,000 | All | Gone | Very scarce | Ultra scarce |
| 100,000 users | 100,000 | All | Gone | Gone | Nearly gone |

At **10,000 users**, Rare+ items start having real secondary market value.
At **50,000 users**, even Uncommon items become scarce.

---

## 6. Smart Contract Architecture

### New Contract: `TavernEquipment` (ERC-1155)

```
TavernEquipment.sol
├── ERC-1155 multi-token standard
├── Item registry (145 items, each with metadata URI)
├── Rarity + max supply per token ID
├── Earn condition verification (on-chain checkable conditions)
├── Auto-mint on level-up (called by TavernClientRPG)
├── Equipment slots per user (head, body, weapon, shield, cloak, accessory)
├── Equip/unequip functions
├── Title system (active title per user)
├── Guild decoration slots
├── Soulbound option per item (non-transferable badges vs tradeable equipment)
└── Metadata URI → IPFS or on-chain SVG
```

### Modified: `TavernClientRPG`

```
Remove:
- SEASON_DURATION, currentSeasonStart, currentSeasonNumber
- SeasonSnapshot struct, seasonSnapshots mapping
- clientLastActiveSeason mapping
- _migrateSeasonIfNeeded(), seasonReset()
- LEGACY_EXP_BONUS, LEGACY_EXP_LV6
- SeasonStarted, SeasonMigrated events

Add:
- MAX_LEVEL = 100 constant
- Replace fixed LEVEL_THRESHOLDS[6] array with precomputed table: threshold = 20 * level^2.2
- levelThreshold(uint256 level) pure function (gas-efficient lookup)
- equipmentContract address (TavernEquipment)
- On level-up: call TavernEquipment.mintLevelReward(user, newLevel)

Keep:
- EXP system, level calculation
- Withdrawal gating (level, jobs, verified, account age, monthly cap)
- All EXP grant functions
```

### New Contract: `TavernGuild`

```
TavernGuild.sol
├── Guild creation (requires agent role + min stake)
├── Guild membership (join/leave)
├── Guild stats tracking (total quests, avg level, guild EXP)
├── Guild level system (same 20*lv^2.2 formula, collective EXP)
├── Guild decoration slots (using TavernEquipment NFTs)
├── Guild master permissions
└── Guild achievement checking (triggers NFT rewards)
```

### Title System (in TavernEquipment)

```
mapping(address => uint256) public activeTitle;  // token ID of equipped title
mapping(uint256 => TitleMeta) public titleMeta;   // color, display name

function equipTitle(uint256 tokenId) external {
    require(balanceOf(msg.sender, tokenId) > 0, "Not owned");
    require(items[tokenId].category == Category.TITLE, "Not a title");
    activeTitle[msg.sender] = tokenId;
}
```

### Auto-Mint Flow

```
User completes quest
  → TavernEscrow calls TavernClientRPG.grantEXP()
    → EXP increases, level check
      → If level up: TavernClientRPG calls TavernEquipment.mintLevelReward(user, level)
        → TavernEquipment checks which items are unlocked at this level
          → Mints all eligible unclaimed items to user
          → Emits ItemMinted events
```

### Soulbound vs Tradeable

| Category | Transferable? | Rationale |
|----------|--------------|-----------|
| Equipment (A) | Yes | Tradeable on OpenSea, creates market |
| Titles (B) | Mixed | Level-based = soulbound, Achievement = tradeable |
| Guild Deco (C) | Guild-bound | Tied to guild, not individual |
| Special/Event (D) | Yes | Limited edition collectibles, high trade value |
| Contributor Tracks (E) | Soulbound | Proof of sustained contribution, non-transferable |
| Badges | Soulbound | Proof of achievement, non-transferable |

---

## 7. Title Color System

| Level Range | Available Colors | Hex |
|-------------|-----------------|-----|
| Lv.1-4 | White | `#FFFFFF` |
| Lv.5-6 | Green | `#2f8d71` |
| Lv.7-8 | Blue | `#4a9eff` |
| Lv.9 | Purple | `#9b59b6` |
| Lv.10 | Gold (animated glow) | `#d8a933` |
| Special achievement | Red | `#e74c3c` |
| Mythic holder | Rainbow (animated) | gradient |

---

## 8. Contract Count Impact

Current: 9 contracts
After NFT system: 11 contracts (+TavernEquipment, +TavernGuild)
Modified: TavernClientRPG (season removal + Lv.100 cap + NFT integration), TavernAutomationRouter (remove SeasonReset TaskType)

---

## 9. Metadata & Art Requirements

Each of the 145 items needs:
- **Icon** (64×64 PNG) — for inventory/equipment UI
- **Full art** (512×512 PNG) — for detail view / OpenSea display
- **3D model** (future) — for Claw3D avatar integration
- **JSON metadata** — ERC-1155 standard, hosted on IPFS

Metadata structure:
```json
{
  "name": "Dragonbone Horns",
  "description": "Forged from the skull of an ancient dragon...",
  "image": "ipfs://Qm.../dragonbone-horns.png",
  "attributes": [
    { "trait_type": "Rarity", "value": "Epic" },
    { "trait_type": "Slot", "value": "Head" },
    { "trait_type": "Category", "value": "Equipment" },
    { "trait_type": "Level Required", "display_type": "number", "value": 5 },
    { "trait_type": "Max Supply", "display_type": "number", "value": 250 }
  ]
}
```

---

## 10. Multi-Path Strategy Matrix

The NFT system creates strategic diversity — users must choose how to invest their time:

| Path | Primary EXP Source | Unique NFTs Available | Synergy |
|------|-------------------|----------------------|---------|
| Client Specialist | Quest posting, subscriptions | Client Track (E1) + Equipment (A) | High USDC spend → faster contributor NFTs |
| Agent Grinder | Quest completion, ratings | Agent Track (E2) + Equipment (A) | More quests → faster leveling + rare equipment |
| Guild Builder | Member recruitment, guild quests | Guild Track (E3) + Guild Deco (C) | Bigger guild → faster guild level + decoration |
| Governance Leader | Voting, proposals | Governance Track (E4) + Titles (B) | More proposals → unique titles + purple prestige |
| Operations Hero | Bug reports, feedback | Operations Track (E5) + Special (D) | Community value → manual recognition rewards |
| Completionist | All activities equally | All categories | Breadth strategy → The Completionist mythic |

No single path gives access to all 145 items. Strategic tradeoffs create a rich, diverse player economy.
