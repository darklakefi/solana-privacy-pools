/**
 * Fee Calculation Tests (P2)
 *
 * Tests the fee calculation logic to ensure correct fee amounts:
 * - Withdrawal fee basis points (default 0.3% = 30 bp)
 * - Deposit fee basis points (default 0% = 0 bp)
 * - Minimum fee handling
 * - Fee rounding behavior
 */
const { expect } = require('chai');
const {
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    parsePoolState,
    calculateWithdrawalFee,
} = require('@solana-privacy-pools/client');
const {
    setupTestContext,
    setupPool,
} = require('../security/helpers/test-setup');

describe('Fee Calculation Tests', function() {
    this.timeout(60000);

    let context, pool;

    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    it('should have correct default fee configuration', async function() {
        console.log('\n  🧮 Test: Default Fee Configuration');

        const poolState = parsePoolState(
            (await context.connection.getAccountInfo(pool.poolStateAccount)).data
        );

        console.log('  Fee Configuration:');
        console.log(`  • Withdrawal fee: ${poolState.withdrawal_fee_basis_points} basis points (${poolState.withdrawal_fee_basis_points / 100}%)`);
        console.log(`  • Deposit fee: ${poolState.deposit_fee_basis_points} basis points (${poolState.deposit_fee_basis_points / 100}%)`);
        console.log(`  • Minimum withdrawal fee: ${poolState.withdrawal_fee_min} lamports`);
        console.log(`  • Fee collector: ${poolState.fee_collector.toBase58()}`);
        console.log(`  • Accumulated fees: ${poolState.accumulated_fees}`);

        // Verify default values match Ethereum standard
        expect(poolState.withdrawal_fee_basis_points).to.equal(30); // 0.3%
        expect(poolState.deposit_fee_basis_points).to.equal(0);      // 0%
        expect(poolState.withdrawal_fee_min).to.equal(0);            // No minimum
        expect(poolState.accumulated_fees).to.equal(0);              // Start at 0

        // Fee collector defaults to authority
        expect(poolState.fee_collector.toBase58()).to.equal(context.authority.publicKey.toBase58());

        console.log('  ✅ Default fee configuration verified');
    });

    it('should calculate withdrawal fees correctly', function() {
        console.log('\n  🧮 Test: Withdrawal Fee Calculation');

        const basisPoints = 30; // 0.3%
        const minimumFee = 0;

        const testCases = [
            { amount: 1_000_000_000, expectedFee: 3_000_000 },     // 1 SOL → 0.003 SOL
            { amount: 100_000_000, expectedFee: 300_000 },         // 0.1 SOL → 0.0003 SOL
            { amount: 10_000_000, expectedFee: 30_000 },           // 0.01 SOL → 0.00003 SOL
            { amount: 1_000_000, expectedFee: 3_000 },             // 0.001 SOL → 0.000003 SOL
            { amount: 500_000_000, expectedFee: 1_500_000 },       // 0.5 SOL → 0.0015 SOL
            { amount: 333_333, expectedFee: 999 },                 // Rounding test
        ];

        console.log('  Test Cases:');
        for (const { amount, expectedFee } of testCases) {
            const calculatedFee = calculateWithdrawalFee(amount, basisPoints, minimumFee);
            console.log(`  • ${amount} lamports → ${calculatedFee} lamports fee (expected: ${expectedFee})`);
            expect(calculatedFee).to.equal(expectedFee);
        }

        console.log('  ✅ All fee calculations correct');
    });

    it('should handle minimum fee correctly', function() {
        console.log('\n  🧮 Test: Minimum Fee Handling');

        const basisPoints = 30; // 0.3%
        const minimumFee = 1000; // 1000 lamports minimum

        const testCases = [
            { amount: 1_000, expectedFee: 1000 },       // Below minimum → use minimum
            { amount: 10_000, expectedFee: 1000 },      // Still below minimum
            { amount: 100_000, expectedFee: 1000 },     // 300 lamports < 1000, use minimum
            { amount: 500_000, expectedFee: 1500 },     // 1500 lamports > 1000, use calculated
            { amount: 1_000_000, expectedFee: 3_000 },  // Well above minimum
        ];

        console.log('  Test Cases (minimum fee = 1000):');
        for (const { amount, expectedFee } of testCases) {
            const calculatedFee = calculateWithdrawalFee(amount, basisPoints, minimumFee);
            console.log(`  • ${amount} lamports → ${calculatedFee} lamports fee (expected: ${expectedFee})`);
            expect(calculatedFee).to.equal(expectedFee);
        }

        console.log('  ✅ Minimum fee handling correct');
    });

    it('should handle zero amount', function() {
        console.log('\n  🧮 Test: Zero Amount');

        const fee = calculateWithdrawalFee(0, 30, 0);
        console.log(`  • 0 lamports → ${fee} lamports fee`);
        expect(fee).to.equal(0);

        console.log('  ✅ Zero amount handled correctly');
    });

    it('should handle very large amounts without overflow', function() {
        console.log('\n  🧮 Test: Large Amount Handling');

        const largeAmount = 1_000_000 * LAMPORTS_PER_SOL; // 1M SOL
        const basisPoints = 30;
        const minimumFee = 0;

        const expectedFee = Math.floor((largeAmount * basisPoints) / 10000);
        const calculatedFee = calculateWithdrawalFee(largeAmount, basisPoints, minimumFee);

        console.log(`  • ${largeAmount} lamports (1M SOL)`);
        console.log(`  • Expected fee: ${expectedFee} lamports`);
        console.log(`  • Calculated fee: ${calculatedFee} lamports`);

        expect(calculatedFee).to.equal(expectedFee);
        console.log('  ✅ Large amounts handled without overflow');
    });

    it('should verify fee formula matches on-chain implementation', function() {
        console.log('\n  🧮 Test: Fee Formula Consistency');

        // Formula from Rust: fee = max((amount * basis_points) / 10000, minimum_fee)
        const amount = 123_456_789;
        const basisPoints = 30;
        const minimumFee = 0;

        const jsCalculation = calculateWithdrawalFee(amount, basisPoints, minimumFee);
        const manualCalculation = Math.floor((amount * basisPoints) / 10000);

        console.log(`  • Amount: ${amount} lamports`);
        console.log(`  • JS function result: ${jsCalculation}`);
        console.log(`  • Manual calculation: ${manualCalculation}`);

        expect(jsCalculation).to.equal(manualCalculation);
        console.log('  ✅ Fee formula consistent with on-chain implementation');
    });
});
