/**
 * Fee Withdrawal Instruction Tests (P2)
 *
 * Tests the WithdrawFees instruction to verify:
 * - Fee collector can withdraw accumulated fees
 * - Fees are transferred to fee collector's token account
 * - Pool state accumulated_fees is decremented correctly
 * - Partial withdrawals work correctly
 * - Cannot withdraw more than accumulated
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
const { getAccount } = require('@solana/spl-token');

describe('Fee Withdrawal Instruction Tests', function() {
    this.timeout(180000); // 3 minutes

    let context, pool;
    let allDeposits = []; // Track deposits for merkle tree

    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    // Helper to generate accumulated fees
    async function generateFees(numWithdrawals = 2) {
        const depositAmount = BigInt(1 * LAMPORTS_PER_SOL);
        const depositSpecs = [];

        for (let i = 0; i < numWithdrawals; i++) {
            const user = Keypair.generate();
            await context.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
            depositSpecs.push({ user, amount: depositAmount });
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        const newDeposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            depositSpecs,
            pool.scope
        );
        allDeposits.push(...newDeposits);

        let poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );

        // Perform withdrawals to generate fees
        for (const depositInfo of newDeposits) {
            const recipient = Keypair.generate();
            const processor = Keypair.generate();
            await context.connection.requestAirdrop(processor.publicKey, 10 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 500));

            const withdrawResult = await withdraw(
                context.connection,
                pool.poolStateAccount,
                depositInfo,
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
    }

    it('should allow fee collector to withdraw accumulated fees', async function() {
        console.log('\n  💸 Test: Fee Collector Withdrawal');

        // Generate fees
        console.log('  Generating fees through withdrawals...');
        await generateFees(2);

        // Get accumulated fees
        const feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        console.log(`  Accumulated fees: ${feeInfo.accumulated_fees}`);
        expect(feeInfo.accumulated_fees).to.be.greaterThan(0);

        // Fee collector is the authority (default)
        const feeCollector = context.authority;
        const poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );

        // Get fee collector token account
        const { getAssociatedTokenAddress } = require('@solana/spl-token');
        const collectorTokenAccount = await getAssociatedTokenAddress(
            poolState.asset_mint,
            feeCollector.publicKey
        );

        let balanceBefore = 0;
        try {
            const accountInfo = await getAccount(context.connection, collectorTokenAccount);
            balanceBefore = Number(accountInfo.amount);
        } catch (e) {
            // Account doesn't exist yet
        }

        console.log(`  Fee collector balance before: ${balanceBefore}`);

        // Withdraw fees
        const amountToWithdraw = feeInfo.accumulated_fees;
        console.log(`  Withdrawing ${amountToWithdraw} lamports...`);

        const txSig = await withdrawFees(
            context.connection,
            pool.poolStateAccount,
            feeCollector,
            BigInt(amountToWithdraw)
        );

        console.log(`  Transaction: ${txSig}`);

        // Verify fee collector received funds
        const accountInfo = await getAccount(context.connection, collectorTokenAccount);
        const balanceAfter = Number(accountInfo.amount);
        const amountReceived = balanceAfter - balanceBefore;

        console.log(`  Fee collector balance after: ${balanceAfter}`);
        console.log(`  Amount received: ${amountReceived}`);

        expect(amountReceived).to.equal(amountToWithdraw);

        // Verify accumulated fees decreased
        const updatedFeeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        console.log(`  Remaining accumulated fees: ${updatedFeeInfo.accumulated_fees}`);
        expect(updatedFeeInfo.accumulated_fees).to.equal(0);

        console.log('  ✅ Fee withdrawal successful');
    });

    it('should allow partial fee withdrawals', async function() {
        console.log('\n  💸 Test: Partial Fee Withdrawal');

        // Generate more fees
        console.log('  Generating fees...');
        await generateFees(2);

        const feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        const totalFees = feeInfo.accumulated_fees;
        console.log(`  Total accumulated fees: ${totalFees}`);

        // Withdraw half
        const amountToWithdraw = Math.floor(totalFees / 2);
        console.log(`  Withdrawing partial amount: ${amountToWithdraw}`);

        await withdrawFees(
            context.connection,
            pool.poolStateAccount,
            context.authority,
            BigInt(amountToWithdraw)
        );

        // Verify remaining fees
        const updatedFeeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        const remainingFees = updatedFeeInfo.accumulated_fees;
        console.log(`  Remaining accumulated fees: ${remainingFees}`);

        expect(remainingFees).to.equal(totalFees - amountToWithdraw);

        // Withdraw the rest
        console.log(`  Withdrawing remaining: ${remainingFees}`);
        await withdrawFees(
            context.connection,
            pool.poolStateAccount,
            context.authority,
            BigInt(remainingFees)
        );

        // Verify all fees withdrawn
        const finalFeeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        console.log(`  Final accumulated fees: ${finalFeeInfo.accumulated_fees}`);
        expect(finalFeeInfo.accumulated_fees).to.equal(0);

        console.log('  ✅ Partial withdrawals work correctly');
    });

    it('should fail when withdrawing more than accumulated', async function() {
        console.log('\n  💸 Test: Excessive Withdrawal Attempt');

        // Generate fees
        await generateFees(1);

        const feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        const totalFees = feeInfo.accumulated_fees;
        console.log(`  Accumulated fees: ${totalFees}`);

        // Try to withdraw more than accumulated
        const excessiveAmount = totalFees + 1_000_000;
        console.log(`  Attempting to withdraw: ${excessiveAmount} (more than available)`);

        try {
            await withdrawFees(
                context.connection,
                pool.poolStateAccount,
                context.authority,
                BigInt(excessiveAmount)
            );
            expect.fail('Should have thrown InsufficientFunds error');
        } catch (error) {
            console.log('  ✅ Transaction failed as expected');
            console.log(`  Error: ${error.message}`);
            // Solana returns custom error or InsufficientFunds
            expect(error.message).to.match(/InsufficientFunds|insufficient|failed/i);
        }

        // Verify fees unchanged
        const unchangedFeeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        expect(unchangedFeeInfo.accumulated_fees).to.equal(totalFees);

        console.log('  ✅ Excessive withdrawal correctly rejected');
    });

    it('should fail when no fees accumulated', async function() {
        console.log('\n  💸 Test: Withdrawal With No Fees');

        // Ensure fees are at zero (withdraw any existing)
        let feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        if (feeInfo.accumulated_fees > 0) {
            await withdrawFees(
                context.connection,
                pool.poolStateAccount,
                context.authority,
                BigInt(feeInfo.accumulated_fees)
            );
        }

        // Verify zero fees
        feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        console.log(`  Accumulated fees: ${feeInfo.accumulated_fees}`);
        expect(feeInfo.accumulated_fees).to.equal(0);

        // Try to withdraw 1 lamport
        console.log('  Attempting to withdraw 1 lamport...');
        try {
            await withdrawFees(
                context.connection,
                pool.poolStateAccount,
                context.authority,
                BigInt(1)
            );
            expect.fail('Should have thrown InsufficientFunds error');
        } catch (error) {
            console.log('  ✅ Transaction failed as expected');
            console.log(`  Error: ${error.message}`);
            expect(error.message).to.match(/InsufficientFunds|insufficient|failed/i);
        }

        console.log('  ✅ Withdrawal with no fees correctly rejected');
    });

    it('should handle multiple sequential withdrawals', async function() {
        console.log('\n  💸 Test: Multiple Sequential Withdrawals');

        // Generate fees
        console.log('  Generating fees...');
        await generateFees(3);

        let feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
        console.log(`  Initial accumulated fees: ${feeInfo.accumulated_fees}`);

        // Withdraw in 3 chunks
        const chunk = Math.floor(feeInfo.accumulated_fees / 3);
        for (let i = 1; i <= 3; i++) {
            console.log(`\n  Withdrawal ${i}/3:`);
            const amountToWithdraw = Math.min(chunk, feeInfo.accumulated_fees);
            console.log(`    Withdrawing: ${amountToWithdraw}`);

            await withdrawFees(
                context.connection,
                pool.poolStateAccount,
                context.authority,
                BigInt(amountToWithdraw)
            );

            feeInfo = await getAccumulatedFees(context.connection, pool.poolStateAccount);
            console.log(`    Remaining: ${feeInfo.accumulated_fees}`);
        }

        // Verify all fees withdrawn (or very close due to rounding)
        console.log(`  Final accumulated fees: ${feeInfo.accumulated_fees}`);
        expect(feeInfo.accumulated_fees).to.be.lessThan(chunk);

        console.log('  ✅ Multiple sequential withdrawals work correctly');
    });
});
