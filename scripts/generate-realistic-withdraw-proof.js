#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');
const { buildPoseidon } = require('circomlibjs');

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
    // Proof A (G1 point: 64 bytes)
    const proofA = [
        ...fieldToBytes(proof.pi_a[0]),
        ...fieldToBytes(proof.pi_a[1])
    ];
    
    // Proof B (G2 point: 128 bytes)
    const proofB = [
        ...fieldToBytes(proof.pi_b[0][0]),
        ...fieldToBytes(proof.pi_b[0][1]),
        ...fieldToBytes(proof.pi_b[1][0]),
        ...fieldToBytes(proof.pi_b[1][1])
    ];
    
    // Proof C (G1 point: 64 bytes)
    const proofC = [
        ...fieldToBytes(proof.pi_c[0]),
        ...fieldToBytes(proof.pi_c[1])
    ];
    
    return { proofA, proofB, proofC };
}

// Compute Lean IMT root (simplified for depth 10)
function computeLeanIMTRoot(poseidon, leaf, index, siblings, depth) {
    let current = leaf;
    let idx = BigInt(index);
    
    for (let i = 0; i < depth; i++) {
        const sibling = BigInt(siblings[i]);
        
        if (idx & 1n) {
            // Current is right, sibling is left
            current = poseidon([sibling, current]);
        } else {
            // Current is left, sibling is right
            current = poseidon([current, sibling]);
        }
        
        idx = idx >> 1n;
    }
    
    return current;
}

// Generate a withdrawal proof with realistic values
async function generateRealisticWithdrawProof() {
    console.log('Building Poseidon hash function...');
    const poseidon = await buildPoseidon();
    const poseidonHash = (inputs) => poseidon.F.toString(poseidon(inputs));
    
    // Define commitment parameters
    const existingValue = BigInt("2000000000"); // 2 tokens
    const withdrawnValue = BigInt("1000000000"); // 1 token
    const label = BigInt("5555555555555555555");
    const existingNullifier = BigInt("123456789");
    const existingSecret = BigInt("987654321");
    const newNullifier = BigInt("111111111");
    const newSecret = BigInt("222222222");
    
    // Compute existing commitment hash using the same formula as the circuit
    // commitment = Poseidon4(value, label, nullifier, secret)
    const existingCommitment = poseidonHash([existingValue, label, existingNullifier, existingSecret]);
    console.log('Existing commitment:', existingCommitment);
    
    // Compute nullifier hash
    const existingNullifierHash = poseidonHash([existingNullifier]);
    console.log('Existing nullifier hash:', existingNullifierHash);
    
    // Compute new commitment (with remaining value)
    const remainingValue = existingValue - withdrawnValue;
    const newCommitment = poseidonHash([remainingValue, label, newNullifier, newSecret]);
    console.log('New commitment:', newCommitment);
    
    // Build merkle trees
    const stateTreeDepth = 10;
    const aspTreeDepth = 10;
    
    // For state tree, put the existing commitment at index 0
    const stateIndex = 0;
    const stateSiblings = Array(32).fill("0");
    // Fill only the first 10 siblings (actual tree depth)
    for (let i = 0; i < stateTreeDepth; i++) {
        stateSiblings[i] = "0"; // Empty siblings for simplicity
    }
    
    // Compute state root
    const stateRoot = computeLeanIMTRoot(
        poseidonHash,
        BigInt(existingCommitment),
        stateIndex,
        stateSiblings.slice(0, stateTreeDepth),
        stateTreeDepth
    );
    console.log('State root:', stateRoot);
    
    // For ASP tree, put the label at index 0
    const aspIndex = 0;
    const aspSiblings = Array(32).fill("0");
    // Fill only the first 10 siblings
    for (let i = 0; i < aspTreeDepth; i++) {
        aspSiblings[i] = "0";
    }
    
    // Compute ASP root
    const aspRoot = computeLeanIMTRoot(
        poseidonHash,
        label,
        aspIndex,
        aspSiblings.slice(0, aspTreeDepth),
        aspTreeDepth
    );
    console.log('ASP root:', aspRoot);
    
    // Context (would be keccak256(IPrivacyPool.Withdrawal, scope) % SNARK_SCALAR_FIELD in real usage)
    const context = BigInt("1111111111111111111");
    
    const input = {
        // Public inputs
        withdrawnValue: withdrawnValue.toString(),
        stateRoot: stateRoot.toString(),
        stateTreeDepth: stateTreeDepth.toString(),
        ASPRoot: aspRoot.toString(),
        ASPTreeDepth: aspTreeDepth.toString(),
        context: context.toString(),
        
        // Private inputs
        label: label.toString(),
        existingValue: existingValue.toString(),
        existingNullifier: existingNullifier.toString(),
        existingSecret: existingSecret.toString(),
        newNullifier: newNullifier.toString(),
        newSecret: newSecret.toString(),
        
        // Merkle proofs
        stateSiblings: stateSiblings,
        stateIndex: stateIndex.toString(),
        ASPSiblings: aspSiblings,
        ASPIndex: aspIndex.toString()
    };
    
    console.log('\nGenerating withdrawal proof...');
    
    // Check that files exist
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
    
    console.log('Proof generated successfully!');
    console.log('Public signals:', publicSignals);
    
    // Verify the public signals match expected values
    console.log('\nVerifying public signals:');
    console.log('withdrawnValue:', publicSignals[0], '==', withdrawnValue.toString());
    console.log('stateRoot:', publicSignals[1], '==', stateRoot.toString());
    console.log('stateTreeDepth:', publicSignals[2], '==', stateTreeDepth.toString());
    console.log('ASPRoot:', publicSignals[3], '==', aspRoot.toString());
    console.log('ASPTreeDepth:', publicSignals[4], '==', aspTreeDepth.toString());
    console.log('context:', publicSignals[5], '==', context.toString());
    console.log('newCommitmentHash:', publicSignals[6]);
    console.log('existingNullifierHash:', publicSignals[7]);
    
    // Convert proof to bytes
    const proofBytes = proofToBytes(proof);
    
    // Convert public signals to bytes
    const publicSignalsBytes = publicSignals.map(signal => fieldToBytes(signal));
    
    // Save the proof
    const result = {
        proof: proofBytes,
        publicSignals: publicSignalsBytes,
        rawProof: proof,
        rawPublicSignals: publicSignals
    };
    
    const outputPath = path.join(__dirname, 'realistic-withdraw-proof.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    
    console.log(`\nProof saved to ${outputPath}`);
    
    // Print Rust-compatible output
    console.log('\n// Rust code for the proof:');
    console.log(`let proof_a: [u8; 64] = [`);
    for (let i = 0; i < 64; i += 16) {
        console.log(`    ${result.proof.proofA.slice(i, i + 16).join(', ')},`);
    }
    console.log(`];`);
    
    console.log(`let proof_b: [u8; 128] = [`);
    for (let i = 0; i < 128; i += 16) {
        console.log(`    ${result.proof.proofB.slice(i, i + 16).join(', ')},`);
    }
    console.log(`];`);
    
    console.log(`let proof_c: [u8; 64] = [`);
    for (let i = 0; i < 64; i += 16) {
        console.log(`    ${result.proof.proofC.slice(i, i + 16).join(', ')},`);
    }
    console.log(`];`);
    
    console.log(`let public_signals: Vec<[u8; 32]> = vec![`);
    result.publicSignals.forEach((signal, idx) => {
        console.log(`    [${signal.slice(0, 16).join(', ')},`);
        console.log(`     ${signal.slice(16, 32).join(', ')}], // Signal ${idx}`);
    });
    console.log(`];`);
    
    return result;
}

// Run if called directly
if (require.main === module) {
    generateRealisticWithdrawProof()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Error generating proof:', error);
            process.exit(1);
        });
}

module.exports = { generateRealisticWithdrawProof, proofToBytes, fieldToBytes };