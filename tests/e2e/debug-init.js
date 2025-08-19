const { LiteSVM } = require('litesvm');
const { 
    Keypair, 
    PublicKey, 
    Transaction, 
    TransactionInstruction,
    SystemProgram,
    ComputeBudgetProgram,
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Test initialization - try without compute budget modification for now
const svm = new LiteSVM();

// Load program
const programPath = path.join(__dirname, '../../target/deploy/solana_privacy_pools.so');
const programBytes = fs.readFileSync(programPath);

// Create accounts
const programKeypair = Keypair.generate();
const entrypointAuthority = Keypair.generate();
const assetMint = Keypair.generate();
const poolAccount = Keypair.generate();

console.log('Program:', programKeypair.publicKey.toString());
console.log('Authority:', entrypointAuthority.publicKey.toString());
console.log('Pool:', poolAccount.publicKey.toString());

// Fund authority
svm.airdrop(entrypointAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
console.log('Authority balance:', svm.getBalance(entrypointAuthority.publicKey));

// Deploy program
svm.addProgram(programKeypair.publicKey, programBytes);
console.log('Program deployed');

// Check program account
const programAccount = svm.getAccount(programKeypair.publicKey);
console.log('Program account exists:', programAccount !== null);
console.log('Program executable:', programAccount?.executable);

// Create pool account
const PRIVACY_POOL_STATE_SIZE = 4265; // From Rust PrivacyPoolStateZC::LEN
const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));
console.log('Rent exemption:', rentExemption);

const createAccountIx = SystemProgram.createAccount({
    fromPubkey: entrypointAuthority.publicKey,
    newAccountPubkey: poolAccount.publicKey,
    space: PRIVACY_POOL_STATE_SIZE,
    lamports: Number(rentExemption),
    programId: programKeypair.publicKey,
});

// Create initialize instruction
// Format: [instruction_type(1), entrypoint_authority(32), max_tree_depth(1), asset_mint(32)]
const instructionData = Buffer.alloc(1 + 32 + 1 + 32);
instructionData[0] = 0; // INITIALIZE_INSTRUCTION
entrypointAuthority.publicKey.toBuffer().copy(instructionData, 1);
instructionData[33] = 20; // max_tree_depth
assetMint.publicKey.toBuffer().copy(instructionData, 34);

const initializeIx = new TransactionInstruction({
    keys: [
        { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
        { pubkey: entrypointAuthority.publicKey, isSigner: true, isWritable: false },
        { pubkey: assetMint.publicKey, isSigner: false, isWritable: false },
    ],
    programId: programKeypair.publicKey,
    data: instructionData,
});

// Build transaction with compute budget
const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: 1200000, // 1.2M compute units
});

const tx = new Transaction().add(computeBudgetIx, createAccountIx, initializeIx);
const blockhash = svm.latestBlockhash();
console.log('Blockhash:', blockhash);

tx.recentBlockhash = blockhash;
tx.feePayer = entrypointAuthority.publicKey;
tx.sign(entrypointAuthority, poolAccount);

console.log('Transaction signed');

// Send transaction
try {
    const result = svm.sendTransaction(tx);
    console.log('Transaction result:', result);
    console.log('Transaction result type:', result.constructor.name);
    
    // Try to access properties
    console.log('Result properties:', Object.keys(result));
    console.log('Result toString:', result.toString());
    
    // Try simulate first
    console.log('\nSimulating transaction...');
    const simResult = svm.simulateTransaction(tx);
    console.log('Simulation result:', simResult);
    console.log('Simulation properties:', Object.keys(simResult));
} catch (err) {
    console.error('Transaction error:', err);
    console.error('Error stack:', err.stack);
}

// Check pool account
const poolAccountInfo = svm.getAccount(poolAccount.publicKey);
console.log('Pool account exists:', poolAccountInfo !== null);
if (poolAccountInfo) {
    console.log('Pool owner:', poolAccountInfo.owner.toString());
    console.log('Pool data length:', poolAccountInfo.data.length);
    console.log('Pool initialized (first byte):', poolAccountInfo.data[0]);
}