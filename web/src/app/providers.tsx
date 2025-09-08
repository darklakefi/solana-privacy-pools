"use client";

import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { clusterApiUrl } from "@solana/web3.js";

// Wallet adapter styles are imported in _app.tsx

// Determine network based on APP_ENV environment variable
const getNetwork = (): WalletAdapterNetwork => {
  const env = process.env.APP_ENV || process.env.NEXT_PUBLIC_APP_ENV || 'dev';
  
  switch (env) {
    case 'prod':
    case 'production':
      return WalletAdapterNetwork.Mainnet;
    case 'test':
    case 'testnet':
      return WalletAdapterNetwork.Testnet;
    case 'dev':
    case 'development':
    default:
      return WalletAdapterNetwork.Devnet;
  }
};

export function Providers({ children }: { children: React.ReactNode }) {
  // Network selection based on environment
  const network = getNetwork();

  // Use custom RPC endpoint if provided, otherwise use default cluster URL
  const endpoint = useMemo(() => {
    const customRpc = process.env.NEXT_PUBLIC_RPC_ENDPOINT;
    if (customRpc) {
      return customRpc;
    }
    return clusterApiUrl(network);
  }, [network]);

  // Empty array - wallets supporting the Wallet Standard are detected automatically
  const wallets = useMemo(() => [], []);

  // Log current network for debugging (only in development)
  if (process.env.NODE_ENV === 'development') {
    console.log(`🌐 Solana Network: ${network}`);
    console.log(`📡 RPC Endpoint: ${endpoint}`);
  }

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}