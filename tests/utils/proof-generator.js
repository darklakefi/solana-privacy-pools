const snarkjs = require('snarkjs');
const fs = require('fs');
const path = require('path');
const { buildPoseidon } = require('circomlibjs');
const { toBigIntBE, toBufferBE } = require('bigint-buffer');

// Convert endianness for Solana compatibility
function changeEndianness(bytes) {
    const result = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length / 32; i++) {
        for (let j = 0; j < 32; j++) {
            result[i * 32 + j] = bytes[i * 32 + (31 - j)];
        }
    }
    return result;
}

// Convert a BigInt to 32-byte buffer (big-endian)
function bigIntToBuffer32(value) {
    const hex = value.toString(16).padStart(64, '0');
    return Buffer.from(hex, 'hex');
}

// Convert G1 point for Solana (negated and serialized)
function encodeG1ForSolana(point) {
    // G1 points are [x, y] coordinates
    // For Solana, we need to negate the y-coordinate and serialize as 64 bytes
    const x = BigInt(point[0]);
    const y = BigInt(point[1]);
    
    // Create 64-byte buffer (32 bytes for x, 32 bytes for y)
    const buffer = Buffer.alloc(64);
    
    // Write x coordinate (big-endian)
    bigIntToBuffer32(x).copy(buffer, 0);
    
    // For proof verification, we need to negate the y coordinate
    // This is because of how the pairing check works in the verifier
    const fieldModulus = BigInt('21888242871839275222246405745257275088696311157297823662689037894645226208583');
    const negY = (fieldModulus - y) % fieldModulus;
    bigIntToBuffer32(negY).copy(buffer, 32);
    
    return buffer;
}

// Convert G2 point for Solana (serialized as 128 bytes)
function encodeG2ForSolana(point) {
    // G2 points are [[x_im, x_re], [y_im, y_re]]
    // For Solana, we serialize as 128 bytes
    const buffer = Buffer.alloc(128);
    
    // Note: G2 encoding requires special handling of the field extension
    // x = x_re + x_im * u where u^2 = -1 in Fp2
    const x_re = BigInt(point[0][0]);
    const x_im = BigInt(point[0][1]);
    const y_re = BigInt(point[1][0]);
    const y_im = BigInt(point[1][1]);
    
    // Serialize in the order expected by Solana's alt_bn128
    // [x_im, x_re, y_im, y_re] each as 32 bytes
    bigIntToBuffer32(x_im).copy(buffer, 0);
    bigIntToBuffer32(x_re).copy(buffer, 32);
    bigIntToBuffer32(y_im).copy(buffer, 64);
    bigIntToBuffer32(y_re).copy(buffer, 96);
    
    return buffer;
}

class ProofGenerator {
    constructor() {
        this.poseidon = null;
        this.circuitPaths = {};
        this._initPoseidon();
    }
    
    async _initPoseidon() {
        this.poseidon = await buildPoseidon();
    }
    
    async ensurePoseidon() {
        if (!this.poseidon) {
            await this._initPoseidon();
        }
        return this.poseidon;
    }

    // Load circuit files
    loadCircuit(circuitName) {
        if (!this.circuitPaths[circuitName]) {
            const wasmPath = path.join(__dirname, `../../build/${circuitName}/${circuitName}_js/${circuitName}.wasm`);
            const zkeyPath = path.join(__dirname, `../../trusted-setup/final-keys/${circuitName}_final.zkey`);
            
            if (!fs.existsSync(wasmPath)) {
                throw new Error(`Circuit WASM file not found: ${wasmPath}`);
            }
            if (!fs.existsSync(zkeyPath)) {
                throw new Error(`Circuit zkey file not found: ${zkeyPath}`);
            }
            
            this.circuitPaths[circuitName] = { wasmPath, zkeyPath };
        }
        
        return this.circuitPaths[circuitName];
    }

    // Generate commitment using Poseidon
    async generateCommitment(label, secret, value) {
        const poseidon = await this.ensurePoseidon();
        
        const labelBn = toBigIntBE(label);
        const secretBn = toBigIntBE(secret);
        const valueBn = BigInt(value);
        
        // Commitment = Poseidon(label, secret, value)
        const commitment = poseidon([labelBn, secretBn, valueBn]);
        
        return {
            hash: bigIntToBuffer32(commitment),
            label: label,
            secret: secret,
            value: value,
        };
    }

    // Generate nullifier using Poseidon
    async generateNullifier(commitmentHash, secret) {
        const poseidon = await this.ensurePoseidon();
        
        const commitmentBn = toBigIntBE(commitmentHash);
        const secretBn = toBigIntBE(secret);
        
        // Nullifier = Poseidon(commitment, secret)
        const nullifier = poseidon([commitmentBn, secretBn]);
        
        return bigIntToBuffer32(nullifier);
    }

    // Pad merkle siblings to required depth
    padSiblings(siblings, maxDepth = 32) {
        const paddedSiblings = [...siblings];
        while (paddedSiblings.length < maxDepth) {
            paddedSiblings.push(BigInt(0));
        }
        return paddedSiblings;
    }

    // Generate withdrawal proof
    async generateWithdrawProof(input) {
        const circuit = this.loadCircuit('withdraw');
        
        // Prepare circuit inputs
        const circuitInput = {
            // Existing commitment data
            existingValue: BigInt(input.existingValue),
            label: toBigIntBE(input.label),
            existingNullifier: toBigIntBE(input.existingNullifier),
            existingSecret: toBigIntBE(input.existingSecret),
            
            // New commitment data (for partial withdrawal)
            newNullifier: toBigIntBE(input.newNullifier),
            newSecret: toBigIntBE(input.newSecret),
            
            // Withdrawal amount
            withdrawnValue: BigInt(input.withdrawnValue),
            
            // Context
            context: toBigIntBE(input.context),
            
            // State merkle proof
            stateRoot: toBigIntBE(input.stateRoot),
            statePathIndices: input.statePathIndices || 0,
            stateSiblings: this.padSiblings(input.stateSiblings || []),
            
            // ASP merkle proof  
            aspRoot: toBigIntBE(input.aspRoot),
            aspPathIndices: input.aspPathIndices || 0,
            aspSiblings: this.padSiblings(input.aspSiblings || []),
        };
        
        // Generate proof using snarkjs
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            circuitInput,
            circuit.wasmPath,
            circuit.zkeyPath
        );
        
        // Encode proof for Solana
        const encodedProof = {
            proofA: encodeG1ForSolana([proof.pi_a[0], proof.pi_a[1]]),
            proofB: encodeG2ForSolana(proof.pi_b),
            proofC: encodeG1ForSolana([proof.pi_c[0], proof.pi_c[1]]),
            publicSignals: publicSignals.map(signal => bigIntToBuffer32(BigInt(signal))),
        };
        
        return encodedProof;
    }

    // Generate ragequit proof (NOTE: No ragequit circuit in original, using dummy data)
    async generateRagequitProof(input) {
        // Since there's no ragequit circuit, we'll return dummy proof data
        // In production, ragequit might not need a ZK proof, just signature verification
        console.warn('No ragequit circuit available - returning dummy proof data');
        
        return {
            proofA: Buffer.alloc(64, 4),
            proofB: Buffer.alloc(128, 5),
            proofC: Buffer.alloc(64, 6),
            publicSignals: [
                bigIntToBuffer32(BigInt(input.value)),
                input.label,
                (await this.generateCommitment(input.label, input.secret, input.value)).hash,
                await this.generateNullifier(
                    (await this.generateCommitment(input.label, input.secret, input.value)).hash,
                    input.secret
                ),
            ],
        };
    }

    // Generate commitment proof (for testing merkle tree)
    async generateCommitmentProof(input) {
        const circuit = this.loadCircuit('commitment');
        
        // Prepare circuit inputs
        const circuitInput = {
            value: BigInt(input.value),
            label: toBigIntBE(input.label),
            nullifier: toBigIntBE(input.nullifier),
            secret: toBigIntBE(input.secret),
        };
        
        // Generate proof using snarkjs
        const { proof, publicSignals } = await snarkjs.groth16.fullProve(
            circuitInput,
            circuit.wasmPath,
            circuit.zkeyPath
        );
        
        return {
            proof,
            publicSignals,
            commitmentHash: bigIntToBuffer32(BigInt(publicSignals[0])),
        };
    }

    // Verify proof locally (for testing)
    async verifyProof(circuitName, proof, publicSignals) {
        const vkeyPath = path.join(__dirname, `../../trusted-setup/final-keys/${circuitName}_vkey.json`);
        const vKey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));
        
        const res = await snarkjs.groth16.verify(vKey, publicSignals, proof);
        return res;
    }
}

module.exports = { ProofGenerator, bigIntToBuffer32, changeEndianness };