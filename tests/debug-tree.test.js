const {
    Connection,
    Keypair,
    Transaction,
    TransactionInstruction,
    sendAndConfirmTransaction,
    SystemProgram,
    PublicKey,
} = require('@solana/web3.js');

const {
    TOKEN_PROGRAM_ID,
    getAssociatedTokenAddress,
    createAssociatedTokenAccountInstruction,
} = require('@solana/spl-token');

const { programKeypair, WSOL_MINT, POOL_STATE_SIZE } = require('./lib');

console.log('=== Debug Tree Persistence Test ===');
console.log('Program ID:', programKeypair.publicKey.toBase58());

function getPoolStateSeed(mint) {
    return `ps-${mint.toBase58().slice(0, 29)}`;
}

function getVaultPDA(mint) {
    const [vaultPDA, vaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), mint.toBuffer()],
        programKeypair.publicKey
    );
    return { vaultPDA, vaultBump };
}

async function parsePoolState(connection, poolStateAccount) {
    const accountInfo = await connection.getAccountInfo(poolStateAccount);
    if (!accountInfo) {
        throw new Error('Pool state account not found');
    }
    
    const data = accountInfo.data;
    
    // Parse the state tree at offset 1152
    const STATE_TREE_OFFSET = 1152;
    
    // Read LeanIMT fields
    const size = data.readBigUInt64LE(STATE_TREE_OFFSET);
    const depth = data.readUInt32LE(STATE_TREE_OFFSET + 8);
    
    // Read the root from side_nodes[depth]
    // side_nodes starts at offset STATE_TREE_OFFSET + 16 (after size and depth+padding)
    const sideNodesOffset = STATE_TREE_OFFSET + 16;
    const rootOffset = sideNodesOffset + (Number(depth) * 32);
    const root = data.slice(rootOffset, rootOffset + 32);
    
    return {
        stateTree: {
            size: Number(size),
            depth: depth,
            root: '0x' + root.toString('hex')
        }
    };
}

async function runTest() {
    try {
        const connection = new Connection('http://127.0.0.1:8899', 'confirmed');
        
        // Create payer/authority
        const authority = Keypair.generate();
        
        // Airdrop SOL to authority
        console.log('\nAirdropping SOL to authority...');
        const airdropSig = await connection.requestAirdrop(authority.publicKey, 10 * 1e9);
        await connection.confirmTransaction(airdropSig);
        console.log('Airdrop confirmed');
        
        // Create pool state account with deterministic seed
        const mint = WSOL_MINT;
        const poolStateSeed = getPoolStateSeed(mint);
        const poolStateAccount = await PublicKey.createWithSeed(
            authority.publicKey,
            poolStateSeed,
            programKeypair.publicKey
        );
        console.log('Pool state account:', poolStateAccount.toBase58());
        
        // Get vault PDA
        const { vaultPDA } = getVaultPDA(mint);
        
        // ============ 1. Initialize pool ============
        console.log('\n1. Initializing pool...');
        
        const poolStateRent = await connection.getMinimumBalanceForRentExemption(POOL_STATE_SIZE);
        
        // Create pool state account
        const createPoolAccountIx = SystemProgram.createAccountWithSeed({
            fromPubkey: authority.publicKey,
            basePubkey: authority.publicKey,
            seed: poolStateSeed,
            newAccountPubkey: poolStateAccount,
            lamports: poolStateRent,
            space: POOL_STATE_SIZE,
            programId: programKeypair.publicKey,
        });
        
        // Create pool token account
        const poolTokenAccount = await getAssociatedTokenAddress(mint, vaultPDA, true);
        const createPoolTokenAccountIx = createAssociatedTokenAccountInstruction(
            authority.publicKey,
            poolTokenAccount,
            vaultPDA,
            mint
        );
        
        // Build initialization instruction
        const initData = Buffer.alloc(66);
        initData[0] = 0; // InitializePool instruction
        authority.publicKey.toBuffer().copy(initData, 1); // entrypoint_authority
        initData[33] = 32; // max_tree_depth
        mint.toBuffer().copy(initData, 34); // asset_mint
        
        const initIx = new TransactionInstruction({
            keys: [
                { pubkey: poolStateAccount, isSigner: false, isWritable: true },
                { pubkey: authority.publicKey, isSigner: true, isWritable: true },
                { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
                { pubkey: mint, isSigner: false, isWritable: false },
                { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            ],
            programId: programKeypair.publicKey,
            data: initData,
        });
        
        const initTx = new Transaction()
            .add(createPoolAccountIx)
            .add(createPoolTokenAccountIx)
            .add(initIx);
        
        await sendAndConfirmTransaction(connection, initTx, [authority]);
        console.log('✅ Pool initialized');
        
        // Check initial state
        let poolState = await parsePoolState(connection, poolStateAccount);
        console.log('Initial state tree:', poolState.stateTree);
        
        // ============ 2. Insert first value ============
        console.log('\n2. Inserting first value...');
        const testValue1 = Buffer.alloc(32);
        testValue1.writeUInt32BE(12345, 28); // Write as big-endian at the end
        
        const insertData1 = Buffer.concat([
            Buffer.from([100]), // DebugTree instruction
            Buffer.from([0]),   // Insert operation (op_type = 0)
            testValue1,
        ]);
        
        const insertTx1 = new Transaction().add(
            new TransactionInstruction({
                programId: programKeypair.publicKey,
                keys: [
                    { pubkey: poolStateAccount, isSigner: false, isWritable: true },
                ],
                data: insertData1,
            })
        );
        
        const sig1 = await sendAndConfirmTransaction(connection, insertTx1, [authority]);
        console.log('Insert tx:', sig1);
        
        // Get transaction details with logs
        const tx1 = await connection.getTransaction(sig1, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });
        if (tx1?.meta?.logMessages) {
            console.log('Transaction logs:');
            tx1.meta.logMessages.forEach(log => {
                if (log.includes('Program log:')) {
                    console.log('  ', log);
                }
            });
        }
        
        // Fetch and verify state after first insert
        poolState = await parsePoolState(connection, poolStateAccount);
        console.log('After insert 1 - state tree:', poolState.stateTree);
        
        // ============ 3. Insert second value ============
        console.log('\n3. Inserting second value...');
        const testValue2 = Buffer.alloc(32);
        testValue2.writeUInt32BE(67890, 28); // Write as big-endian at the end
        
        const insertData2 = Buffer.concat([
            Buffer.from([100]), // DebugTree instruction
            Buffer.from([0]),   // Insert operation
            testValue2,
        ]);
        
        const insertTx2 = new Transaction().add(
            new TransactionInstruction({
                programId: programKeypair.publicKey,
                keys: [
                    { pubkey: poolStateAccount, isSigner: false, isWritable: true },
                ],
                data: insertData2,
            })
        );
        
        const sig2 = await sendAndConfirmTransaction(connection, insertTx2, [authority]);
        console.log('Insert tx:', sig2);
        
        // Get transaction details with logs
        const tx2 = await connection.getTransaction(sig2, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });
        if (tx2?.meta?.logMessages) {
            console.log('Transaction logs:');
            tx2.meta.logMessages.forEach(log => {
                if (log.includes('Program log:')) {
                    console.log('  ', log);
                }
            });
        }
        
        // Fetch and verify state after second insert
        poolState = await parsePoolState(connection, poolStateAccount);
        console.log('After insert 2 - state tree:', poolState.stateTree);
        
        // ============ 4. Insert third value ============
        console.log('\n4. Inserting third value...');
        const testValue3 = Buffer.alloc(32);
        testValue3.writeUInt32BE(111111, 28); // Write as big-endian at the end
        
        const insertData3 = Buffer.concat([
            Buffer.from([100]), // DebugTree instruction
            Buffer.from([0]),   // Insert operation
            testValue3,
        ]);
        
        const insertTx3 = new Transaction().add(
            new TransactionInstruction({
                programId: programKeypair.publicKey,
                keys: [
                    { pubkey: poolStateAccount, isSigner: false, isWritable: true },
                ],
                data: insertData3,
            })
        );
        
        const sig3 = await sendAndConfirmTransaction(connection, insertTx3, [authority]);
        console.log('Insert tx:', sig3);
        
        // Get transaction details with logs
        const tx3 = await connection.getTransaction(sig3, {
            maxSupportedTransactionVersion: 0,
            commitment: 'confirmed'
        });
        if (tx3?.meta?.logMessages) {
            console.log('Transaction logs:');
            tx3.meta.logMessages.forEach(log => {
                if (log.includes('Program log:')) {
                    console.log('  ', log);
                }
            });
        }
        
        // Fetch and verify final state
        poolState = await parsePoolState(connection, poolStateAccount);
        console.log('After insert 3 - state tree:', poolState.stateTree);
        
        // ============ Verification ============
        console.log('\n=== Final Verification ===');
        if (poolState.stateTree.size === 3) {
            console.log('✅ Size is correct: 3');
        } else {
            console.log('❌ Size is wrong. Expected 3, got', poolState.stateTree.size);
        }
        
        if (poolState.stateTree.root === '0x' + '00'.repeat(32)) {
            console.log('❌ Root is all zeros - Poseidon hash issue confirmed');
        } else {
            console.log('✅ Root is non-zero:', poolState.stateTree.root);
        }
        
        console.log('\n✅ Test completed');
        
    } catch (error) {
        console.error('❌ Test failed:', error.message);
        if (error.logs) {
            console.log('Transaction logs:', error.logs);
        }
        process.exit(1);
    }
}

// Run the test
runTest().catch(console.error);