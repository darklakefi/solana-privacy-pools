/**
 * Minimal withdrawal test to validate root validation approach
 *
 * This test validates that:
 * 1. We can track commitments locally
 * 2. Local tree roots match on-chain roots
 * 3. Withdrawals work with root validation
 */
const { expect } = require('chai');
const { LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { setupTestContext, setupPool, createDeposits, WSOL_MINT } = require('./helpers/test-setup');
const { buildMerkleTrees, validateTreeRoots } = require('@solana-privacy-pools/client/merkle');
const { withdrawSimple } = require('@solana-privacy-pools/client/withdraw');

describe('Minimal Withdrawal Test - Root Validation', () => {
    let context;
    let pool;
    let deposits;

    const SMALL = BigInt(1 * LAMPORTS_PER_SOL);
    const MEDIUM = BigInt(5 * LAMPORTS_PER_SOL);

    before(async function() {
        this.timeout(120000); // 2 minutes for setup

        console.log('\n🧪 Setting up minimal withdrawal test...');
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);

        // Create two deposits
        console.log('\n📥 Creating deposits...');
        deposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            [
                { user: context.users.alice, amount: MEDIUM },
                { user: context.users.bob, amount: SMALL }
            ],
            pool.scope
        );

        console.log(`  ✓ Created ${deposits.length} deposits`);
    });

    it('should validate that local tree roots match on-chain after deposits', async function() {
        this.timeout(60000); // 1 minute

        console.log('\n✅ Test: Validate roots after deposits');

        // Build local trees from deposits
        const { stateTree, aspTree } = await buildMerkleTrees(deposits);

        console.log(`  Local trees built: state=${stateTree.size}, asp=${aspTree.size}`);

        // Validate against on-chain state
        const onchainInfo = await validateTreeRoots(
            context.connection,
            pool.poolStateAccount,
            stateTree,
            aspTree
        );

        expect(onchainInfo.onchainStateSize).to.equal(stateTree.size);
        expect(onchainInfo.onchainAspSize).to.equal(aspTree.size);
    });

    it('should successfully withdraw and validate roots match after withdrawal', async function() {
        this.timeout(60000); // 1 minute

        console.log('\n✅ Test: Withdraw and validate roots');

        // Withdraw partial amount from Alice's deposit
        const withdrawAmount = BigInt(2 * LAMPORTS_PER_SOL); // Withdraw 2 SOL from 5 SOL deposit
        const aliceDeposit = deposits[0];

        console.log(`  Withdrawing ${withdrawAmount / BigInt(LAMPORTS_PER_SOL)} SOL from ${MEDIUM / BigInt(LAMPORTS_PER_SOL)} SOL deposit...`);

        // Perform withdrawal (this returns the new commitment)
        const withdrawResult = await withdrawSimple(
            context.connection,
            pool.poolStateAccount,
            context.users.alice,
            aliceDeposit,
            deposits, // All commitments for merkle tree
            WSOL_MINT,
            withdrawAmount
        );

        console.log(`  ✓ Withdrawal successful, new commitment: ${withdrawResult.newCommitment.toString('hex').slice(0, 16)}...`);

        // Add new withdrawal commitment to our local tracking
        const updatedDeposits = [
            ...deposits,
            {
                commitment: withdrawResult.newCommitment,
                label: null, // Withdrawal commitments have null label (reuse existing label)
                value: null, // We don't know the exact value but it doesn't matter for tree building
            }
        ];

        // Build trees with updated commitments
        const { stateTree, aspTree } = await buildMerkleTrees(updatedDeposits);

        console.log(`  Local trees rebuilt: state=${stateTree.size}, asp=${aspTree.size}`);

        // Validate roots still match
        const onchainInfo = await validateTreeRoots(
            context.connection,
            pool.poolStateAccount,
            stateTree,
            aspTree
        );

        console.log(`  ✓ Roots match after withdrawal!`);

        expect(onchainInfo.onchainStateSize).to.equal(stateTree.size);
        expect(onchainInfo.onchainAspSize).to.equal(aspTree.size);
    });
});
