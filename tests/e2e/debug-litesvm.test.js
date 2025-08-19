const { expect } = require('chai');
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

const {
    TestHelpers,
    PRIVACY_POOL_STATE_SIZE,
} = require('../utils/test-helpers');

describe('Debug LiteSVM', () => {
    let svm;
    let helpers;
    let programKeypair;
    let entrypointAuthority;
    let assetMint;
    let poolAccount;

    const programPath = path.join(__dirname, '../../target/deploy/solana_privacy_pools.so');
    const programBytes = fs.existsSync(programPath) ? fs.readFileSync(programPath) : null;

    before(function() {
        if (!programBytes) {
            console.log('Program not built. Run: cargo build-sbf');
            this.skip();
        }
    });

    beforeEach(() => {
        svm = new LiteSVM();
        helpers = new TestHelpers();

        // Create keypairs
        programKeypair = Keypair.generate();
        entrypointAuthority = Keypair.generate();
        assetMint = Keypair.generate();
        poolAccount = Keypair.generate();

        // Fund accounts
        svm.airdrop(entrypointAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

        // Deploy program
        svm.addProgram(programKeypair.publicKey, programBytes);
        
        console.log('Program deployed at:', programKeypair.publicKey.toString());
        console.log('Pool account:', poolAccount.publicKey.toString());
        console.log('Authority:', entrypointAuthority.publicKey.toString());
    });

    it('should debug simple initialization', () => {
        // Get minimum rent (LiteSVM expects BigInt)
        const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));
        console.log('Rent exemption needed:', rentExemption.toString());
        
        // Create pool account
        const createAccountIx = SystemProgram.createAccount({
            fromPubkey: entrypointAuthority.publicKey,
            newAccountPubkey: poolAccount.publicKey,
            space: PRIVACY_POOL_STATE_SIZE,
            lamports: Number(rentExemption),
            programId: programKeypair.publicKey,
        });

        // Create initialize instruction with minimal data
        const instructionData = Buffer.alloc(66); // 1 + 32 + 1 + 32
        instructionData[0] = 0; // INITIALIZE_INSTRUCTION
        entrypointAuthority.publicKey.toBuffer().copy(instructionData, 1);
        instructionData[33] = 20; // max_tree_depth
        assetMint.publicKey.toBuffer().copy(instructionData, 34);

        console.log('Instruction data length:', instructionData.length);
        console.log('Instruction data:', instructionData.toString('hex').substring(0, 20) + '...');

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
            units: 1200000,
        });
        
        const tx = new Transaction().add(computeBudgetIx, createAccountIx, initializeIx);
        const blockhash = svm.latestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = entrypointAuthority.publicKey;
        tx.sign(entrypointAuthority, poolAccount);
        
        console.log('Transaction signed, attempting to send...');
        
        // Try to get more info about the failure
        try {
            const result = svm.sendTransaction(tx);
            console.log('Transaction result type:', result.constructor.name);
            console.log('Transaction result:', result);
            
            if (result.constructor.name === 'FailedTransactionMetadata') {
                console.log('Transaction failed - checking logs...');
                // Try to get logs or error info
                const logs = svm.getTransactionLogs ? svm.getTransactionLogs(result) : 'No logs available';
                console.log('Logs:', logs);
            }
            
        } catch (error) {
            console.error('Exception during transaction:', error.message);
            console.error('Stack:', error.stack);
            throw error;
        }

        // Check if account was created
        const poolAccountInfo = svm.getAccount(poolAccount.publicKey);
        if (poolAccountInfo) {
            console.log('Pool account created successfully');
            console.log('Owner:', poolAccountInfo.owner.toString());
            console.log('Data length:', poolAccountInfo.data.length);
            console.log('First few bytes:', poolAccountInfo.data.slice(0, 10));
        } else {
            console.log('Pool account was not created');
        }
    });
});