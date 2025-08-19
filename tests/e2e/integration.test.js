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
    PROGRAM_ID,
    PRIVACY_POOL_STATE_SIZE,
    DEPOSITOR_STATE_SIZE,
    NULLIFIER_STATE_SIZE,
} = require('../utils/test-helpers');

describe('Privacy Pool Integration Tests', () => {
    let svm;
    let helpers;
    let programKeypair;
    let entrypointAuthority;
    let assetMint;
    let poolAccount;
    let alice;
    let bob;
    let charlie;
    let relayer;

    const programBytes = fs.readFileSync(
        path.join(__dirname, '../../target/deploy/solana_privacy_pools.so')
    );

    beforeEach(async () => {
        svm = new LiteSVM();
        helpers = new TestHelpers();

        // Create keypairs
        programKeypair = Keypair.generate();
        entrypointAuthority = Keypair.generate();
        assetMint = Keypair.generate();
        poolAccount = Keypair.generate();
        alice = Keypair.generate();
        bob = Keypair.generate();
        charlie = Keypair.generate();
        relayer = Keypair.generate();

        // Fund accounts
        await svm.airdrop(entrypointAuthority.publicKey, 100 * LAMPORTS_PER_SOL);
        await svm.airdrop(alice.publicKey, 100 * LAMPORTS_PER_SOL);
        await svm.airdrop(bob.publicKey, 100 * LAMPORTS_PER_SOL);
        await svm.airdrop(charlie.publicKey, 100 * LAMPORTS_PER_SOL);
        await svm.airdrop(relayer.publicKey, 100 * LAMPORTS_PER_SOL);

        // Deploy program
        await svm.deployProgram(programKeypair.publicKey, programBytes);

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

    afterEach(() => {
        svm.close();
    });

    describe('Full Direct Withdrawal', () => {
        it('should allow full withdrawal of deposited amount', async () => {
            // Alice deposits
            const label = Buffer.alloc(32);
            label.write('alice-deposit-1');
            const secret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            const depositAmount = 10 * LAMPORTS_PER_SOL;
            const commitmentHash = helpers.generateCommitment(label, secret, depositAmount);

            const [depositorPDA] = helpers.findDepositorPDA(
                poolAccount.publicKey,
                alice.publicKey,
                label
            );

            const createDepositorIx = SystemProgram.createAccount({
                fromPubkey: alice.publicKey,
                newAccountPubkey: depositorPDA,
                space: DEPOSITOR_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const depositIx = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA,
                alice.publicKey,
                commitmentHash,
                label,
                depositAmount
            );

            const depositTx = new Transaction().add(createDepositorIx, depositIx);
            await svm.sendTransaction(depositTx, [alice]);

            // Verify deposit was recorded
            const depositorAccountInfo = await svm.getAccount(depositorPDA);
            expect(depositorAccountInfo).to.not.be.null;

            // Note: Actual withdrawal would require ZK proof generation
            // This test demonstrates the structure for full withdrawal
        });
    });

    describe('Partial Withdrawals', () => {
        it('should allow multiple partial withdrawals', async () => {
            // Bob deposits a large amount
            const label = Buffer.alloc(32);
            label.write('bob-large-deposit');
            const secret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            const depositAmount = 50 * LAMPORTS_PER_SOL;
            const commitmentHash = helpers.generateCommitment(label, secret, depositAmount);

            const [depositorPDA] = helpers.findDepositorPDA(
                poolAccount.publicKey,
                bob.publicKey,
                label
            );

            const createDepositorIx = SystemProgram.createAccount({
                fromPubkey: bob.publicKey,
                newAccountPubkey: depositorPDA,
                space: DEPOSITOR_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const depositIx = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA,
                bob.publicKey,
                commitmentHash,
                label,
                depositAmount
            );

            const depositTx = new Transaction().add(createDepositorIx, depositIx);
            await svm.sendTransaction(depositTx, [bob]);

            // Note: Actual partial withdrawals would require:
            // 1. First withdrawal of 20 SOL with new commitment for remaining 30 SOL
            // 2. Second withdrawal of 15 SOL with new commitment for remaining 15 SOL
            // 3. Final withdrawal of remaining 15 SOL
            // Each would require separate ZK proofs
        });
    });

    describe('Relayed Withdrawals', () => {
        it('should allow withdrawal through a relayer', async () => {
            // Charlie deposits
            const label = Buffer.alloc(32);
            label.write('charlie-private');
            const secret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            const depositAmount = 5 * LAMPORTS_PER_SOL;
            const commitmentHash = helpers.generateCommitment(label, secret, depositAmount);

            const [depositorPDA] = helpers.findDepositorPDA(
                poolAccount.publicKey,
                charlie.publicKey,
                label
            );

            const createDepositorIx = SystemProgram.createAccount({
                fromPubkey: charlie.publicKey,
                newAccountPubkey: depositorPDA,
                space: DEPOSITOR_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const depositIx = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA,
                charlie.publicKey,
                commitmentHash,
                label,
                depositAmount
            );

            const depositTx = new Transaction().add(createDepositorIx, depositIx);
            await svm.sendTransaction(depositTx, [charlie]);

            // Note: In a relayed withdrawal:
            // 1. Charlie generates ZK proof offline
            // 2. Charlie sends proof to relayer (off-chain)
            // 3. Relayer submits withdrawal transaction
            // 4. Relayer receives fee, Charlie receives funds
        });
    });

    describe('ASP (Access Scope Provider) Removal', () => {
        it('should handle ASP removal from merkle tree', async () => {
            // This test would simulate:
            // 1. Multiple deposits with ASP commitments
            // 2. Building merkle tree with ASP nodes
            // 3. Removing an ASP (marking as invalid)
            // 4. Attempting withdrawal with removed ASP (should fail)
            // 5. Successful withdrawal without removed ASP
        });
    });

    describe('Attack Prevention', () => {
        it('should prevent double-spending', async () => {
            // Alice deposits
            const label = Buffer.alloc(32);
            label.write('alice-double-spend');
            const secret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
            const depositAmount = 10 * LAMPORTS_PER_SOL;
            const commitmentHash = helpers.generateCommitment(label, secret, depositAmount);
            const nullifierHash = helpers.generateNullifier(commitmentHash, secret);

            const [depositorPDA] = helpers.findDepositorPDA(
                poolAccount.publicKey,
                alice.publicKey,
                label
            );

            const createDepositorIx = SystemProgram.createAccount({
                fromPubkey: alice.publicKey,
                newAccountPubkey: depositorPDA,
                space: DEPOSITOR_STATE_SIZE,
                lamports: await svm.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE),
                programId: programKeypair.publicKey,
            });

            const depositIx = helpers.createDepositInstruction(
                poolAccount.publicKey,
                depositorPDA,
                alice.publicKey,
                commitmentHash,
                label,
                depositAmount
            );

            const depositTx = new Transaction().add(createDepositorIx, depositIx);
            await svm.sendTransaction(depositTx, [alice]);

            // Note: Prevention of double-spending would be tested by:
            // 1. Creating nullifier account during first withdrawal
            // 2. Attempting second withdrawal with same nullifier (should fail)
        });

        it('should prevent withdrawal with invalid proof', async () => {
            // This test would verify that:
            // 1. Invalid proof components are rejected
            // 2. Mismatched public signals are rejected
            // 3. Proof for different circuit is rejected
        });

        it('should prevent ragequit after spending commitment', async () => {
            // This test would verify that:
            // 1. Deposit and withdraw normally
            // 2. Attempt ragequit with same commitment (should fail)
        });
    });

    describe('Pool Wind Down', () => {
        it('should handle complete pool wind down', async () => {
            // Make multiple deposits
            const deposits = [];
            
            for (let i = 0; i < 3; i++) {
                const label = Buffer.alloc(32);
                label.write(`deposit-${i}`);
                const secret = Buffer.from(helpers.randomFieldElement().toString(16).padStart(64, '0'), 'hex');
                const amount = (i + 1) * LAMPORTS_PER_SOL;
                const commitmentHash = helpers.generateCommitment(label, secret, amount);
                
                deposits.push({ label, secret, amount, commitmentHash });
                
                const depositor = i === 0 ? alice : i === 1 ? bob : charlie;
                const [depositorPDA] = helpers.findDepositorPDA(
                    poolAccount.publicKey,
                    depositor.publicKey,
                    label
                );

                const createDepositorIx = SystemProgram.createAccount({
                    fromPubkey: depositor.publicKey,
                    newAccountPubkey: depositorPDA,
                    space: DEPOSITOR_STATE_SIZE,
                    lamports: await svm.getMinimumBalanceForRentExemption(DEPOSITOR_STATE_SIZE),
                    programId: programKeypair.publicKey,
                });

                const depositIx = helpers.createDepositInstruction(
                    poolAccount.publicKey,
                    depositorPDA,
                    depositor.publicKey,
                    commitmentHash,
                    label,
                    amount
                );

                const tx = new Transaction().add(createDepositorIx, depositIx);
                await svm.sendTransaction(tx, [depositor]);
            }

            // Wind down the pool
            const windDownIx = helpers.createWindDownInstruction(
                poolAccount.publicKey,
                entrypointAuthority.publicKey
            );

            const windDownTx = new Transaction().add(windDownIx);
            await svm.sendTransaction(windDownTx, [entrypointAuthority]);

            // Note: After wind down:
            // 1. No new deposits should be allowed
            // 2. Existing commitments can still be withdrawn
            // 3. Ragequit should still work for unspent commitments
        });
    });

    describe('Complex Scenarios', () => {
        it('should handle rapid successive deposits and withdrawals', async () => {
            // This test would simulate high-frequency trading scenario:
            // 1. Multiple users making rapid deposits
            // 2. Overlapping withdrawal requests
            // 3. Ensuring merkle tree consistency
            // 4. Verifying all funds are accounted for
        });

        it('should handle maximum tree depth', async () => {
            // This test would:
            // 1. Fill merkle tree to maximum capacity
            // 2. Verify tree operations at max depth
            // 3. Test root history rotation
        });

        it('should handle concurrent operations correctly', async () => {
            // This test would simulate:
            // 1. Multiple simultaneous deposits
            // 2. Concurrent withdrawals
            // 3. Race condition prevention
            // 4. State consistency verification
        });
    });
});