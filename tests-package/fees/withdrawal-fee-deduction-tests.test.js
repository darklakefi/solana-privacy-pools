/**
 * Withdrawal Fee Deduction Tests (P2)
 *
 * Integration tests verifying that withdrawal fees are correctly:
 * - Deducted from withdrawal amounts
 * - Accumulated in pool state
 * - Transferred as net amount (gross - fee) to recipient
 */
const { expect } = require('chai');
const {
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    parsePoolState,
    calculateWithdrawalFee,
    withdraw,
} = require('@solana-privacy-pools/client');
const {
    setupTestContext,
    setupPool,
    createDeposits,
} = require('../security/helpers/test-setup');
const { getAccount } = require('@solana/spl-token');

describe('Withdrawal Fee Deduction Tests', function() {
    this.timeout(180000); // 3 minutes for proof generation

    let context, pool;
    let allDeposits = []; // Track deposits for merkle tree

    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    it('should deduct fee from withdrawal and accumulate it', async function() {
        console.log('\n  💰 Test: Fee Deduction and Accumulation');

        // Create a deposit
        const depositAmount = BigInt(1 * LAMPORTS_PER_SOL); // 1 SOL
        const user = Keypair.generate();
        await context.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log('  Creating deposit...');
        const deposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            [{ user, amount: depositAmount }],
            pool.scope
        );
        allDeposits.push(...deposits);

        // Get initial pool state
        let poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        const initialAccumulatedFees = poolState.accumulated_fees;
        console.log(`  Initial accumulated fees: ${initialAccumulatedFees}`);

        // Perform withdrawal to a separate recipient (privacy-preserving)
        const withdrawAmount = depositAmount; // Withdraw full amount
        const recipient = Keypair.generate();
        const processor = Keypair.generate(); // Different from depositor!

        // Fund the processor
        await context.connection.requestAirdrop(processor.publicKey, 10 * LAMPORTS_PER_SOL);
        await new Promise(resolve => setTimeout(resolve, 1000));

        console.log(`  Withdrawing ${Number(withdrawAmount)} lamports...`);
        console.log(`  Depositor: ${user.publicKey.toBase58().slice(0, 8)}...`);
        console.log(`  Recipient: ${recipient.publicKey.toBase58().slice(0, 8)}... (different!)`);
        console.log(`  Processor: ${processor.publicKey.toBase58().slice(0, 8)}...`);

        // Calculate expected fee
        const expectedFee = calculateWithdrawalFee(
            Number(withdrawAmount),
            poolState.withdrawal_fee_basis_points,
            poolState.withdrawal_fee_min
        );
        const expectedNetAmount = Number(withdrawAmount) - expectedFee;

        console.log(`  Expected gross amount: ${withdrawAmount}`);
        console.log(`  Expected fee (${poolState.withdrawal_fee_basis_points}bp): ${expectedFee}`);
        console.log(`  Expected net amount: ${expectedNetAmount}`);

        // Execute withdrawal
        const withdrawResult = await withdraw(
            context.connection,
            pool.poolStateAccount,
            deposits[0],
            allDeposits,
            withdrawAmount,
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

        console.log(`  Withdrawal transaction: ${withdrawResult.signature}`);

        // Verify accumulated fees increased
        poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        const finalAccumulatedFees = poolState.accumulated_fees;

        console.log(`  Final accumulated fees: ${finalAccumulatedFees}`);
        console.log(`  Fee increase: ${finalAccumulatedFees - initialAccumulatedFees}`);

        expect(finalAccumulatedFees - initialAccumulatedFees).to.equal(expectedFee);

        // Verify recipient received net amount
        const recipientTokenAccount = withdrawResult.recipientTokenAccount;
        const recipientAccountInfo = await getAccount(context.connection, recipientTokenAccount);
        const amountReceived = Number(recipientAccountInfo.amount);

        console.log(`  Amount received by recipient: ${amountReceived}`);
        expect(amountReceived).to.equal(expectedNetAmount);

        console.log('  ✅ Fee deduction and accumulation verified');
        console.log('  ✅ Privacy preserved: depositor ≠ recipient');
    });

    it('should accumulate fees from multiple withdrawals', async function() {
        console.log('\n  💰 Test: Multiple Withdrawal Fee Accumulation');

        // Get initial accumulated fees
        let poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        const initialAccumulatedFees = poolState.accumulated_fees;
        console.log(`  Initial accumulated fees: ${initialAccumulatedFees}`);

        // Create 3 deposits
        const depositAmount = BigInt(0.5 * LAMPORTS_PER_SOL);
        const depositSpecs = [];

        for (let i = 0; i < 3; i++) {
            const user = Keypair.generate();
            await context.connection.requestAirdrop(user.publicKey, 10 * LAMPORTS_PER_SOL);
            depositSpecs.push({ user, amount: depositAmount });
        }

        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('  Creating 3 deposits...');
        const newDeposits = await createDeposits(
            context.connection,
            pool.poolStateAccount,
            depositSpecs,
            pool.scope
        );
        allDeposits.push(...newDeposits);

        // Perform 3 withdrawals
        let totalExpectedFees = 0;

        for (let i = 0; i < 3; i++) {
            console.log(`\n  Withdrawal ${i + 1}/3:`);

            poolState = parsePoolState(
                (await context.connection.getAccountInfo(pool.poolStateAccount)).data
            );

            const expectedFee = calculateWithdrawalFee(
                Number(depositAmount),
                poolState.withdrawal_fee_basis_points,
                poolState.withdrawal_fee_min
            );
            totalExpectedFees += expectedFee;

            console.log(`    Withdrawal amount: ${depositAmount}`);
            console.log(`    Expected fee: ${expectedFee}`);

            const recipient = Keypair.generate();
            const processor = Keypair.generate();
            await context.connection.requestAirdrop(processor.publicKey, 10 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 500));

            const withdrawResult = await withdraw(
                context.connection,
                pool.poolStateAccount,
                newDeposits[i],
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

        // Verify total accumulated fees
        poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );
        const finalAccumulatedFees = poolState.accumulated_fees;
        const totalFeeIncrease = finalAccumulatedFees - initialAccumulatedFees;

        console.log(`\n  Initial accumulated fees: ${initialAccumulatedFees}`);
        console.log(`  Final accumulated fees: ${finalAccumulatedFees}`);
        console.log(`  Total fee increase: ${totalFeeIncrease}`);
        console.log(`  Expected total fees: ${totalExpectedFees}`);

        expect(totalFeeIncrease).to.equal(totalExpectedFees);
        console.log('  ✅ Multiple withdrawal fee accumulation verified');
    });

});
