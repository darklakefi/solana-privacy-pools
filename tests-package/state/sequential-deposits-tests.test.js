/**
 * Sequential Deposits Tests
 *
 * Tests multiple sequential deposits from different users to verify:
 * - Nonce management and increments
 * - Tree growth and root updates
 * - State integrity across many operations
 */
const { expect } = require('chai');
const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    WSOL_MINT,
    initializePool,
    parsePoolState,
} = require('@solana-privacy-pools/client');
const { setupTestContext } = require('../security/helpers/test-setup');
const { createDeposits } = require('../security/helpers/test-setup');

describe('Sequential Deposits Tests', function() {
    this.timeout(180000); // 3 minutes for many deposits

    let context;
    let pool;

    before(async function() {
        context = await setupTestContext();

        // Initialize pool
        pool = await initializePool(context.connection, context.authority, WSOL_MINT);
    });

    it('should handle 10+ sequential deposits with correct nonce increments', async function() {
        console.log('\n  📥 Test: 10+ Sequential Deposits');

        // Create 12 different users
        const users = [];
        for (let i = 0; i < 12; i++) {
            const user = Keypair.generate();
            await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
            users.push(user);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get initial pool state
        let poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        const initialNonce = poolState.nonce;
        const initialStateTreeSize = poolState.stateTree.size;
        const initialAspTreeSize = poolState.aspTree.size;

        console.log(`  Initial state: nonce=${initialNonce}, stateTree=${initialStateTreeSize}, aspTree=${initialAspTreeSize}`);

        // Create deposits with varying amounts
        const depositSpecs = users.map((user, i) => ({
            user,
            amount: BigInt((i + 1) * LAMPORTS_PER_SOL) // 1 SOL, 2 SOL, 3 SOL, ...
        }));

        const deposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            depositSpecs,
            pool.scope
        );

        console.log(`  ✅ Created ${deposits.length} deposits`);

        // Verify all deposits were created
        expect(deposits).to.have.lengthOf(12);

        // Get final pool state
        poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        const finalNonce = poolState.nonce;
        const finalStateTreeSize = poolState.stateTree.size;
        const finalAspTreeSize = poolState.aspTree.size;

        console.log(`  Final state: nonce=${finalNonce}, stateTree=${finalStateTreeSize}, aspTree=${finalAspTreeSize}`);

        // Verify nonce incremented by number of deposits
        expect(finalNonce).to.equal(initialNonce + 12);

        // Verify state tree grew by number of deposits
        expect(finalStateTreeSize).to.equal(initialStateTreeSize + 12);

        // Verify ASP tree grew by number of deposits (all have labels)
        expect(finalAspTreeSize).to.equal(initialAspTreeSize + 12);

        // Verify each deposit has correct nonce
        for (let i = 0; i < deposits.length; i++) {
            expect(deposits[i].nonce).to.equal(i);
        }

        // Verify each deposit has unique commitment
        const commitments = new Set(deposits.map(d => d.commitment.toString('hex')));
        expect(commitments.size).to.equal(12);

        // Verify each deposit has unique label (since nonces are sequential)
        const labels = new Set(deposits.map(d => d.label.toString()));
        expect(labels.size).to.equal(12);

        console.log('  ✅ All nonces, commitments, and labels are unique');
        console.log(`  ✅ State tree size increased by ${finalStateTreeSize - initialStateTreeSize}`);
        console.log(`  ✅ ASP tree size increased by ${finalAspTreeSize - initialAspTreeSize}`);
    });
});
