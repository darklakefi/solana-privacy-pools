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
    
    // Add all labels to ASP tree (skip null labels from withdrawal commitments)
    let skippedLabels = 0;
    for (const deposit of deposits) {
        // Label is already a BigInt
        // Skip null labels (from withdrawal commitments that reuse existing labels)
        if (deposit.label !== null && deposit.label !== undefined) {
            aspTree.insert(deposit.label);
        } else {
            skippedLabels++;
        }
    }

    console.log(`    Built trees: State=${stateTree.size} leaves, ASP=${aspTree.size} labels (skipped ${skippedLabels})`);
    console.log(`    State root: ${stateTree.root.toString(16).slice(0, 16)}..., ASP root: ${aspTree.root.toString(16).slice(0, 16)}...`);
    console.log(`    State depth: ${stateTree.depth}, ASP depth: ${aspTree.depth}`);

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

    // Calculate ASP index (accounting for skipped null labels)
    let aspIndex = 0;
    for (let i = 0; i < depositIndex; i++) {
        if (deposits[i].label !== null && deposits[i].label !== undefined) {
            aspIndex++;
        }
    }

    console.log(`    Debug: State tree size: ${stateTree.size}, ASP tree size: ${aspTree.size}`);
    console.log(`    Debug: depositIndex: ${depositIndex}, calculated aspIndex: ${aspIndex}`);

    // Generate proof for the label in ASP tree
    const aspProof = aspTree.generateProof(aspIndex);
    
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
        aspIndex: aspIndex
    };
}

/**
 * Validate that local merkle trees match on-chain roots
 * This ensures our local commitment tracking is in sync with blockchain state
 */
async function validateTreeRoots(connection, poolStateAccount, localStateTree, localAspTree) {
    const { parsePoolState } = require('./pool-parser');

    // Fetch current pool state
    const poolAccountInfo = await connection.getAccountInfo(poolStateAccount);
    if (!poolAccountInfo) {
        throw new Error('Pool state account not found');
    }

    const poolState = parsePoolState(poolAccountInfo.data);

    // Convert on-chain roots to BigInt for comparison
    let onchainStateRoot = BigInt(0);
    for (let i = 0; i < 32; i++) {
        onchainStateRoot = (onchainStateRoot << 8n) | BigInt(poolState.stateTree.root[i]);
    }

    let onchainAspRoot = BigInt(0);
    for (let i = 0; i < 32; i++) {
        onchainAspRoot = (onchainAspRoot << 8n) | BigInt(poolState.aspTree.root[i]);
    }

    // Compare roots
    const stateRootMatch = localStateTree.root === onchainStateRoot;
    const aspRootMatch = localAspTree.root === onchainAspRoot;

    if (!stateRootMatch || !aspRootMatch) {
        console.error('❌ Root mismatch detected!');
        console.error(`  Local state root:  ${localStateTree.root.toString(16)}`);
        console.error(`  Onchain state root: ${onchainStateRoot.toString(16)}`);
        console.error(`  Local ASP root:  ${localAspTree.root.toString(16)}`);
        console.error(`  Onchain ASP root: ${onchainAspRoot.toString(16)}`);
        console.error(`  Local state size: ${localStateTree.size}, Onchain: ${poolState.stateTree.size}`);
        console.error(`  Local ASP size: ${localAspTree.size}, Onchain: ${poolState.aspTree.size}`);
        throw new Error('Local merkle tree roots do not match on-chain state');
    }

    console.log(`  ✓ Root validation passed (state=${localStateTree.size} leaves, asp=${localAspTree.size} labels)`);

    return {
        onchainStateSize: poolState.stateTree.size,
        onchainAspSize: poolState.aspTree.size,
        onchainStateDepth: poolState.stateTree.depth,
        onchainAspDepth: poolState.aspTree.depth
    };
}

module.exports = {
    buildMerkleTrees,
    generateMerkleProofs,
    validateTreeRoots,
    FIELD_MODULUS
};