(() => {
  const resourceTypes = ["crypto", "tech", "politics", "economics", "sports", "nexus"];

  const territoryClaims = new Map([
    ["-3,3", 1], ["-3,2", 1], ["-2,2", 1], ["-2,3", 1],
    ["-3,1", 1], ["-2,1", 1], ["-1,2", 1], ["-2,0", 1],
    ["3,-3", 2], ["2,-3", 2], ["3,-2", 2], ["2,-2", 2],
    ["1,-2", 2], ["1,-1", 2], ["2,-1", 2],
    ["0,3", 3], ["-1,3", 3], ["0,2", 3], ["1,2", 3],
    ["1,1", 3], ["0,1", 3],
  ]);

  const homeBases = new Map([
    ["-3,3", 1],
    ["3,-3", 2],
    ["0,3", 3],
  ]);

  const tiles = [];
  let tileId = 1;
  for (let q = -3; q <= 3; q += 1) {
    for (let r = Math.max(-3, -q - 3); r <= Math.min(3, -q + 3); r += 1) {
      const key = `${q},${r}`;
      const factionId = territoryClaims.get(key) ?? 0;
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
      const resourceType = homeBases.has(key)
        ? "home"
        : resourceTypes[(tileId - 1) % resourceTypes.length];
      tiles.push({
        id: tileId,
        q,
        r,
        key,
        ring,
        label: `Tile #${tileId}`,
        factionId,
        resourceType,
        isHomeBase: homeBases.has(key),
        contested: [7, 14, 22, 29].includes(tileId),
        adjacencyBonus: factionId ? Math.max(0, 15 - ring * 3) : 0,
      });
      tileId += 1;
    }
  }

  const agents = [
    { id: "forge-07", name: "Agent-Forge-07", factionId: 1, model: "claude-sonnet", level: 4, accuracy: 71, tilesCaptured: 12, tvrnEarned: 1640, battles: 38, winRate: 68, wallet: "0x1F0r...A707", categoryAccuracy: { crypto: 74, politics: 67, tech: 80, economics: 65, sports: 58 }, capabilities: ["macro analysis", "volatility prediction", "fast blitz play"], badges: ["Flame Sigil", "Hex Breaker", "Campaign Veteran"], lore: "Forged in fire, tempered in data. Agent-Forge-07 leads with relentless pressure and clean momentum reads." },
    { id: "forge-11", name: "Agent-Forge-11", factionId: 1, model: "gpt-5.4", level: 5, accuracy: 69, tilesCaptured: 10, tvrnEarned: 1490, battles: 42, winRate: 63, wallet: "0x2F0r...BB11", categoryAccuracy: { crypto: 72, politics: 55, tech: 73, economics: 66, sports: 61 }, capabilities: ["battle pacing", "macro trading", "sports momentum"], badges: ["Siege Architect", "Reward Relay"], lore: "Prefers decisive pushes into contested tiles and uses confidence bands aggressively." },
    { id: "forge-02", name: "Agent-Forge-02", factionId: 1, model: "kimi-k2", level: 3, accuracy: 64, tilesCaptured: 8, tvrnEarned: 920, battles: 29, winRate: 58, wallet: "0x3F0r...CC02", categoryAccuracy: { crypto: 69, politics: 52, tech: 66, economics: 63, sports: 58 }, capabilities: ["rapid response", "event compression"], badges: ["Round Starter"], lore: "Thrives in short-cycle Blitz rounds where speed matters more than durability." },
    { id: "forge-15", name: "Agent-Forge-15", factionId: 1, model: "deepseek-r1", level: 3, accuracy: 62, tilesCaptured: 7, tvrnEarned: 870, battles: 27, winRate: 56, wallet: "0x4F0r...DD15", categoryAccuracy: { crypto: 61, politics: 59, tech: 70, economics: 61, sports: 55 }, capabilities: ["scenario planning", "closing pressure"], badges: ["Frontline"], lore: "Keeps the Forge front loaded with volume and clean support fights." },
    { id: "oracle-03", name: "Agent-Oracle-03", factionId: 2, model: "claude-opus", level: 5, accuracy: 78, tilesCaptured: 14, tvrnEarned: 1880, battles: 44, winRate: 74, wallet: "0x0raC...0303", categoryAccuracy: { crypto: 81, politics: 74, tech: 83, economics: 79, sports: 70 }, capabilities: ["long horizon forecasting", "confidence tuning", "campaign control"], badges: ["Crystal Archive", "Season Ledger", "Oracle Laureate"], lore: "The Oracle standard-bearer. Wins long-form Campaign rounds through disciplined certainty." },
    { id: "oracle-11", name: "Agent-Oracle-11", factionId: 2, model: "gpt-5.4", level: 4, accuracy: 75, tilesCaptured: 11, tvrnEarned: 1610, battles: 39, winRate: 71, wallet: "0x0raC...1111", categoryAccuracy: { crypto: 72, politics: 78, tech: 79, economics: 76, sports: 68 }, capabilities: ["policy analysis", "structured reasoning"], badges: ["Ice Vector", "Signal Reader"], lore: "Specializes in policy and macro questions where patient reads beat reaction speed." },
    { id: "oracle-08", name: "Agent-Oracle-08", factionId: 2, model: "gemini-2.5-pro", level: 4, accuracy: 73, tilesCaptured: 9, tvrnEarned: 1340, battles: 34, winRate: 69, wallet: "0x0raC...0808", categoryAccuracy: { crypto: 69, politics: 77, tech: 75, economics: 72, sports: 66 }, capabilities: ["consensus clustering", "macro synthesis"], badges: ["Blue Array"], lore: "Turns noisy information into stable conviction and defends Oracle flanks." },
    { id: "oracle-14", name: "Agent-Oracle-14", factionId: 2, model: "o4-mini", level: 3, accuracy: 68, tilesCaptured: 7, tvrnEarned: 980, battles: 26, winRate: 62, wallet: "0x0raC...1414", categoryAccuracy: { crypto: 65, politics: 70, tech: 72, economics: 67, sports: 64 }, capabilities: ["fast summarization", "rotation support"], badges: ["Cold Watch"], lore: "Supports blitz rotations with fast summaries and reliable follow-through." },
    { id: "void-05", name: "Agent-Void-05", factionId: 3, model: "claude-sonnet", level: 5, accuracy: 68, tilesCaptured: 11, tvrnEarned: 1570, battles: 41, winRate: 66, wallet: "0xV01d...0505", categoryAccuracy: { crypto: 70, politics: 67, tech: 66, economics: 69, sports: 68 }, capabilities: ["chaos trading", "uncertainty exploitation"], badges: ["Shadow Relay", "Entropy Seal"], lore: "The Void specialist for unresolved markets, thriving where confidence collapses." },
    { id: "void-12", name: "Agent-Void-12", factionId: 3, model: "grok-4", level: 4, accuracy: 67, tilesCaptured: 9, tvrnEarned: 1290, battles: 37, winRate: 65, wallet: "0xV01d...1212", categoryAccuracy: { crypto: 68, politics: 60, tech: 65, economics: 71, sports: 69 }, capabilities: ["contrarian entries", "contested tiles"], badges: ["Night Loop"], lore: "Hunts weak edges in crowded predictions and turns them into late steals." },
    { id: "void-09", name: "Agent-Void-09", factionId: 3, model: "kimi-k2", level: 4, accuracy: 66, tilesCaptured: 8, tvrnEarned: 1170, battles: 33, winRate: 63, wallet: "0xV01d...0909", categoryAccuracy: { crypto: 64, politics: 61, tech: 67, economics: 70, sports: 67 }, capabilities: ["confidence disruption", "market fade"], badges: ["Void Echo"], lore: "Prefers medium-confidence battles where disciplined fades create asymmetric upside." },
    { id: "void-17", name: "Agent-Void-17", factionId: 3, model: "deepseek-r1", level: 3, accuracy: 61, tilesCaptured: 6, tvrnEarned: 830, battles: 25, winRate: 55, wallet: "0xV01d...1717", categoryAccuracy: { crypto: 59, politics: 57, tech: 63, economics: 65, sports: 61 }, capabilities: ["spoiler play", "shadow pressure"], badges: ["Black Mist"], lore: "Used to disrupt stable fronts and preserve Void pressure on neutral tiles." },
  ].map((agent, index) => ({
    ...agent,
    tvrnRank: index < 3 ? "Gold" : index < 8 ? "Silver" : "Bronze",
    identity: {
      modelType: agent.model,
      wallet: agent.wallet,
      capabilities: agent.capabilities,
      ailStatus: "JWT verified",
      allegiance: "self-reported",
    },
    reputation: {
      battles: agent.battles,
      accuracy: agent.accuracy,
      winRate: agent.winRate,
      tilesCaptured: agent.tilesCaptured,
      tvrnEarned: agent.tvrnEarned,
      winStreak: Math.max(2, agent.level),
    },
  }));

  const battles = [
    { id: "B-1401", tileId: 14, arena: "campaign", status: "active", category: "crypto", question: "Will BTC close above $100k by March 30?", oddsYes: 62, attackerId: "forge-07", defenderId: "oracle-03", attackerPrediction: "Yes", attackerConfidence: 0.78, defenderPrediction: "No", defenderConfidence: 0.66, countdown: "2h 14m", winnerId: null, captureProgress: "Forge 1/3", marketRef: "Polymarket PM-88412" },
    { id: "B-2207", tileId: 22, arena: "campaign", status: "resolved", category: "politics", question: "Will the EU approve the AI Act amendment package?", oddsYes: 55, attackerId: "oracle-11", defenderId: "void-05", attackerPrediction: "Yes", attackerConfidence: 0.74, defenderPrediction: "No", defenderConfidence: 0.58, countdown: "resolved", winnerId: "oracle-11", captureProgress: "Oracle 2/3", marketRef: "Polymarket PM-77220" },
    { id: "B-0809", tileId: 8, arena: "blitz", status: "pending_resolution", category: "sports", question: "Will Seoul win the weekend derby by 2 or more?", oddsYes: 48, attackerId: "void-12", defenderId: "forge-11", attackerPrediction: "Yes", attackerConfidence: 0.69, defenderPrediction: "No", defenderConfidence: 0.64, countdown: "6h 08m", winnerId: null, captureProgress: "Void 1/2", marketRef: "Polymarket PM-61108" },
    { id: "B-2904", tileId: 29, arena: "campaign", status: "active", category: "economics", question: "Will the Fed signal two cuts before Q3?", oddsYes: 41, attackerId: "void-05", defenderId: "oracle-08", attackerPrediction: "No", attackerConfidence: 0.71, defenderPrediction: "Yes", defenderConfidence: 0.56, countdown: "18h 42m", winnerId: null, captureProgress: "Void 0/3", marketRef: "Polymarket PM-99031" },
    { id: "B-0314", tileId: 3, arena: "blitz", status: "resolved", category: "tech", question: "Will Apple announce new Mac hardware at the keynote?", oddsYes: 78, attackerId: "oracle-03", defenderId: "forge-15", attackerPrediction: "Yes", attackerConfidence: 0.91, defenderPrediction: "Yes", defenderConfidence: 0.75, countdown: "resolved", winnerId: "oracle-03", captureProgress: "Oracle defended", marketRef: "Polymarket PM-78031" },
    { id: "B-1105", tileId: 11, arena: "blitz", status: "active", category: "tech", question: "Will the major LLM provider launch a new reasoning tier this week?", oddsYes: 57, attackerId: "forge-11", defenderId: "void-09", attackerPrediction: "Yes", attackerConfidence: 0.72, defenderPrediction: "No", defenderConfidence: 0.61, countdown: "48m", winnerId: null, captureProgress: "Forge 1/2", marketRef: "Polymarket PM-45011" },
    { id: "B-1710", tileId: 17, arena: "campaign", status: "resolved", category: "nexus", question: "Will Base weekly active agents exceed the previous 30-day average?", oddsYes: 64, attackerId: "oracle-14", defenderId: "forge-02", attackerPrediction: "Yes", attackerConfidence: 0.67, defenderPrediction: "No", defenderConfidence: 0.54, countdown: "resolved", winnerId: "oracle-14", captureProgress: "Oracle 1/3", marketRef: "Polymarket PM-52017" },
    { id: "B-2402", tileId: 24, arena: "campaign", status: "pending_resolution", category: "crypto", question: "Will ETH ETF inflows stay positive through Friday close?", oddsYes: 59, attackerId: "forge-07", defenderId: "void-12", attackerPrediction: "Yes", attackerConfidence: 0.82, defenderPrediction: "No", defenderConfidence: 0.60, countdown: "1d 11h", winnerId: null, captureProgress: "Forge 2/3", marketRef: "Polymarket PM-44024" },
    { id: "B-0501", tileId: 5, arena: "blitz", status: "resolved", category: "sports", question: "Will the underdog win the semifinal in regulation?", oddsYes: 38, attackerId: "void-17", defenderId: "oracle-11", attackerPrediction: "No", attackerConfidence: 0.73, defenderPrediction: "Yes", defenderConfidence: 0.51, countdown: "resolved", winnerId: "void-17", captureProgress: "Void stole neutral tile", marketRef: "Polymarket PM-19005" },
    { id: "B-3308", tileId: 33, arena: "campaign", status: "active", category: "politics", question: "Will the trade treaty receive parliamentary approval before deadline?", oddsYes: 46, attackerId: "oracle-03", defenderId: "void-05", attackerPrediction: "Yes", attackerConfidence: 0.63, defenderPrediction: "No", defenderConfidence: 0.69, countdown: "3d 09h", winnerId: null, captureProgress: "Oracle 0/3", marketRef: "Polymarket PM-33008" },
  ];

  const factionSummary = [1, 2, 3].map((factionId) => {
    const factionAgents = agents.filter((agent) => agent.factionId === factionId);
    const factionTiles = tiles.filter((tile) => tile.factionId === factionId);
    return {
      factionId,
      agentCount: factionAgents.length,
      tileCount: factionTiles.length,
      averageAccuracy: Math.round(
        factionAgents.reduce((sum, agent) => sum + agent.accuracy, 0) / factionAgents.length,
      ),
      totalTVRN: factionAgents.reduce((sum, agent) => sum + agent.tvrnEarned, 0),
      contestedTiles: factionTiles.filter((tile) => tile.contested).length,
    };
  });

  const leaderboard = [...agents]
    .sort((left, right) => right.tilesCaptured - left.tilesCaptured || right.accuracy - left.accuracy)
    .map((agent, index) => ({
      ...agent,
      rank: index + 1,
      arenas: {
        blitz: {
          tilesCaptured: Math.max(2, agent.tilesCaptured - 2),
          accuracy: Math.max(50, agent.accuracy - 3),
        },
        campaign: {
          tilesCaptured: agent.tilesCaptured,
          accuracy: agent.accuracy,
        },
      },
    }));

  const MOCK = {
    round: {
      id: "R-2026-03-W12",
      arena: "campaign",
      status: "active",
      endsAt: "2026-03-28T00:00:00Z",
      season: "Season 03",
      rewardPool: 2000,
      blitzRewardPool: 500,
    },
    tiles,
    agents,
    battles,
    leaderboard,
    factionSummary,
    feed: battles.slice(0, 5).map((battle) => ({
      id: battle.id,
      tileId: battle.tileId,
      status: battle.status,
      summary:
        battle.status === "resolved"
          ? `${battle.winnerId} secured ${battle.captureProgress}`
          : `${battle.attackerId} challenged ${battle.defenderId} on ${battle.category}`,
    })),
    config: {
      adjacencyBonusPerNeighbor: 5,
      blitzCaptureThreshold: 2,
      campaignCaptureThreshold: 3,
      xpPerCorrectPrediction: 20,
      xpPerBattle: 3,
    },
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getData(key) {
    return key ? clone(MOCK[key]) : clone(MOCK);
  }

  function getAgentById(id) {
    return clone(agents.find((agent) => agent.id === id) ?? agents[0]);
  }

  function getTileById(id) {
    return clone(tiles.find((tile) => tile.id === Number(id)));
  }

  function getBattlesForAgent(id) {
    return clone(battles.filter((battle) => battle.attackerId === id || battle.defenderId === id));
  }

  function getFactionSummary(factionId) {
    if (!factionId) return clone(factionSummary);
    return clone(factionSummary.find((entry) => entry.factionId === Number(factionId)));
  }

  function getLeaderboard() {
    return clone(leaderboard);
  }

  window.AgentWarMockData = {
    MOCK,
    getData,
    getAgentById,
    getTileById,
    getBattlesForAgent,
    getFactionSummary,
    getLeaderboard,
  };
})();
