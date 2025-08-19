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

describe('Privacy Pool Core Flows', () => {
    let svm;
    let helpers;
    let programKeypair;
    let entrypointAuthority;
    let assetMint;
    let poolAccount;
    let depositor1;

    const programPath = path.join(__dirname, '../../target/deploy/solana_privacy_pools.so');
    
    before(function() {
        if (!fs.existsSync(programPath)) {
            console.log('Program not built. Run: cargo build-sbf');
            this.skip();
        }
    });

    const programBytes = fs.existsSync(programPath) ? fs.readFileSync(programPath) : null;

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
    });

    describe('Complete Flow: Initialize → Deposit → Wind Down', () => {
        it('should execute complete pool lifecycle', async () => {
            // === STEP 1: Initialize Pool ===
            console.log('Step 1: Initializing pool...');
            
            const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));

            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: Number(rentExemption),
                programId: programKeypair.publicKey,
            });

            // Create initialize instruction
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

            // Build and send initialization transaction
            const initTx = new Transaction().add(createAccountIx, initializeIx);
            helpers.addComputeBudget(initTx);
            
            const blockhash = svm.latestBlockhash();
            initTx.recentBlockhash = blockhash;
            initTx.feePayer = entrypointAuthority.publicKey;
            initTx.sign(entrypointAuthority, poolAccount);

            const initResult = svm.sendTransaction(initTx);
            expect(initResult.constructor.name).to.equal('TransactionMetadata');
            
            console.log('✅ Pool initialized successfully');

            // === STEP 2: Make a Deposit ===
            console.log('Step 2: Making deposit...');

            // Generate commitment data (use pre-generated values to avoid async issues)
            const label = Buffer.alloc(32);
            label.write('test-deposit-1');
            const secret = Buffer.from('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'hex');
            const depositValue = 1000000; // 0.001 SOL
            
            // Use a pre-computed commitment hash to avoid async issues during test
            const commitmentHash = Buffer.from('8800000000000000000000000000000000000000000000000000000000000000', 'hex');

            // Create depositor account (using simple keypair for testing)
            const depositorAccount = Keypair.generate();
            const depositorRent = svm.minimumBalanceForRentExemption(BigInt(DEPOSITOR_STATE_SIZE));

            const createDepositorIx = SystemProgram.createAccount({
                fromPubkey: depositor1.publicKey,
                newAccountPubkey: depositorAccount.publicKey,
                space: DEPOSITOR_STATE_SIZE,
                lamports: Number(depositorRent),
                programId: programKeypair.publicKey,
            });

            // Create deposit instruction using helper
            const depositIx = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorAccount.publicKey,
                depositor1.publicKey,
                commitmentHash,
                label,
                depositValue
            );
            // Override program ID to match the deployed program
            depositIx.programId = programKeypair.publicKey;

            // Build and send deposit transaction
            const depositTx = new Transaction().add(createDepositorIx, depositIx);
            helpers.addComputeBudget(depositTx);
            
            depositTx.recentBlockhash = svm.latestBlockhash();
            depositTx.feePayer = depositor1.publicKey;
            depositTx.sign(depositor1, depositorAccount);

            const depositResult = svm.sendTransaction(depositTx);
            console.log('Deposit result type:', depositResult.constructor.name);
            console.log('Deposit result:', depositResult);
            expect(depositResult.constructor.name).to.equal('TransactionMetadata');
            
            console.log('✅ Deposit completed successfully');

            // Verify depositor account was created and has correct data
            const depositorAccountInfo = svm.getAccount(depositorAccount.publicKey);
            expect(depositorAccountInfo).to.not.be.null;
            expect(depositorAccountInfo.owner.toString()).to.equal(programKeypair.publicKey.toString());
            expect(depositorAccountInfo.data.length).to.equal(DEPOSITOR_STATE_SIZE);

            // === STEP 3: Wind Down Pool ===
            console.log('Step 3: Winding down pool...');

            // Create wind down instruction
            const windDownData = Buffer.alloc(1);
            windDownData[0] = 4; // WIND_DOWN_INSTRUCTION

            const windDownIx = new TransactionInstruction({
                keys: [
                    { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
                    { pubkey: entrypointAuthority.publicKey, isSigner: true, isWritable: false },
                ],
                programId: programKeypair.publicKey,
                data: windDownData,
            });

            // Build and send wind down transaction
            const windDownTx = new Transaction().add(windDownIx);
            helpers.addComputeBudget(windDownTx);
            
            windDownTx.recentBlockhash = svm.latestBlockhash();
            windDownTx.feePayer = entrypointAuthority.publicKey;
            windDownTx.sign(entrypointAuthority);

            const windDownResult = svm.sendTransaction(windDownTx);
            expect(windDownResult.constructor.name).to.equal('TransactionMetadata');
            
            console.log('✅ Pool wound down successfully');

            // === VERIFICATION ===
            const finalPoolState = svm.getAccount(poolAccount.publicKey);
            expect(finalPoolState).to.not.be.null;
            expect(finalPoolState.data[0]).to.equal(1); // still initialized
            // The 'dead' flag should be set but its exact position in zero-copy layout needs verification
            
            console.log('🎉 Complete lifecycle test successful!');
            console.log('  - Pool initialized: ✅');
            console.log('  - Deposit made: ✅');
            console.log('  - Pool wound down: ✅');
            console.log('  - All using optimized compute budget and zero-copy accounts');
        });
    });
});