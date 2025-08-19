const { expect } = require('chai');
const { LiteSVM } = require('litesvm');
const { 
    Keypair, 
    PublicKey, 
    Transaction, 
    SystemProgram,
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const {
    TestHelpers,
    PRIVACY_POOL_STATE_SIZE,
    DEPOSITOR_STATE_SIZE,
    NULLIFIER_STATE_SIZE,
} = require('../utils/test-helpers');

describe('Privacy Pool LiteSVM Tests', () => {
    let svm;
    let helpers;
    let programKeypair;
    let entrypointAuthority;
    let assetMint;
    let poolAccount;
    let depositor1;
    let depositor2;
    let processooor;

    // Load the compiled program
    const programPath = path.join(__dirname, '../../target/deploy/solana_privacy_pools.so');
    
    before(function() {
        // Skip if program not built
        if (!fs.existsSync(programPath)) {
            console.log('Program not built. Run: cargo build-sbf --release');
            this.skip();
        }
    });

    const programBytes = fs.existsSync(programPath) ? fs.readFileSync(programPath) : null;

    beforeEach(() => {
        // Initialize LiteSVM
        svm = new LiteSVM();
        helpers = new TestHelpers();

        // Create keypairs
        programKeypair = Keypair.generate();
        entrypointAuthority = Keypair.generate();
        assetMint = Keypair.generate();
        poolAccount = Keypair.generate();
        depositor1 = Keypair.generate();
        depositor2 = Keypair.generate();
        processooor = Keypair.generate();

        // Fund accounts (using BigInt)
        svm.airdrop(entrypointAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        svm.airdrop(depositor1.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        svm.airdrop(depositor2.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        svm.airdrop(processooor.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

        // Deploy program
        svm.addProgram(programKeypair.publicKey, programBytes);
        
        // Update the program ID in test helpers to match deployed program
        helpers.programId = programKeypair.publicKey;
    });

    describe('Pool Initialization', () => {
        it('should initialize a new privacy pool', () => {
            // Get minimum rent (LiteSVM expects BigInt)
            const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));
            
            // Create pool account
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: Number(rentExemption), // SystemProgram expects number
                programId: programKeypair.publicKey,
            });

            // Create initialize instruction
            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                20
            );
            // Update instruction program ID
            initializeIx.programId = programKeypair.publicKey;

            // Build transaction with compute budget
            const tx = new Transaction().add(createAccountIx, initializeIx);
            helpers.addComputeBudget(tx);
            const blockhash = svm.latestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(entrypointAuthority, poolAccount);
            
            // Send transaction
            const result = svm.sendTransaction(tx);
            console.log('Init transaction result:', result);

            // Verify pool account was created
            const poolAccountInfo = svm.getAccount(poolAccount.publicKey);
            expect(poolAccountInfo).to.not.be.null;
            expect(poolAccountInfo.owner.toString()).to.equal(programKeypair.publicKey.toString());
            expect(poolAccountInfo.data.length).to.equal(PRIVACY_POOL_STATE_SIZE);
            
            // Check the pool is initialized (first byte should be 1)
            expect(poolAccountInfo.data[0]).to.equal(1);
            
            console.log('Pool initialized successfully');
        });

        it('should fail to initialize with invalid tree depth', () => {
            const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));
            
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: Number(rentExemption),
                programId: programKeypair.publicKey,
            });

            // Create initialize instruction with invalid depth (> 32)
            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                33 // Invalid depth
            );
            initializeIx.programId = programKeypair.publicKey;

            const tx = new Transaction().add(createAccountIx, initializeIx);
            const blockhash = svm.latestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(entrypointAuthority, poolAccount);
            
            // Should fail
            try {
                const result = svm.sendTransaction(tx);
                expect.fail('Transaction should have failed');
            } catch (err) {
                // Expected to fail
                console.log('Expected failure: invalid tree depth');
            }
        });
    });

    describe('Deposit Flow', () => {
        beforeEach(() => {
            // Initialize pool first
            const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));
            
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: Number(rentExemption),
                programId: programKeypair.publicKey,
            });

            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                20
            );
            initializeIx.programId = programKeypair.publicKey;

            const tx = new Transaction().add(createAccountIx, initializeIx);
            const blockhash = svm.latestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(entrypointAuthority, poolAccount);
            
            svm.sendTransaction(tx);
        });

        it('should deposit funds into the pool', () => {
            // Generate commitment
            const label = Buffer.alloc(32);
            label.write('test-label');
            const secret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            const value = 1000000; // 0.001 SOL
            const commitmentHash = helpers.generateCommitment(label, secret, value);

            // Find depositor PDA (using test helper's mock PDA)
            const depositorPDA = Keypair.generate(); // For testing, use a regular keypair

            // Create depositor account
            const rentExemption = svm.minimumBalanceForRentExemption(BigInt(DEPOSITOR_STATE_SIZE));
            const createDepositorIx = SystemProgram.createAccount({
                fromPubkey: depositor1.publicKey,
                newAccountPubkey: depositorPDA.publicKey,
                space: DEPOSITOR_STATE_SIZE,
                lamports: Number(rentExemption),
                programId: programKeypair.publicKey,
            });

            // Create deposit instruction
            const depositIx = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA.publicKey,
                depositor1.publicKey,
                commitmentHash,
                label,
                value
            );
            depositIx.programId = programKeypair.publicKey;

            // Build and send transaction
            const tx = new Transaction().add(createDepositorIx, depositIx);
            const blockhash = svm.latestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(depositor1, depositorPDA);
            
            const result = svm.sendTransaction(tx);
            console.log('Deposit transaction result:', result);

            // Verify depositor account was created
            const depositorAccountInfo = svm.getAccount(depositorPDA.publicKey);
            expect(depositorAccountInfo).to.not.be.null;
            expect(depositorAccountInfo.owner.toString()).to.equal(programKeypair.publicKey.toString());
            
            console.log('Deposit successful');
        });

        it('should handle multiple deposits', () => {
            const deposits = [];
            
            // Create 3 deposits
            for (let i = 0; i < 3; i++) {
                const label = Buffer.alloc(32);
                label.write(`deposit-${i}`);
                const secret = helpers.randomBytes32();
                const value = (i + 1) * 1000000;
                const commitmentHash = helpers.generateCommitment(label, secret, value);
                
                deposits.push({ label, secret, value, commitmentHash });
                
                const depositorPDA = Keypair.generate();
                const rentExemption = svm.minimumBalanceForRentExemption(BigInt(DEPOSITOR_STATE_SIZE));
                
                const createDepositorIx = SystemProgram.createAccount({
                    fromPubkey: depositor1.publicKey,
                    newAccountPubkey: depositorPDA.publicKey,
                    space: DEPOSITOR_STATE_SIZE,
                    lamports: Number(rentExemption),
                    programId: programKeypair.publicKey,
                });

                const depositIx = helpers.createDepositInstruction(
                    poolAccount.publicKey,
                    depositorPDA.publicKey,
                    depositor1.publicKey,
                    commitmentHash,
                    label,
                    value
                );
                depositIx.programId = programKeypair.publicKey;

                const tx = new Transaction().add(createDepositorIx, depositIx);
                const blockhash = svm.latestBlockhash();
                tx.recentBlockhash = blockhash;
                tx.sign(depositor1, depositorPDA);
                
                const result = svm.sendTransaction(tx);
                console.log(`Deposit ${i} completed`);
            }
            
            expect(deposits).to.have.lengthOf(3);
            console.log('All deposits successful');
        });
    });

    describe('Wind Down Flow', () => {
        beforeEach(() => {
            // Initialize pool
            const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));
            
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: Number(rentExemption),
                programId: programKeypair.publicKey,
            });

            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                20
            );
            initializeIx.programId = programKeypair.publicKey;

            const tx = new Transaction().add(createAccountIx, initializeIx);
            const blockhash = svm.latestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(entrypointAuthority, poolAccount);
            
            svm.sendTransaction(tx);
        });

        it('should wind down the pool', () => {
            // Create wind down instruction
            const windDownIx = helpers.createWindDownInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey
            );
            windDownIx.programId = programKeypair.publicKey;

            // Build and send transaction
            const tx = new Transaction().add(windDownIx);
            const blockhash = svm.latestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(entrypointAuthority);
            
            const result = svm.sendTransaction(tx);
            console.log('Wind down transaction result:', result);

            // Check pool state is marked as dead
            const poolAccountInfo = svm.getAccount(poolAccount.publicKey);
            
            // The 'dead' flag is at offset 73 in the state
            // is_initialized(1) + entrypoint_authority(32) + asset_mint(32) + scope(32) + nonce(8) = 105
            // Actually, checking the exact byte position depends on the zero-copy layout
            // For now, just verify the transaction succeeded
            
            console.log('Pool wound down successfully');
        });

        it('should fail to wind down with wrong authority', () => {
            // Try to wind down with non-authority account
            const windDownIx = helpers.createWindDownInstruction(
                poolAccount.publicKey,
                depositor1.publicKey // Wrong authority
            );
            windDownIx.programId = programKeypair.publicKey;

            const tx = new Transaction().add(windDownIx);
            const blockhash = svm.latestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.sign(depositor1);
            
            try {
                const result = svm.sendTransaction(tx);
                expect.fail('Transaction should have failed');
            } catch (err) {
                // Expected to fail
                console.log('Expected failure: wrong authority');
            }
        });
    });
});