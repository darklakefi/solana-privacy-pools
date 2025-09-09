import { useState, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

// Program ID for privacy pools
const PROGRAM_ID = new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID || 'EJhaJo4ARqgCZ28yD3Y6b1nkAtDHXh36QPBxg24SZX6f');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export interface DepositParams {
  amount: number; // in SOL
  nonce: number;
  scope: string;
}

export interface WithdrawParams {
  amount: number; // in SOL
  nullifier: bigint;
  secret: bigint;
  nonce: number;
  scope: string;
  recipient?: PublicKey;
}

function getPoolStateSeed(mint: PublicKey) {
  return `ps-${mint.toBase58().slice(0, 29)}`;
}

export function usePrivacyPool() {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [depositInfo, setDepositInfo] = useState<{ nullifier: bigint; secret: bigint } | null>(null);

  const depositFunds = useCallback(async (params: DepositParams) => {
    if (!publicKey || !sendTransaction) {
      setError('Wallet not connected');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Check if pool exists
      const poolStateSeed = getPoolStateSeed(WSOL_MINT);
      const poolStateAccount = await PublicKey.createWithSeed(
        publicKey,
        poolStateSeed,
        PROGRAM_ID
      );
      const poolAccountInfo = await connection.getAccountInfo(poolStateAccount);
      
      // Convert SOL to lamports
      const amountLamports = Math.floor(params.amount * LAMPORTS_PER_SOL);
      
      // Generate random nullifier and secret for privacy
      const nullifier = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
      const secret = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
      
      // Store for later withdrawal
      setDepositInfo({ nullifier, secret });
      
      // Call API endpoint
      const response = await fetch('/api/deposit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userPublicKey: publicKey.toBase58(),
          amount: amountLamports.toString(),
          nonce: params.nonce,
          scope: params.scope,
          nullifier: nullifier.toString(),
          secret: secret.toString(),
          initializeIfNeeded: !poolAccountInfo
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Deposit failed');
      }

      console.log('Deposit successful:', data.signature);
      
      // Return the deposit credentials for the user to save
      return {
        signature: data.signature,
        nullifier: data.nullifier,
        secret: data.secret,
        amount: params.amount,
        nonce: params.nonce,
        scope: params.scope,
        depositorState: data.depositorState
      };
    } catch (err) {
      console.error('Deposit error:', err);
      setError(err instanceof Error ? err.message : 'Deposit failed');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [connection, publicKey, sendTransaction]);

  const withdrawFunds = useCallback(async (params: WithdrawParams) => {
    if (!publicKey || !sendTransaction) {
      setError('Wallet not connected');
      return null;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Convert SOL to lamports
      const amountLamports = Math.floor(params.amount * LAMPORTS_PER_SOL);
      
      // Call API endpoint
      const response = await fetch('/api/withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userPublicKey: publicKey.toBase58(),
          amount: amountLamports.toString(),
          nullifier: params.nullifier.toString(),
          secret: params.secret.toString(),
          nonce: params.nonce,
          scope: params.scope,
          recipient: params.recipient?.toBase58()
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Withdrawal failed');
      }

      const signature = data.signature;

      console.log('Withdrawal successful:', signature);
      return signature;
    } catch (err) {
      console.error('Withdrawal error:', err);
      setError(err instanceof Error ? err.message : 'Withdrawal failed');
      return null;
    } finally {
      setIsLoading(false);
    }
  }, [connection, publicKey, sendTransaction]);

  const getPoolInfo = useCallback(async () => {
    if (!publicKey) return null;
    
    try {
      // Derive the pool state account
      const poolStateSeed = getPoolStateSeed(WSOL_MINT);
      const poolStateAccount = await PublicKey.createWithSeed(
        publicKey,
        poolStateSeed,
        PROGRAM_ID
      );

      const poolAccountInfo = await connection.getAccountInfo(poolStateAccount);
      if (!poolAccountInfo) {
        return null;
      }
      
      // For now, just return basic info
      // We could create an API endpoint to parse the pool state if needed
      return {
        exists: true,
        balance: poolAccountInfo.lamports,
        owner: poolAccountInfo.owner.toBase58()
      };
    } catch (err) {
      console.error('Error fetching pool info:', err);
      return null;
    }
  }, [connection, publicKey]);

  return {
    depositFunds,
    withdrawFunds,
    getPoolInfo,
    isLoading,
    error,
    depositInfo
  };
}