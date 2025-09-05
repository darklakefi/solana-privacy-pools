"use client";

import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";

export function WalletButton() {
  const { setVisible } = useWalletModal();
  const { wallet, disconnect, connecting, connected, publicKey } = useWallet();

  const handleClick = () => {
    if (connected) {
      disconnect();
    } else {
      setVisible(true);
    }
  };

  const getButtonText = () => {
    if (connecting) return "Connecting...";
    if (connected && publicKey) {
      const address = publicKey.toBase58();
      return `${address.slice(0, 4)}...${address.slice(-4)}`;
    }
    return "Connect";
  };

  return (
    <button
      onClick={handleClick}
      disabled={connecting}
      className={`
        px-6 py-2 rounded-lg font-sans text-sm transition-all
        ${connected 
          ? "bg-primary/20 text-primary border border-primary hover:bg-primary/30" 
          : "bg-primary text-black hover:bg-primary-dark"
        }
        ${connecting ? "opacity-50 cursor-wait" : ""}
      `}
    >
      {getButtonText()}
    </button>
  );
}