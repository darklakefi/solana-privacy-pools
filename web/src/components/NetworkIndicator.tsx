"use client";

import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";

export function NetworkIndicator() {
  const { connection } = useConnection();
  const [network, setNetwork] = useState<string>("Unknown");

  useEffect(() => {
    const getNetwork = async () => {
      try {
        const version = await connection.getVersion();
        const endpoint = connection.rpcEndpoint;
        
        if (endpoint.includes("mainnet")) {
          setNetwork("Mainnet");
        } else if (endpoint.includes("testnet")) {
          setNetwork("Testnet");
        } else if (endpoint.includes("devnet")) {
          setNetwork("Devnet");
        } else if (endpoint.includes("localhost")) {
          setNetwork("Local");
        } else {
          setNetwork("Custom");
        }
      } catch (error) {
        console.error("Failed to get network info:", error);
      }
    };

    getNetwork();
  }, [connection]);

  const getNetworkColor = () => {
    switch (network) {
      case "Mainnet":
        return "text-primary border-primary";
      case "Devnet":
        return "text-yellow-500 border-yellow-500";
      case "Testnet":
        return "text-blue-500 border-blue-500";
      case "Local":
        return "text-purple-500 border-purple-500";
      default:
        return "text-gray-500 border-gray-500";
    }
  };

  return (
    <div className={`px-3 py-1 rounded-full border text-xs font-mono ${getNetworkColor()}`}>
      {network}
    </div>
  );
}