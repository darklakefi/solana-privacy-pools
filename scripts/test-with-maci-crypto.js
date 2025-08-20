#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');
const { hashLeftRight, poseidon } = require('../../privacy-pools-core/node_modules/maci-crypto/build/ts/hashing.js');
const { LeanIMT } = require('@zk-kit/lean-imt');

// Path to the withdraw circuit artifacts
const CIRCUIT_DIR = path.join(__dirname, '../../privacy-pools-core/packages/circuits/build/withdraw');
const WASM_PATH = path.join(CIRCUIT_DIR, 'withdraw_js/withdraw.wasm');
const ZKEY_PATH = path.join(CIRCUIT_DIR, 'groth16_pkey.zkey');

// Helper to convert field element to little-endian bytes
function fieldToBytes(fieldStr) {
    const bigInt = BigInt(fieldStr);
    const bytes = [];
    let temp = bigInt;
    
    for (let i = 0; i < 32; i++) {
        bytes.push(Number(temp & 0xFFn));
        temp = temp >> 8n;
    }
    
    return bytes;
}

// Convert proof points to byte arrays
function proofToBytes(proof) {
    const proofA = [
        ...fieldToBytes(proof.pi_a[0]),
        ...fieldToBytes(proof.pi_a[1])
    ];
    
    const proofB = [
        ...fieldToBytes(proof.pi_b[0][0]),
        ...fieldToBytes(proof.pi_b[0][1]),
        ...fieldToBytes(proof.pi_b[1][0]),
        ...fieldToBytes(proof.pi_b[1][1])
    ];
    
    const proofC = [
        ...fieldToBytes(proof.pi_c[0]),
        ...fieldToBytes(proof.pi_c[1])
    ];
    
    return { proofA, proofB, proofC };
}

// Pad siblings array to required length
function padSiblings(siblings, maxDepth) {
    const padded = [...siblings];
    while (padded.length < maxDepth) {
        padded.push(BigInt(0));
    }
    return padded;
}

// Test with exactly the same hash function as circuit tests
async function testWithMaciCrypto() {
    console.log('=== Testing with maci-crypto hash function ===\n');
    
    // Use exactly the same hash function as the circuit tests
    const hash = (a, b) => hashLeftRight(a, b);
    
    // Create state tree using @zk-kit/lean-imt with maci-crypto hash
    const stateTree = new LeanIMT(hash);
    const aspTree = new LeanIMT(hash);
    
    // Create exactly 5 deposits
    const deposits = [];
    console.log('1. Creating 5 deposits...');
    
    for (let i = 0; i < 5; i++) {
        const deposit = {
            depositor: `Depositor${i + 1}`,
            value: BigInt((i + 1) * 1000000000), // 1, 2, 3, 4, 5 tokens
            label: BigInt(1000 + i),
            nullifier: BigInt(2000 + i),
            secret: BigInt(3000 + i)
        };
        
        // Compute commitment hash using Poseidon from maci-crypto
        deposit.commitment = poseidon([
            deposit.value,
            deposit.label,
            deposit.nullifier,
            deposit.secret
        ]);
        
        deposits.push(deposit);
        console.log(`   ${deposit.depositor}: value=${deposit.value}, commitment=${deposit.commitment.toString().slice(0, 20)}...`);
    }
    
    // Insert commitments into state tree
    console.log('\n2. Building state tree...');
    deposits.forEach((deposit, i) => {
        stateTree.insert(deposit.commitment);
        console.log(`   Inserted ${i+1}: depth=${stateTree.depth}, root=${stateTree.root.toString().slice(0, 20)}...`);
    });
    
    // Insert labels into ASP tree
    console.log('\n3. Building ASP tree...');
    deposits.forEach((deposit, i) => {
        aspTree.insert(deposit.label);
        console.log(`   Inserted label ${i+1}: depth=${aspTree.depth}, root=${aspTree.root.toString().slice(0, 20)}...`);
    });
    
    // Withdraw from deposit 3 (index 2)
    const withdrawalIndex = 2;
    const withdrawalDeposit = deposits[withdrawalIndex];
    
    console.log(`\n4. Preparing withdrawal from deposit ${withdrawalIndex + 1}...`);
    console.log(`   Original value: ${withdrawalDeposit.value}`);
    
    // Define withdrawal parameters
    const withdrawnValue = BigInt(1500000000); // Withdraw 1.5 tokens
    const remainingValue = withdrawalDeposit.value - withdrawnValue;
    const newNullifier = BigInt(9999);
    const newSecret = BigInt(8888);
    
    console.log(`   Withdrawing: ${withdrawnValue}`);
    console.log(`   Remaining: ${remainingValue}`);
    
    // Generate merkle proofs using @zk-kit/lean-imt
    const stateProof = stateTree.generateProof(withdrawalIndex);
    const aspProof = aspTree.generateProof(withdrawalIndex);
    
    console.log('\n5. Merkle proofs:');
    console.log(`   State proof:`);
    console.log(`     - leaf: ${stateProof.leaf.toString().slice(0, 20)}...`);
    console.log(`     - index: ${stateProof.index}`);
    console.log(`     - root: ${stateProof.root.toString().slice(0, 20)}...`);
    console.log(`     - siblings: ${stateProof.siblings.length}`);
    console.log(`   ASP proof:`);
    console.log(`     - leaf: ${aspProof.leaf}`);
    console.log(`     - index: ${aspProof.index}`);
    console.log(`     - root: ${aspProof.root.toString().slice(0, 20)}...`);
    console.log(`     - siblings: ${aspProof.siblings.length}`);
    
    // Verify proofs work with library
    console.log('\n6. Verifying with @zk-kit...');
    const stateVerify = stateTree.verifyProof(stateProof);
    const aspVerify = aspTree.verifyProof(aspProof);
    console.log(`   State proof valid: ${stateVerify}`);
    console.log(`   ASP proof valid: ${aspVerify}`);
    
    // Context
    const context = BigInt("12345678901234567890");
    
    // Pad siblings to maxDepth=32
    const paddedStateSiblings = padSiblings(stateProof.siblings, 32);
    const paddedASPSiblings = padSiblings(aspProof.siblings, 32);
    
    const circuitInputs = {
        // Public inputs
        withdrawnValue: withdrawnValue.toString(),
        stateRoot: stateProof.root.toString(),
        stateTreeDepth: stateTree.depth.toString(),
        ASPRoot: aspProof.root.toString(),
        ASPTreeDepth: aspTree.depth.toString(),
        context: context.toString(),
        
        // Private inputs
        label: withdrawalDeposit.label.toString(),
        existingValue: withdrawalDeposit.value.toString(),
        existingNullifier: withdrawalDeposit.nullifier.toString(),
        existingSecret: withdrawalDeposit.secret.toString(),
        newNullifier: newNullifier.toString(),
        newSecret: newSecret.toString(),
        
        // Merkle proofs
        stateSiblings: paddedStateSiblings.map(s => s.toString()),
        stateIndex: stateProof.index.toString(),
        ASPSiblings: paddedASPSiblings.map(s => s.toString()),
        ASPIndex: aspProof.index.toString()
    };
    
    console.log('\n7. Circuit inputs:');
    console.log(`   withdrawnValue: ${circuitInputs.withdrawnValue}`);
    console.log(`   stateRoot: ${circuitInputs.stateRoot.slice(0, 30)}...`);
    console.log(`   stateTreeDepth: ${circuitInputs.stateTreeDepth}`);
    console.log(`   ASPRoot: ${circuitInputs.ASPRoot.slice(0, 30)}...`);
    console.log(`   ASPTreeDepth: ${circuitInputs.ASPTreeDepth}`);
    
    // Check files exist
    if (!fs.existsSync(WASM_PATH)) {
        throw new Error(`WASM file not found at ${WASM_PATH}`);
    }
    if (!fs.existsSync(ZKEY_PATH)) {
        throw new Error(`ZKEY file not found at ${ZKEY_PATH}`);
    }
    
    console.log('\n8. Generating ZK proof...');
    
    try {
        // Generate the proof
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            circuitInputs,
            WASM_PATH,
            ZKEY_PATH
        );
        
        console.log('\n✅ PROOF GENERATED SUCCESSFULLY!');
        
        // Display public signals
        console.log('\n9. Public signals:');
        const signalLabels = [
            'withdrawnValue',
            'stateRoot',
            'stateTreeDepth',
            'ASPRoot',
            'ASPTreeDepth',
            'context',
            'newCommitmentHash',
            'existingNullifierHash'
        ];
        
        publicSignals.forEach((signal, idx) => {
            console.log(`   ${signalLabels[idx]}: ${signal}`);
        });
        
        // Verify computed values
        const expectedNewCommitment = poseidon([
            remainingValue,
            withdrawalDeposit.label,
            newNullifier,
            newSecret
        ]);
        const expectedNullifierHash = poseidon([withdrawalDeposit.nullifier]);
        
        console.log('\n10. Verification:');
        console.log(`   New commitment matches: ${publicSignals[6] === expectedNewCommitment.toString()}`);
        console.log(`   Nullifier hash matches: ${publicSignals[7] === expectedNullifierHash.toString()}`);
        
        // Convert proof to bytes
        const proofBytes = proofToBytes(proof);
        const publicSignalsBytes = publicSignals.map(signal => fieldToBytes(signal));
        
        // Save the result
        const result = {
            scenario: 'Test with maci-crypto hash',
            deposits: deposits.map(d => ({
                depositor: d.depositor,
                value: d.value.toString(),
                commitment: d.commitment.toString()
            })),
            withdrawal: {
                fromDeposit: withdrawalIndex,
                withdrawnValue: withdrawnValue.toString(),
                remainingValue: remainingValue.toString()
            },
            proof: proofBytes,
            publicSignals: publicSignalsBytes,
            rawProof: proof,
            rawPublicSignals: publicSignals,
            trees: {
                stateRoot: stateTree.root.toString(),
                stateDepth: stateTree.depth,
                aspRoot: aspTree.root.toString(),
                aspDepth: aspTree.depth
            }
        };
        
        const outputPath = path.join(__dirname, 'maci-crypto-proof.json');
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
        
        console.log(`\n✅ Proof saved to ${outputPath}`);
        
        // Mark todo as completed
        console.log('\n✅ Successfully generated working ZK proof for 5-deposit tree!');
        
        return result;
        
    } catch (error) {
        console.error('\n❌ Error generating proof:', error.message);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    testWithMaciCrypto()
        .then(() => {
            console.log('\n✅ Test completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testWithMaciCrypto };