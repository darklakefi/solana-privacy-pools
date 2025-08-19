const { expect } = require('chai');
const { LiteSVM } = require('litesvm');
const { 
    Keypair, 
    PublicKey, 
    Transaction, 
    SystemProgram,
    LAMPORTS_PER_SOL 
} = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

describe('Simple LiteSVM Test', () => {
    let svm;
    let payer;

    beforeEach(() => {
        // Initialize LiteSVM
        svm = new LiteSVM();
        
        // Create keypair
        payer = Keypair.generate();
        
        // Fund account (LiteSVM expects BigInt)
        svm.airdrop(payer.publicKey, BigInt(10 * LAMPORTS_PER_SOL));
        
        // Check balance
        const balance = svm.getBalance(payer.publicKey);
        console.log('Payer balance:', balance.toString());
    });

    it('should transfer SOL between accounts', () => {
        const recipient = Keypair.generate();
        
        // Check initial balances
        const payerBalanceBefore = svm.getBalance(payer.publicKey);
        const recipientBalanceBefore = svm.getBalance(recipient.publicKey) || BigInt(0);
        
        expect(payerBalanceBefore).to.equal(BigInt(10 * LAMPORTS_PER_SOL));
        expect(recipientBalanceBefore).to.equal(BigInt(0));
        
        // Create transfer instruction
        const transferIx = SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: recipient.publicKey,
            lamports: LAMPORTS_PER_SOL,
        });
        
        // Create and send transaction
        const tx = new Transaction().add(transferIx);
        const blockhash = svm.latestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.sign(payer);
        
        const result = svm.sendTransaction(tx);
        console.log('Transaction result:', result);
        
        // Check final balances
        const payerBalanceAfter = svm.getBalance(payer.publicKey);
        const recipientBalanceAfter = svm.getBalance(recipient.publicKey);
        
        expect(recipientBalanceAfter).to.equal(BigInt(LAMPORTS_PER_SOL));
        // Payer balance should be reduced by transfer amount + fee (compare BigInts)
        expect(payerBalanceAfter < payerBalanceBefore).to.be.true;
    });

    it('should deploy and execute a program', function() {
        const programPath = path.join(__dirname, '../../target/deploy/solana_privacy_pools.so');
        
        if (!fs.existsSync(programPath)) {
            console.log('Program not built, skipping test');
            this.skip();
        }
        
        // Deploy program
        const programKeypair = Keypair.generate();
        const programBytes = fs.readFileSync(programPath);
        
        svm.addProgram(programKeypair.publicKey, programBytes);
        
        // Check program was deployed
        const programAccount = svm.getAccount(programKeypair.publicKey);
        expect(programAccount).to.not.be.null;
        expect(programAccount.executable).to.be.true;
        
        console.log('Program deployed at:', programKeypair.publicKey.toString());
    });
});