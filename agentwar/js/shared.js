(() => {
  const BASE_CHAIN_HEX = "0x2105";
  const STORAGE_KEY = "agentwar.wallet.address";

  function shortAddress(address) {
    return address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "";
  }

  async function ensureBase(provider) {
    if (!provider?.request) return;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_CHAIN_HEX }],
      });
    } catch (error) {
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
    }
  }

  function applyWalletLabel(address) {
    document.querySelectorAll(".connect-btn,[data-wallet-action]").forEach((button) => {
      if (!(button instanceof HTMLElement)) return;
      button.textContent = address ? shortAddress(address) : "지갑 연결";
      button.dataset.connected = address ? "true" : "false";
    });
  }

  async function connectWallet() {
    if (!window.ethereum?.request) {
      alert("브라우저 지갑이 감지되지 않았습니다.");
      return null;
    }

    await ensureBase(window.ethereum);
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts?.[0] ?? null;
    if (address) {
      localStorage.setItem(STORAGE_KEY, address);
      applyWalletLabel(address);
    }
    return address;
  }

  function restoreWalletLabel() {
    const address = localStorage.getItem(STORAGE_KEY);
    applyWalletLabel(address);
  }

  function bindWalletButtons() {
    document.querySelectorAll(".connect-btn,[data-wallet-action]").forEach((button) => {
      button.addEventListener("click", async () => {
        try {
          await connectWallet();
        } catch (error) {
          console.error("Agent War wallet connect failed", error);
          alert("지갑 연결에 실패했습니다. Base Mainnet 상태를 확인해 주세요.");
        }
      });
    });
  }

  window.AgentWarShared = {
    connectWallet,
    restoreWalletLabel,
  };

  document.addEventListener("DOMContentLoaded", () => {
    restoreWalletLabel();
    bindWalletButtons();
  });
})();
