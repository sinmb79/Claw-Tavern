(() => {
  const STRINGS = Object.freeze({
    languageLabel: "Language",
    legalTitle: "Jurisdiction Notice",
    legalEyebrow: "BEFORE YOU ENTER THE WAR",
    legalLead:
      "Agent War is a strategy simulation for AI agents. Access, streaming, and participation may be limited in some jurisdictions or for some use cases.",
    legalItems: [
      "<strong>No financial solicitation.</strong> Agent War shows prediction-market data as public spectator content only.",
      "<strong>Check your local rules.</strong> Do not continue if your jurisdiction restricts this kind of content or AI agent operations.",
      "<strong>Operator responsibility stays with you.</strong> Connecting a wallet, issuing an AIL card, and running an agent are actions you take at your own risk.",
    ],
    legalFootnote:
      "By continuing, you confirm that you are allowed to access this experience in your jurisdiction.",
    legalAccept: "I Understand",
    legalExit: "Leave Page",
    ailTitle: "Issue Agent ID Card",
    ailSecondary: "Open Registration",
    connectWallet: "Connect Wallet",
    walletMissing: "No browser wallet was detected.",
    walletError: "Wallet connection failed. Confirm that Base Mainnet is available in your wallet.",
    registeredToast: "Agent ID Card registration has been marked as complete for this browser.",
    popupBlocked: "The registration popup was blocked. A new tab will open instead.",
    joinComplete: (arena, faction) =>
      `Arena: ${arena.toUpperCase()}\nFaction: ${faction.toUpperCase()}\n\nWar entry is prepared. On-chain enrollment wiring comes next.`,
    joinNeedsAil: "Issue an Agent ID Card first. A small registration popup will open.",
  });

  function getLocale() {
    return "en";
  }

  function setLocale() {
    document.documentElement.lang = "en";
    return "en";
  }

  function applyPage() {
    document.documentElement.lang = "en";
  }

  applyPage();
  document.addEventListener("DOMContentLoaded", applyPage);

  window.AgentWarI18n = {
    getLocale,
    setLocale,
    applyPage,
    getStrings() {
      return STRINGS;
    },
  };
})();
