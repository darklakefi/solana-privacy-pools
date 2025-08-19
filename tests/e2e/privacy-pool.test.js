const { expect } = require('chai');
const { LiteSVM } = require('@litesvm/node');
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
    PROGRAM_ID,
    PRIVACY_POOL_STATE_SIZE,
    DEPOSITOR_STATE_SIZE,
    NULLIFIER_STATE_SIZE,
} = require('../utils/test-helpers');

describe('Privacy Pool E2E Tests', () => {
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
    const programBytes = fs.readFileSync(
        path.join(__dirname, '../../target/deploy/solana_privacy_pools.so')
    );

    beforeEach(async () => {
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

        // Fund accounts
        await svm.airdrop(entrypointAuthority.publicKey, 10 * LAMPORTS_PER_SOL);
        await svm.airdrop(depositor1.publicKey, 10 * LAMPORTS_PER_SOL);
        await svm.airdrop(depositor2.publicKey, 10 * LAMPORTS_PER_SOL);
        await svm.airdrop(processooor.publicKey, 10 * LAMPORTS_PER_SOL);

        // Deploy program
        await svm.deployProgram(programKeypair.publicKey, programBytes);
    });

    afterEach(() => {
        svm.close();
    });

    describe('Pool Initialization', () => {
        it('should initialize a new privacy pool', async () => {
            // Create pool account
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(PRIVACY_POOL_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            // Create initialize instruction
            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                20
            );

            // Send transaction
            const tx = new Transaction().add(createAccountIx, initializeIx);
            const signature = await svm.sendTransaction(tx, [entrypointAuthority, poolAccount]);
            
            expect(signature).to.not.be.null;

            // Verify pool state
            const poolAccountInfo = await svm.getAccount(poolAccount.publicKey);
            expect(poolAccountInfo).to.not.be.null;
            expect(poolAccountInfo.owner.toString()).to.equal(programKeypair.publicKey.toString());
        });

        it('should fail to initialize with invalid tree depth', async () => {
            // Create pool account
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(PRIVACY_POOL_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            // Create initialize instruction with invalid depth (> 32)
            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                33
            );

            // Send transaction - should fail
            const tx = new Transaction().add(createAccountIx, initializeIx);
            
            try {
                await svm.sendTransaction(tx, [entrypointAuthority, poolAccount]);
                expect.fail('Transaction should have failed');
            } catch (err) {
                expect(err.message).to.include('invalid');
            }
        });
    });

    describe('Deposit Flow', () => {
        beforeEach(async () => {
            // Initialize pool first
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(PRIVACY_POOL_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                20
            );

            const tx = new Transaction().add(createAccountIx, initializeIx);
            await svm.sendTransaction(tx, [entrypointAuthority, poolAccount]);
        });

        it('should deposit funds into the pool', async () => {
            // Generate commitment
            const label = Buffer.alloc(32);
            label.write('test-label');
            const secret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            const value = 1000000; // 0.001 SOL
            const commitmentHash = helpers.generateCommitment(label, secret, value);

            // Find depositor PDA
            const [depositorPDA] = helpers.findDepositorPDA(
                poolAccount.publicKey,
                depositor1.publicKey,
                label
            );

            // Create depositor account
            const createDepositorIx = SystemProgram.createAccount({
                fromPubkey: depositor1.publicKey,
                newAccountPubkey: depositorPDA,
                space: DEPOSITOR_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            // Create deposit instruction
            const depositIx = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA,
                depositor1.publicKey,
                commitmentHash,
                label,
                value
            );

            // Send transaction
            const tx = new Transaction().add(createDepositorIx, depositIx);
            const signature = await svm.sendTransaction(tx, [depositor1]);
            
            expect(signature).to.not.be.null;

            // Verify depositor account was created
            const depositorAccountInfo = await svm.getAccount(depositorPDA);
            expect(depositorAccountInfo).to.not.be.null;
        });

        it('should fail to deposit with duplicate label', async () => {
            // Generate commitment
            const label = Buffer.alloc(32);
            label.write('duplicate-label');
            const secret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            const value = 1000000;
            const commitmentHash = helpers.generateCommitment(label, secret, value);

            // Find depositor PDA
            const [depositorPDA] = helpers.findDepositorPDA(
                poolAccount.publicKey,
                depositor1.publicKey,
                label
            );

            // First deposit - should succeed
            const createDepositorIx1 = SystemProgram.createAccount({
                fromPubkey: depositor1.publicKey,
                newAccountPubkey: depositorPDA,
                space: DEPOSITOR_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const depositIx1 = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA,
                depositor1.publicKey,
                commitmentHash,
                label,
                value
            );

            const tx1 = new Transaction().add(createDepositorIx1, depositIx1);
            await svm.sendTransaction(tx1, [depositor1]);

            // Second deposit with same label - should fail
            const secret2 = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            const commitmentHash2 = helpers.generateCommitment(label, secret2, value);

            const depositIx2 = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA,
                depositor1.publicKey,
                commitmentHash2,
                label,
                value
            );

            const tx2 = new Transaction().add(depositIx2);
            
            try {
                await svm.sendTransaction(tx2, [depositor1]);
                expect.fail('Transaction should have failed');
            } catch (err) {
                expect(err.message).to.include('already');
            }
        });
    });

    describe('Withdrawal Flow', () => {
        let commitmentSecret;
        let commitmentHash;
        let nullifierHash;
        let label;
        let depositValue;

        beforeEach(async () => {
            // Initialize pool
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(PRIVACY_POOL_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                20
            );

            const tx = new Transaction().add(createAccountIx, initializeIx);
            await svm.sendTransaction(tx, [entrypointAuthority, poolAccount]);

            // Make a deposit first
            label = Buffer.alloc(32);
            label.write('withdrawal-test');
            commitmentSecret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            depositValue = 1000000;
            commitmentHash = helpers.generateCommitment(label, commitmentSecret, depositValue);
            nullifierHash = helpers.generateNullifier(commitmentHash, commitmentSecret);

            const [depositorPDA] = helpers.findDepositorPDA(
                poolAccount.publicKey,
                depositor1.publicKey,
                label
            );

            const createDepositorIx = SystemProgram.createAccount({
                fromPubkey: depositor1.publicKey,
                newAccountPubkey: depositorPDA,
                space: DEPOSITOR_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const depositIx = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA,
                depositor1.publicKey,
                commitmentHash,
                label,
                depositValue
            );

            const depositTx = new Transaction().add(createDepositorIx, depositIx);
            await svm.sendTransaction(depositTx, [depositor1]);
        });

        it('should withdraw funds from the pool', async () => {
            // Note: In a real test, we would generate actual ZK proofs
            // For now, we'll use dummy proof data
            const proofData = {
                proofA: Buffer.alloc(64, 1),
                proofB: Buffer.alloc(128, 2),
                proofC: Buffer.alloc(64, 3),
                publicSignals: [
                    Buffer.from(depositValue.toString(16).padStart(64, '0'), 'hex'), // withdrawn_value
                    Buffer.alloc(32, 200), // state_root
                    Buffer.from('01'.padStart(64, '0'), 'hex'), // state_tree_depth
                    Buffer.alloc(32, 201), // asp_root
                    Buffer.from('02'.padStart(64, '0'), 'hex'), // asp_tree_depth
                    Buffer.alloc(32, 202), // context
                    Buffer.alloc(32, 203), // new_commitment_hash
                    nullifierHash, // existing_nullifier_hash
                ],
            };

            const withdrawalData = {
                processooor: processooor.publicKey,
                data: Buffer.from([1, 2, 3, 4]),
            };

            // Find nullifier PDA
            const [nullifierPDA] = helpers.findNullifierPDA(
                poolAccount.publicKey,
                nullifierHash
            );

            // Create nullifier account
            const createNullifierIx = SystemProgram.createAccount({
                fromPubkey: processooor.publicKey,
                newAccountPubkey: nullifierPDA,
                space: NULLIFIER_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(NULLIFIER_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            // Create withdraw instruction
            const withdrawIx = helpers.createWithdrawInstruction(
                poolAccount.publicKey,
                nullifierPDA,
                processooor.publicKey,
                proofData,
                withdrawalData
            );

            // Note: In production, proof verification would fail with dummy data
            // This test structure shows how the flow would work with real proofs
        });
    });

    describe('Ragequit Flow', () => {
        let commitmentSecret;
        let commitmentHash;
        let nullifierHash;
        let label;
        let depositValue;
        let depositorPDA;

        beforeEach(async () => {
            // Initialize pool
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(PRIVACY_POOL_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                20
            );

            const tx = new Transaction().add(createAccountIx, initializeIx);
            await svm.sendTransaction(tx, [entrypointAuthority, poolAccount]);

            // Make a deposit
            label = Buffer.alloc(32);
            label.write('ragequit-test');
            commitmentSecret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            depositValue = 1000000;
            commitmentHash = helpers.generateCommitment(label, commitmentSecret, depositValue);
            nullifierHash = helpers.generateNullifier(commitmentHash, commitmentSecret);

            [depositorPDA] = helpers.findDepositorPDA(
                poolAccount.publicKey,
                depositor1.publicKey,
                label
            );

            const createDepositorIx = SystemProgram.createAccount({
                fromPubkey: depositor1.publicKey,
                newAccountPubkey: depositorPDA,
                space: DEPOSITOR_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const depositIx = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA,
                depositor1.publicKey,
                commitmentHash,
                label,
                depositValue
            );

            const depositTx = new Transaction().add(createDepositorIx, depositIx);
            await svm.sendTransaction(depositTx, [depositor1]);
        });

        it('should allow ragequit from the pool', async () => {
            // Note: In a real test, we would generate actual ZK proofs
            const proofData = {
                proofA: Buffer.alloc(64, 4),
                proofB: Buffer.alloc(128, 5),
                proofC: Buffer.alloc(64, 6),
                publicSignals: [
                    Buffer.from(depositValue.toString(16).padStart(64, '0'), 'hex'), // value
                    label, // label
                    commitmentHash, // commitment_hash
                    nullifierHash, // nullifier_hash
                ],
            };

            // Find nullifier PDA
            const [nullifierPDA] = helpers.findNullifierPDA(
                poolAccount.publicKey,
                nullifierHash
            );

            // Create nullifier account
            const createNullifierIx = SystemProgram.createAccount({
                fromPubkey: depositor1.publicKey,
                newAccountPubkey: nullifierPDA,
                space: NULLIFIER_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(NULLIFIER_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            // Create ragequit instruction
            const ragequitIx = helpers.createRagequitInstruction(
                poolAccount.publicKey,
                nullifierPDA,
                depositorPDA,
                depositor1.publicKey,
                proofData
            );

            // Note: In production, proof verification would fail with dummy data
            // This test structure shows how the flow would work with real proofs
        });
    });

    describe('Wind Down Flow', () => {
        beforeEach(async () => {
            // Initialize pool
            const createAccountIx = SystemProgram.createAccount({
                fromPubkey: entrypointAuthority.publicKey,
                newAccountPubkey: poolAccount.publicKey,
                space: PRIVACY_POOL_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(PRIVACY_POOL_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const initializeIx = helpers.createInitializeInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey,
                assetMint.publicKey,
                20
            );

            const tx = new Transaction().add(createAccountIx, initializeIx);
            await svm.sendTransaction(tx, [entrypointAuthority, poolAccount]);
        });

        it('should wind down the pool', async () => {
            // Create wind down instruction
            const windDownIx = helpers.createWindDownInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey
            );

            // Send transaction
            const tx = new Transaction().add(windDownIx);
            const signature = await svm.sendTransaction(tx, [entrypointAuthority]);
            
            expect(signature).to.not.be.null;

            // Note: Would verify pool state is marked as dead
        });

        it('should fail to wind down with wrong authority', async () => {
            // Try to wind down with non-authority account
            const windDownIx = helpers.createWindDownInstruction(
                poolAccount.publicKey,
                depositor1.publicKey
            );

            const tx = new Transaction().add(windDownIx);
            
            try {
                await svm.sendTransaction(tx, [depositor1]);
                expect.fail('Transaction should have failed');
            } catch (err) {
                expect(err.message).to.include('authority');
            }
        });
    });
});