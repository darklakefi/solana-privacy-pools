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

// Generate a withdrawal proof using @zk-kit/lean-imt
async function generateWithdrawProofWithZKKit() {
    console.log('Building Poseidon hash function...');
    const poseidon = await buildPoseidon();
    const poseidonHash = (inputs) => {
        const result = poseidon(inputs);
        return poseidon.F.toObject(result);
    };
    
    // Create hash function for LeanIMT
    const hash = (a, b) => poseidonHash([a, b]);
    
    // Create state tree
    const stateTree = new LeanIMT(hash);
    
    // Add dummy commitments to build depth
    console.log('Building state tree...');
    for (let i = 0; i < 15; i++) {
        const dummyCommitment = poseidonHash([BigInt(i+1), BigInt(i+1), BigInt(i+1), BigInt(i+1)]);
        stateTree.insert(dummyCommitment);
    }
    
    // Define commitment parameters
    const existingValue = BigInt("2000000000");
    const withdrawnValue = BigInt("1000000000");
    const label = BigInt("5555555555555555555");
    const existingNullifier = BigInt("123456789");
    const existingSecret = BigInt("987654321");
    const newNullifier = BigInt("111111111");
    const newSecret = BigInt("222222222");
    
    // Compute existing commitment
    const existingCommitment = poseidonHash([existingValue, label, existingNullifier, existingSecret]);
    console.log('Existing commitment:', existingCommitment.toString());
    
    // Insert into state tree
    stateTree.insert(existingCommitment);
    const leafIndex = stateTree.indexOf(existingCommitment);
    const stateProof = stateTree.generateProof(leafIndex);
    
    console.log('State tree root:', stateTree.root.toString());
    console.log('State proof root:', stateProof.root.toString());
    console.log('Roots match:', stateTree.root === stateProof.root);
    console.log('State tree depth:', stateTree.depth);
    console.log('State proof index:', stateProof.index);
    console.log('State proof siblings:', stateProof.siblings.length);
    
    // Create ASP tree
    const aspTree = new LeanIMT(hash);
    
    // Add dummy labels
    console.log('Building ASP tree...');
    for (let i = 0; i < 15; i++) {
        aspTree.insert(BigInt(i + 1000));
    }
    
    // Insert actual label
    aspTree.insert(label);
    const aspLabelIndex = aspTree.indexOf(label);
    const aspProof = aspTree.generateProof(aspLabelIndex);
    
    console.log('ASP tree root:', aspTree.root.toString());
    console.log('ASP tree depth:', aspTree.depth);
    console.log('ASP proof index:', aspProof.index);
    console.log('ASP proof siblings:', aspProof.siblings.length);
    
    // Context
    const context = BigInt("1111111111111111111");
    
    // Pad siblings to maxDepth=32
    const paddedStateSiblings = padSiblings(stateProof.siblings, 32);
    const paddedASPSiblings = padSiblings(aspProof.siblings, 32);
    
    const input = {
        // Public inputs (use proof roots, not tree roots!)
        withdrawnValue: withdrawnValue.toString(),
        stateRoot: stateProof.root.toString(),  // Use proof root
        stateTreeDepth: stateTree.depth.toString(),
        ASPRoot: aspProof.root.toString(),      // Use proof root
        ASPTreeDepth: aspTree.depth.toString(),
        context: context.toString(),
        
        // Private inputs
        label: label.toString(),
        existingValue: existingValue.toString(),
        existingNullifier: existingNullifier.toString(),
        existingSecret: existingSecret.toString(),
        newNullifier: newNullifier.toString(),
        newSecret: newSecret.toString(),
        
        // Merkle proofs
        stateSiblings: paddedStateSiblings.map(s => s.toString()),
        stateIndex: stateProof.index.toString(),
        ASPSiblings: paddedASPSiblings.map(s => s.toString()),
        ASPIndex: aspProof.index.toString()
    };
    
    console.log('\nGenerating withdrawal proof...');
    console.log('Circuit inputs:');
    console.log('  stateRoot:', stateProof.root.toString());
    console.log('  stateIndex:', stateProof.index);
    console.log('  stateTreeDepth:', stateTree.depth);
    console.log('  First few siblings:', paddedStateSiblings.slice(0, 5).map(s => s.toString()));
    
    // Check files exist
    if (!fs.existsSync(WASM_PATH)) {
        throw new Error(`WASM file not found at ${WASM_PATH}`);
    }
    if (!fs.existsSync(ZKEY_PATH)) {
        throw new Error(`ZKEY file not found at ${ZKEY_PATH}`);
    }
    
    // Generate the proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        WASM_PATH,
        ZKEY_PATH
    );
    
    console.log('\nProof generated successfully!');
    console.log('Public signals:');
    publicSignals.forEach((signal, idx) => {
        const labels = [
            'withdrawnValue',
            'stateRoot',
            'stateTreeDepth',
            'ASPRoot',
            'ASPTreeDepth',
            'context',
            'newCommitmentHash',
            'existingNullifierHash'
        ];
        console.log(`  ${labels[idx] || idx}: ${signal}`);
    });
    
    // Convert proof to bytes
    const proofBytes = proofToBytes(proof);
    
    // Convert public signals to bytes
    const publicSignalsBytes = publicSignals.map(signal => fieldToBytes(signal));
    
    // Save the proof
    const result = {
        proof: proofBytes,
        publicSignals: publicSignalsBytes,
        rawProof: proof,
        rawPublicSignals: publicSignals,
        stateRoot: stateTree.root.toString(),
        commitment: existingCommitment.toString()
    };
    
    const outputPath = path.join(__dirname, 'zkkit-withdraw-proof.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    
    console.log(`\nProof saved to ${outputPath}`);
    
    return result;
}

// Run if called directly
if (require.main === module) {
    generateWithdrawProofWithZKKit()
        .then(() => {
            console.log('\nSuccess! Proof generated and saved.');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Error generating proof:', error);
            process.exit(1);
        });
}

module.exports = { generateWithdrawProofWithZKKit };