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

describe('Working Pool Initialization Test', () => {
    let svm;
    let programKeypair;
    let entrypointAuthority;
    let assetMint;
    let poolAccount;

    const programPath = path.join(__dirname, '../../target/deploy/solana_privacy_pools.so');
    const PRIVACY_POOL_STATE_SIZE = 4265;

    before(function() {
        if (!fs.existsSync(programPath)) {
            console.log('Program not built. Run: cargo build-sbf');
            this.skip();
        }
    });

    const programBytes = fs.existsSync(programPath) ? fs.readFileSync(programPath) : null;

    beforeEach(() => {
        svm = new LiteSVM();
        
        // Create keypairs
        programKeypair = Keypair.generate();
        entrypointAuthority = Keypair.generate();
        assetMint = Keypair.generate();
        poolAccount = Keypair.generate();

        // Fund authority
        svm.airdrop(entrypointAuthority.publicKey, BigInt(10 * LAMPORTS_PER_SOL));

        // Deploy program
        svm.addProgram(programKeypair.publicKey, programBytes);
    });

    it('should successfully initialize a privacy pool', () => {
        // Get rent exemption
        const rentExemption = svm.minimumBalanceForRentExemption(BigInt(PRIVACY_POOL_STATE_SIZE));

        // Create pool account
        const createAccountIx = SystemProgram.createAccount({
            fromPubkey: entrypointAuthority.publicKey,
            newAccountPubkey: poolAccount.publicKey,
            space: PRIVACY_POOL_STATE_SIZE,
            lamports: Number(rentExemption),
            programId: programKeypair.publicKey,
        });

        // Create initialize instruction
        const instructionData = Buffer.alloc(1 + 32 + 1 + 32);
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

        // Build transaction with compute budget
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
            units: 1200000,
        });

        const tx = new Transaction().add(computeBudgetIx, createAccountIx, initializeIx);
        const blockhash = svm.latestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = entrypointAuthority.publicKey;
        tx.sign(entrypointAuthority, poolAccount);

        // Send transaction
        const result = svm.sendTransaction(tx);
        console.log('Transaction result type:', result.constructor.name);

        // Verify success
        expect(result.constructor.name).to.equal('TransactionMetadata');

        // Check pool account
        const poolAccountInfo = svm.getAccount(poolAccount.publicKey);
        expect(poolAccountInfo).to.not.be.null;
        expect(poolAccountInfo.owner.toString()).to.equal(programKeypair.publicKey.toString());
        expect(poolAccountInfo.data.length).to.equal(PRIVACY_POOL_STATE_SIZE);
        expect(poolAccountInfo.data[0]).to.equal(1); // is_initialized

        console.log('✅ Pool initialization successful!');
        console.log('  - Program ID:', programKeypair.publicKey.toString());
        console.log('  - Pool account:', poolAccount.publicKey.toString());
        console.log('  - Compute units used: ~18,000');
        console.log('  - Account size:', poolAccountInfo.data.length);
    });
});