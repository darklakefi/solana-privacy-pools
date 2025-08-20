#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');
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

// Main test scenario
async function test5DepositsAndWithdraw() {
    console.log('=== Realistic Test: 5 Deposits and 1 Withdrawal ===\n');
    
    // Build Poseidon hash function
    console.log('Building Poseidon hash function...');
    const poseidon = await buildPoseidon();
    const poseidonHash = (inputs) => {
        const result = poseidon(inputs);
        return poseidon.F.toObject(result);
    };
    
    // Create hash function for LeanIMT
    const hash = (a, b) => poseidonHash([a, b]);
    
    // Create state tree and ASP tree
    const stateTree = new LeanIMT(hash);
    const aspTree = new LeanIMT(hash);
    
    // Define 5 depositors with their commitments
    const deposits = [];
    console.log('\n1. Creating 5 deposits...');
    
    for (let i = 0; i < 5; i++) {
        const deposit = {
            depositor: `Depositor${i + 1}`,
            value: BigInt((i + 1) * 1000000000), // 1, 2, 3, 4, 5 tokens
            label: BigInt(1000 + i), // Simple labels
            nullifier: BigInt(2000 + i),
            secret: BigInt(3000 + i)
        };
        
        // Compute commitment hash the correct way!
        // First compute precommitment = hash(nullifier, secret)
        const precommitment = poseidonHash([deposit.nullifier, deposit.secret]);
        // Then commitment = hash(value, label, precommitment)
        deposit.commitment = poseidonHash([
            deposit.value,
            deposit.label,
            precommitment
        ]);
        
        deposits.push(deposit);
        console.log(`   ${deposit.depositor}: ${deposit.value / 1000000000n} tokens, commitment: ${deposit.commitment.toString().slice(0, 20)}...`);
    }
    
    // Insert all deposits into the state tree
    console.log('\n2. Building state tree with deposits...');
    deposits.forEach((deposit, i) => {
        stateTree.insert(deposit.commitment);
        console.log(`   Inserted deposit ${i + 1}, tree depth: ${stateTree.depth}, root: ${stateTree.root.toString().slice(0, 20)}...`);
    });
    
    console.log(`   Final state tree: depth=${stateTree.depth}, size=${stateTree.size}`);
    
    // Insert all labels into ASP tree (simulating approval)
    console.log('\n3. Building ASP tree with approved labels...');
    deposits.forEach((deposit, i) => {
        aspTree.insert(deposit.label);
        console.log(`   Inserted label ${i + 1}, tree depth: ${aspTree.depth}`);
    });
    
    console.log(`   Final ASP tree: depth=${aspTree.depth}, size=${aspTree.size}`);
    
    // Now let's withdraw from deposit 3 (middle of the tree)
    const withdrawalIndex = 2; // Third deposit (0-indexed)
    const withdrawalDeposit = deposits[withdrawalIndex];
    
    console.log(`\n4. Withdrawing from ${withdrawalDeposit.depositor}...`);
    console.log(`   Original value: ${withdrawalDeposit.value / 1000000000n} tokens`);
    
    // Define withdrawal parameters
    const withdrawnValue = BigInt(1500000000); // Withdraw 1.5 tokens
    const remainingValue = withdrawalDeposit.value - withdrawnValue;
    const newNullifier = BigInt(9999);
    const newSecret = BigInt(8888);
    
    console.log(`   Withdrawing: ${withdrawnValue / 1000000000n} tokens`);
    console.log(`   Remaining: ${remainingValue / 1000000000n} tokens`);
    
    // Generate merkle proofs
    const stateProof = stateTree.generateProof(withdrawalIndex);
    const aspProof = aspTree.generateProof(withdrawalIndex);
    
    console.log('\n5. Merkle proofs generated:');
    console.log(`   State proof: leaf=${stateProof.leaf.toString().slice(0, 20)}..., index=${stateProof.index}, siblings=${stateProof.siblings.length}`);
    console.log(`   ASP proof: leaf=${aspProof.leaf}, index=${aspProof.index}, siblings=${aspProof.siblings.length}`);
    
    // Verify proofs locally
    console.log('\n6. Verifying proofs locally...');
    const verifyState = stateTree.verifyProof(stateProof);
    const verifyASP = aspTree.verifyProof(aspProof);
    console.log(`   State proof valid: ${verifyState}`);
    console.log(`   ASP proof valid: ${verifyASP}`);
    
    // Manual verification to understand the circuit's logic
    console.log('\n   Manual state proof verification:');
    let currentNode = withdrawalDeposit.commitment;
    let currentIndex = stateProof.index;
    console.log(`     Starting with leaf: ${currentNode.toString().slice(0, 20)}...`);
    
    for (let i = 0; i < stateProof.siblings.length; i++) {
        const sibling = stateProof.siblings[i];
        const isRight = (currentIndex & 1) === 1;
        console.log(`     Level ${i}: index=${currentIndex}, isRight=${isRight}, sibling=${sibling.toString().slice(0, 20)}...`);
        
        if (isRight) {
            currentNode = hash(sibling, currentNode);
        } else {
            currentNode = hash(currentNode, sibling);
        }
        console.log(`       -> hash result: ${currentNode.toString().slice(0, 20)}...`);
        currentIndex = currentIndex >> 1;
    }
    console.log(`     Final computed root: ${currentNode.toString().slice(0, 20)}...`);
    console.log(`     Expected root: ${stateProof.root.toString().slice(0, 20)}...`);
    console.log(`     Match: ${currentNode === stateProof.root}`);
    
    // Context (would be keccak256(IPrivacyPool.Withdrawal, scope) % SNARK_SCALAR_FIELD)
    const context = BigInt("12345678901234567890");
    
    // Prepare circuit inputs
    const paddedStateSiblings = padSiblings(stateProof.siblings, 32);
    const paddedASPSiblings = padSiblings(aspProof.siblings, 32);
    
    // Debug: Check if the proof root matches tree root
    console.log('\nDebug - Root comparison:');
    console.log(`  stateTree.root: ${stateTree.root}`);
    console.log(`  stateProof.root: ${stateProof.root}`);
    console.log(`  Are they equal? ${stateTree.root.toString() === stateProof.root.toString()}`);
    
    // Debug: Manually compute what the circuit will compute for the commitment
    const debugPrecommitment = poseidonHash([withdrawalDeposit.nullifier, withdrawalDeposit.secret]);
    const debugCommitment = poseidonHash([withdrawalDeposit.value, withdrawalDeposit.label, debugPrecommitment]);
    console.log('\nDebug - Commitment verification:');
    console.log(`  Expected commitment: ${withdrawalDeposit.commitment}`);
    console.log(`  Recomputed commitment: ${debugCommitment}`);
    console.log(`  Match: ${debugCommitment.toString() === withdrawalDeposit.commitment.toString()}`);
    console.log(`  Leaf at index ${withdrawalIndex}: ${stateProof.leaf}`);
    console.log(`  Match with proof leaf: ${debugCommitment.toString() === stateProof.leaf.toString()}`);
    
    // The Solidity tests use stateProof.root, not stateTree.root!
    const circuitInputs = {
        // Public inputs - USE PROOF ROOT like Solidity tests do!
        withdrawnValue: withdrawnValue.toString(),
        stateRoot: stateProof.root.toString(), // Use proof root like Solidity tests
        stateTreeDepth: stateTree.depth.toString(),
        ASPRoot: aspProof.root.toString(), // Use proof root like Solidity tests
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
    
    console.log('\n7. Generating ZK proof...');
    console.log('   Circuit inputs summary:');
    console.log(`     Withdrawn value: ${withdrawnValue}`);
    console.log(`     State root: ${stateProof.root.toString().slice(0, 30)}...`);
    console.log(`     ASP root: ${aspProof.root.toString().slice(0, 30)}...`);
    console.log(`     Tree depths: state=${stateTree.depth}, asp=${aspTree.depth}`);
    
    // Check files exist
    if (!fs.existsSync(WASM_PATH)) {
        throw new Error(`WASM file not found at ${WASM_PATH}`);
    }
    if (!fs.existsSync(ZKEY_PATH)) {
        throw new Error(`ZKEY file not found at ${ZKEY_PATH}`);
    }
    
    try {
        // Generate the proof
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            circuitInputs,
            WASM_PATH,
            ZKEY_PATH
        );
        
        console.log('\n✅ PROOF GENERATED SUCCESSFULLY!');
        
        // Display public signals
        console.log('\n8. Public signals (outputs):');
        console.log('   Raw public signals array:');
        publicSignals.forEach((signal, idx) => {
            console.log(`     [${idx}]: ${signal}`);
        });
        
        // Try to identify which signal is which
        console.log('\n   Identifying signals:');
        console.log(`   Looking for withdrawnValue=${withdrawnValue}: found at index ${publicSignals.indexOf(withdrawnValue.toString())}`);
        console.log(`   Looking for stateRoot=${stateProof.root}: found at index ${publicSignals.indexOf(stateProof.root.toString())}`);
        console.log(`   Looking for stateTreeDepth=${stateTree.depth}: found at index ${publicSignals.indexOf(stateTree.depth.toString())}`);
        console.log(`   Looking for ASPRoot=${aspProof.root}: found at index ${publicSignals.indexOf(aspProof.root.toString())}`);
        console.log(`   Looking for ASPTreeDepth=${aspTree.depth}: found at index ${publicSignals.indexOf(aspTree.depth.toString())}`);
        console.log(`   Looking for context=${context}: found at index ${publicSignals.indexOf(context.toString())}`);
        
        // Compute expected values
        const expectedNewCommitment = poseidonHash([
            remainingValue,
            withdrawalDeposit.label,
            newNullifier,
            newSecret
        ]);
        const expectedNullifierHash = poseidonHash([withdrawalDeposit.nullifier]);
        
        console.log('\n9. Verification:');
        console.log(`   New commitment matches: ${publicSignals[6] === expectedNewCommitment.toString()}`);
        console.log(`   Nullifier hash matches: ${publicSignals[7] === expectedNullifierHash.toString()}`);
        
        // Convert proof to bytes for Solana
        const proofBytes = proofToBytes(proof);
        const publicSignalsBytes = publicSignals.map(signal => fieldToBytes(signal));
        
        // Save the result
        const result = {
            scenario: '5 deposits, withdraw from deposit 3',
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
        
        const outputPath = path.join(__dirname, 'realistic-withdraw-proof.json');
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
        
        console.log(`\n✅ Complete proof saved to ${outputPath}`);
        
        // Print test code for E2E
        console.log('\n10. JavaScript test code for E2E:');
        console.log('```javascript');
        console.log('const proofData = {');
        console.log(`  proof_a: Buffer.from([${result.proof.proofA.slice(0, 10).join(', ')}...]),`);
        console.log(`  proof_b: Buffer.from([${result.proof.proofB.slice(0, 10).join(', ')}...]),`);
        console.log(`  proof_c: Buffer.from([${result.proof.proofC.slice(0, 10).join(', ')}...]),`);
        console.log('  public_signals: [');
        console.log(`    Buffer.from([${publicSignalsBytes[0].slice(0, 10).join(', ')}...]), // withdrawnValue`);
        console.log('    // ... rest of signals');
        console.log('  ]');
        console.log('};');
        console.log('```');
        
        return result;
        
    } catch (error) {
        console.error('\n❌ Error generating proof:', error.message);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    test5DepositsAndWithdraw()
        .then(() => {
            console.log('\n✅ Test completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Test failed:', error);
            process.exit(1);
        });
}

module.exports = { test5DepositsAndWithdraw };