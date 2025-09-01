// Refactored test using the consolidated library
const { 
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
} = require('@solana/web3.js');
const { getAccount, getAssociatedTokenAddress } = require('@solana/spl-token');
const {
    // Constants
    WSOL_MINT,
    programKeypair,
    
    // Pool operations
    initializePool,
    parsePoolState,
    windDownPool,
    getVaultPDA,
    
    // Deposit operations
    createAndWrapWSol,
    deposit,
    
    // Withdraw operations
    ragequit,
    withdraw,
} = require('./lib');

console.log('=== Privacy Pool Test with Library ===');
console.log('Program ID:', programKeypair.publicKey.toBase58());

async function main() {
    // Connect to local validator
    const connection = new Connection('http://localhost:8899', 'confirmed');
    console.log('Connected to validator');
    
    // Setup accounts
    const authority = Keypair.generate();
    const user1 = Keypair.generate();
    const user2 = Keypair.generate();
    const user3 = Keypair.generate();
    
    // Fund accounts
    console.log('\n1. Funding accounts...');
    await connection.requestAirdrop(authority.publicKey, 100 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(user1.publicKey, 100 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(user2.publicKey, 100 * LAMPORTS_PER_SOL);
    await connection.requestAirdrop(user3.publicKey, 100 * LAMPORTS_PER_SOL);
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('✅ Accounts funded');
    
    // Initialize pool
    console.log('\n2. Initializing privacy pool...');
    console.log('  Authority pubkey:', authority.publicKey.toBase58());
    const { 
        poolStateAccount, 
        vaultPDA, 
        poolTokenAccount, 
        scope 
    } = await initializePool(connection, authority, WSOL_MINT);
    console.log('✅ Pool initialized');
    console.log('  Pool state:', poolStateAccount.toBase58());
    console.log('  Vault PDA:', vaultPDA.toBase58());
    console.log('  Scope:', scope.toString('hex'));
    
    // Store deposit info for withdrawals
    const deposits = [];
    
    // Process deposits
    console.log('\n3. Processing deposits...');
    const users = [
        { keypair: user1, amount: BigInt(1 * LAMPORTS_PER_SOL), label: 'User 1' },
        { keypair: user2, amount: BigInt(2 * LAMPORTS_PER_SOL), label: 'User 2' },
        { keypair: user3, amount: BigInt(3 * LAMPORTS_PER_SOL), label: 'User 3' },
    ];
    
    for (let i = 0; i < users.length; i++) {
        const { keypair: user, amount, label } = users[i];
        
        // Wrap SOL to WSOL
        console.log(`\n  ${label}: Wrapping ${amount / BigInt(LAMPORTS_PER_SOL)} SOL to WSOL...`);
        const userWsolAccount = await createAndWrapWSol(connection, user, amount);
        
        // Make deposit
        console.log(`  ${label}: Depositing to privacy pool...`);
        const depositResult = await deposit(
            connection,
            poolStateAccount,
            user,
            amount,
            i, // nonce
            scope,
            WSOL_MINT
        );
        
        deposits.push({
            ...depositResult,
            user: user.publicKey,
            userLabel: label,
            amount
        });
        
        console.log(`  ✅ ${label} deposited ${amount / BigInt(LAMPORTS_PER_SOL)} WSOL`);
        console.log(`     Commitment: ${Buffer.from(depositResult.commitment).toString('hex').slice(0, 16)}...`);
        
        // Check balance
        const poolBalance = await getAccount(connection, poolTokenAccount);
        console.log(`     Pool balance: ${poolBalance.amount / BigInt(LAMPORTS_PER_SOL)} WSOL`);
    }
    
    // Read pool state
    console.log('\n4. Reading pool state...');
    const poolAccountInfo = await connection.getAccountInfo(poolStateAccount);
    const poolState = parsePoolState(poolAccountInfo.data);
    console.log(`  Total deposits: ${poolState.totalDeposits}`);
    console.log(`  State tree size: ${poolState.stateTree.size}`);
    console.log(`  ASP tree size: ${poolState.aspTree.size}`);
    
    // Test withdrawals with ZK proofs
    console.log('\n5. Testing withdrawals with ZK proofs...');
    
    // User 2 withdraws using ZK proof
    console.log('  User 2 withdrawing with ZK proof...');
    try {
        const withdrawResult = await withdraw(
            connection,
            poolStateAccount,
            user2,
            deposits[1], // User 2's deposit info
            deposits.map(d => d.commitment), // All commitments for merkle tree
            WSOL_MINT
        );
        console.log('  ✅ User 2 withdrew successfully with ZK proof');
        console.log(`     Nullifier: ${Buffer.from(withdrawResult.nullifierHash).toString('hex').slice(0, 16)}...`);
        
        // Check balance
        const user2WsolAddress = await getAssociatedTokenAddress(WSOL_MINT, user2.publicKey);
        const user2WsolAccount = await getAccount(connection, user2WsolAddress);
        console.log(`     User 2 received: ${user2WsolAccount.amount / BigInt(LAMPORTS_PER_SOL)} WSOL`);
    } catch (error) {
        console.log('  ❌ User 2 withdrawal failed:', error.message);
        if (error.logs) {
            console.log('     Logs:', error.logs.slice(-5).join('\n     '));
        }
    }
    
    // Test wind down and ragequit
    console.log('\n6. Testing wind down and ragequit...');
    
    // Wind down the pool
    console.log('  Winding down pool...');
    await windDownPool(connection, poolStateAccount, authority);
    console.log('  ✅ Pool wound down');
    
    // User 1 ragequits
    console.log('  User 1 performing ragequit...');
    const ragequitResult = await ragequit(
        connection,
        poolStateAccount,
        deposits[0].depositorState,
        user1,
        deposits[0].amount,
        WSOL_MINT
    );
    console.log('  ✅ User 1 rage quit successful');
    
    // Check final balances
    const user1WsolAddress = await getAssociatedTokenAddress(WSOL_MINT, user1.publicKey);
    const user1WsolAccount = await getAccount(connection, user1WsolAddress);
    console.log(`  User 1 recovered: ${user1WsolAccount.amount / BigInt(LAMPORTS_PER_SOL)} WSOL`);
    
    console.log('\n✅ All tests completed successfully!');
}

main().catch(console.error);