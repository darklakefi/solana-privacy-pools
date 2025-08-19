const { LiteSVM } = require('litesvm');
const { Keypair, PublicKey } = require('@solana/web3.js');

async function test() {
    try {
        console.log('Creating LiteSVM instance...');
        const svm = new LiteSVM();
        
        console.log('Available methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(svm)).filter(m => !m.startsWith('_')));
        
        const keypair = Keypair.generate();
        console.log('Generated keypair:', keypair.publicKey.toString());
        
        // Try to airdrop (LiteSVM expects BigInt)
        console.log('Attempting airdrop...');
        try {
            const result = svm.airdrop(keypair.publicKey, BigInt(1000000000));
            console.log('Airdrop result:', result);
        } catch (e) {
            console.log('Airdrop error:', e.message, e);
        }
        
        // Check balance
        const balance = svm.getBalance(keypair.publicKey);
        console.log('Balance:', balance);
        
    } catch (error) {
        console.error('Error:', error);
    }
}

test();