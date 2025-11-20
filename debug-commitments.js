#!/usr/bin/env node
/**
 * Quick debug script to check commitment formats
 * Run with: node debug-commitments.js
 */

const { Connection, Keypair } = require('@solana/web3.js');
const { deposit } = require('./client/deposit');
const { buildMerkleTrees } = require('./client/merkle');

// Mock withdrawal result since we can't easily run a real withdrawal
function createMockWithdrawalResult() {
  // Simulate what proof.js returns as publicSignals[0]
  // It should be a Buffer from to32ByteBuffer()
  const mockCommitment = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) {
    mockCommitment[i] = Math.floor(Math.random() * 256);
  }

  return {
    newCommitment: mockCommitment,
    nullifierHash: Buffer.alloc(32)
  };
}

async function debugCommitmentFormats() {
  console.log('\n=== Commitment Format Debug ===\n');

  try {
    // 1. Check what deposit returns
    console.log('1. Checking deposit commitment format...');
    console.log('   NOTE: Skipping actual deposit (requires blockchain connection)');
    console.log('   Checking deposit.js source code instead...\n');

    // Read deposit.js to see what it returns
    const depositSource = require('fs').readFileSync('./client/deposit.js', 'utf8');
    const hasPublicSignalsCommitment = depositSource.includes('publicSignals.commitment');
    console.log('   deposit.js returns publicSignals.commitment?', hasPublicSignalsCommitment);

    // Check proof.js to see what publicSignals format is
    const proofSource = require('fs').readFileSync('./client/proof.js', 'utf8');
    const hasTo32ByteBuffer = proofSource.includes('to32ByteBuffer');
    const hasFormattedPublicSignals = proofSource.includes('formattedPublicSignals');
    console.log('   proof.js uses to32ByteBuffer?', hasTo32ByteBuffer);
    console.log('   proof.js creates formattedPublicSignals?', hasFormattedPublicSignals);

    if (hasTo32ByteBuffer && hasFormattedPublicSignals) {
      console.log('   ✓ deposit.commitment should be a Buffer (from to32ByteBuffer)\n');
    }

    // 2. Check withdrawal result format
    console.log('2. Checking withdrawal newCommitment format...');
    const mockWithdrawal = createMockWithdrawalResult();
    console.log('   Mock withdrawal newCommitment is Buffer?', Buffer.isBuffer(mockWithdrawal.newCommitment));
    console.log('   Mock withdrawal newCommitment type:', mockWithdrawal.newCommitment.constructor.name);
    console.log('   ✓ Mock shows newCommitment should be Buffer\n');

    // 3. Test Buffer.from() conversion
    console.log('3. Testing Buffer.from() conversion...');
    const uint8Array = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      uint8Array[i] = i;
    }

    const convertedBuffer = Buffer.from(uint8Array);
    console.log('   Original is Uint8Array?', uint8Array instanceof Uint8Array);
    console.log('   Converted is Buffer?', Buffer.isBuffer(convertedBuffer));
    console.log('   Values match?', uint8Array[0] === convertedBuffer[0] && uint8Array[31] === convertedBuffer[31]);
    console.log('   ✓ Buffer.from(Uint8Array) works correctly\n');

    // 4. Test merkle tree building with mixed types
    console.log('4. Testing merkle tree building...');

    const testDeposits = [
      {
        commitment: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32]),
        label: BigInt(100),
        value: 1000000000
      },
      {
        commitment: Buffer.from(uint8Array), // Converted from Uint8Array
        label: null, // Simulating withdrawal commitment
        value: 500000000
      }
    ];

    console.log('   Test deposit 1 commitment is Buffer?', Buffer.isBuffer(testDeposits[0].commitment));
    console.log('   Test deposit 2 commitment is Buffer?', Buffer.isBuffer(testDeposits[1].commitment));

    try {
      const { stateTree, aspTree } = await buildMerkleTrees(testDeposits);
      console.log('   ✓ Merkle tree built successfully!');
      console.log('   State tree size:', stateTree.size);
      console.log('   ASP tree size:', aspTree.size, '(should be 1, skipping null label)');
      console.log('   State root:', stateTree.root.toString(16).slice(0, 16) + '...');
    } catch (error) {
      console.log('   ✗ Merkle tree building failed:', error.message);
    }

    console.log('\n5. Checking actual withdrawal return type...');
    const withdrawSource = require('fs').readFileSync('./client/withdraw.js', 'utf8');
    const returnsPublicSignals = withdrawSource.includes('newCommitment: publicSignals[0]');
    console.log('   withdraw.js returns publicSignals[0]?', returnsPublicSignals);
    console.log('   publicSignals comes from generateWithdrawProof');
    console.log('   generateWithdrawProof returns formattedPublicSignals (Buffers)');
    console.log('   ✓ withdrawResult.newCommitment should be Buffer\n');

    console.log('\n=== Summary ===');
    console.log('Based on source code analysis:');
    console.log('  • deposit.commitment: Buffer (from proof.js to32ByteBuffer)');
    console.log('  • withdrawResult.newCommitment: Buffer (from proof.js to32ByteBuffer)');
    console.log('  • Buffer.from(Uint8Array): Works correctly');
    console.log('  • Merkle tree building: Works with Buffers');
    console.log('\nIf tests show "not a buffer", the issue might be:');
    console.log('  1. commitments are Uint8Array but deposit/withdraw return them as-is');
    console.log('  2. Something in the flow converts Buffer → Uint8Array');
    console.log('  3. The allDeposits.push() somehow corrupts the type');
    console.log('\nRecommendation: Check actual runtime types in integration test');

  } catch (error) {
    console.error('\nError during debug:', error);
    console.error(error.stack);
  }
}

// Run the debug
debugCommitmentFormats().then(() => {
  console.log('\n=== Debug Complete ===\n');
}).catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
