import { useState } from 'react';
import { usePrivacyPool } from '../hooks/usePrivacyPool';

interface DepositModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DepositModal({ isOpen, onClose }: DepositModalProps) {
  const [amount, setAmount] = useState('');
  const [showCredentials, setShowCredentials] = useState(false);
  const [credentials, setCredentials] = useState<any>(null);
  const { depositFunds, isLoading, error } = usePrivacyPool();

  if (!isOpen) return null;

  const handleDeposit = async () => {
    const depositAmount = parseFloat(amount);
    if (isNaN(depositAmount) || depositAmount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    // Generate random nonce and use default scope for now
    const nonce = Math.floor(Math.random() * 1000000);
    const scope = 'default';

    const result = await depositFunds({
      amount: depositAmount,
      nonce,
      scope
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
                <label className="block text-sm text-gray-400 mb-2">Amount (SOL)</label>
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
                  disabled={isLoading || !amount}
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
                <p className="font-mono text-sm text-white">{credentials?.amount} SOL</p>
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