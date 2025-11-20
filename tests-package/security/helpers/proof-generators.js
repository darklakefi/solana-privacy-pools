/**
 * Proof generation helpers for testing
 *
 * These utilities help create invalid proofs for security testing
 */
const crypto = require('crypto');
const {
    generateCommitmentProof,
    generateWithdrawProof,
    FIELD_MODULUS,
} = require('@solana-privacy-pools/client/proof');

/**
 * Generate a random field element
 */
function randomFieldElement() {
    const bytes = crypto.randomBytes(32);
    let bigInt = BigInt(0);
    for (let i = 0; i < 32; i++) {
        bigInt = (bigInt << 8n) | BigInt(bytes[i]);
    }
    return bigInt % FIELD_MODULUS;
}

/**
 * Generate a fake commitment (not in any merkle tree)
 */
function generateFakeCommitment() {
    const value = randomFieldElement();
    const label = randomFieldElement();
    const nullifier = randomFieldElement();
    const secret = randomFieldElement();

    return {
        value,
        label,
        nullifier,
        secret,
        // Note: actual commitment would be poseidon(value, label, nullifier, secret)
        // This is just random data
        commitment: randomFieldElement(),
        nullifierHash: randomFieldElement(),
    };
}

/**
 * Generate invalid merkle proof siblings (all zeros or random)
 */
function generateInvalidMerkleSiblings(depth, mode = 'zeros') {
    const siblings = [];
    for (let i = 0; i < depth; i++) {
        if (mode === 'zeros') {
            siblings.push(0n);
        } else {
            siblings.push(randomFieldElement());
        }
    }
    return siblings;
}

/**
 * Create deposit info structure for testing
 */
function createTestDeposit(overrides = {}) {
    const defaults = {
        value: BigInt(1000),
        label: randomFieldElement(),
        nullifier: randomFieldElement(),
        secret: randomFieldElement(),
        nonce: 0,
    };

    return { ...defaults, ...overrides };
}

/**
 * Create an invalid root (not in pool's root history)
 */
function generateInvalidRoot() {
    return randomFieldElement();
}

module.exports = {
    randomFieldElement,
    generateFakeCommitment,
    generateInvalidMerkleSiblings,
    createTestDeposit,
    generateInvalidRoot,
    generateCommitmentProof,
    generateWithdrawProof,
};
