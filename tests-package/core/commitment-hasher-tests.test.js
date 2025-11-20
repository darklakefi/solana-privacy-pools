/**
 * Commitment Hasher Tests (P1)
 *
 * Tests for Poseidon hash commitment computation.
 *
 * The commitment hasher computes: commitment = Poseidon(value, label, nullifier, secret)
 * The nullifier hash computes: nullifierHash = Poseidon(nullifier)
 *
 * These tests verify hash properties without requiring an external TypeScript reference,
 * since the circuit itself is the canonical implementation.
 */

const { expect } = require('chai');
const { generateCommitmentProof } = require('@solana-privacy-pools/client/proof');

// Field modulus for BN254
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

describe('Commitment Hasher Tests', function() {
    this.timeout(60000);

    describe('Basic Hash Computation', function() {

        it('should compute commitment hash from Poseidon(value, label, nullifier, secret)', async function() {
            console.log('\n  🔒 Test: Basic Commitment Hash');

            const value = BigInt(1000000);
            const label = BigInt(42);
            const nullifier = BigInt(12345);
            const secret = BigInt(67890);

            const result = await generateCommitmentProof(value, label, nullifier, secret);

            console.log(`  ✓ Input: value=${value}, label=${label}, nullifier=${nullifier}, secret=${secret}`);
            console.log(`  ✓ Commitment: ${result.publicSignals.commitment.toString('hex').slice(0, 32)}...`);
            console.log(`  ✓ Nullifier hash: ${result.publicSignals.nullifierHash.toString('hex').slice(0, 32)}...`);

            // Verify outputs are 32 bytes
            expect(result.publicSignals.commitment).to.have.lengthOf(32);
            expect(result.publicSignals.nullifierHash).to.have.lengthOf(32);

            // Verify outputs are non-zero
            expect(result.publicSignals.commitment.toString('hex')).to.not.equal('0'.repeat(64));
            expect(result.publicSignals.nullifierHash.toString('hex')).to.not.equal('0'.repeat(64));
        });
    });

    describe('Hash Determinism', function() {

        it('should produce same commitment for same inputs', async function() {
            console.log('\n  🔒 Test: Hash Determinism');

            const value = BigInt(5000000);
            const label = BigInt(100);
            const nullifier = BigInt(9999);
            const secret = BigInt(8888);

            // Generate commitment twice with same inputs
            const result1 = await generateCommitmentProof(value, label, nullifier, secret);
            const result2 = await generateCommitmentProof(value, label, nullifier, secret);

            console.log(`  ✓ First commitment:  ${result1.publicSignals.commitment.toString('hex').slice(0, 32)}...`);
            console.log(`  ✓ Second commitment: ${result2.publicSignals.commitment.toString('hex').slice(0, 32)}...`);

            // Verify commitments match
            expect(result1.publicSignals.commitment.toString('hex')).to.equal(
                result2.publicSignals.commitment.toString('hex')
            );

            // Verify nullifier hashes match
            expect(result1.publicSignals.nullifierHash.toString('hex')).to.equal(
                result2.publicSignals.nullifierHash.toString('hex')
            );

            console.log('  ✓ Commitments are deterministic');
        });
    });

    describe('Hash Collision Resistance', function() {

        it('should produce different commitments for different values', async function() {
            console.log('\n  🔒 Test: Different Values');

            const label = BigInt(100);
            const nullifier = BigInt(1000);
            const secret = BigInt(2000);

            const result1 = await generateCommitmentProof(BigInt(1), label, nullifier, secret);
            const result2 = await generateCommitmentProof(BigInt(2), label, nullifier, secret);

            console.log(`  ✓ Value 1 commitment: ${result1.publicSignals.commitment.toString('hex').slice(0, 32)}...`);
            console.log(`  ✓ Value 2 commitment: ${result2.publicSignals.commitment.toString('hex').slice(0, 32)}...`);

            expect(result1.publicSignals.commitment.toString('hex')).to.not.equal(
                result2.publicSignals.commitment.toString('hex')
            );

            console.log('  ✓ Different values produce different commitments');
        });

        it('should produce different commitments for different labels', async function() {
            console.log('\n  🔒 Test: Different Labels');

            const value = BigInt(1000);
            const nullifier = BigInt(1000);
            const secret = BigInt(2000);

            const result1 = await generateCommitmentProof(value, BigInt(1), nullifier, secret);
            const result2 = await generateCommitmentProof(value, BigInt(2), nullifier, secret);

            console.log(`  ✓ Label 1 commitment: ${result1.publicSignals.commitment.toString('hex').slice(0, 32)}...`);
            console.log(`  ✓ Label 2 commitment: ${result2.publicSignals.commitment.toString('hex').slice(0, 32)}...`);

            expect(result1.publicSignals.commitment.toString('hex')).to.not.equal(
                result2.publicSignals.commitment.toString('hex')
            );

            console.log('  ✓ Different labels produce different commitments');
        });

        it('should produce different commitments for different nullifiers', async function() {
            console.log('\n  🔒 Test: Different Nullifiers');

            const value = BigInt(1000);
            const label = BigInt(100);
            const secret = BigInt(2000);

            const result1 = await generateCommitmentProof(value, label, BigInt(1), secret);
            const result2 = await generateCommitmentProof(value, label, BigInt(2), secret);

            console.log(`  ✓ Nullifier 1 commitment: ${result1.publicSignals.commitment.toString('hex').slice(0, 32)}...`);
            console.log(`  ✓ Nullifier 2 commitment: ${result2.publicSignals.commitment.toString('hex').slice(0, 32)}...`);

            expect(result1.publicSignals.commitment.toString('hex')).to.not.equal(
                result2.publicSignals.commitment.toString('hex')
            );

            // Also verify nullifier hashes are different
            expect(result1.publicSignals.nullifierHash.toString('hex')).to.not.equal(
                result2.publicSignals.nullifierHash.toString('hex')
            );

            console.log('  ✓ Different nullifiers produce different commitments and nullifier hashes');
        });

        it('should produce different commitments for different secrets', async function() {
            console.log('\n  🔒 Test: Different Secrets');

            const value = BigInt(1000);
            const label = BigInt(100);
            const nullifier = BigInt(1000);

            const result1 = await generateCommitmentProof(value, label, nullifier, BigInt(1));
            const result2 = await generateCommitmentProof(value, label, nullifier, BigInt(2));

            console.log(`  ✓ Secret 1 commitment: ${result1.publicSignals.commitment.toString('hex').slice(0, 32)}...`);
            console.log(`  ✓ Secret 2 commitment: ${result2.publicSignals.commitment.toString('hex').slice(0, 32)}...`);

            expect(result1.publicSignals.commitment.toString('hex')).to.not.equal(
                result2.publicSignals.commitment.toString('hex')
            );

            // Nullifier hashes should be the same (only depend on nullifier)
            expect(result1.publicSignals.nullifierHash.toString('hex')).to.equal(
                result2.publicSignals.nullifierHash.toString('hex')
            );

            console.log('  ✓ Different secrets produce different commitments');
            console.log('  ✓ Nullifier hash unchanged (only depends on nullifier)');
        });
    });

    describe('Nullifier Hash Independence', function() {

        it('should compute nullifier hash independent of value, label, and secret', async function() {
            console.log('\n  🔒 Test: Nullifier Hash Independence');

            const nullifier = BigInt(42424242);

            // Generate commitments with same nullifier but different other values
            const result1 = await generateCommitmentProof(
                BigInt(1000), BigInt(1), nullifier, BigInt(100)
            );
            const result2 = await generateCommitmentProof(
                BigInt(9999), BigInt(2), nullifier, BigInt(200)
            );

            console.log(`  ✓ Nullifier hash 1: ${result1.publicSignals.nullifierHash.toString('hex').slice(0, 32)}...`);
            console.log(`  ✓ Nullifier hash 2: ${result2.publicSignals.nullifierHash.toString('hex').slice(0, 32)}...`);

            // Nullifier hashes should be identical (only depend on nullifier)
            expect(result1.publicSignals.nullifierHash.toString('hex')).to.equal(
                result2.publicSignals.nullifierHash.toString('hex')
            );

            // Commitments should be different (depend on all inputs)
            expect(result1.publicSignals.commitment.toString('hex')).to.not.equal(
                result2.publicSignals.commitment.toString('hex')
            );

            console.log('  ✓ Nullifier hash is independent of value, label, and secret');
        });
    });

    describe('Boundary Values', function() {

        it('should handle zero values', async function() {
            console.log('\n  🔒 Test: Zero Values');

            const result = await generateCommitmentProof(
                BigInt(0),
                BigInt(0),
                BigInt(0),
                BigInt(0)
            );

            console.log(`  ✓ Zero commitment: ${result.publicSignals.commitment.toString('hex').slice(0, 32)}...`);
            console.log(`  ✓ Zero nullifier hash: ${result.publicSignals.nullifierHash.toString('hex').slice(0, 32)}...`);

            // Even with all zeros, outputs should be non-zero (Poseidon property)
            expect(result.publicSignals.commitment.toString('hex')).to.not.equal('0'.repeat(64));
            expect(result.publicSignals.nullifierHash.toString('hex')).to.not.equal('0'.repeat(64));

            console.log('  ✓ Zero inputs produce non-zero hashes');
        });

        it('should handle large field elements', async function() {
            console.log('\n  🔒 Test: Large Field Elements');

            // Use values close to field modulus
            const largeValue = FIELD_MODULUS - BigInt(1000);
            const largeLabel = FIELD_MODULUS - BigInt(2000);
            const largeNullifier = FIELD_MODULUS - BigInt(3000);
            const largeSecret = FIELD_MODULUS - BigInt(4000);

            const result = await generateCommitmentProof(
                largeValue,
                largeLabel,
                largeNullifier,
                largeSecret
            );

            console.log(`  ✓ Large value commitment: ${result.publicSignals.commitment.toString('hex').slice(0, 32)}...`);
            console.log(`  ✓ Large nullifier hash: ${result.publicSignals.nullifierHash.toString('hex').slice(0, 32)}...`);

            // Verify outputs are valid field elements
            expect(result.publicSignals.commitment).to.have.lengthOf(32);
            expect(result.publicSignals.nullifierHash).to.have.lengthOf(32);

            console.log('  ✓ Large field elements handled correctly');
        });
    });
});
