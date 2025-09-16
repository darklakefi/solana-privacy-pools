import { useState, useEffect } from 'react';
import { usePrivacyPool } from '../hooks/usePrivacyPool';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedToken: string;
}

export function DepositModal({ isOpen, onClose, selectedToken }: DepositModalProps) {
  const [amount, setAmount] = useState('');
  const [showCredentials, setShowCredentials] = useState(false);
  const [credentials, setCredentials] = useState<any>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const { depositFunds, isLoading, error } = usePrivacyPool();
  const { connection } = useConnection();
  const { publicKey } = useWallet();

  // Token mint addresses for devnet
  const TOKEN_MINTS: { [key: string]: string } = {
    'SOL': 'So11111111111111111111111111111111111111112', // Native SOL
    'USDC': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', // USDC devnet
    'USDT': 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUUy1PVCMB4DYPzVaS'  // USDT devnet (example)
  };

  // Token decimals
  const TOKEN_DECIMALS: { [key: string]: number } = {
    'SOL': 9,
    'USDC': 6,  // USDC typically has 6 decimals
    'USDT': 6   // USDT typically has 6 decimals
  };

  useEffect(() => {
    const fetchBalance = async () => {
      if (publicKey && isOpen) {
        try {
          if (selectedToken === 'SOL') {
            // For SOL, get the native balance
            const bal = await connection.getBalance(publicKey);
            setBalance(bal / LAMPORTS_PER_SOL);
          } else {
            // For SPL tokens, get the associated token account balance
            try {
              const mintAddress = new PublicKey(TOKEN_MINTS[selectedToken]);
              const associatedTokenAddress = await getAssociatedTokenAddress(
                mintAddress,
                publicKey
              );
              
              // Try to get the token account
              const tokenAccount = await getAccount(connection, associatedTokenAddress);
              const decimals = TOKEN_DECIMALS[selectedToken] || 6;
              const bal = Number(tokenAccount.amount) / Math.pow(10, decimals);
              setBalance(bal);
            } catch (tokenErr) {
              // Token account doesn't exist or has no balance
              console.log(`No ${selectedToken} token account found for wallet`);
              setBalance(0);
            }
          }
        } catch (err) {
          console.error('Failed to fetch balance:', err);
          setBalance(null);
        }
      }
    };

    fetchBalance();
  }, [publicKey, connection, isOpen, selectedToken]);

  if (!isOpen) return null;

  const handleDeposit = async () => {
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    // Convert to native units based on token decimals
    const decimals = TOKEN_DECIMALS[selectedToken] || 9;
    const amountNative = Math.floor(depositAmount * Math.pow(10, decimals));

    // Generate random nonce and use default scope for now
    const nonce = Math.floor(Math.random() * 1000000);
    const scope = 'default';
    
    // Get the token mint
    const tokenMint = new PublicKey(TOKEN_MINTS[selectedToken]);

    const result = await depositFunds({
      amount: amountNative,
      nonce,
      scope,
      tokenMint
    });

    if (result) {
      setCredentials(result);
      setShowCredentials(true);
    }
  };

  const handleClose = () => {
    setAmount('');
    setShowCredentials(false);
    setCredentials(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-dark border border-primary/20 rounded-xl p-6 max-w-md w-full mx-4">
        {!showCredentials ? (
          <>
            <h2 className="text-2xl font-sans text-white mb-4">Deposit to Privacy Pool</h2>
            
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-sm text-gray-400">Amount ({selectedToken})</label>
                  {balance !== null && (
                    <span className="text-sm text-gray-400">
                      Balance: <span className="text-primary">{balance.toFixed(4)} {selectedToken}</span>
                    </span>
                  )}
                </div>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-black border border-primary/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                  placeholder="0.0"
                  step="0.01"
                  disabled={isLoading}
                />
                {balance !== null && parseFloat(amount) > balance && (
                  <p className="text-red-400 text-xs mt-1">Insufficient balance</p>
                )}
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <div className="flex space-x-3">
                <button
                  onClick={handleClose}
                  className="flex-1 border border-gray-500 text-gray-300 px-4 py-2 rounded-lg hover:bg-gray-500/10 transition-colors"
                  disabled={isLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeposit}
                  className="flex-1 bg-primary text-black px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
                  disabled={isLoading || !amount || (balance !== null && parseFloat(amount) > balance)}
                >
                  {isLoading ? 'Processing...' : 'Deposit'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-sans text-white mb-4">Deposit Successful!</h2>
            
            <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 mb-4">
              <p className="text-yellow-400 text-sm font-semibold mb-2">⚠️ IMPORTANT: Save these credentials!</p>
              <p className="text-yellow-400/80 text-xs">You need these to withdraw your funds. They cannot be recovered if lost.</p>
            </div>

            <div className="space-y-3 mb-4">
              <div className="bg-black rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-1">Nullifier</p>
                <p className="font-mono text-xs text-primary break-all">{credentials?.nullifier}</p>
              </div>
              
              <div className="bg-black rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-1">Secret</p>
                <p className="font-mono text-xs text-primary break-all">{credentials?.secret}</p>
              </div>
              
              <div className="bg-black rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-1">Amount</p>
                <p className="font-mono text-sm text-white">{amount} {selectedToken}</p>
              </div>
              
              <div className="bg-black rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-1">Transaction</p>
                <a 
                  href={`https://explorer.solana.com/tx/${credentials?.signature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-primary hover:text-primary-dark"
                >
                  {credentials?.signature?.slice(0, 20)}...
                </a>
              </div>
            </div>

            <button
              onClick={handleClose}
              className="w-full bg-primary text-black px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
            >
              Done (I've saved my credentials)
            </button>
          </>
        )}
      </div>
    </div>
  );
}