import { useState } from 'react';
import { PublicKey } from '@solana/web3.js';
import { usePrivacyPool } from '../hooks/usePrivacyPool';

interface WithdrawModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedToken: string;
}

export function WithdrawModal({ isOpen, onClose, selectedToken }: WithdrawModalProps) {
  const [amount, setAmount] = useState('');
  const [nullifier, setNullifier] = useState('');
  const [secret, setSecret] = useState('');
  const [recipient, setRecipient] = useState('');
  const [txSignature, setTxSignature] = useState('');
  const { withdrawFunds, isLoading, error } = usePrivacyPool();
  
  // Token mint addresses for devnet
  const TOKEN_MINTS: { [key: string]: string } = {
    'SOL': 'So11111111111111111111111111111111111111112',
    'USDC': '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
    'USDT': 'EJwZgeZrdC8TXTQbQBoL6bfuAnFUUy1PVCMB4DYPzVaS'
  };
  
  // Token decimals
  const TOKEN_DECIMALS: { [key: string]: number } = {
    'SOL': 9,
    'USDC': 6,
    'USDT': 6
  };

  if (!isOpen) return null;

  const handleWithdraw = async () => {
    const withdrawAmount = parseFloat(amount);
    if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    if (!nullifier || !secret) {
      alert('Please enter your nullifier and secret');
      return;
    }

    try {
      // Parse recipient if provided
      let recipientPubkey = undefined;
      if (recipient) {
        try {
          recipientPubkey = new PublicKey(recipient);
        } catch {
          alert('Invalid recipient address');
          return;
        }
      }

      // Convert to native units based on token decimals
      const decimals = TOKEN_DECIMALS[selectedToken] || 9;
      const amountNative = Math.floor(withdrawAmount * Math.pow(10, decimals));

      // Generate nonce and use default scope for now
      const nonce = Math.floor(Math.random() * 1000000);
      const scope = 'default';
      
      // Get the token mint
      const tokenMint = new PublicKey(TOKEN_MINTS[selectedToken]);

      const signature = await withdrawFunds({
        amount: amountNative,
        nullifier: BigInt(nullifier),
        secret: BigInt(secret),
        nonce,
        scope,
        recipient: recipientPubkey,
        tokenMint
      });

      if (signature) {
        setTxSignature(signature);
      }
    } catch (err) {
      console.error('Withdrawal error:', err);
    }
  };

  const handleClose = () => {
    setAmount('');
    setNullifier('');
    setSecret('');
    setRecipient('');
    setTxSignature('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-dark border border-primary/20 rounded-xl p-6 max-w-md w-full mx-4">
        {!txSignature ? (
          <>
            <h2 className="text-2xl font-sans text-white mb-4">Withdraw from Privacy Pool</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Amount ({selectedToken})</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-black border border-primary/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-primary"
                  placeholder="0.0"
                  step="0.01"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Nullifier</label>
                <input
                  type="text"
                  value={nullifier}
                  onChange={(e) => setNullifier(e.target.value)}
                  className="w-full bg-black border border-primary/20 rounded-lg px-4 py-2 text-white font-mono text-sm focus:outline-none focus:border-primary"
                  placeholder="Enter your nullifier"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">Secret</label>
                <input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  className="w-full bg-black border border-primary/20 rounded-lg px-4 py-2 text-white font-mono text-sm focus:outline-none focus:border-primary"
                  placeholder="Enter your secret"
                  disabled={isLoading}
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">
                  Recipient Address (optional)
                </label>
                <input
                  type="text"
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  className="w-full bg-black border border-primary/20 rounded-lg px-4 py-2 text-white font-mono text-xs focus:outline-none focus:border-primary"
                  placeholder="Leave empty to withdraw to current wallet"
                  disabled={isLoading}
                />
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
                  onClick={handleWithdraw}
                  className="flex-1 bg-primary text-black px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors disabled:opacity-50"
                  disabled={isLoading || !amount || !nullifier || !secret}
                >
                  {isLoading ? 'Processing...' : 'Withdraw'}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-sans text-white mb-4">Withdrawal Successful!</h2>
            
            <div className="space-y-3 mb-4">
              <div className="bg-black rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-1">Amount</p>
                <p className="font-mono text-sm text-white">{amount} {selectedToken}</p>
              </div>
              
              <div className="bg-black rounded-lg p-3">
                <p className="text-xs text-gray-400 mb-1">Transaction</p>
                <a 
                  href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-xs text-primary hover:text-primary-dark"
                >
                  {txSignature.slice(0, 20)}...
                </a>
              </div>
            </div>

            <button
              onClick={handleClose}
              className="w-full bg-primary text-black px-4 py-2 rounded-lg hover:bg-primary-dark transition-colors"
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}