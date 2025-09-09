import { NextApiRequest, NextApiResponse } from 'next';
import { Connection, PublicKey } from '@solana/web3.js';

// Import the client functions on the server side where fs is available
const { withdrawSimple } = require('@solana-privacy-pools/client');

const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { 
      userPublicKey,
      amount,
      nullifier,
      secret,
      nonce,
      scope,
      recipient
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
    if (!poolAccountInfo) {
      return res.status(400).json({ error: 'Pool not initialized' });
    }

    // Parse recipient if provided
    const recipientPubkey = recipient ? new PublicKey(recipient) : userPubkey;

    // Create the withdraw transaction
    const signature = await withdrawSimple(
      connection,
      poolStateAccount,
      { publicKey: userPubkey },
      BigInt(amount),
      BigInt(nullifier),
      BigInt(secret),
      nonce,
      scope,
      recipientPubkey,
      WSOL_MINT
    );

    res.status(200).json({
      success: true,
      signature
    });
  } catch (error) {
    console.error('Withdraw error:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : 'Withdrawal failed' 
    });
  }
}