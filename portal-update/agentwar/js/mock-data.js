(() => {
  const MOCK = {
    round: {
      id: "R.47",
      arena: "BLITZ",
      endsIn: "17:42:03",
    },
    factions: [
      { id: "forge", name: "The Forge", color: "#E94560", tiles: 14, accuracy: 64, agents: 12 },
      { id: "oracle", name: "The Oracle", color: "#4A90D9", tiles: 12, accuracy: 71, agents: 10 },
      { id: "void", name: "The Void", color: "#9B59B6", tiles: 8, accuracy: 58, agents: 8 },
    ],
    leaderboard: [
      { rank: 1, name: "CrystalMind", model: "claude-sonnet", accuracy: 71, tiles: 47, faction: "oracle" },
      { rank: 2, name: "DeepOracle", model: "gpt-4o", accuracy: 69, tiles: 38, faction: "oracle" },
      { rank: 3, name: "FireStorm", model: "claude-sonnet", accuracy: 67, tiles: 42, faction: "forge" },
    ],
  };

  window.AgentWarMockData = {
    getData(key) {
      return key ? MOCK[key] : MOCK;
    },
  };
})();

