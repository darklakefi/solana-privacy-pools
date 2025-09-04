const { LeanIMT } = require('@zk-kit/lean-imt');
const { buildPoseidon } = require('circomlibjs');

async function testLeanIMT() {
    console.log('=== Testing zk-kit LeanIMT with Poseidon (matching Rust implementation) ===\n');
    
    // Initialize Poseidon
    const poseidon = await buildPoseidon();
    
    // Create hash function matching our on-chain implementation
    // The zk-kit library expects a function that takes TWO values and returns ONE
    const hash = (a, b) => {
        // Convert to BigInt if needed
        const leftField = typeof a === 'bigint' ? a : BigInt(a);
        const rightField = typeof b === 'bigint' ? b : BigInt(b);
        
        // Hash using Poseidon
        const result = poseidon.F.toObject(poseidon([leftField, rightField]));
        console.log(`  Poseidon(${leftField.toString(16).slice(0,8)}..., ${rightField.toString(16).slice(0,8)}...) = ${result.toString(16).slice(0,16)}...`);
        return result;
    };
    
    // Test 1: Simple 3-element tree matching our Rust test
    console.log('Test 1: Simple 3-element tree (matching Rust test)\n');
    const tree = new LeanIMT(hash);
    
    // Use the same test values as our Rust debug test
    // In Rust we use: [0, 0, ..., 0, 0, 0, 48, 57] for 12345 big-endian
    const values = [
        BigInt('0x3039'), // 12345 in big-endian at end of 32 bytes
        BigInt('0xD431'), // 54321 in big-endian
        BigInt('0x4E61BC5'), // 82525125 in big-endian
    ];
    
    console.log('Inserting values:');
    values.forEach((v, i) => {
        console.log(`  [${i}]: 0x${v.toString(16)}`);
        tree.insert(v);
        console.log(`    Root after insert: ${tree.root.toString(16)}`);
        console.log(`    Size: ${tree.size}, Depth: ${tree.depth}`);
    });
    
    console.log('\n=== Final tree state ===');
    console.log(`Size: ${tree.size}`);
    console.log(`Depth: ${tree.depth}`);
    console.log(`Root: ${tree.root.toString(16)}`);
    
    // Test 2: Test with proper 32-byte commitments like from circuit
    console.log('\n\nTest 2: Circuit-compatible 32-byte commitments\n');
    
    const tree2 = new LeanIMT(hash);
    
    // Create proper field elements that match what we get from the circuit
    const commitments = [
        BigInt('0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'),
        BigInt('0x2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40'),
        BigInt('0x4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f60'),
    ];
    
    console.log('Inserting commitments:');
    commitments.forEach((c, i) => {
        tree2.insert(c);
        console.log(`  [${i}]: ${c.toString(16).slice(0, 32)}...`);
        console.log(`    Root: ${tree2.root.toString(16).slice(0, 32)}...`);
    });
    
    // Test 3: Generate proofs (matching what circuit expects)
    console.log('\n\nTest 3: Proof generation for circuit compatibility\n');
    
    for (let i = 0; i < commitments.length; i++) {
        const proof = tree2.generateProof(i);
        console.log(`\nProof for index ${i}:`);
        console.log(`  Index: ${proof.index}`);
        console.log(`  Leaf: ${proof.leaf.toString(16).slice(0, 32)}...`);
        console.log(`  Root: ${proof.root.toString(16).slice(0, 32)}...`);
        console.log(`  Siblings (${proof.siblings.length} total):`);
        
        // Show first few siblings
        for (let j = 0; j < Math.min(3, proof.siblings.length); j++) {
            const sibling = proof.siblings[j];
            if (sibling !== null) {
                console.log(`    [${j}]: ${sibling.toString(16).slice(0, 32)}...`);
            } else {
                console.log(`    [${j}]: null`);
            }
        }
        
        // Verify the proof manually
        let current = proof.leaf;
        for (let level = 0; level < proof.siblings.length; level++) {
            const sibling = proof.siblings[level];
            if (sibling === null) continue;
            
            if ((proof.index >> level) & 1) {
                // Current is right child
                current = hash(sibling, current);
            } else {
                // Current is left child
                current = hash(current, sibling);
            }
        }
        
        const verified = current === tree2.root;
        console.log(`  Manual verification: ${verified ? '✅ PASS' : '❌ FAIL'}`);
        if (!verified) {
            console.log(`    Expected: ${tree2.root.toString(16)}`);
            console.log(`    Got:      ${current.toString(16)}`);
        }
    }
    
    // Test 4: Match exact behavior with our on-chain Rust implementation
    console.log('\n\nTest 4: Match exact on-chain behavior\n');
    
    const tree3 = new LeanIMT(hash);
    
    // Simulate the exact deposits from our integration test
    // These would be actual commitment hashes from the circuit
    const deposit1Commitment = BigInt('0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef');
    const deposit2Commitment = BigInt('0xfedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321');
    
    console.log('Simulating on-chain deposits:');
    tree3.insert(deposit1Commitment);
    console.log(`  Deposit 1 root: ${tree3.root.toString(16).slice(0, 32)}...`);
    
    tree3.insert(deposit2Commitment);
    console.log(`  Deposit 2 root: ${tree3.root.toString(16).slice(0, 32)}...`);
    
    // Generate proof for withdrawal (deposit at index 0)
    const withdrawalProof = tree3.generateProof(0);
    console.log('\nWithdrawal proof for deposit 1:');
    console.log(`  Proof index: ${withdrawalProof.index}`);
    console.log(`  Proof siblings: ${withdrawalProof.siblings.length} levels`);
    console.log(`  First sibling should be deposit2: ${withdrawalProof.siblings[0]?.toString(16).slice(0, 32)}...`);
    console.log(`  Expected:                         ${deposit2Commitment.toString(16).slice(0, 32)}...`);
    console.log(`  Match: ${withdrawalProof.siblings[0] === deposit2Commitment ? '✅' : '❌'}`);
}

testLeanIMT().catch(console.error);