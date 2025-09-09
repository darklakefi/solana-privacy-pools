import { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';

// Import the client functions on the server side where fs is available
const { deposit, initializePool } = require('@solana-privacy-pools/client');

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      userPublicKey, 
      amount, 
      nonce, 
      scope,
      nullifier,
      secret,
      initializeIfNeeded 
    } = req.body;

    // Create connection to Solana
    const rpcEndpoint = process.env.NEXT_PUBLIC_RPC_ENDPOINT || 
      (process.env.APP_ENV === 'prod' ? 'https://api.mainnet-beta.solana.com' : 'https://api.devnet.solana.com');
    const connection = new Connection(rpcEndpoint, 'confirmed');

    // Parse user public key
    const userPubkey = new PublicKey(userPublicKey);
    
    // Derive pool state account
    const poolStateSeed = `ps-${WSOL_MINT.toBase58().slice(0, 29)}`;
    const poolStateAccount = await PublicKey.createWithSeed(
      userPubkey,
      poolStateSeed,
      new PublicKey(process.env.NEXT_PUBLIC_PROGRAM_ID!)
    );

    // Check if pool exists
    const poolAccountInfo = await connection.getAccountInfo(poolStateAccount);
    
    let actualPoolState = poolStateAccount;
    
    if (!poolAccountInfo && initializeIfNeeded) {
      // Initialize the pool first
      const initResult = await initializePool(
        connection,
        { publicKey: userPubkey },
        WSOL_MINT
      );
      actualPoolState = initResult.poolStateAccount;
    } else if (!poolAccountInfo) {
      return res.status(400).json({ error: 'Pool not initialized' });
    }

    // Create the deposit transaction
    const depositResult = await deposit(
      connection,
      actualPoolState,
      { publicKey: userPubkey },
      BigInt(amount),
      nonce,
      scope,
      WSOL_MINT,
      nullifier ? BigInt(nullifier) : undefined,
      secret ? BigInt(secret) : undefined
    );

    res.status(200).json({
      success: true,
      signature: depositResult.signature,
      nullifier: depositResult.nullifier.toString(),
      secret: depositResult.secret.toString(),
      depositorState: depositResult.depositorState.toBase58()
    });
  } catch (error) {
    console.error('Deposit error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Deposit failed' 
    });
  }
}