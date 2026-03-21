(() => {
  const BASE_CHAIN_HEX = "0x2105";
  const AIL_REGISTER_URL = "https://www.agentidcard.org/register";
  const STORAGE_KEYS = {
    wallet: "agentwar.wallet.address",
    legalAccepted: "agentwar.legal.accepted",
    ailRegistered: "agentwar.ail.registered",
  };

  let pendingLegalAction = null;

  function strings() {
    return window.AgentWarI18n?.getStrings?.() ?? {};
  }

  function shortAddress(address) {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
  }

  function applyWalletLabel(address) {
    const label = address ? shortAddress(address) : strings().connectWallet || "Connect Wallet";
    document.querySelectorAll(".connect-btn,[data-wallet-action]").forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      button.textContent = label;
      button.dataset.connected = address ? "true" : "false";
    });
  }

  async function ensureBase(provider) {
    if (!provider?.request) return;

    await provider.request({
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

  async function connectWallet() {
    if (!window.ethereum?.request) {
      window.alert(strings().walletMissing || "No browser wallet was detected.");
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
          window.alert(strings().walletError || "Wallet connection failed.");
        }
      });
    });
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
        <div class="agentwar-modal__body agentwar-legal-modal__body">
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

  function syncLegalCopy() {
    const copy = strings();
    const items = document.getElementById("agentwar-legal-items");
    if (items) {
      items.innerHTML = (copy.legalItems || [])
        .map((item) => `<div class="agentwar-legal-modal__item">${item}</div>`)
        .join("");
    }

    const mappings = [
      ["agentwar-legal-title", copy.legalTitle],
      ["agentwar-legal-eyebrow", copy.legalEyebrow],
      ["agentwar-legal-lead", copy.legalLead],
      ["agentwar-legal-footnote", copy.legalFootnote],
      ["agentwar-legal-accept", copy.legalAccept],
      ["agentwar-legal-exit", copy.legalExit],
    ];

    mappings.forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element && typeof value === "string") {
        element.textContent = value;
      }
    });
  }

  function openLegalModal() {
    ensureLegalModal();
    syncLegalCopy();
    const modal = document.getElementById("agentwar-legal-modal");
    if (modal) modal.hidden = false;
  }

  function closeLegalModal() {
    const modal = document.getElementById("agentwar-legal-modal");
    if (modal) modal.hidden = true;
  }

  function runAfterLegalAcceptance(action) {
    if (localStorage.getItem(STORAGE_KEYS.legalAccepted) === "true") {
      action();
      return;
    }

    pendingLegalAction = action;
    openLegalModal();
  }

  function openAILPopup() {
    const width = 560;
    const height = 820;
    const dualScreenLeft = window.screenLeft ?? window.screenX ?? 0;
    const dualScreenTop = window.screenTop ?? window.screenY ?? 0;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || screen.width || width;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || screen.height || height;
    const left = Math.max(0, Math.round(dualScreenLeft + (viewportWidth - width) / 2));
    const top = Math.max(0, Math.round(dualScreenTop + (viewportHeight - height) / 2));
    const features = [
      "popup=yes",
      `width=${width}`,
      `height=${height}`,
      `left=${left}`,
      `top=${top}`,
      "resizable=yes",
      "scrollbars=yes",
    ].join(",");

    const popup = window.open(AIL_REGISTER_URL, "agentwar_ail_card", features);
    if (popup) {
      popup.focus?.();
      return popup;
    }

    window.alert(strings().popupBlocked || "The registration popup was blocked. A new tab will open instead.");
    window.open(AIL_REGISTER_URL, "_blank", "noopener,noreferrer");
    return null;
  }

  function markAILRegistered() {
    localStorage.setItem(STORAGE_KEYS.ailRegistered, "true");
    window.alert(strings().registeredToast || "Agent ID Card registration has been marked as complete for this browser.");
  }

  function isAILRegistered() {
    return localStorage.getItem(STORAGE_KEYS.ailRegistered) === "true";
  }

  function bindLegalModal() {
    document.getElementById("agentwar-legal-accept")?.addEventListener("click", () => {
      localStorage.setItem(STORAGE_KEYS.legalAccepted, "true");
      closeLegalModal();
      if (typeof pendingLegalAction === "function") {
        const action = pendingLegalAction;
        pendingLegalAction = null;
        action();
      }
    });

    document.getElementById("agentwar-legal-exit")?.addEventListener("click", () => {
      pendingLegalAction = null;
      window.location.href = "../index.html";
    });
  }

  function bindJoinButtons() {
    document.querySelectorAll("[data-open-ail],[data-agent-join]").forEach((trigger) => {
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        runAfterLegalAcceptance(() => openAILPopup());
      });
    });
  }

  window.AgentWarShared = {
    connectWallet,
    restoreWalletLabel,
    openAILModal: openAILPopup,
    openAILPopup,
    openLegalModal,
    markAILRegistered,
    isAILRegistered,
    requestAgentJoin() {
      runAfterLegalAcceptance(() => openAILPopup());
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    window.AgentWarI18n?.applyPage?.();
    ensureLegalModal();
    syncLegalCopy();
    bindWalletButtons();
    restoreWalletLabel();
    bindLegalModal();
    bindJoinButtons();
  });
})();
