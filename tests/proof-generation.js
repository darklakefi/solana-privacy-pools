// Common module for proof generation functions
const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');
const { keccak256 } = require('js-sha3');

// Circuit paths
const COMMITMENT_WASM = path.join(__dirname, '../../privacy-pools-core/packages/circuits/build/commitment/commitment_js/commitment.wasm');
const COMMITMENT_ZKEY = path.join(__dirname, '../../privacy-pools-core/packages/circuits/build/commitment/groth16_pkey.zkey');
const COMMITMENT_VKEY = path.join(__dirname, '../../privacy-pools-core/packages/circuits/build/commitment/groth16_vkey.json');

// Field modulus for BN254
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');
const BN254_FIELD_MODULUS = BigInt("21888242871839275222246405745257275088548364400416034343698204186575808495617");

// Helper function to convert BigInt to big-endian 32-byte array
function bigIntToBytes32BE(value) {
    const bytes = new Uint8Array(32);
    let bigintValue = BigInt(value); // Ensure it's a BigInt
    for (let i = 0; i < 32; i++) {
        bytes[31 - i] = Number((bigintValue >> BigInt(i * 8)) & 0xFFn);
    }
    return bytes;
}

// Helper function to reduce a hash to field element
function reduceHashToField(hashBuffer) {
    // Convert hash to BigInt (big-endian)
    let hashBigInt = BigInt(0);
    for (let i = 0; i < 32; i++) {
        hashBigInt = (hashBigInt << 8n) | BigInt(hashBuffer[i]);
    }
    
    // Reduce modulo field
    hashBigInt = hashBigInt % FIELD_MODULUS;
    
    // Convert back to bytes (big-endian)
    const reduced = Buffer.alloc(32);
    let temp = hashBigInt;
    for (let j = 31; j >= 0; j--) {
        reduced[j] = Number(temp & 0xFFn);
        temp = temp >> 8n;
    }
    
    return { bigint: hashBigInt, buffer: reduced };
}

// Compute scope hash for a given mint
function computeScope(mintBuffer) {
    const scopeData = Buffer.concat([
        Buffer.from('PrivacyPool'),
        mintBuffer
    ]);
    const scopeHash = Buffer.from(keccak256.array(scopeData));
    return reduceHashToField(scopeHash);
}

// Compute label from scope and nonce
function computeLabel(scopeBuffer, nonce) {
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(BigInt(nonce));
    
    const labelData = Buffer.concat([scopeBuffer, nonceBuffer]);
    const labelHash = Buffer.from(keccak256.array(labelData));
    return reduceHashToField(labelHash);
}

// Generate commitment proof
async function generateCommitmentProof(value, label, nullifier, secret) {
    if (!fs.existsSync(COMMITMENT_WASM) || !fs.existsSync(COMMITMENT_ZKEY)) {
        console.log('   ⚠️  Circuit files not found, using mock proof for testing');
        // Return mock proof for testing
        return {
            proof: {
                proofA: new Uint8Array(64),
                proofB: new Uint8Array(128),
                proofC: new Uint8Array(64)
            },
            publicSignals: {
                value: Buffer.alloc(32),
                label: Buffer.alloc(32),
                commitment: Buffer.alloc(32),
                nullifierHash: Buffer.alloc(32)
            }
        };
    }
    
    // Prepare witness input
    const input = {
        value: value.toString(),
        label: label.toString(),
        nullifier: nullifier.toString(),
        secret: secret.toString()
    };
    
    // Generate witness and proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        COMMITMENT_WASM,
        COMMITMENT_ZKEY
    );
    
    console.log('   Circuit public signals:', publicSignals.map((s, i) => 
        `[${i}]: ${BigInt(s).toString(16).padStart(64, '0')}`).join('\n   '));
    
    // Convert proof to bytes (big-endian format for standard syscalls)
    const proofA = new Uint8Array(64);
    const proofB = new Uint8Array(128);
    const proofC = new Uint8Array(64);
    
    // Convert proof.pi_a (G1 point) to bytes - groth16-solana expects negated proof_a
    const piA = [BigInt(proof.pi_a[0]), BigInt(proof.pi_a[1])];
    // Negate the y-coordinate: y' = -y mod p = p - y (for non-zero y)
    const piA_neg = [piA[0], piA[1] === 0n ? 0n : BN254_FIELD_MODULUS - piA[1]];
    
    const piABytes0 = bigIntToBytes32BE(piA_neg[0]);
    const piABytes1 = bigIntToBytes32BE(piA_neg[1]);
    proofA.set(piABytes0, 0);
    proofA.set(piABytes1, 32);
    
    // Convert proof.pi_b (G2 point) to bytes
    const piB = [
        [BigInt(proof.pi_b[0][0]), BigInt(proof.pi_b[0][1])],
        [BigInt(proof.pi_b[1][0]), BigInt(proof.pi_b[1][1])]
    ];
    const piBBytes00 = bigIntToBytes32BE(piB[0][0]);
    const piBBytes01 = bigIntToBytes32BE(piB[0][1]);
    const piBBytes10 = bigIntToBytes32BE(piB[1][0]);
    const piBBytes11 = bigIntToBytes32BE(piB[1][1]);
    proofB.set(piBBytes00, 0);
    proofB.set(piBBytes01, 32);
    proofB.set(piBBytes10, 64);
    proofB.set(piBBytes11, 96);
    
    // Convert proof.pi_c (G1 point) to bytes
    const piC = [BigInt(proof.pi_c[0]), BigInt(proof.pi_c[1])];
    const piCBytes0 = bigIntToBytes32BE(piC[0]);
    const piCBytes1 = bigIntToBytes32BE(piC[1]);
    proofC.set(piCBytes0, 0);
    proofC.set(piCBytes1, 32);
    
    // Convert public signals to bytes 
    // NOTE: Everything uses big-endian for standard syscalls
    // Circuit outputs: [commitment, nullifierHash, value, label]
    
    const commitmentBytes = bigIntToBytes32BE(publicSignals[0]);
    const nullifierHashBytes = bigIntToBytes32BE(publicSignals[1]);
    const valueBytes = bigIntToBytes32BE(publicSignals[2]);
    const labelBytes = bigIntToBytes32BE(publicSignals[3]);
    
    return {
        proof: { proofA, proofB, proofC },
        publicSignals: {
            value: valueBytes,
            label: labelBytes,
            commitment: commitmentBytes,
            nullifierHash: nullifierHashBytes
        },
        rawProof: proof,
        rawPublicSignals: publicSignals
    };
}

// Verify proof with snarkjs
async function verifyCommitmentProof(proof, publicSignals) {
    if (!fs.existsSync(COMMITMENT_VKEY)) {
        console.error('Verifying key not found!');
        return false;
    }
    
    const vKey = JSON.parse(fs.readFileSync(COMMITMENT_VKEY, 'utf8'));
    return await snarkjs.groth16.verify(vKey, publicSignals, proof);
}

module.exports = {
    FIELD_MODULUS,
    BN254_FIELD_MODULUS,
    bigIntToBytes32BE,
    reduceHashToField,
    computeScope,
    computeLabel,
    generateCommitmentProof,
    verifyCommitmentProof,
    COMMITMENT_WASM,
    COMMITMENT_ZKEY,
    COMMITMENT_VKEY
};