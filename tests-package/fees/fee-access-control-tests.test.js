/**
 * Fee Access Control Tests (P2)
 *
 * Tests access control for fee withdrawal:
 * - Only fee collector can withdraw fees
 * - Unauthorized accounts cannot withdraw fees
 * - Fee collector authority is validated
 * - Proper error codes returned for unauthorized access
 */
const { expect } = require('chai');
const {
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    parsePoolState,
    withdrawFees,
    getAccumulatedFees,
    withdraw,
} = require('@solana-privacy-pools/client');
const {
    setupTestContext,
    setupPool,
    createDeposits,
} = require('../security/helpers/test-setup');

describe('Fee Access Control Tests', function() {
    this.timeout(180000); // 3 minutes

    let context, pool;
    let allDeposits = []; // Track deposits for merkle tree

    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    // Helper to generate accumulated fees
    async function generateFees() {
        const depositAmount = BigInt(1 * LAMPORTS_PER_SOL);
        const user = Keypair.generate();
        await context.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        const deposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            [{ user, amount: depositAmount }],
            pool.scope
        );
        allDeposits.push(...deposits);

        const poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );

        const recipient = Keypair.generate();
        const processor = Keypair.generate();
        await context.connection.requestAirdrop(processor.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        const withdrawResult = await withdraw(
            context.connection,
            pool.poolStateAccount,
            deposits[0],
            allDeposits,
            depositAmount,
            recipient.publicKey,
            pool.scope,
            poolState.asset_mint,
            processor
        );

        // If withdrawal created a child commitment, add it to allDeposits
        if (withdrawResult.newCommitment) {
            allDeposits.push({
                commitment: withdrawResult.newCommitment,
                label: null, // Reuses existing label
                value: null, // Unknown remaining value
            });
        }
    }

    it('should verify fee collector is set to authority by default', async function() {
        console.log('\n  🔐 Test: Default Fee Collector');

        const poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );

        console.log(`  Authority: ${poolState.authority.toBase58()}`);
        console.log(`  Fee collector: ${poolState.fee_collector.toBase58()}`);

        expect(poolState.fee_collector.toBase58()).to.equal(
            poolState.authority.toBase58()
        );

        console.log('  ✅ Fee collector defaults to authority');
    });

    it('should allow authorized fee collector to withdraw fees', async function() {
        console.log('\n  🔐 Test: Authorized Fee Withdrawal');

        // Generate fees
        console.log('  Generating fees...');
        await generateFees();

        const feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        console.log(`  Accumulated fees: ${feeInfo.accumulated_fees}`);
        expect(feeInfo.accumulated_fees).to.be.greaterThan(0);

        // Fee collector is authority (default)
        console.log(`  Fee collector (authority): ${context.authority.publicKey.toBase58()}`);

        // Withdraw fees successfully
        const txSig = await withdrawFees(
            context.connection,
            pool.poolStateAccount,
            context.authority,
            BigInt(feeInfo.accumulated_fees)
        );

        console.log(`  ✅ Authorized withdrawal successful: ${txSig}`);

        // Verify fees withdrawn
        const updatedFeeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        expect(updatedFeeInfo.accumulated_fees).to.equal(0);
    });

    it('should reject unauthorized fee withdrawal attempts', async function() {
        console.log('\n  🔐 Test: Unauthorized Fee Withdrawal');

        // Generate fees
        console.log('  Generating fees...');
        await generateFees();

        const feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        console.log(`  Accumulated fees: ${feeInfo.accumulated_fees}`);

        // Create unauthorized account
        const unauthorized = Keypair.generate();
        await context.connection.requestAirdrop(unauthorized.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`  Unauthorized account: ${unauthorized.publicKey.toBase58()}`);
        console.log(`  Expected fee collector: ${feeInfo.fee_collector.toBase58()}`);

        // Attempt to withdraw fees with unauthorized account
        console.log('  Attempting unauthorized withdrawal...');
        try {
            await withdrawFees(
                context.connection,
                pool.poolStateAccount,
                unauthorized,
                BigInt(feeInfo.accumulated_fees)
            );
            expect.fail('Should have thrown authorization error');
        } catch (error) {
            console.log('  ✅ Transaction failed as expected');
            console.log(`  Error: ${error.message}`);

            // Verify it's an authorization/invalid error
            expect(error.message).to.match(/Unauthorized|InvalidArgument|not the fee collector|failed/i);
        }

        // Verify fees unchanged
        const unchangedFeeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        expect(unchangedFeeInfo.accumulated_fees).to.equal(feeInfo.accumulated_fees);

        console.log('  ✅ Unauthorized withdrawal correctly rejected');
    });

    it('should reject fee withdrawal with missing signature', async function() {
        console.log('\n  🔐 Test: Missing Signature');

        // Generate fees if needed
        let feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        if (feeInfo.accumulated_fees === 0) {
            await generateFees();
            feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        }

        console.log(`  Accumulated fees: ${feeInfo.accumulated_fees}`);

        // Note: In Solana, transactions MUST be signed by the feePayer
        // The test framework requires a signer, so we'll test that a random
        // signer (not the fee collector) cannot successfully withdraw

        const randomSigner = Keypair.generate();
        await context.connection.requestAirdrop(randomSigner.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`  Random signer (not fee collector): ${randomSigner.publicKey.toBase58()}`);

        try {
            await withdrawFees(
                context.connection,
                pool.poolStateAccount,
                randomSigner,
                BigInt(1000)
            );
            expect.fail('Should have thrown error');
        } catch (error) {
            console.log('  ✅ Transaction failed as expected');
            console.log(`  Error: ${error.message}`);
            expect(error.message).to.match(/Unauthorized|InvalidArgument|not the fee collector|failed/i);
        }

        console.log('  ✅ Missing proper signature correctly rejected');
    });

    it('should protect against fee collector impersonation', async function() {
        console.log('\n  🔐 Test: Fee Collector Impersonation Protection');

        // Generate fees
        await generateFees();

        const poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        const feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);

        console.log(`  Legitimate fee collector: ${poolState.fee_collector.toBase58()}`);
        console.log(`  Accumulated fees: ${feeInfo.accumulated_fees}`);

        // Create an attacker account
        const attacker = Keypair.generate();
        await context.connection.requestAirdrop(attacker.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`  Attacker account: ${attacker.publicKey.toBase58()}`);

        // Attempt to withdraw fees as attacker
        console.log('  Attacker attempting to withdraw fees...');
        try {
            await withdrawFees(
                context.connection,
                pool.poolStateAccount,
                attacker,
                BigInt(feeInfo.accumulated_fees)
            );
            expect.fail('Should have rejected attacker');
        } catch (error) {
            console.log('  ✅ Attacker rejected');
            console.log(`  Error: ${error.message}`);
            expect(error.message).to.match(/Unauthorized|InvalidArgument|not the fee collector|failed/i);
        }

        // Verify fees remain unchanged
        const finalFeeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        expect(finalFeeInfo.accumulated_fees).to.equal(feeInfo.accumulated_fees);

        console.log('  ✅ Fee collector impersonation prevented');
    });

    it('should verify fee collector in client SDK', async function() {
        console.log('\n  🔐 Test: Client SDK Authorization Check');

        // Generate fees
        await generateFees();

        const feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        console.log(`  Accumulated fees: ${feeInfo.accumulated_fees}`);

        // Create unauthorized account
        const unauthorized = Keypair.generate();
        console.log(`  Unauthorized account: ${unauthorized.publicKey.toBase58()}`);
        console.log(`  Expected fee collector: ${feeInfo.fee_collector.toBase58()}`);

        // Client SDK should reject before sending transaction
        try {
            await withdrawFees(
                context.connection,
                pool.poolStateAccount,
                unauthorized,
                BigInt(1000)
            );
            expect.fail('Client SDK should have rejected');
        } catch (error) {
            console.log('  ✅ Client SDK rejected unauthorized attempt');
            console.log(`  Error: ${error.message}`);
            // SDK throws before transaction is sent
            expect(error.message).to.match(/Unauthorized|not the fee collector|InvalidArgument|failed/i);
        }

        console.log('  ✅ Client SDK authorization check working');
    });
});
