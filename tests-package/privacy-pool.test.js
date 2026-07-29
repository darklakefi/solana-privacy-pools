// Refactored test using the consolidated library
const assert = require('node:assert/strict');
const { 
    Connection,
    ComputeBudgetProgram,
    Keypair,
    LAMPORTS_PER_SOL,
    SystemProgram,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
} = require('@solana/web3.js');
const {
    TOKEN_PROGRAM_ID,
    getAccount,
    getAssociatedTokenAddress,
} = require('@solana/spl-token');
const {
    // Constants
    INSTRUCTIONS,
    WSOL_MINT,
    programKeypair,
    
    // Pool operations
    initializePool,
    parsePoolState,
    windDownPool,
    getNullifierPDA,
    getVaultPDA,
    
    // Deposit operations
    createAndWrapWSol,
    deposit,
    
    // Withdraw operations
    ragequit,
    withdraw,
    withdrawSimple,
} = require('@solana-privacy-pools/client');

console.log('=== Privacy Pool Test with Library ===');
console.log('Program ID:', programKeypair.publicKey.toBase58());

function buildNullifierReplayProbe({
    poolStateAccount,
    vaultPDA,
    nullifierAccount,
    user,
    poolTokenAccount,
    userTokenAccount,
    mint,
    nullifierHash,
}) {
    const withdrawalData = Buffer.alloc(8);
    const publicSignalsCount = 8;
    const instructionData = Buffer.alloc(
        1 + 32 + 4 + withdrawalData.length + 64 + 128 + 64 + 4
        + publicSignalsCount * 32
    );
    let offset = 0;

    instructionData[offset++] = INSTRUCTIONS.WITHDRAW;
    user.publicKey.toBuffer().copy(instructionData, offset);
    offset += 32;
    instructionData.writeUInt32LE(withdrawalData.length, offset);
    offset += 4;
    withdrawalData.copy(instructionData, offset);
    offset += withdrawalData.length;

    // Leave the proof bytes zeroed: the program must reject the nullifier
    // account before attempting proof verification.
    offset += 64 + 128 + 64;
    instructionData.writeUInt32LE(publicSignalsCount, offset);
    offset += 4;
    Buffer.from(nullifierHash).copy(instructionData, offset + 32);

    return new TransactionInstruction({
        keys: [
            { pubkey: poolStateAccount, isSigner: false, isWritable: true },
            { pubkey: vaultPDA, isSigner: false, isWritable: false },
            { pubkey: nullifierAccount, isSigner: false, isWritable: true },
            { pubkey: user.publicKey, isSigner: true, isWritable: true },
            { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: mint, isSigner: false, isWritable: false },
            { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: programKeypair.publicKey,
        data: instructionData,
    });
}

async function expectProgramRejection(promise, expectedLog) {
    try {
        await promise;
        assert.fail(`Expected transaction rejection containing "${expectedLog}"`);
    } catch (error) {
        if (error instanceof assert.AssertionError) {
            throw error;
        }

        const details = [
            error instanceof Error ? error.message : String(error),
            ...(error.logs || []),
        ].join('\n');
        assert.match(details, new RegExp(expectedLog));
    }
}

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
        const withdrawResult = await withdrawSimple(
            connection,
            poolStateAccount,
            user2,
            deposits[1], // User 2's deposit info
            deposits, // All deposits for merkle tree
            WSOL_MINT,
            deposits[1].value // Withdraw full amount
        );
        console.log('  ✅ User 2 withdrew successfully with ZK proof');
        console.log(`     Nullifier: ${Buffer.from(withdrawResult.nullifierHash).toString('hex').slice(0, 16)}...`);

        const { nullifierPDA } = getNullifierPDA(
            poolStateAccount,
            withdrawResult.nullifierHash
        );
        assert.equal(
            withdrawResult.nullifierState.toBase58(),
            nullifierPDA.toBase58(),
            'client must return the canonical nullifier PDA'
        );

        const nullifierAccountInfo = await connection.getAccountInfo(nullifierPDA);
        assert.ok(nullifierAccountInfo, 'nullifier marker account must exist');
        assert.equal(
            nullifierAccountInfo.owner.toBase58(),
            programKeypair.publicKey.toBase58(),
            'nullifier marker must be program owned'
        );
        assert.equal(nullifierAccountInfo.data[0], 1, 'nullifier marker must be spent');
        assert.deepEqual(
            nullifierAccountInfo.data.subarray(1),
            Buffer.from(withdrawResult.nullifierHash),
            'nullifier marker must contain the proof nullifier hash'
        );

        const user2WsolAddress = await getAssociatedTokenAddress(
            WSOL_MINT,
            user2.publicKey
        );
        const rogueNullifier = Keypair.generate().publicKey;
        const rogueProbe = buildNullifierReplayProbe({
            poolStateAccount,
            vaultPDA,
            nullifierAccount: rogueNullifier,
            user: user2,
            poolTokenAccount,
            userTokenAccount: user2WsolAddress,
            mint: WSOL_MINT,
            nullifierHash: withdrawResult.nullifierHash,
        });
        await expectProgramRejection(
            sendAndConfirmTransaction(
                connection,
                new Transaction()
                    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
                    .add(rogueProbe),
                [user2],
                { commitment: 'confirmed' }
            ),
            'Invalid nullifier account'
        );

        const replayProbe = buildNullifierReplayProbe({
            poolStateAccount,
            vaultPDA,
            nullifierAccount: nullifierPDA,
            user: user2,
            poolTokenAccount,
            userTokenAccount: user2WsolAddress,
            mint: WSOL_MINT,
            nullifierHash: withdrawResult.nullifierHash,
        });
        await expectProgramRejection(
            sendAndConfirmTransaction(
                connection,
                new Transaction()
                    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
                    .add(replayProbe),
                [user2],
                { commitment: 'confirmed' }
            ),
            'Nullifier already spent'
        );
        console.log('  ✅ Nullifier PDA rejects arbitrary-account bypasses and replays');
        
        // Check balance
        const user2WsolAccount = await getAccount(connection, user2WsolAddress);
        console.log(`     User 2 received: ${user2WsolAccount.amount / BigInt(LAMPORTS_PER_SOL)} WSOL`);
    } catch (error) {
        console.log('  ❌ User 2 withdrawal failed:', error.message);
        if (error.logs) {
            console.log('     Logs:', error.logs.slice(-5).join('\n     '));
        }
        throw error;
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
