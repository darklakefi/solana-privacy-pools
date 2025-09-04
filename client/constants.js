const { PublicKey, Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// WSOL mint address (Native SOL wrapped as SPL token)
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Field modulus for BN254
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

// Load program keypair from deploy artifacts
const programKeypair = Keypair.fromSecretKey(
    new Uint8Array(JSON.parse(fs.readFileSync(
        path.join(__dirname, '../target/deploy/solana_privacy_pools-keypair.json')
    )))
);

// Account sizes
const POOL_STATE_SIZE = 3616; // Vendored Lean IMT pool state size (with alignment)
const DEPOSITOR_STATE_SIZE = 64;
const NULLIFIER_STATE_SIZE = 33;

// Instruction IDs
const INSTRUCTIONS = {
    INITIALIZE: 0,
    DEPOSIT: 1,
    WITHDRAW: 2,
    RAGEQUIT: 3,
    WIND_DOWN: 4
};

module.exports = {
    WSOL_MINT,
    FIELD_MODULUS,
    programKeypair,
    POOL_STATE_SIZE,
    DEPOSITOR_STATE_SIZE,
    NULLIFIER_STATE_SIZE,
    INSTRUCTIONS
};