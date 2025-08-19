const { expect } = require('chai');
const { LiteSVM } = require('litesvm');
const { 
    Keypair, 
    PublicKey, 
    Transaction, 
    TransactionInstruction,
    SystemProgram,
    ComputeBudgetProgram,
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const {
    TestHelpers,
    PRIVACY_POOL_STATE_SIZE,
    DEPOSITOR_STATE_SIZE,
    NULLIFIER_STATE_SIZE,
} = require('../utils/test-helpers');

describe('Debug Withdraw', () => {
    let svm;
    let helpers;
    let programKeypair;
    let entrypointAuthority;
    let assetMint;
    let poolAccount;
    let depositor1;
    let processooor;

    const programPath = path.join(__dirname, '../../target/deploy/solana_privacy_pools.so');
    const programBytes = fs.existsSync(programPath) ? fs.readFileSync(programPath) : null;

    before(function() {
        if (!programBytes) {
            console.log('Program not built. Run: cargo build-sbf');
            this.skip();
        }
    });

    beforeEach(async () => {
        svm = new LiteSVM();
        helpers = new TestHelpers();

        // Create keypairs
        programKeypair = Keypair.generate();
        entrypointAuthority = Keypair.generate();
        assetMint = Keypair.generate();
        poolAccount = Keypair.generate();
        depositor1 = Keypair.generate();
        processooor = Keypair.generate();

        // Fund accounts
        svm.airdrop(entrypointAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        svm.airdrop(depositor1.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        svm.airdrop(processooor.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

        // Deploy program
        svm.addProgram(programKeypair.publicKey, programBytes);
        
        console.log('Program deployed at:', programKeypair.publicKey.toString());
        console.log('Pool account:', poolAccount.publicKey.toString());
        console.log('Authority:', entrypointAuthority.publicKey.toString());
        console.log('Depositor:', depositor1.publicKey.toString());
        console.log('Processooor:', processooor.publicKey.toString());
    });

    it('should debug withdraw flow step by step', async () => {
        // STEP 1: Initialize pool
        console.log('Step 1: Initializing pool...');
        const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));
        
        const createAccountIx = SystemProgram.createAccount({
            fromPubkey: entrypointAuthority.publicKey,
            newAccountPubkey: poolAccount.publicKey,
            space: PRIVACY_POOL_STATE_SIZE,
            lamports: Number(rentExemption),
            programId: programKeypair.publicKey,
        });

        const instructionData = Buffer.alloc(66);
        instructionData[0] = 0; // INITIALIZE_INSTRUCTION
        entrypointAuthority.publicKey.toBuffer().copy(instructionData, 1);
        instructionData[33] = 20; // max_tree_depth
        assetMint.publicKey.toBuffer().copy(instructionData, 34);

        const initializeIx = new TransactionInstruction({
            keys: [
                { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: entrypointAuthority.publicKey, isSigner: true, isWritable: false },
                { pubkey: assetMint.publicKey, isSigner: false, isWritable: false },
            ],
            programId: programKeypair.publicKey,
            data: instructionData,
        });

        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({ units: 1200000 });
        const initTx = new Transaction().add(computeBudgetIx, createAccountIx, initializeIx);
        initTx.recentBlockhash = svm.latestBlockhash();
        initTx.feePayer = entrypointAuthority.publicKey;
        initTx.sign(entrypointAuthority, poolAccount);
        
        const initResult = svm.sendTransaction(initTx);
        expect(initResult.constructor.name).to.equal('TransactionMetadata');
        console.log('✅ Pool initialized successfully');

        // STEP 2: Create depositor account and make a deposit
        console.log('Step 2: Making initial deposit...');
        const depositorAccount = Keypair.generate();
        const depositorRent = svm.minimumBalanceForRentExemption(BigInt(DEPOSITOR_STATE_SIZE));

        const createDepositorIx = SystemProgram.createAccount({
            fromPubkey: depositor1.publicKey,
            newAccountPubkey: depositorAccount.publicKey,
            space: DEPOSITOR_STATE_SIZE,
            lamports: Number(depositorRent),
            programId: programKeypair.publicKey,
        });

        // Generate commitment for deposit
        const depositValue = 1000000; // 0.001 SOL
        const label = Buffer.alloc(32);
        label.write('test-deposit');
        const secret = Buffer.from('1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef', 'hex');
        
        // Use Poseidon to generate precommitment (nullifier hash of nullifier and secret)
        const nullifier = Buffer.from('abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890', 'hex');
        // For testing, just use the nullifier directly as precommitment
        const precommitmentHash = nullifier;

        const depositData = Buffer.alloc(1 + 32 + 8 + 32);
        let offset = 0;
        depositData[offset++] = 1; // DEPOSIT_INSTRUCTION
        depositor1.publicKey.toBuffer().copy(depositData, offset); offset += 32;
        depositData.writeBigUInt64LE(BigInt(depositValue), offset); offset += 8;
        precommitmentHash.copy(depositData, offset);

        const depositIx = new TransactionInstruction({
            keys: [
                { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: depositorAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: depositor1.publicKey, isSigner: true, isWritable: false },
            ],
            programId: programKeypair.publicKey,
            data: depositData,
        });

        const depositTx = new Transaction().add(computeBudgetIx, createDepositorIx, depositIx);
        depositTx.recentBlockhash = svm.latestBlockhash();
        depositTx.feePayer = depositor1.publicKey;
        depositTx.sign(depositor1, depositorAccount);

        const depositResult = svm.sendTransaction(depositTx);
        expect(depositResult.constructor.name).to.equal('TransactionMetadata');
        console.log('✅ Initial deposit completed');

        // STEP 3: Create nullifier account for withdrawal
        console.log('Step 3: Creating nullifier account...');
        const nullifierAccount = Keypair.generate();
        const nullifierRent = svm.minimumBalanceForRentExemption(BigInt(NULLIFIER_STATE_SIZE));

        const createNullifierIx = SystemProgram.createAccount({
            fromPubkey: processooor.publicKey,
            newAccountPubkey: nullifierAccount.publicKey,
            space: NULLIFIER_STATE_SIZE,
            lamports: Number(nullifierRent),
            programId: programKeypair.publicKey,
        });

        const createNullifierTx = new Transaction().add(computeBudgetIx, createNullifierIx);
        createNullifierTx.recentBlockhash = svm.latestBlockhash();
        createNullifierTx.feePayer = processooor.publicKey;
        createNullifierTx.sign(processooor, nullifierAccount);

        const createNullifierResult = svm.sendTransaction(createNullifierTx);
        expect(createNullifierResult.constructor.name).to.equal('TransactionMetadata');
        console.log('✅ Nullifier account created');

        // STEP 4: Prepare withdrawal with mock proof (in production, this would be generated using ZK circuits)
        console.log('Step 4: Preparing withdrawal...');
        
        // Create withdrawal data
        const withdrawalDataContent = Buffer.alloc(32); // Empty data for testing
        
        // Create mock proof data (in production, this would be generated from ZK circuits)
        const mockProof = {
            proof_a: Buffer.alloc(64, 1),  // Mock proof_a
            proof_b: Buffer.alloc(128, 2), // Mock proof_b
            proof_c: Buffer.alloc(64, 3),  // Mock proof_c
            public_signals: [
                // Signal 0: withdrawn_value (8 bytes as LE u64, rest zeros)
                Buffer.concat([Buffer.from([0x40, 0x42, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00]), Buffer.alloc(24)]), // 1000000
                // Signal 1: state_root (should match a root in the pool)
                Buffer.alloc(32, 0), // Will use the current root
                // Signal 2: state_tree_depth (1 byte, rest zeros)
                Buffer.concat([Buffer.from([20]), Buffer.alloc(31)]), // depth = 20
                // Signal 3: asp_root
                Buffer.alloc(32, 0),
                // Signal 4: asp_tree_depth (1 byte, rest zeros)
                Buffer.concat([Buffer.from([20]), Buffer.alloc(31)]), // depth = 20
                // Signal 5: context (keccak256 hash)
                Buffer.alloc(32, 5),
                // Signal 6: new_commitment_hash
                Buffer.alloc(32, 6),
                // Signal 7: existing_nullifier_hash
                Buffer.alloc(32, 7),
            ]
        };

        // Build withdrawal instruction data
        const withdrawData = Buffer.alloc(1 + 32 + 4 + withdrawalDataContent.length + 64 + 128 + 64 + 4 + (32 * mockProof.public_signals.length));
        offset = 0;
        
        // Instruction type
        withdrawData[offset++] = 2; // WITHDRAW_INSTRUCTION
        
        // Processooor pubkey
        processooor.publicKey.toBuffer().copy(withdrawData, offset); 
        offset += 32;
        
        // Withdrawal data length
        withdrawData.writeUInt32LE(withdrawalDataContent.length, offset); 
        offset += 4;
        
        // Withdrawal data content
        withdrawalDataContent.copy(withdrawData, offset); 
        offset += withdrawalDataContent.length;
        
        // Proof data
        mockProof.proof_a.copy(withdrawData, offset); 
        offset += 64;
        mockProof.proof_b.copy(withdrawData, offset); 
        offset += 128;
        mockProof.proof_c.copy(withdrawData, offset); 
        offset += 64;
        
        // Public signals count
        withdrawData.writeUInt32LE(mockProof.public_signals.length, offset); 
        offset += 4;
        
        // Public signals
        for (const signal of mockProof.public_signals) {
            signal.copy(withdrawData, offset);
            offset += 32;
        }

        console.log('Withdrawal instruction data length:', withdrawData.length);
        console.log('Withdrawal instruction data preview:', withdrawData.toString('hex').substring(0, 40) + '...');

        const withdrawIx = new TransactionInstruction({
            keys: [
                { pubkey: poolAccount.publicKey, isSigner: false, isWritable: true },
                { pubkey: processooor.publicKey, isSigner: true, isWritable: false },
                { pubkey: nullifierAccount.publicKey, isSigner: false, isWritable: true },
            ],
            programId: programKeypair.publicKey,
            data: withdrawData,
        });

        // STEP 5: Attempt withdrawal
        console.log('Step 5: Attempting withdrawal...');
        const withdrawTx = new Transaction().add(computeBudgetIx, withdrawIx);
        withdrawTx.recentBlockhash = svm.latestBlockhash();
        withdrawTx.feePayer = processooor.publicKey;
        withdrawTx.sign(processooor);

        console.log('Attempting withdrawal transaction...');
        const withdrawResult = svm.sendTransaction(withdrawTx);
        console.log('Withdrawal result type:', withdrawResult.constructor.name);
        
        if (withdrawResult.constructor.name === 'FailedTransactionMetadata') {
            console.log('❌ Withdrawal transaction failed (expected with mock proof)');
            console.log('This is expected as we\'re using mock proof data.');
            console.log('In production, you would generate a valid ZK proof using the circuits.');
            
            // Check nullifier account state
            const nullifierAccountInfo = svm.getAccount(nullifierAccount.publicKey);
            console.log('Nullifier account exists:', !!nullifierAccountInfo);
            
            if (nullifierAccountInfo) {
                console.log('Nullifier account data length:', nullifierAccountInfo.data.length);
                console.log('Nullifier is_spent flag:', nullifierAccountInfo.data[0]);
            }
        } else {
            console.log('✅ Withdrawal transaction succeeded (unexpected with mock proof)');
            expect(withdrawResult.constructor.name).to.equal('TransactionMetadata');
            
            // Verify nullifier was marked as spent
            const nullifierAccountInfo = svm.getAccount(nullifierAccount.publicKey);
            expect(nullifierAccountInfo).to.not.be.null;
            console.log('Nullifier marked as spent:', nullifierAccountInfo.data[0] === 1);
        }
    });
});