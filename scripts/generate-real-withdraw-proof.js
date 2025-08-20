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

// Implement Lean IMT matching the circuit's expectations
class LeanIMT {
    constructor(poseidonHash, maxDepth) {
        this.poseidonHash = poseidonHash;
        this.maxDepth = maxDepth;
        this.nodes = [[]]; // nodes[level][index]
        
        // Start with empty tree
        for (let i = 0; i <= maxDepth; i++) {
            this.nodes[i] = [];
        }
    }
    
    get depth() {
        // Dynamic depth based on number of leaves
        const size = this.nodes[0].length;
        if (size === 0) return 0;
        if (size === 1) return 0; // Single leaf at depth 0
        return Math.ceil(Math.log2(size));
    }
    
    get root() {
        const size = this.nodes[0].length;
        if (size === 0) return 0n;
        if (size === 1) return this.nodes[0][0]; // Single leaf is the root
        const d = this.depth;
        return this.nodes[d][0];
    }
    
    insert(leaf) {
        const index = this.nodes[0].length;
        
        // Check if we need to add a new level
        const newDepth = Math.ceil(Math.log2(index + 1));
        while (this.nodes.length <= newDepth) {
            this.nodes.push([]);
        }
        
        let node = leaf;
        let currentIndex = index;
        
        for (let level = 0; level <= newDepth; level++) {
            this.nodes[level][currentIndex] = node;
            
            if (level < newDepth) {
                // Check if this is a right node (odd index)
                if (currentIndex & 1) {
                    // It's a right node, hash with left sibling
                    const sibling = this.nodes[level][currentIndex - 1];
                    node = this.poseidonHash([sibling, node]);
                }
                // For left nodes without right sibling, the parent equals the node itself
                // This is handled implicitly by not changing 'node'
                
                currentIndex >>= 1;
            }
        }
        
        return index;
    }
    
    getProof(index) {
        if (index >= this.nodes[0].length) {
            throw new Error('Index out of bounds');
        }
        
        const siblings = [];
        let currentIndex = index;
        
        for (let level = 0; level < this.maxDepth; level++) {
            let sibling = 0n;
            
            if (level < this.depth) {
                const isRight = currentIndex & 1;
                const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
                
                // Check if sibling exists
                if (siblingIndex < this.nodes[level].length) {
                    sibling = this.nodes[level][siblingIndex];
                }
                // If sibling doesn't exist, it stays 0
                
                currentIndex >>= 1;
            }
            
            siblings.push(sibling);
        }
        
        return siblings;
    }
    
    // Verify that a proof generates the expected root
    verifyProof(leaf, index, siblings, depth) {
        let node = leaf;
        let idx = index;
        
        for (let i = 0; i < this.maxDepth; i++) {
            const sibling = siblings[i];
            
            if (sibling !== 0n) {
                // Hash with sibling
                if (idx & 1) {
                    // Current is right, sibling is left
                    node = this.poseidonHash([sibling, node]);
                } else {
                    // Current is left, sibling is right
                    node = this.poseidonHash([node, sibling]);
                }
            }
            // If sibling is 0, node value propagates up unchanged
            
            idx >>= 1;
        }
        
        return node;
    }
}

// Generate a withdrawal proof with the actual merkle tree structure
async function generateRealWithdrawProof() {
    console.log('Building Poseidon hash function...');
    const poseidon = await buildPoseidon();
    const poseidonHash = (inputs) => {
        const result = poseidon(inputs);
        return poseidon.F.toObject(result);
    };
    
    // Create Lean IMT tree matching circuit expectations
    const maxTreeDepth = 32; // Circuit compiled with maxDepth=32
    const tree = new LeanIMT(poseidonHash, maxTreeDepth);
    
    // Define commitment parameters
    const existingValue = BigInt("2000000000"); // 2 tokens
    const withdrawnValue = BigInt("1000000000"); // 1 token
    const label = BigInt("5555555555555555555");
    const existingNullifier = BigInt("123456789");
    const existingSecret = BigInt("987654321");
    const newNullifier = BigInt("111111111");
    const newSecret = BigInt("222222222");
    
    // Add some dummy commitments first to build tree depth
    console.log('Adding dummy commitments to build tree depth...');
    for (let i = 0; i < 15; i++) {
        const dummyCommitment = poseidonHash([BigInt(i+1), BigInt(i+1), BigInt(i+1), BigInt(i+1)]);
        tree.insert(dummyCommitment);
    }
    
    // Compute existing commitment hash using Poseidon4
    const existingCommitment = poseidonHash([existingValue, label, existingNullifier, existingSecret]);
    console.log('Existing commitment:', existingCommitment.toString());
    
    // Insert the actual commitment
    const leafIndex = tree.insert(existingCommitment);
    console.log('Leaf index:', leafIndex);
    console.log('Tree depth:', tree.depth);
    console.log('Tree root after insertion:', tree.root.toString());
    
    // Get merkle proof
    const siblings = tree.getProof(leafIndex);
    console.log('Number of siblings:', siblings.length);
    
    // For ASP tree, we'll use a Lean IMT with labels
    const aspTree = new LeanIMT(poseidonHash, maxTreeDepth);
    
    // Add dummy labels to build depth
    for (let i = 0; i < 15; i++) {
        aspTree.insert(BigInt(i + 1000));
    }
    
    // Insert the actual label
    const aspIndex = aspTree.insert(label);
    const aspSiblings = aspTree.getProof(aspIndex);
    console.log('ASP tree depth:', aspTree.depth);
    
    // Context (would be keccak256(IPrivacyPool.Withdrawal, scope) % SNARK_SCALAR_FIELD in real usage)
    const context = BigInt("1111111111111111111");
    
    // Siblings should already be length 32 from LeanIMT.getProof
    console.log('State siblings length:', siblings.length);
    console.log('ASP siblings length:', aspSiblings.length);
    
    const input = {
        // Public inputs
        withdrawnValue: withdrawnValue.toString(),
        stateRoot: tree.root.toString(),
        stateTreeDepth: tree.depth.toString(), // Use actual depth
        ASPRoot: aspTree.root.toString(),
        ASPTreeDepth: aspTree.depth.toString(), // Use actual depth
        context: context.toString(),
        
        // Private inputs
        label: label.toString(),
        existingValue: existingValue.toString(),
        existingNullifier: existingNullifier.toString(),
        existingSecret: existingSecret.toString(),
        newNullifier: newNullifier.toString(),
        newSecret: newSecret.toString(),
        
        // Merkle proofs
        stateSiblings: siblings.map(s => s.toString()),
        stateIndex: leafIndex.toString(),
        ASPSiblings: aspSiblings.map(s => s.toString()),
        ASPIndex: aspIndex.toString()
    };
    
    // Verify the proof locally first
    console.log('\nVerifying merkle proof locally...');
    const verifiedRoot = tree.verifyProof(existingCommitment, leafIndex, siblings, tree.depth);
    console.log('Verified root:', verifiedRoot.toString());
    console.log('Expected root:', tree.root.toString());
    console.log('Roots match:', verifiedRoot === tree.root);
    
    const aspVerifiedRoot = aspTree.verifyProof(label, aspIndex, aspSiblings, aspTree.depth);
    console.log('ASP verified root:', aspVerifiedRoot.toString());
    console.log('ASP expected root:', aspTree.root.toString());
    console.log('ASP roots match:', aspVerifiedRoot === aspTree.root);
    
    console.log('\nGenerating withdrawal proof...');
    console.log('Input summary:');
    console.log('  State root:', tree.root.toString());
    console.log('  ASP root:', aspTree.root.toString());
    console.log('  Withdrawn value:', withdrawnValue.toString());
    console.log('  State tree depth:', tree.depth);
    console.log('  ASP tree depth:', aspTree.depth);
    
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
    
    console.log('\nProof generated successfully!');
    console.log('Public signals:');
    publicSignals.forEach((signal, idx) => {
        console.log(`  ${idx}: ${signal}`);
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
        treeRoot: tree.root.toString(),
        commitment: existingCommitment.toString()
    };
    
    const outputPath = path.join(__dirname, 'real-withdraw-proof.json');
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    
    console.log(`\nProof saved to ${outputPath}`);
    
    // Print JavaScript test code
    console.log('\n// JavaScript code for the test:');
    console.log('const proofData = {');
    console.log(`  proof_a: Buffer.from([${result.proof.proofA.join(', ')}]),`);
    console.log(`  proof_b: Buffer.from([${result.proof.proofB.join(', ')}]),`);
    console.log(`  proof_c: Buffer.from([${result.proof.proofC.join(', ')}]),`);
    console.log('  public_signals: [');
    result.publicSignals.forEach((signal, idx) => {
        console.log(`    Buffer.from([${signal.join(', ')}]), // Signal ${idx}`);
    });
    console.log('  ]');
    console.log('};');
    
    return result;
}

// Run if called directly
if (require.main === module) {
    generateRealWithdrawProof()
        .then(() => process.exit(0))
        .catch((error) => {
            console.error('Error generating proof:', error);
            process.exit(1);
        });
}

module.exports = { generateRealWithdrawProof };