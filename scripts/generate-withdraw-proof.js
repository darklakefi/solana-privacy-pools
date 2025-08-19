#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const snarkjs = require('snarkjs');
const crypto = require('crypto');

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

// Generate a withdrawal proof
async function generateWithdrawProof(input) {
    console.log('Generating withdrawal proof...');
    console.log('Input:', JSON.stringify(input, null, 2));
    
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
    
    // Convert proof to bytes
    const proofBytes = proofToBytes(proof);
    
    // Convert public signals to bytes
    const publicSignalsBytes = publicSignals.map(signal => fieldToBytes(signal));
    
    return {
        proof: proofBytes,
        publicSignals: publicSignalsBytes,
        rawProof: proof,
        rawPublicSignals: publicSignals
    };
}

// Example usage
async function main() {
    // Example input for withdrawal circuit
    // Based on the circuit definition in withdraw.circom
    
    // BN254 field modulus
    const FIELD_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");
    
    const input = {
        // Public inputs (must be valid field elements)
        withdrawnValue: "1000000000", // 1 token with 9 decimals
        stateRoot: "12345678901234567890",  // Valid field element
        stateTreeDepth: "10",
        ASPRoot: "98765432109876543210",    // Valid field element (note the uppercase)
        ASPTreeDepth: "10",
        context: "1111111111111111111",      // Valid field element
        
        // Private inputs
        label: "5555555555555555555",        // Valid field element
        existingValue: "2000000000",         // 2 tokens (withdrawing 1)
        existingNullifier: "123456789",
        existingSecret: "987654321",
        newNullifier: "111111111",
        newSecret: "222222222",
        
        // Merkle tree proofs (maxTreeDepth = 32)
        stateSiblings: Array(32).fill("0"),
        stateIndex: "0",
        ASPSiblings: Array(32).fill("0"),    // Note the uppercase
        ASPIndex: "0"                         // Note the uppercase
    };
    
    try {
        const result = await generateWithdrawProof(input);
        
        // Save the proof to a file
        const outputPath = path.join(__dirname, 'withdraw-proof.json');
        fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
        
        console.log(`\nProof saved to ${outputPath}`);
        
        // Print Rust-compatible output
        console.log('\n// Rust code for the proof:');
        console.log(`let proof_a: [u8; 64] = [${result.proof.proofA.join(', ')}];`);
        console.log(`let proof_b: [u8; 128] = [${result.proof.proofB.join(', ')}];`);
        console.log(`let proof_c: [u8; 64] = [${result.proof.proofC.join(', ')}];`);
        console.log(`let public_signals: Vec<[u8; 32]> = vec![`);
        result.publicSignals.forEach(signal => {
            console.log(`    [${signal.join(', ')}],`);
        });
        console.log(`];`);
        
    } catch (error) {
        console.error('Error generating proof:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main();
}

module.exports = { generateWithdrawProof, proofToBytes, fieldToBytes };