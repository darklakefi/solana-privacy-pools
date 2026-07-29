const assert = require('node:assert/strict');
const test = require('node:test');
const { PublicKey } = require('@solana/web3.js');

const { programKeypair } = require('./constants');
const { getNullifierPDA } = require('./pool');

test('nullifier PDA is canonical and scoped to its pool', () => {
    const poolA = new PublicKey(Buffer.alloc(32, 1));
    const poolB = new PublicKey(Buffer.alloc(32, 2));
    const hashA = Buffer.alloc(32, 3);
    const hashB = Buffer.alloc(32, 4);

    const first = getNullifierPDA(poolA, hashA);
    const repeated = getNullifierPDA(poolA, hashA);
    const otherPool = getNullifierPDA(poolB, hashA);
    const otherHash = getNullifierPDA(poolA, hashB);
    const [expected, expectedBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('nullifier'), poolA.toBuffer(), hashA],
        programKeypair.publicKey
    );

    assert.equal(first.nullifierPDA.toBase58(), expected.toBase58());
    assert.equal(first.nullifierBump, expectedBump);
    assert.equal(repeated.nullifierPDA.toBase58(), first.nullifierPDA.toBase58());
    assert.notEqual(otherPool.nullifierPDA.toBase58(), first.nullifierPDA.toBase58());
    assert.notEqual(otherHash.nullifierPDA.toBase58(), first.nullifierPDA.toBase58());
    assert.equal(PublicKey.isOnCurve(first.nullifierPDA.toBytes()), false);
});

test('nullifier PDA rejects malformed hashes', () => {
    const pool = new PublicKey(Buffer.alloc(32, 1));

    assert.throws(
        () => getNullifierPDA(pool, Buffer.alloc(31)),
        /exactly 32 bytes/
    );
});
