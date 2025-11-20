/**
 * Merkle Tree Tests (P1)
 *
 * Tests for LeanIMT merkle tree operations.
 *
 * Uses @zk-kit/lean-imt library for building and verifying merkle trees.
 * These tests verify that our merkle tree implementation correctly computes
 * roots, generates proofs, and validates tree depth constraints.
 */

const { expect } = require('chai');
const { Keypair, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { buildMerkleTrees, validateTreeRoots } = require('@solana-privacy-pools/client/merkle');
const { LeanIMT } = require('@zk-kit/lean-imt');
const { buildPoseidon } = require('circomlibjs');

// Test helpers
const {
    setupTestContext,
    setupPool,
    createDeposits,
} = require('../security/helpers/test-setup');

describe('Merkle Tree Tests', function() {
    this.timeout(120000);

    let context, pool;

    // Setup shared pool
    before(async function() {
        context = await setupTestContext();
        pool = await setupPool(context.connection, context.authority);
    });

    describe('Root Computation', function() {

        it('should compute root correctly with multiple leaves', async function() {
            console.log('\n  🌳 Test: Multi-Leaf Root Computation');

            // Create fresh users
            const alice = Keypair.generate();
            const bob = Keypair.generate();
            const charlie = Keypair.generate();

            await context.connection.requestAirdrop(alice.publicKey, 100 * LAMPORTS_PER_SOL);
            await context.connection.requestAirdrop(bob.publicKey, 100 * LAMPORTS_PER_SOL);
            await context.connection.requestAirdrop(charlie.publicKey, 100 * LAMPORTS_PER_SOL);
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Create 3 deposits
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [
                    { user: alice, amount: BigInt(1 * LAMPORTS_PER_SOL) },
                    { user: bob, amount: BigInt(2 * LAMPORTS_PER_SOL) },
                    { user: charlie, amount: BigInt(3 * LAMPORTS_PER_SOL) },
                ],
                pool.scope
            );

            console.log(`  ✓ Created ${deposits.length} deposits`);

            // Build merkle trees
            const { stateTree, aspTree } = await buildMerkleTrees(deposits);

            console.log(`  ✓ State tree: ${stateTree.size} leaves, depth ${stateTree.depth}`);
            console.log(`  ✓ State root: ${stateTree.root.toString(16).slice(0, 32)}...`);
            console.log(`  ✓ ASP tree: ${aspTree.size} labels, depth ${aspTree.depth}`);
            console.log(`  ✓ ASP root: ${aspTree.root.toString(16).slice(0, 32)}...`);

            // Validate roots match on-chain state
            await validateTreeRoots(context.connection, pool.poolStateAccount, stateTree, aspTree);

            expect(stateTree.size).to.equal(3);
            expect(aspTree.size).to.equal(3);
            expect(stateTree.depth).to.be.greaterThan(0);
            expect(aspTree.depth).to.be.greaterThan(0);
        });

        it('should compute same root as @zk-kit/lean-imt reference', async function() {
            console.log('\n  🌳 Test: Root Matches zk-kit Reference');

            // Create Poseidon hash function
            const poseidon = await buildPoseidon();
            const hash = (a, b) => {
                const leftField = typeof a === 'bigint' ? a : BigInt(a);
                const rightField = typeof b === 'bigint' ? b : BigInt(b);
                return poseidon.F.toObject(poseidon([leftField, rightField]));
            };

            // Create reference tree directly with zk-kit
            const referenceTree = new LeanIMT(hash);

            // Create test leaves
            const leaves = [
                BigInt(100),
                BigInt(200),
                BigInt(300),
            ];

            // Insert into reference tree
            for (const leaf of leaves) {
                referenceTree.insert(leaf);
            }

            console.log(`  ✓ Reference tree root: ${referenceTree.root.toString(16).slice(0, 32)}...`);
            console.log(`  ✓ Reference tree depth: ${referenceTree.depth}`);

            // Create mock deposits with same leaves as commitments
            const mockDeposits = leaves.map(leaf => {
                const commitment = Buffer.alloc(32);
                let temp = leaf;
                for (let i = 31; i >= 0; i--) {
                    commitment[i] = Number(temp & 0xFFn);
                    temp >>= 8n;
                }
                return {
                    commitment,
                    label: BigInt(1), // Dummy label
                };
            });

            // Build tree using our implementation
            const { stateTree } = await buildMerkleTrees(mockDeposits);

            console.log(`  ✓ Our tree root:       ${stateTree.root.toString(16).slice(0, 32)}...`);
            console.log(`  ✓ Our tree depth:      ${stateTree.depth}`);

            // Verify roots match
            expect(stateTree.root.toString(16)).to.equal(referenceTree.root.toString(16));
            expect(stateTree.depth).to.equal(referenceTree.depth);

            console.log('  ✓ Roots match @zk-kit/lean-imt reference');
        });
    });

    describe('Proof Generation and Verification', function() {

        it('should generate and verify merkle proofs', async function() {
            console.log('\n  🌳 Test: Proof Generation and Verification');

            // Create fresh users (one per deposit to avoid token account issues)
            const users = [
                Keypair.generate(),
                Keypair.generate(),
                Keypair.generate(),
                Keypair.generate(),
                Keypair.generate(),
            ];

            for (const user of users) {
                await context.connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));

            // Create 5 deposits to have a non-trivial tree
            const deposits = await createDeposits(
                context.connection,
                pool.poolStateAccount,
                [
                    { user: users[0], amount: BigInt(1 * LAMPORTS_PER_SOL) },
                    { user: users[1], amount: BigInt(2 * LAMPORTS_PER_SOL) },
                    { user: users[2], amount: BigInt(3 * LAMPORTS_PER_SOL) },
                    { user: users[3], amount: BigInt(4 * LAMPORTS_PER_SOL) },
                    { user: users[4], amount: BigInt(5 * LAMPORTS_PER_SOL) },
                ],
                pool.scope
            );

            console.log(`  ✓ Created ${deposits.length} deposits`);

            // Build merkle trees
            const { stateTree, aspTree } = await buildMerkleTrees(deposits);

            console.log(`  ✓ Built trees: state depth ${stateTree.depth}, asp depth ${aspTree.depth}`);

            // Generate proof for middle deposit (index 2)
            const testIndex = 2;
            const stateProof = stateTree.generateProof(testIndex);
            const aspProof = aspTree.generateProof(testIndex);

            console.log(`  ✓ Generated proofs for index ${testIndex}`);
            console.log(`    State proof: ${stateProof.siblings.length} siblings`);
            console.log(`    ASP proof: ${aspProof.siblings.length} siblings`);

            // Verify proofs using zk-kit
            const stateVerified = stateTree.verifyProof(stateProof);
            const aspVerified = aspTree.verifyProof(aspProof);

            expect(stateVerified).to.be.true;
            expect(aspVerified).to.be.true;

            console.log('  ✓ Proofs verified successfully');

            // Verify proof structure
            expect(stateProof.index).to.equal(testIndex);
            expect(stateProof.root).to.equal(stateTree.root);
            expect(stateProof.siblings).to.be.an('array');
            expect(stateProof.siblings.length).to.equal(stateTree.depth);

            console.log('  ✓ Proof structure valid');
        });

        it('should reject invalid proofs', async function() {
            console.log('\n  🌳 Test: Invalid Proof Rejection');

            // Create Poseidon hash function
            const poseidon = await buildPoseidon();
            const hash = (a, b) => {
                const leftField = typeof a === 'bigint' ? a : BigInt(a);
                const rightField = typeof b === 'bigint' ? b : BigInt(b);
                return poseidon.F.toObject(poseidon([leftField, rightField]));
            };

            // Create tree with 3 leaves
            const tree = new LeanIMT(hash);
            tree.insert(BigInt(100));
            tree.insert(BigInt(200));
            tree.insert(BigInt(300));

            console.log(`  ✓ Created tree with ${tree.size} leaves`);

            // Generate valid proof for index 0
            const validProof = tree.generateProof(0);

            // Tamper with the proof by changing a sibling
            const tamperedProof = {
                ...validProof,
                siblings: validProof.siblings.map((s, i) => i === 0 ? s + 1n : s)
            };

            console.log('  ✓ Created tampered proof');

            // Verify original proof passes
            expect(tree.verifyProof(validProof)).to.be.true;

            // Verify tampered proof fails
            expect(tree.verifyProof(tamperedProof)).to.be.false;

            console.log('  ✓ Tampered proof correctly rejected');
        });
    });
});
