const { generateCommitmentProof, verifyCommitmentProof } = require('./lib/proof');
const { computeLabel, computeScope } = require('./lib/proof');
const { BN } = require('bn.js');
const crypto = require('crypto');

async function testProof() {
    // Test values
    const amount = 1000000000n; // 1 SOL in lamports
    const nullifier = BigInt('0x' + crypto.randomBytes(31).toString('hex'));
    const secret = BigInt('0x' + crypto.randomBytes(31).toString('hex'));
    
    // Compute scope and label
    const mintBuffer = Buffer.from('So11111111111111111111111111111111111111112', 'base64').slice(0, 32);
    const scope = computeScope(mintBuffer);
    const label = computeLabel(scope.buffer, 0);
    
    console.log('Test values:');
    console.log('  Amount:', amount.toString());
    console.log('  Label:', label.bigint.toString(16).padStart(64, '0'));
    console.log('  Nullifier:', nullifier.toString(16).padStart(64, '0'));
    console.log('  Secret:', secret.toString(16).padStart(64, '0'));
    
    // Generate proof
    console.log('\nGenerating proof...');
    const { proof, publicSignals, rawProof, rawPublicSignals } = await generateCommitmentProof(
        amount,
        label.bigint,
        nullifier,
        secret
    );
    
    console.log('\nPublic signals extracted:');
    console.log('  Commitment:', Buffer.from(publicSignals.commitment).toString('hex'));
    console.log('  NullifierHash:', Buffer.from(publicSignals.nullifierHash).toString('hex'));
    console.log('  Value:', Buffer.from(publicSignals.value).toString('hex'));
    console.log('  Label:', Buffer.from(publicSignals.label).toString('hex'));
    
    // Verify locally using raw proof and signals
    console.log('\nVerifying proof locally...');
    const snarkjs = require('snarkjs');
    const fs = require('fs');
    const vKey = JSON.parse(fs.readFileSync('../build/commitment/groth16_vkey.json', 'utf8'));
    const isValid = await snarkjs.groth16.verify(vKey, rawPublicSignals, rawProof);
    console.log('Proof is valid:', isValid);
    
    return isValid;
}

testProof().then(result => {
    console.log('\nTest completed:', result ? 'SUCCESS' : 'FAILED');
    process.exit(result ? 0 : 1);
}).catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});