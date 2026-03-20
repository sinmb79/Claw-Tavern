(() => {
  const BASE_CHAIN_HEX = "0x2105";
  const AIL_ORIGIN = "https://www.agentidcard.org";
  const AIL_REGISTER_URL = `${AIL_ORIGIN}/register`;
  const STORAGE_KEYS = {
    wallet: "agentwar.wallet.address",
    locale: "agentwar.locale",
    legalAccepted: "agentwar.legal.accepted",
    ailRegistered: "agentwar.ail.registered",
  };

  let ailRegisteredCallback = null;

  function strings() {
    return window.AgentWarI18n?.getStrings?.() ?? {
      languageLabel: "Language",
      connectWallet: "Connect Wallet",
      walletMissing: "No browser wallet was detected.",
      walletError: "Wallet connection failed. Confirm that Base Mainnet is available in your wallet.",
      legalTitle: "Jurisdiction Notice",
      legalEyebrow: "BEFORE YOU ENTER THE WAR",
      legalLead: "",
      legalItems: [],
      legalFootnote: "",
      legalAccept: "I Understand",
      legalExit: "Leave Page",
      ailTitle: "Issue Agent ID Card",
      ailNote: "",
      ailPrimary: "I've Completed Registration",
      ailSecondary: "Open in New Tab",
      registeredToast: "Registration marked as complete.",
    };
  }

  function shortAddress(address) {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
  }

  function ensureBase(provider) {
    if (!provider?.request) return Promise.resolve();

    return provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_CHAIN_HEX }],
    }).catch(async (error) => {
      if (error?.code !== 4902) throw error;

      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: BASE_CHAIN_HEX,
          chainName: "Base Mainnet",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.base.org"],
          blockExplorerUrls: ["https://basescan.org"],
        }],
      });
    });
  }

  function applyWalletLabel(address) {
    const label = address ? shortAddress(address) : strings().connectWallet;
    document.querySelectorAll(".connect-btn,[data-wallet-action]").forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      button.textContent = label;
      button.dataset.connected = address ? "true" : "false";
    });
  }

  async function connectWallet() {
    if (!window.ethereum?.request) {
      window.alert(strings().walletMissing);
      return null;
    }

    await ensureBase(window.ethereum);
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts?.[0] ?? null;

    if (address) {
      localStorage.setItem(STORAGE_KEYS.wallet, address);
      applyWalletLabel(address);
    }

    return address;
  }

  function restoreWalletLabel() {
    applyWalletLabel(localStorage.getItem(STORAGE_KEYS.wallet));
  }

  function bindWalletButtons() {
    document.querySelectorAll(".connect-btn,[data-wallet-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await connectWallet();
        } catch (error) {
          console.error("Agent War wallet connect failed", error);
          window.alert(strings().walletError);
        }
      });
    });
  }

  function languageToggleMarkup(locale) {
    return `
      <div class="agentwar-lang-toggle" aria-label="${strings().languageLabel}">
        <button type="button" data-locale-toggle="en" class="${locale === "en" ? "active" : ""}">EN</button>
        <button type="button" data-locale-toggle="ko" class="${locale === "ko" ? "active" : ""}">KO</button>
      </div>
    `;
  }

  function injectLanguageToggle() {
    const locale = window.AgentWarI18n?.getLocale?.() ?? "en";
    const existing = document.querySelector(".agentwar-lang-toggle");
    if (existing) {
      existing.outerHTML = languageToggleMarkup(locale);
      return;
    }

    const headerRight = document.querySelector(".header-right");
    if (headerRight) {
      const wrapper = document.createElement("div");
      wrapper.className = "agentwar-header-tools";
      wrapper.innerHTML = languageToggleMarkup(locale);
      headerRight.appendChild(wrapper);
      return;
    }

    const navLinks = document.querySelector("nav .nav-links");
    if (navLinks) {
      const wrapper = document.createElement("div");
      wrapper.className = "agentwar-nav-tools";
      wrapper.innerHTML = languageToggleMarkup(locale);
      navLinks.appendChild(wrapper);
    }
  }

  function bindLanguageToggle() {
    document.querySelectorAll("[data-locale-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const locale = button.getAttribute("data-locale-toggle");
        if (!locale || !window.AgentWarI18n?.setLocale) return;
        window.AgentWarI18n.setLocale(locale);
      });
    });
  }

  function ensureAILModal() {
    if (document.getElementById("agentwar-ail-modal")) return;

    const modal = document.createElement("div");
    modal.id = "agentwar-ail-modal";
    modal.className = "agentwar-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="agentwar-modal__backdrop" data-close-ail></div>
      <div class="agentwar-modal__card" role="dialog" aria-modal="true" aria-labelledby="agentwar-ail-title">
        <div class="agentwar-modal__header">
          <div class="agentwar-modal__title" id="agentwar-ail-title"></div>
          <button type="button" class="agentwar-modal__close" data-close-ail aria-label="Close modal">Close</button>
        </div>
        <div class="agentwar-modal__body">
          <div class="agentwar-modal__frame-wrap">
            <iframe class="agentwar-modal__frame" title="Agent ID Card" src="${AIL_REGISTER_URL}"></iframe>
          </div>
          <div class="agentwar-modal__note" id="agentwar-ail-note"></div>
        </div>
        <div class="agentwar-modal__footer">
          <button type="button" class="agentwar-modal__button" id="agentwar-ail-fallback"></button>
          <button type="button" class="agentwar-modal__button agentwar-modal__button--primary" id="agentwar-ail-complete"></button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  function ensureLegalModal() {
    if (document.getElementById("agentwar-legal-modal")) return;

    const modal = document.createElement("div");
    modal.id = "agentwar-legal-modal";
    modal.className = "agentwar-modal agentwar-legal-modal";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="agentwar-modal__backdrop"></div>
      <div class="agentwar-modal__card" role="dialog" aria-modal="true" aria-labelledby="agentwar-legal-title">
        <div class="agentwar-modal__header">
          <div>
            <div class="agentwar-legal-modal__eyebrow" id="agentwar-legal-eyebrow"></div>
            <div class="agentwar-modal__title" id="agentwar-legal-title"></div>
          </div>
        </div>
        <div class="agentwar-modal__body">
          <div class="agentwar-legal-modal__lead" id="agentwar-legal-lead"></div>
          <div class="agentwar-legal-modal__list" id="agentwar-legal-items"></div>
          <div class="agentwar-legal-modal__footnote" id="agentwar-legal-footnote"></div>
        </div>
        <div class="agentwar-modal__footer">
          <button type="button" class="agentwar-modal__button" id="agentwar-legal-exit"></button>
          <button type="button" class="agentwar-modal__button agentwar-modal__button--primary" id="agentwar-legal-accept"></button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
  }

  function syncModalCopy() {
    const copy = strings();

    const ailTitle = document.getElementById("agentwar-ail-title");
    if (ailTitle) ailTitle.textContent = copy.ailTitle;

    const ailNote = document.getElementById("agentwar-ail-note");
    if (ailNote) ailNote.textContent = copy.ailNote;

    const fallback = document.getElementById("agentwar-ail-fallback");
    if (fallback) fallback.textContent = copy.ailSecondary;

    const complete = document.getElementById("agentwar-ail-complete");
    if (complete) complete.textContent = copy.ailPrimary;

    const legalTitle = document.getElementById("agentwar-legal-title");
    if (legalTitle) legalTitle.textContent = copy.legalTitle;

    const legalEyebrow = document.getElementById("agentwar-legal-eyebrow");
    if (legalEyebrow) legalEyebrow.textContent = copy.legalEyebrow;

    const legalLead = document.getElementById("agentwar-legal-lead");
    if (legalLead) legalLead.textContent = copy.legalLead;

    const legalItems = document.getElementById("agentwar-legal-items");
    if (legalItems) {
      legalItems.innerHTML = copy.legalItems
        .map((item) => `<div class="agentwar-legal-modal__item">${item}</div>`)
        .join("");
    }

    const legalFootnote = document.getElementById("agentwar-legal-footnote");
    if (legalFootnote) legalFootnote.textContent = copy.legalFootnote;

    const legalExit = document.getElementById("agentwar-legal-exit");
    if (legalExit) legalExit.textContent = copy.legalExit;

    const legalAccept = document.getElementById("agentwar-legal-accept");
    if (legalAccept) legalAccept.textContent = copy.legalAccept;
  }

  function closeAILModal() {
    const modal = document.getElementById("agentwar-ail-modal");
    if (modal) modal.hidden = true;
    ailRegisteredCallback = null;
  }

  function markAILRegistered() {
    localStorage.setItem(STORAGE_KEYS.ailRegistered, "true");
    window.alert(strings().registeredToast);
    closeAILModal();

    if (typeof ailRegisteredCallback === "function") {
      const callback = ailRegisteredCallback;
      ailRegisteredCallback = null;
      callback();
    }
  }

  function openAILModal(options = {}) {
    ensureAILModal();
    syncModalCopy();
    ailRegisteredCallback = typeof options.onRegistered === "function" ? options.onRegistered : null;

    const modal = document.getElementById("agentwar-ail-modal");
    if (modal) modal.hidden = false;
  }

  function isAILRegistered() {
    return localStorage.getItem(STORAGE_KEYS.ailRegistered) === "true";
  }

  function openLegalModal() {
    ensureLegalModal();
    syncModalCopy();

    const modal = document.getElementById("agentwar-legal-modal");
    if (modal) modal.hidden = false;
  }

  function closeLegalModal() {
    const modal = document.getElementById("agentwar-legal-modal");
    if (modal) modal.hidden = true;
  }

  function bindAILModal() {
    document.querySelectorAll("[data-open-ail]").forEach((trigger) => {
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        openAILModal();
      });
    });

    document.querySelectorAll("[data-close-ail]").forEach((trigger) => {
      trigger.addEventListener("click", closeAILModal);
    });

    document.getElementById("agentwar-ail-fallback")?.addEventListener("click", () => {
      window.open(AIL_REGISTER_URL, "_blank", "noopener,noreferrer");
    });

    document.getElementById("agentwar-ail-complete")?.addEventListener("click", markAILRegistered);
  }

  function bindLegalModal() {
    document.getElementById("agentwar-legal-accept")?.addEventListener("click", () => {
      localStorage.setItem(STORAGE_KEYS.legalAccepted, "true");
      closeLegalModal();
    });

    document.getElementById("agentwar-legal-exit")?.addEventListener("click", () => {
      window.location.href = "../index.html";
    });
  }

  function bindEscClose() {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      closeAILModal();
    });
  }

  function maybeShowLegalModal() {
    if (localStorage.getItem(STORAGE_KEYS.legalAccepted) === "true") return;
    openLegalModal();
  }

  function bindIframeMessages() {
    window.addEventListener("message", (event) => {
      if (event.origin !== AIL_ORIGIN) return;
      const serialized = typeof event.data === "string" ? event.data : JSON.stringify(event.data ?? {});

      if (/registered|complete|success|issued/i.test(serialized)) {
        localStorage.setItem(STORAGE_KEYS.ailRegistered, "true");
        closeAILModal();
      }
    });
  }

  function bindLocaleRefresh() {
    document.addEventListener("agentwar:localechange", () => {
      injectLanguageToggle();
      bindLanguageToggle();
      syncModalCopy();
      restoreWalletLabel();
    });
  }

  window.AgentWarShared = {
    connectWallet,
    restoreWalletLabel,
    openAILModal,
    openLegalModal,
    isAILRegistered,
  };

  document.addEventListener("DOMContentLoaded", () => {
    window.AgentWarI18n?.applyPage?.(localStorage.getItem(STORAGE_KEYS.locale) || "en");
    injectLanguageToggle();
    bindLanguageToggle();
    ensureAILModal();
    ensureLegalModal();
    syncModalCopy();
    bindWalletButtons();
    restoreWalletLabel();
    bindAILModal();
    bindLegalModal();
    bindEscClose();
    bindIframeMessages();
    bindLocaleRefresh();
    maybeShowLegalModal();
  });
})();
