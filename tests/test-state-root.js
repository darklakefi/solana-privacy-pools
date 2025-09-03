const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey
} = require('@solana/web3.js');
const { initializePool } = require('./lib/pool');
const { deposit } = require('./lib/deposit');
const { parsePoolState } = require('./lib/pool-parser');
const { programKeypair, WSOL_MINT } = require('./lib/constants');

async function testStateRoot() {
    const connection = new Connection('http://localhost:8899', 'confirmed');

    // Create test accounts
    const authority = Keypair.generate();
    const user1 = Keypair.generate();

    console.log('Funding accounts...');
    await connection.requestAirdrop(authority.publicKey, 5 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(user1.publicKey, 5 * LAMPORTS_PER_SOL);

    // Wait for confirmation
    await new Promise(r => setTimeout(r, 1000));

    console.log('Initializing pool...');
    const { poolStateAccount } = await initializePool(
        connection,
        authority,
        programKeypair.publicKey,
        WSOL_MINT
    );
    console.log('Pool state:', poolStateAccount.toBase58());

    // Read initial state
    let accountInfo = await connection.getAccountInfo(poolStateAccount);
    let poolState = parsePoolState(accountInfo.data);
    console.log('\nInitial state:');
    console.log('  State tree size:', poolState.stateTree.size);
    console.log('  State tree depth:', poolState.stateTree.depth);
    console.log('  State tree root:', poolState.stateTree.root.toString('hex'));

    // Make a deposit
    console.log('\nMaking deposit...');
    const scope = poolState.scope;
    const depositResult = await deposit(
        connection,
        poolStateAccount,
        user1,
        BigInt(1 * LAMPORTS_PER_SOL),
        1, // nonce
        scope,
        WSOL_MINT
    );
    console.log('Deposit completed:', depositResult.txSig);

    // Read state after deposit
    accountInfo = await connection.getAccountInfo(poolStateAccount);
    poolState = parsePoolState(accountInfo.data);
    console.log('\nAfter deposit:');
    console.log('  State tree size:', poolState.stateTree.size);
    console.log('  State tree depth:', poolState.stateTree.depth);
    console.log('  State tree root:', poolState.stateTree.root.toString('hex'));

    // Check side nodes
    console.log('\n  Side nodes:');
    for (let i = 0; i <= Math.min(5, poolState.stateTree.depth); i++) {
        const node = poolState.stateTree.sideNodes[i];
        const isZero = node.every(b => b === 0);
        console.log(`    [${i}]: ${isZero ? 'ALL ZEROS' : node.toString('hex').slice(0, 32) + '...'}`);
    }

    if (poolState.stateTree.size > 0 && poolState.stateTree.root.every(b => b === 0)) {
        console.log('\n❌ ERROR: State root is all zeros after deposit!');
    } else {
        console.log('\n✅ State root is non-zero after deposit');
    }
}

testStateRoot().catch(console.error);
