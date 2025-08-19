const { PublicKey, Transaction, TransactionInstruction, SystemProgram } = require('@solana/web3.js');
const borsh = require('borsh');
const fs = require('fs');
const path = require('path');
const { ProofGenerator } = require('./proof-generator');
const { poseidon2 } = require('circomlibjs');
const crypto = require('crypto');

// Program ID - should match the deployed program
const PROGRAM_ID = new PublicKey('11111111111111111111111111111111');

// Constants matching Rust implementation
const MAX_TREE_DEPTH = 32;
const ROOT_HISTORY_SIZE = 64;
const SNARK_SCALAR_FIELD = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

// Account sizes (matching Rust)
const PRIVACY_POOL_STATE_SIZE = 8 + 32 + 32 + 32 + 8 + 1 + 1 + 6 + 8 + (32 * ROOT_HISTORY_SIZE) + (32 * 2 * MAX_TREE_DEPTH);
const DEPOSITOR_STATE_SIZE = 1 + 32 + 32;
const NULLIFIER_STATE_SIZE = 1 + 32;

// Instruction enum discriminants
const INSTRUCTION_INITIALIZE = 0;
const INSTRUCTION_DEPOSIT = 1;
const INSTRUCTION_WITHDRAW = 2;
const INSTRUCTION_RAGEQUIT = 3;
const INSTRUCTION_WIND_DOWN = 4;

// Schema for instruction serialization
const instructionSchema = {
    Initialize: {
        kind: 'struct',
        fields: [
            ['instruction', 'u8'],
            ['max_tree_depth', 'u8'],
        ]
    },
    Deposit: {
        kind: 'struct',
        fields: [
            ['instruction', 'u8'],
            ['commitment_hash', [32]],
            ['label', [32]],
            ['value', 'u64'],
        ]
    },
    Withdraw: {
        kind: 'struct',
        fields: [
            ['instruction', 'u8'],
            ['proof_a', [64]],
            ['proof_b', [128]],
            ['proof_c', [64]],
            ['public_signals_len', 'u32'],
            ['public_signals', ['u8']],
            ['data_len', 'u32'],
            ['data', ['u8']],
        ]
    },
    Ragequit: {
        kind: 'struct',
        fields: [
            ['instruction', 'u8'],
            ['proof_a', [64]],
            ['proof_b', [128]],
            ['proof_c', [64]],
            ['public_signals_len', 'u32'],
            ['public_signals', ['u8']],
        ]
    },
    WindDown: {
        kind: 'struct',
        fields: [
            ['instruction', 'u8'],
        ]
    }
};

class TestHelpers {
    constructor() {
        this.poseidon = poseidon2;
        this.proofGenerator = new ProofGenerator();
    }

    // Generate a random field element
    randomFieldElement() {
        const bytes = crypto.randomBytes(31);
        const value = BigInt('0x' + bytes.toString('hex'));
        return value % SNARK_SCALAR_FIELD;
    }
    
    // Generate random bytes
    randomBytes32() {
        return crypto.randomBytes(32);
    }

    // Generate commitment hash using Poseidon
    generateCommitment(label, secret, value) {
        const labelBn = BigInt('0x' + Buffer.from(label).toString('hex'));
        const secretBn = BigInt('0x' + Buffer.from(secret).toString('hex'));
        const valueBn = BigInt(value);
        
        // Hash using Poseidon
        const hash = this.poseidon([labelBn, secretBn, valueBn]);
        
        // Convert to bytes
        const hashBytes = Buffer.alloc(32);
        const hashHex = hash.toString(16).padStart(64, '0');
        hashBytes.write(hashHex, 'hex');
        
        return hashBytes;
    }

    // Generate nullifier hash using Poseidon
    generateNullifier(commitment, secret) {
        const commitmentBn = BigInt('0x' + Buffer.from(commitment).toString('hex'));
        const secretBn = BigInt('0x' + Buffer.from(secret).toString('hex'));
        
        // Hash using Poseidon
        const hash = this.poseidon([commitmentBn, secretBn]);
        
        // Convert to bytes
        const hashBytes = Buffer.alloc(32);
        const hashHex = hash.toString(16).padStart(64, '0');
        hashBytes.write(hashHex, 'hex');
        
        return hashBytes;
    }

    // Create initialize instruction
    createInitializeInstruction(poolAccount, entrypointAuthority, assetMint, maxTreeDepth = 20) {
        const data = Buffer.alloc(2);
        data[0] = INSTRUCTION_INITIALIZE;
        data[1] = maxTreeDepth;

        return new TransactionInstruction({
            keys: [
                { pubkey: poolAccount, isSigner: false, isWritable: true },
                { pubkey: entrypointAuthority, isSigner: true, isWritable: false },
                { pubkey: assetMint, isSigner: false, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data,
        });
    }

    // Create deposit instruction
    createDepositInstruction(poolAccount, depositorAccount, depositor, commitmentHash, label, value) {
        const data = Buffer.alloc(1 + 32 + 32 + 8);
        data[0] = INSTRUCTION_DEPOSIT;
        commitmentHash.copy(data, 1);
        label.copy(data, 33);
        data.writeBigUInt64LE(BigInt(value), 65);

        return new TransactionInstruction({
            keys: [
                { pubkey: poolAccount, isSigner: false, isWritable: true },
                { pubkey: depositorAccount, isSigner: false, isWritable: true },
                { pubkey: depositor, isSigner: true, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data,
        });
    }

    // Create withdraw instruction
    createWithdrawInstruction(poolAccount, nullifierAccount, processooor, proofData, withdrawalData) {
        const publicSignalsBytes = this.serializePublicSignals(proofData.publicSignals);
        const withdrawalDataBytes = this.serializeWithdrawalData(withdrawalData);
        
        const data = Buffer.alloc(1 + 64 + 128 + 64 + 4 + publicSignalsBytes.length + 4 + withdrawalDataBytes.length);
        let offset = 0;
        
        data[offset++] = INSTRUCTION_WITHDRAW;
        proofData.proofA.copy(data, offset); offset += 64;
        proofData.proofB.copy(data, offset); offset += 128;
        proofData.proofC.copy(data, offset); offset += 64;
        data.writeUInt32LE(publicSignalsBytes.length, offset); offset += 4;
        publicSignalsBytes.copy(data, offset); offset += publicSignalsBytes.length;
        data.writeUInt32LE(withdrawalDataBytes.length, offset); offset += 4;
        withdrawalDataBytes.copy(data, offset);

        return new TransactionInstruction({
            keys: [
                { pubkey: poolAccount, isSigner: false, isWritable: true },
                { pubkey: nullifierAccount, isSigner: false, isWritable: true },
                { pubkey: processooor, isSigner: true, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data,
        });
    }

    // Create ragequit instruction
    createRagequitInstruction(poolAccount, nullifierAccount, depositorAccount, depositor, proofData) {
        const publicSignalsBytes = this.serializePublicSignals(proofData.publicSignals);
        
        const data = Buffer.alloc(1 + 64 + 128 + 64 + 4 + publicSignalsBytes.length);
        let offset = 0;
        
        data[offset++] = INSTRUCTION_RAGEQUIT;
        proofData.proofA.copy(data, offset); offset += 64;
        proofData.proofB.copy(data, offset); offset += 128;
        proofData.proofC.copy(data, offset); offset += 64;
        data.writeUInt32LE(publicSignalsBytes.length, offset); offset += 4;
        publicSignalsBytes.copy(data, offset);

        return new TransactionInstruction({
            keys: [
                { pubkey: poolAccount, isSigner: false, isWritable: true },
                { pubkey: nullifierAccount, isSigner: false, isWritable: true },
                { pubkey: depositorAccount, isSigner: false, isWritable: true },
                { pubkey: depositor, isSigner: true, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data,
        });
    }

    // Create wind down instruction
    createWindDownInstruction(poolAccount, entrypointAuthority) {
        const data = Buffer.alloc(1);
        data[0] = INSTRUCTION_WIND_DOWN;

        return new TransactionInstruction({
            keys: [
                { pubkey: poolAccount, isSigner: false, isWritable: true },
                { pubkey: entrypointAuthority, isSigner: true, isWritable: false },
            ],
            programId: PROGRAM_ID,
            data,
        });
    }

    // Helper to serialize public signals
    serializePublicSignals(signals) {
        const totalLength = signals.length * 32;
        const buffer = Buffer.alloc(totalLength);
        
        for (let i = 0; i < signals.length; i++) {
            signals[i].copy(buffer, i * 32);
        }
        
        return buffer;
    }

    // Helper to serialize withdrawal data
    serializeWithdrawalData(data) {
        const buffer = Buffer.alloc(32 + 4 + data.data.length);
        data.processooor.toBuffer().copy(buffer, 0);
        buffer.writeUInt32LE(data.data.length, 32);
        Buffer.from(data.data).copy(buffer, 36);
        return buffer;
    }

    // Generate proof using the proof generator
    async generateWithdrawProof(input) {
        return this.proofGenerator.generateWithdrawProof(input);
    }

    // Generate ragequit proof using the proof generator
    async generateRagequitProof(input) {
        return this.proofGenerator.generateRagequitProof(input);
    }
    
    // Generate commitment proof 
    async generateCommitmentProof(input) {
        return this.proofGenerator.generateCommitmentProof(input);
    }

    // Create PDA for depositor account
    findDepositorPDA(poolAccount, depositor, label) {
        return PublicKey.findProgramAddressSync(
            [
                Buffer.from('depositor'),
                poolAccount.toBuffer(),
                depositor.toBuffer(),
                label,
            ],
            PROGRAM_ID
        );
    }

    // Create PDA for nullifier account
    findNullifierPDA(poolAccount, nullifierHash) {
        return PublicKey.findProgramAddressSync(
            [
                Buffer.from('nullifier'),
                poolAccount.toBuffer(),
                nullifierHash,
            ],
            PROGRAM_ID
        );
    }

}

module.exports = {
    TestHelpers,
    PROGRAM_ID,
    MAX_TREE_DEPTH,
    ROOT_HISTORY_SIZE,
    PRIVACY_POOL_STATE_SIZE,
    DEPOSITOR_STATE_SIZE,
    NULLIFIER_STATE_SIZE,
    INSTRUCTION_INITIALIZE,
    INSTRUCTION_DEPOSIT,
    INSTRUCTION_WITHDRAW,
    INSTRUCTION_RAGEQUIT,
    INSTRUCTION_WIND_DOWN,
};