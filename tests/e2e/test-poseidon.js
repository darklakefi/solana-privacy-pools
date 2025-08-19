const { TestHelpers } = require('../utils/test-helpers');

async function testPoseidon() {
    console.log('Testing Poseidon initialization...');
    
    const helpers = new TestHelpers();
    
    // Test commitment generation
    const label = Buffer.alloc(32);
    label.write('test-label');
    const secret = Buffer.alloc(32);
    secret.write('test-secret');
    const value = 1000;
    
    try {
        const commitment = await helpers.generateCommitment(label, secret, value);
        console.log('✅ Commitment generated:', commitment.toString('hex'));
        
        const nullifier = await helpers.generateNullifier(commitment, secret);
        console.log('✅ Nullifier generated:', nullifier.toString('hex'));
        
        console.log('✅ Poseidon working correctly!');
    } catch (error) {
        console.error('❌ Poseidon test failed:', error);
    }
}

testPoseidon();