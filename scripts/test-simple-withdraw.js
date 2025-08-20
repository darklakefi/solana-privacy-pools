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

// Simplest possible test - single deposit
async function testSimpleWithdraw() {
    console.log('=== Simple Withdrawal Test (1 deposit) ===\n');
    
    // Use exactly the same hash function as the circuit tests
    const hash = (a, b) => hashLeftRight(a, b);
    
    // Create state tree using @zk-kit/lean-imt with maci-crypto hash
    const stateTree = new LeanIMT(hash);
    const aspTree = new LeanIMT(hash);
    
    // Create just 1 deposit
    console.log('1. Creating 1 deposit...');
    
    const deposit = {
        value: BigInt(2000000000), // 2 tokens
        label: BigInt(5555),
        nullifier: BigInt(123456789),
        secret: BigInt(987654321)
    };
    
    // Compute commitment hash using Poseidon from maci-crypto
    deposit.commitment = poseidon([
        deposit.value,
        deposit.label,
        deposit.nullifier,
        deposit.secret
    ]);
    
    console.log(`   Value: ${deposit.value}`);
    console.log(`   Commitment: ${deposit.commitment.toString()}`);
    
    // Insert commitment into state tree
    console.log('\n2. Building state tree...');
    stateTree.insert(deposit.commitment);
    console.log(`   Tree depth: ${stateTree.depth}`);
    console.log(`   Tree root: ${stateTree.root.toString()}`);
    
    // Insert label into ASP tree
    console.log('\n3. Building ASP tree...');
    aspTree.insert(deposit.label);
    console.log(`   Tree depth: ${aspTree.depth}`);
    console.log(`   Tree root: ${aspTree.root.toString()}`);
    
    // Prepare withdrawal
    console.log('\n4. Preparing withdrawal...');
    const withdrawnValue = BigInt(1000000000); // Withdraw 1 token
    const remainingValue = deposit.value - withdrawnValue;
    const newNullifier = BigInt(111111111);
    const newSecret = BigInt(222222222);
    
    console.log(`   Withdrawing: ${withdrawnValue}`);
    console.log(`   Remaining: ${remainingValue}`);
    
    // Generate merkle proofs
    const stateProof = stateTree.generateProof(0); // First and only deposit at index 0
    const aspProof = aspTree.generateProof(0);
    
    console.log('\n5. Merkle proofs:');
    console.log(`   State proof:`);
    console.log(`     - leaf: ${stateProof.leaf.toString()}`);
    console.log(`     - index: ${stateProof.index}`);
    console.log(`     - root: ${stateProof.root.toString()}`);
    console.log(`     - siblings: ${stateProof.siblings.length} (${stateProof.siblings.map(s => s.toString()).join(', ')})`);
    console.log(`   ASP proof:`);
    console.log(`     - leaf: ${aspProof.leaf}`);
    console.log(`     - index: ${aspProof.index}`);
    console.log(`     - root: ${aspProof.root.toString()}`);
    console.log(`     - siblings: ${aspProof.siblings.length}`);
    
    // Important: Check if tree root and proof root are the same
    console.log('\n6. Root comparison:');
    console.log(`   State tree root: ${stateTree.root.toString()}`);
    console.log(`   State proof root: ${stateProof.root.toString()}`);
    console.log(`   Same? ${stateTree.root === stateProof.root}`);
    console.log(`   ASP tree root: ${aspTree.root.toString()}`);
    console.log(`   ASP proof root: ${aspProof.root.toString()}`);
    console.log(`   Same? ${aspTree.root === aspProof.root}`);
    
    // Context
    const context = BigInt("12345678901234567890");
    
    // Pad siblings to maxDepth=32
    const paddedStateSiblings = padSiblings(stateProof.siblings, 32);
    const paddedASPSiblings = padSiblings(aspProof.siblings, 32);
    
    const circuitInputs = {
        // Public inputs - USE TREE ROOT, NOT PROOF ROOT
        withdrawnValue: withdrawnValue.toString(),
        stateRoot: stateTree.root.toString(), // Use tree root!
        stateTreeDepth: stateTree.depth.toString(),
        ASPRoot: aspTree.root.toString(), // Use tree root!
        ASPTreeDepth: aspTree.depth.toString(),
        context: context.toString(),
        
        // Private inputs
        label: deposit.label.toString(),
        existingValue: deposit.value.toString(),
        existingNullifier: deposit.nullifier.toString(),
        existingSecret: deposit.secret.toString(),
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
    console.log(`   stateRoot: ${circuitInputs.stateRoot}`);
    console.log(`   stateTreeDepth: ${circuitInputs.stateTreeDepth}`);
    console.log(`   ASPRoot: ${circuitInputs.ASPRoot}`);
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
            deposit.label,
            newNullifier,
            newSecret
        ]);
        const expectedNullifierHash = poseidon([deposit.nullifier]);
        
        console.log('\n10. Verification:');
        console.log(`   New commitment matches: ${publicSignals[6] === expectedNewCommitment.toString()}`);
        console.log(`   Nullifier hash matches: ${publicSignals[7] === expectedNullifierHash.toString()}`);
        
        // Convert proof to bytes
        const proofBytes = proofToBytes(proof);
        const publicSignalsBytes = publicSignals.map(signal => fieldToBytes(signal));
        
        // Save the result
        const result = {
            scenario: 'Simple withdrawal test (1 deposit)',
            deposit: {
                value: deposit.value.toString(),
                commitment: deposit.commitment.toString()
            },
            withdrawal: {
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
        
        const outputPath = path.join(__dirname, 'simple-withdraw-proof.json');
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
        
        console.log(`\n✅ Proof saved to ${outputPath}`);
        
        return result;
        
    } catch (error) {
        console.error('\n❌ Error generating proof:', error.message);
        
        // Debug information
        console.log('\n=== Debug Information ===');
        console.log('State tree:');
        console.log(`  Root: ${stateTree.root}`);
        console.log(`  Depth: ${stateTree.depth}`);
        console.log(`  Size: ${stateTree.size}`);
        
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    testSimpleWithdraw()
        .then(() => {
            console.log('\n✅ Test completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test failed:', error);
            process.exit(1);
        });
}

module.exports = { testSimpleWithdraw };