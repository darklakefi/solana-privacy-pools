/**
 * Deposit Validation Tests (P2)
 *
 * Tests for deposit amount boundaries and validation.
 */

const { expect } = require('chai');
const { Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Test helpers
const {
    setupTestContext,
    setupPool,
    createDeposits,
} = require('../security/helpers/test-setup');

const {
    expectTransactionFailure,
} = require('../security/helpers/error-assertions');

describe('Deposit Validation Tests', function() {
    this.timeout(120000);

    let context, pool;

    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    describe('Amount Boundaries', function() {

        it('should reject zero amount deposit', async function() {
            console.log('\n  💰 Test: Zero Amount Deposit');

            const user = Keypair.generate();
            await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            console.log('  ✓ User created with funds');

            // Try to deposit 0 lamports (should fail)
            await expectTransactionFailure(async () => {
                await createDeposits(
                    context.connection,
                    pool.poolStateAccount,
                    [{ user, amount: 0n }],
                    pool.scope
                );
            }, 'Cannot deposit zero');

            console.log('  ✓ Zero deposit correctly rejected');
        });

        it('should accept minimum valid deposit (1 lamport)', async function() {
            console.log('\n  💰 Test: Minimum Valid Deposit');

            const user = Keypair.generate();
            await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            console.log('  ✓ User created with funds');

            // Deposit 1 lamport (smallest valid amount)
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user, amount: 1n }],
                pool.scope
            );

            expect(deposits).to.have.lengthOf(1);
            expect(deposits[0].value).to.equal(1n);

            console.log('  ✓ 1 lamport deposit accepted');
            console.log(`  ✓ Commitment: ${deposits[0].commitment.toString('hex').slice(0, 32)}...`);
        });

        it('should accept large deposit amount', async function() {
            console.log('\n  💰 Test: Large Deposit Amount');

            const user = Keypair.generate();
            await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            console.log('  ✓ User created with funds');

            // Deposit 50 SOL (large but valid)
            const largeAmount = BigInt(50 * LAMPORTS_PER_SOL);
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [{ user, amount: largeAmount }],
                pool.scope
            );

            expect(deposits).to.have.lengthOf(1);
            expect(deposits[0].value).to.equal(largeAmount);

            console.log(`  ✓ ${largeAmount / BigInt(LAMPORTS_PER_SOL)} SOL deposit accepted`);
            console.log(`  ✓ Commitment: ${deposits[0].commitment.toString('hex').slice(0, 32)}...`);
        });
    });
});
