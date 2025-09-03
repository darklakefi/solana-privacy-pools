const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey
} = require('@solana/web3.js');
const { initializePool } = require('./lib/pool');
const { deposit, createAndWrapWSol } = require('./lib/deposit');
const { parsePoolState } = require('./lib/pool-parser');
const { programKeypair, WSOL_MINT } = require('./lib/constants');

async function testSingleDeposit() {
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

    // Create WSOL account for user
    console.log('Creating WSOL account...');
    await createAndWrapWSol(connection, user1, LAMPORTS_PER_SOL);

    // Read initial state
    let accountInfo = await connection.getAccountInfo(poolStateAccount);
    let poolState = parsePoolState(accountInfo.data);
    console.log('\nBefore deposit:');
    console.log('  State tree size:', poolState.stateTree.size);
    console.log('  State tree depth:', poolState.stateTree.depth);
    const rootBefore = poolState.stateTree.root;
    console.log('  State tree root:', rootBefore.toString('hex'));

    // Check side nodes before
    console.log('  Side nodes before:');
    for (let i = 0; i <= 3; i++) {
        const node = poolState.stateTree.sideNodes[i];
        const isZero = node.every(b => b === 0);
        console.log(`    [${i}]: ${isZero ? 'ALL ZEROS' : node.toString('hex').slice(0, 16) + '...'}`);
    }

    // Make a deposit
    console.log('\nMaking deposit...');
    const scope = poolState.scope;

    // Get deposit transaction and check logs
    const depositResult = await deposit(
        connection,
        poolStateAccount,
        user1,
        BigInt(1 * LAMPORTS_PER_SOL),
        1, // nonce
        scope,
        WSOL_MINT
    );
    console.log('Deposit TX:', depositResult.txSig);

    // Get transaction logs
    const txDetails = await connection.getTransaction(depositResult.txSig, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
    });

    if (txDetails && txDetails.meta && txDetails.meta.logMessages) {
        console.log('\nProgram logs:');
        txDetails.meta.logMessages.forEach(log => {
            if (log.includes('LeanIMT') || log.includes('State tree') || log.includes('state_tree')) {
                console.log('  ', log);
            }
        });
    }

    // Read state after deposit
    accountInfo = await connection.getAccountInfo(poolStateAccount);
    poolState = parsePoolState(accountInfo.data);
    console.log('\nAfter deposit:');
    console.log('  State tree size:', poolState.stateTree.size);
    console.log('  State tree depth:', poolState.stateTree.depth);
    const rootAfter = poolState.stateTree.root;
    console.log('  State tree root:', rootAfter.toString('hex'));

    // Check side nodes after
    console.log('  Side nodes after:');
    for (let i = 0; i <= 3; i++) {
        const node = poolState.stateTree.sideNodes[i];
        const isZero = node.every(b => b === 0);
        console.log(`    [${i}]: ${isZero ? 'ALL ZEROS' : node.toString('hex').slice(0, 16) + '...'}`);
    }

    // Check if anything changed
    if (rootBefore.equals(rootAfter)) {
        console.log('\n❌ ERROR: Root did not change after deposit!');
    } else {
        console.log('\n✅ Root changed after deposit');
    }

    if (poolState.stateTree.size === 0) {
        console.log('❌ ERROR: Size is still 0 after deposit!');
    } else {
        console.log('✅ Size increased to', poolState.stateTree.size);
    }
}

testSingleDeposit().catch(console.error);
