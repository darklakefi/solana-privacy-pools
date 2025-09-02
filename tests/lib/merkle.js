const { keccak256 } = require('js-sha3');
const { buildPoseidon } = require('circomlibjs');

// Field modulus for BN254
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

// Convert hash to field element
function hashToField(hashBuffer) {
    let hashBigInt = BigInt(0);
    for (let i = 0; i < 32; i++) {
        hashBigInt = (hashBigInt << 8n) | BigInt(hashBuffer[i]);
    }
    return hashBigInt % FIELD_MODULUS;
}

/**
 * Build a Lean IMT (Incremental Merkle Tree) from leaves
 * This matches the Rust implementation in the program
 */
class LeanIMT {
    constructor(maxDepth = 20) {
        this.maxDepth = maxDepth;
        this.leaves = [];
        this.nodes = {};
        this.depth = 0;
        this.poseidon = null;
    }

    async init() {
        this.poseidon = await buildPoseidon();
    }

    // Hash two nodes together using Poseidon
    hash(left, right) {
        if (!this.poseidon) {
            throw new Error('LeanIMT not initialized. Call init() first');
        }
        
        // Convert to field elements if needed
        const leftField = typeof left === 'bigint' ? left : hashToField(left);
        const rightField = typeof right === 'bigint' ? right : hashToField(right);
        
        // Use Poseidon hash
        const hash = this.poseidon.F.toObject(this.poseidon([leftField, rightField]));
        return hash;
    }

    // Add a leaf to the tree
    insert(leaf) {
        const leafField = typeof leaf === 'bigint' ? leaf : hashToField(leaf);
        const index = this.leaves.length;
        this.leaves.push(leafField);
        
        // Update tree depth if needed
        const requiredDepth = Math.ceil(Math.log2(this.leaves.length));
        if (requiredDepth > this.depth) {
            this.depth = requiredDepth;
        }
        
        // Store leaf at level 0
        this.nodes[`0-${index}`] = leafField;
        
        // Update internal nodes
        this.updatePath(index);
        
        return index;
    }

    // Update the path from a leaf to the root
    updatePath(leafIndex) {
        let currentIndex = leafIndex;
        
        for (let level = 0; level < this.depth; level++) {
            const siblingIndex = currentIndex ^ 1;
            const parentIndex = Math.floor(currentIndex / 2);
            
            const left = this.nodes[`${level}-${currentIndex & ~1}`] || BigInt(0);
            const right = this.nodes[`${level}-${(currentIndex & ~1) + 1}`] || BigInt(0);
            
            const parentHash = this.hash(left, right);
            this.nodes[`${level + 1}-${parentIndex}`] = parentHash;
            
            currentIndex = parentIndex;
        }
    }

    // Get the root of the tree
    getRoot() {
        if (this.leaves.length === 0) {
            return BigInt(0);
        }
        
        // Root is at the top level
        return this.nodes[`${this.depth}-0`] || BigInt(0);
    }

    // Generate a membership proof for a leaf
    generateProof(leafIndex) {
        if (leafIndex >= this.leaves.length) {
            throw new Error('Leaf index out of bounds');
        }
        
        const siblings = [];
        let currentIndex = leafIndex;
        
        for (let level = 0; level < this.maxDepth; level++) {
            if (level < this.depth) {
                const siblingIndex = currentIndex ^ 1;
                const sibling = this.nodes[`${level}-${siblingIndex}`] || BigInt(0);
                siblings.push(sibling);
                currentIndex = Math.floor(currentIndex / 2);
            } else {
                // Pad with zeros for unused levels
                siblings.push(BigInt(0));
            }
        }
        
        return {
            siblings,
            leafIndex,
            leaf: this.leaves[leafIndex],
            root: this.getRoot()
        };
    }

    // Verify a membership proof
    verifyProof(leaf, leafIndex, siblings, root) {
        let currentHash = typeof leaf === 'bigint' ? leaf : hashToField(leaf);
        let currentIndex = leafIndex;
        
        for (let i = 0; i < this.depth; i++) {
            const sibling = siblings[i];
            
            if ((currentIndex & 1) === 0) {
                // Current is left, sibling is right
                currentHash = this.hash(currentHash, sibling);
            } else {
                // Current is right, sibling is left
                currentHash = this.hash(sibling, currentHash);
            }
            
            currentIndex = Math.floor(currentIndex / 2);
        }
        
        return currentHash === root;
    }
}

/**
 * Build merkle trees from deposits data
 */
async function buildMerkleTrees(deposits) {
    // Initialize trees
    const stateTree = new LeanIMT(20);
    const aspTree = new LeanIMT(20);
    
    await stateTree.init();
    await aspTree.init();
    
    // Add all commitments to state tree
    for (const deposit of deposits) {
        // Convert commitment to field element
        const commitmentField = hashToField(deposit.commitment);
        stateTree.insert(commitmentField);
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
    
    return {
        stateRoot: stateTree.getRoot(),
        stateTreeDepth: stateTree.depth,
        stateProof: stateProof.siblings,
        stateIndex: depositIndex,
        aspRoot: aspTree.getRoot(),
        aspTreeDepth: aspTree.depth,
        aspProof: aspProof.siblings,
        aspIndex: depositIndex
    };
}

module.exports = {
    LeanIMT,
    buildMerkleTrees,
    generateMerkleProofs,
    hashToField
};