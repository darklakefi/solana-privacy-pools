const { LeanIMT } = require('@zk-kit/lean-imt');
const { buildPoseidon } = require('circomlibjs');

// Field modulus for BN254
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/**
 * Build merkle trees from deposits using zk-kit LeanIMT
 */
async function buildMerkleTrees(deposits) {
    // Initialize Poseidon
    const poseidon = await buildPoseidon();
    
    // Create hash function that matches our on-chain implementation
    // zk-kit expects a function that takes two arguments
    const hash = (a, b) => {
        // Convert to BigInt if needed
        const leftField = typeof a === 'bigint' ? a : BigInt(a);
        const rightField = typeof b === 'bigint' ? b : BigInt(b);
        
        // Hash using Poseidon
        const result = poseidon.F.toObject(poseidon([leftField, rightField]));
        return result;
    };
    
    // Create trees with Poseidon hash
    const stateTree = new LeanIMT(hash);
    const aspTree = new LeanIMT(hash);
    
    // Add all commitments to state tree
    for (let i = 0; i < deposits.length; i++) {
        const deposit = deposits[i];
        // Commitment is already a valid field element from the circuit
        // Convert directly to BigInt without modification
        let commitmentBigInt = BigInt(0);
        for (let j = 0; j < 32; j++) {
            commitmentBigInt = (commitmentBigInt << 8n) | BigInt(deposit.commitment[j]);
        }
        console.log(`    Inserting commitment ${i}: ${commitmentBigInt.toString(16).slice(0, 16)}...`);
        stateTree.insert(commitmentBigInt);
    }
    
    // Add all labels to ASP tree
    for (const deposit of deposits) {
        // Label is already a BigInt
        aspTree.insert(deposit.label);
    }
    
    return {
        stateTree,
        aspTree
    };
}

/**
 * Generate merkle proofs for a specific deposit
 */
async function generateMerkleProofs(deposits, depositIndex) {
    const { stateTree, aspTree } = await buildMerkleTrees(deposits);
    
    // Generate proof for the commitment in state tree
    const stateProof = stateTree.generateProof(depositIndex);
    
    // Generate proof for the label in ASP tree  
    const aspProof = aspTree.generateProof(depositIndex);
    
    // Pad siblings to 20 levels for circuit compatibility
    const padSiblings = (siblings) => {
        const padded = [...siblings];
        while (padded.length < 20) {
            padded.push(BigInt(0));
        }
        return padded;
    };
    
    return {
        stateRoot: stateTree.root,
        stateTreeDepth: stateTree.depth,
        stateProof: padSiblings(stateProof.siblings),
        stateIndex: depositIndex,
        aspRoot: aspTree.root,
        aspTreeDepth: aspTree.depth,
        aspProof: padSiblings(aspProof.siblings),
        aspIndex: depositIndex
    };
}

module.exports = {
    buildMerkleTrees,
    generateMerkleProofs,
    FIELD_MODULUS
};