import { LiteSVM } from 'litesvm';
import { PublicKey, SystemProgram, Transaction, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

async function testBasicFunctionality() {
    console.log("Testing basic LiteSVM functionality...");
    
    const svm = new LiteSVM();
    const payer = Keypair.generate();
    const recipient = Keypair.generate();
    
    // Airdrop SOL to payer
    console.log("Airdropping SOL...");
    await svm.airdrop(payer.publicKey, 10n * BigInt(LAMPORTS_PER_SOL));
    
    const payerBalance = await svm.getBalance(payer.publicKey);
    console.log(`Payer balance: ${payerBalance} lamports`);
    
    // Create a simple transfer transaction
    console.log("Creating transfer transaction...");
    const transferAmount = LAMPORTS_PER_SOL / 2;
    
    const transferInstruction = SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: transferAmount
    });
    
    const tx = new Transaction().add(transferInstruction);
    tx.recentBlockhash = svm.latestBlockhash();
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    
    console.log("Sending transaction...");
    const result = await svm.sendTransaction(tx);
    
    console.log("Transaction result:", {
        success: !result.err,
        logs: result.logs
    });
    
    // Check balances after
    const payerBalanceAfter = await svm.getBalance(payer.publicKey);
    const recipientBalance = await svm.getBalance(recipient.publicKey);
    
    console.log(`Payer balance after: ${payerBalanceAfter} lamports`);
    console.log(`Recipient balance: ${recipientBalance} lamports`);
    
    // Try compute budget measurement
    if (result.meta && result.meta.computeUnitsConsumed !== undefined) {
        console.log(`Compute units used: ${result.meta.computeUnitsConsumed}`);
    } else {
        console.log("CU usage not available in result.meta");
        console.log("Available result properties:", Object.keys(result));
    }
    
    console.log("Basic test completed successfully!");
}

testBasicFunctionality().catch(console.error);