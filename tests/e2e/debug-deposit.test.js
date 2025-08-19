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
    DEPOSITOR_STATE_SIZE,
} = require('../utils/test-helpers');

describe('Debug Deposit', () => {
    let svm;
    let helpers;
    let programKeypair;
    let entrypointAuthority;
    let assetMint;
    let poolAccount;
    let depositor1;

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
        depositor1 = Keypair.generate();

        // Fund accounts
        svm.airdrop(entrypointAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        svm.airdrop(depositor1.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

        // Deploy program
        svm.addProgram(programKeypair.publicKey, programBytes);
        
        console.log('Program deployed at:', programKeypair.publicKey.toString());
        console.log('Pool account:', poolAccount.publicKey.toString());
        console.log('Authority:', entrypointAuthority.publicKey.toString());
        console.log('Depositor:', depositor1.publicKey.toString());
    });

    it('should debug deposit flow step by step', () => {
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

        // STEP 2: Create depositor account
        console.log('Step 2: Creating depositor account...');
        const depositorAccount = Keypair.generate();
        const depositorRent = svm.minimumBalanceForRentExemption(BigInt(DEPOSITOR_STATE_SIZE));

        const createDepositorIx = SystemProgram.createAccount({
            fromPubkey: depositor1.publicKey,
            newAccountPubkey: depositorAccount.publicKey,
            space: DEPOSITOR_STATE_SIZE,
            lamports: Number(depositorRent),
            programId: programKeypair.publicKey,
        });

        const createDepTx = new Transaction().add(computeBudgetIx, createDepositorIx);
        createDepTx.recentBlockhash = svm.latestBlockhash();
        createDepTx.feePayer = depositor1.publicKey;
        createDepTx.sign(depositor1, depositorAccount);

        const createDepResult = svm.sendTransaction(createDepTx);
        expect(createDepResult.constructor.name).to.equal('TransactionMetadata');
        console.log('✅ Depositor account created');

        // STEP 3: Try deposit with debug info
        console.log('Step 3: Making deposit with debug info...');
        
        // Use simple test data
        const label = Buffer.alloc(32);
        label.write('test-deposit-debug');
        const secret = Buffer.from('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'hex');
        const depositValue = 1000000; // 0.001 SOL
        const commitmentHash = Buffer.from('8800000000000000000000000000000000000000000000000000000000000000', 'hex');

        // Manually construct deposit instruction (should match our helper)
        const depositData = Buffer.alloc(1 + 32 + 8 + 32); // instruction + depositor + value + precommitment_hash
        let offset = 0;
        depositData[offset++] = 1; // DEPOSIT_INSTRUCTION
        depositor1.publicKey.toBuffer().copy(depositData, offset); offset += 32;
        depositData.writeBigUInt64LE(BigInt(depositValue), offset); offset += 8;
        commitmentHash.copy(depositData, offset);

        console.log('Deposit instruction data length:', depositData.length);
        console.log('Deposit instruction data preview:', depositData.toString('hex').substring(0, 40) + '...');

        const depositIx = new TransactionInstruction({
            keys: [
                { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: depositorAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: depositor1.publicKey, isSigner: true, isWritable: false },
            ],
            programId: programKeypair.publicKey,
            data: depositData,
        });

        // Build and send deposit transaction
        const depositTx = new Transaction().add(computeBudgetIx, depositIx);
        depositTx.recentBlockhash = svm.latestBlockhash();
        depositTx.feePayer = depositor1.publicKey;
        depositTx.sign(depositor1);

        console.log('Attempting deposit transaction...');
        const depositResult = svm.sendTransaction(depositTx);
        console.log('Deposit result type:', depositResult.constructor.name);
        
        if (depositResult.constructor.name === 'FailedTransactionMetadata') {
            console.log('❌ Deposit transaction failed');
            
            // Check if accounts still exist and have expected state
            const poolAccountInfo = svm.getAccount(poolAccount.publicKey);
            const depositorAccountInfo = svm.getAccount(depositorAccount.publicKey);
            
            console.log('Pool account exists:', !!poolAccountInfo);
            console.log('Depositor account exists:', !!depositorAccountInfo);
            
            if (poolAccountInfo) {
                console.log('Pool account data length:', poolAccountInfo.data.length);
                console.log('Pool account first bytes:', poolAccountInfo.data.slice(0, 10));
            }
            
            // This will fail, but we want to see the debug info
            expect(depositResult.constructor.name).to.equal('TransactionMetadata');
        } else {
            console.log('✅ Deposit transaction succeeded');
            expect(depositResult.constructor.name).to.equal('TransactionMetadata');
            
            // Verify depositor account was updated
            const depositorAccountInfo = svm.getAccount(depositorAccount.publicKey);
            expect(depositorAccountInfo).to.not.be.null;
            console.log('Depositor account data after deposit:', depositorAccountInfo.data.slice(0, 20));
        }
    });
});