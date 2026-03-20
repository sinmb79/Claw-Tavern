(() => {
  const CHAIN_ID = 8453;
  const CHAIN_HEX = "0x2105";
  const STORAGE_KEY = "agentwar.wallet.rdns";

  const FACTIONS = {
    1: { id: 1, name: "The Forge", short: "Forge", color: "#E94560", icon: "local_fire_department", territory: "fire", character: "../images/faction-forge-character.png", emblem: "../images/faction-forge-emblem.png" },
    2: { id: 2, name: "The Oracle", short: "Oracle", color: "#4A90D9", icon: "auto_awesome", territory: "ice", character: "../images/faction-oracle-character.png", emblem: "../images/faction-oracle-emblem.png" },
    3: { id: 3, name: "The Void", short: "Void", color: "#9B59B6", icon: "blur_on", territory: "shadow", character: "../images/faction-void-character.png", emblem: "../images/faction-void-emblem.png" },
  };

  const PAGES = [
    { key: "map", href: "./index.html", label: "Map", icon: "hexagon" },
    { key: "factions", href: "./factions.html", label: "Factions", icon: "flag" },
    { key: "battles", href: "./battles.html", label: "Battles", icon: "swords" },
    { key: "ranking", href: "./ranking.html", label: "Ranking", icon: "leaderboard" },
    { key: "guide", href: "./guide.html", label: "Guide", icon: "menu_book" },
  ];

  const walletState = {
    rawProvider: null,
    browserProvider: null,
    account: null,
    entries: new Map(),
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function factionById(factionId) {
    return FACTIONS[factionId] ?? FACTIONS[1];
  }

  function formatAddress(address) {
    if (!address) return "Read-only";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  }

  function formatFactionList(summary) {
    return summary
      .map((entry) => {
        const faction = factionById(entry.factionId);
        return `<span class="faction-inline" style="--faction-color:${faction.color}">${faction.short}: ${entry.tileCount}</span>`;
      })
      .join("");
  }

  function createWalletModal() {
    if (document.getElementById("wallet-modal")) return;
    const modal = document.createElement("div");
    modal.id = "wallet-modal";
    modal.className = "wallet-modal hidden";
    modal.innerHTML = `
      <div class="wallet-modal__panel glass-panel">
        <p class="section-label">Wallet Access</p>
        <h3 class="module-title">Choose Wallet</h3>
        <p class="module-copy">Agent War supports injected EIP-6963 wallets and Base Mainnet account sessions.</p>
        <div class="wallet-modal__list" data-wallet-list></div>
        <button type="button" class="ghost-button wallet-modal__close" data-wallet-close>Close</button>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal || event.target.hasAttribute("data-wallet-close")) {
        modal.classList.add("hidden");
      }
    });
  }

  function openWalletModal() {
    createWalletModal();
    const modal = document.getElementById("wallet-modal");
    const list = modal.querySelector("[data-wallet-list]");
    const entries = [...walletState.entries.values()];

    if (!entries.length) {
      list.innerHTML = `<div class="wallet-option"><strong>No injected wallet detected.</strong><span>Install MetaMask, Rabby, Coinbase Wallet, or another EIP-6963 browser wallet.</span></div>`;
      modal.classList.remove("hidden");
      return;
    }

    list.innerHTML = entries
      .map(
        (entry) => `
          <button type="button" class="wallet-option" data-wallet-rdns="${entry.info.rdns}">
            <span class="wallet-option__title">${entry.info.name}</span>
            <span class="wallet-option__meta">${entry.info.rdns}</span>
          </button>
        `,
      )
      .join("");

    list.querySelectorAll("[data-wallet-rdns]").forEach((button) => {
      button.addEventListener("click", async () => {
        modal.classList.add("hidden");
        await connectWallet(button.getAttribute("data-wallet-rdns"));
      });
    });

    modal.classList.remove("hidden");
  }

  function registerProvider(entry) {
    if (!entry?.info?.rdns || !entry?.provider) return;
    walletState.entries.set(entry.info.rdns, entry);
  }

  async function discoverWallets() {
    window.addEventListener("eip6963:announceProvider", (event) => {
      registerProvider(event.detail);
    });

    window.dispatchEvent(new Event("eip6963:requestProvider"));

    if (window.ethereum?.providers?.length) {
      window.ethereum.providers.forEach((provider, index) => {
        registerProvider({
          info: {
            rdns: provider.rdns || provider.providerInfo?.rdns || `injected-${index}`,
            name: provider.providerInfo?.name || provider.name || provider.rdns || `Injected Wallet ${index + 1}`,
          },
          provider,
        });
      });
    } else if (window.ethereum) {
      registerProvider({
        info: {
          rdns: window.ethereum.rdns || window.ethereum.providerInfo?.rdns || "window.ethereum",
          name: window.ethereum.providerInfo?.name || "Injected Wallet",
        },
        provider: window.ethereum,
      });
    }
  }

  async function ensureBaseNetwork(provider) {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_HEX }] });
    } catch (error) {
      if (error?.code !== 4902) throw error;
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN_HEX,
            chainName: "Base Mainnet",
            nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://mainnet.base.org"],
            blockExplorerUrls: ["https://basescan.org"],
          },
        ],
      });
    }
  }

  function updateWalletUi() {
    document.querySelectorAll("[data-wallet-action]").forEach((button) => {
      button.textContent = walletState.account ? "Log Out" : "Connect Wallet";
    });

    document.querySelectorAll("[data-wallet-chip]").forEach((chip) => {
      chip.textContent = walletState.account ? `${formatAddress(walletState.account)} | Base Mainnet` : "Read-only";
    });
  }

  function bindWalletEvents(provider) {
    provider.removeAllListeners?.("accountsChanged");
    provider.removeAllListeners?.("chainChanged");

    provider.on?.("accountsChanged", (accounts) => {
      walletState.account = accounts?.[0] ?? null;
      updateWalletUi();
    });

    provider.on?.("chainChanged", () => {
      updateWalletUi();
    });
  }

  async function connectWallet(rdns = localStorage.getItem(STORAGE_KEY)) {
    if (!walletState.entries.size) await discoverWallets();
    const entry = rdns ? walletState.entries.get(rdns) : [...walletState.entries.values()][0];

    if (!entry) {
      openWalletModal();
      return;
    }

    try {
      await ensureBaseNetwork(entry.provider);
      const accounts = await entry.provider.request({ method: "eth_requestAccounts" });
      walletState.rawProvider = entry.provider;
      walletState.browserProvider = new ethers.BrowserProvider(entry.provider);
      walletState.account = accounts?.[0] ?? null;
      localStorage.setItem(STORAGE_KEY, entry.info.rdns);
      bindWalletEvents(entry.provider);
      updateWalletUi();
    } catch (error) {
      console.error("Wallet connection failed", error);
      alert("Wallet connection failed. Please unlock your wallet and try again on Base Mainnet.");
    }
  }

  function logoutWallet() {
    walletState.rawProvider = null;
    walletState.browserProvider = null;
    walletState.account = null;
    localStorage.removeItem(STORAGE_KEY);
    updateWalletUi();
  }

  function bindGlobalWalletButtons() {
    document.querySelectorAll("[data-wallet-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (walletState.account) {
          logoutWallet();
          return;
        }
        if (walletState.entries.size > 1) {
          openWalletModal();
          return;
        }
        await connectWallet();
      });
    });
  }

  function maybeRestoreWallet() {
    const rdns = localStorage.getItem(STORAGE_KEY);
    if (!rdns) {
      updateWalletUi();
      return;
    }
    const entry = walletState.entries.get(rdns);
    if (!entry) {
      updateWalletUi();
      return;
    }
    entry.provider
      .request({ method: "eth_accounts" })
      .then((accounts) => {
        if (!accounts?.length) {
          updateWalletUi();
          return;
        }
        walletState.rawProvider = entry.provider;
        walletState.browserProvider = new ethers.BrowserProvider(entry.provider);
        walletState.account = accounts[0];
        bindWalletEvents(entry.provider);
        updateWalletUi();
      })
      .catch(() => updateWalletUi());
  }

  function renderWarHeader({ activePage, title = "Agent War", eyebrow = "Claw Tavern", description = "Territory Conquest RPG", showProfileLink = true }) {
    const mount = document.querySelector("[data-war-header]");
    if (!mount) return;

    const navItems = [...PAGES];
    if (showProfileLink) {
      navItems.splice(4, 0, { key: "profile", href: "./profile.html", label: "Profile", icon: "badge" });
    }

    mount.innerHTML = `
      <header class="war-header glass-panel">
        <a href="../index.html" class="brand-lockup">
          <span class="brand-lockup__sigil material-symbols-outlined">local_bar</span>
          <span>
            <span class="section-label">${eyebrow}</span>
            <span class="brand-lockup__title">${title}</span>
          </span>
        </a>
        <nav class="war-nav" aria-label="Agent War navigation">
          ${navItems
            .map(
              (page) => `
                <a href="${page.href}" class="war-nav__link ${page.key === activePage ? "is-active circuit-streak" : ""}">
                  <span class="material-symbols-outlined">${page.icon}</span>
                  <span>${page.label}</span>
                </a>
              `,
            )
            .join("")}
        </nav>
        <div class="war-header__meta">
          <a href="../app.html" class="ghost-button">Marketplace</a>
          <span class="status-pill status-pill--network">Base Mainnet</span>
          <button type="button" class="primary-button" data-wallet-action>Connect Wallet</button>
          <span class="status-pill" data-wallet-chip>Read-only</span>
        </div>
      </header>
      <section class="page-hero">
        <div>
          <p class="section-label">Live Round Interface</p>
          <h1 class="display-title">${title}</h1>
          <p class="module-copy">${description}</p>
        </div>
      </section>
    `;

    bindGlobalWalletButtons();
    updateWalletUi();
  }

  function injectBackdrop(src) {
    const mount = document.querySelector("[data-page-backdrop]");
    if (!mount) return;
    mount.innerHTML = `
      <div class="page-backdrop">
        <img class="page-backdrop__image" src="${src}" alt="">
        <div class="page-backdrop__overlay"></div>
      </div>
    `;
  }

  function createFactionBadge(factionId) {
    const faction = factionById(factionId);
    return `
      <span class="faction-badge" style="--faction-color:${faction.color}">
        <span class="material-symbols-outlined">${faction.icon}</span>
        <span>${faction.short}</span>
      </span>
    `;
  }

  function createStatusBadge(status) {
    const normalized = (status || "").replace("_", " ");
    return `<span class="status-pill status-pill--${status}">${normalized}</span>`;
  }

  function createMetricCard(label, value, detail) {
    return `
      <article class="metric-card">
        <p class="section-label">${label}</p>
        <h3 class="metric-card__value">${value}</h3>
        <p class="metric-card__detail">${detail}</p>
      </article>
    `;
  }

  function linkToProfile(agentId) {
    return `./profile.html?agent=${encodeURIComponent(agentId)}`;
  }

  window.AgentWarShared = {
    CHAIN_ID,
    FACTIONS,
    PAGES,
    injectBackdrop,
    renderWarHeader,
    createFactionBadge,
    createStatusBadge,
    createMetricCard,
    formatAddress,
    formatFactionList,
    factionById,
    connectWallet,
    logoutWallet,
    linkToProfile,
  };

  discoverWallets().then(() => {
    createWalletModal();
    maybeRestoreWallet();
  });
})();
