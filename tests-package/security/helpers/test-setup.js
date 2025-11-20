/**
 * Test setup utilities for security tests
 */
const {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const {
    WSOL_MINT,
    programKeypair,
    initializePool,
    parsePoolState,
    createAndWrapWSol,
    deposit,
} = require('@solana-privacy-pools/client');

/**
 * Create a test context with connection and funded accounts
 */
async function setupTestContext() {
    const connection = new Connection('http://localhost:8899', 'confirmed');

    // Create accounts
    const authority = Keypair.generate();
    const users = {
        alice: Keypair.generate(),
        bob: Keypair.generate(),
        charlie: Keypair.generate(),
        attacker: Keypair.generate(),
    };

    // Fund accounts
    await connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL);
    for (const user of Object.values(users)) {
        await connection.requestAirdrop(user.publicKey, 100 * LAMPORTS_PER_SOL);
    }

    // Wait for airdrops to confirm
    await new Promise(resolve => setTimeout(resolve, 1000));

    return {
        connection,
        authority,
        users,
        programId: programKeypair.publicKey,
    };
}

/**
 * Initialize a privacy pool for testing
 */
async function setupPool(connection, authority) {
    const {
        poolStateAccount,
        vaultPDA,
        poolTokenAccount,
        scope
    } = await initializePool(connection, authority, WSOL_MINT);

    return {
        poolStateAccount,
        vaultPDA,
        poolTokenAccount,
        scope,
    };
}

/**
 * Create deposits for testing
 * @param {Connection} connection
 * @param {PublicKey} poolStateAccount
 * @param {Array} depositors Array of {user: Keypair, amount: bigint}
 * @param {Buffer} scope
 * @returns {Array} Array of deposit info
 */
async function createDeposits(connection, poolStateAccount, depositors, scope) {
    const deposits = [];

    // Get current pool nonce to continue from where pool left off
    const poolState = await getPoolState(connection, poolStateAccount);
    let currentNonce = poolState.nonce;

    for (let i = 0; i < depositors.length; i++) {
        const { user, amount } = depositors[i];

        // Wrap SOL to WSOL
        await createAndWrapWSol(connection, user, amount);

        // Make deposit with current nonce
        const depositResult = await deposit(
            connection,
            poolStateAccount,
            user,
            amount,
            currentNonce, // Use pool's current nonce
            scope,
            WSOL_MINT
        );

        currentNonce++; // Increment for next deposit

        deposits.push({
            ...depositResult,
            user: user.publicKey,
            amount,
            nonce: i,
        });
    }

    return deposits;
}

/**
 * Get current pool state
 */
async function getPoolState(connection, poolStateAccount) {
    const accountInfo = await connection.getAccountInfo(poolStateAccount);
    return parsePoolState(accountInfo.data);
}

module.exports = {
    setupTestContext,
    setupPool,
    createDeposits,
    getPoolState,
    WSOL_MINT,
};
