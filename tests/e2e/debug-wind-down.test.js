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

describe('Debug Wind Down', () => {
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

    it('should debug wind down flow step by step', () => {
        // STEP 1: Initialize pool first
        console.log('Step 1: Initializing pool...');
        const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));
        
        const createAccountIx = SystemProgram.createAccount({
            fromPubkey: entrypointAuthority.publicKey,
            newAccountPubkey: poolAccount.publicKey,
            space: PRIVACY_POOL_STATE_SIZE,
            lamports: Number(rentExemption),
            programId: programKeypair.publicKey,
        });

        const instructionData = Buffer.alloc(66);
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

        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1200000 });
        const initTx = new Transaction().add(computeBudgetIx, createAccountIx, initializeIx);
        const blockhash = svm.latestBlockhash();
        initTx.recentBlockhash = blockhash;
        initTx.feePayer = entrypointAuthority.publicKey;
        initTx.sign(entrypointAuthority, poolAccount);
        
        const initResult = svm.sendTransaction(initTx);
        expect(initResult.constructor.name).to.equal('TransactionMetadata');
        console.log('✅ Pool initialized successfully');

        // Check pool state before wind down
        console.log('Step 2: Checking pool state before wind down...');
        const poolAccountInfo = svm.getAccount(poolAccount.publicKey);
        expect(poolAccountInfo).to.not.be.null;
        console.log('Pool account data length:', poolAccountInfo.data.length);
        console.log('Pool is_initialized:', poolAccountInfo.data[0]);
        console.log('Pool dead flag (should be 0):', poolAccountInfo.data[105]); // dead flag at offset 105
        
        // STEP 3: Try wind down with debug info
        console.log('Step 3: Attempting wind down...');
        
        // Wind down instruction: just instruction type (1 byte)
        const windDownData = Buffer.alloc(1);
        windDownData[0] = 4; // WIND_DOWN_INSTRUCTION
        
        console.log('Wind down instruction data length:', windDownData.length);
        console.log('Wind down instruction data:', windDownData.toString('hex'));

        const windDownIx = new TransactionInstruction({
            keys: [
                { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: entrypointAuthority.publicKey, isSigner: true, isWritable: false },
            ],
            programId: programKeypair.publicKey,
            data: windDownData,
        });

        // Build and send wind down transaction
        const windDownTx = new Transaction().add(computeBudgetIx, windDownIx);
        windDownTx.recentBlockhash = svm.latestBlockhash();
        windDownTx.feePayer = entrypointAuthority.publicKey;
        windDownTx.sign(entrypointAuthority);

        console.log('Attempting wind down transaction...');
        console.log('Pool account:', poolAccount.publicKey.toString());
        console.log('Authority account:', entrypointAuthority.publicKey.toString());
        console.log('Authority is signer:', true);
        
        const windDownResult = svm.sendTransaction(windDownTx);
        console.log('Wind down result type:', windDownResult.constructor.name);
        
        if (windDownResult.constructor.name === 'FailedTransactionMetadata') {
            console.log('❌ Wind down transaction failed');
            
            // Check current pool state
            const poolAccountInfoAfter = svm.getAccount(poolAccount.publicKey);
            console.log('Pool account still exists:', !!poolAccountInfoAfter);
            
            if (poolAccountInfoAfter) {
                console.log('Pool account data length after:', poolAccountInfoAfter.data.length);
                console.log('Pool dead flag after (should still be 0):', poolAccountInfoAfter.data[105]);
                console.log('Pool authority bytes:', poolAccountInfoAfter.data.slice(1, 33));
                console.log('Expected authority bytes:', entrypointAuthority.publicKey.toBuffer());
                
                // Compare authority bytes
                const storedAuth = poolAccountInfoAfter.data.slice(1, 33);
                const expectedAuth = entrypointAuthority.publicKey.toBuffer();
                const authMatches = Buffer.compare(storedAuth, expectedAuth) === 0;
                console.log('Authority matches:', authMatches);
            }
            
            // This will fail, but we want to see the debug info
            expect(windDownResult.constructor.name).to.equal('TransactionMetadata');
        } else {
            console.log('✅ Wind down transaction succeeded');
            expect(windDownResult.constructor.name).to.equal('TransactionMetadata');
            
            // Verify pool state was updated
            const poolAccountInfoAfter = svm.getAccount(poolAccount.publicKey);
            expect(poolAccountInfoAfter).to.not.be.null;
            console.log('Pool dead flag after (should be 1):', poolAccountInfoAfter.data[105]);
            expect(poolAccountInfoAfter.data[105]).to.equal(1);
        }
    });
});