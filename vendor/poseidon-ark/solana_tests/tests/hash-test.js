import { LiteSVM } from 'litesvm';
import { PublicKey, TransactionInstruction, Transaction, Keypair } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

const PROGRAM_ID_STR = "Hash111111111111111111111111111111111111111";
const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

// Test vectors for Poseidon hashing (32-byte inputs)
const testVectors1 = [
    {
        name: "Zero input",
        data: new Uint8Array(32).fill(0)
    }
];

// Test vectors for 2-input Poseidon hashing (64-byte inputs)
const testVectors2 = [
    {
        name: "Two zeros",
        data: new Uint8Array(64).fill(0)
    }
];


class HashTester {
    constructor() {
        this.svm = new LiteSVM();
        this.payer = Keypair.generate();
        this.results = [];
    }

    async initialize() {
        console.log("Initializing LiteSVM...");
        
        // Airdrop SOL to payer
        await this.svm.airdrop(this.payer.publicKey, 10_000_000_000n);
        
        // Load and deploy program
        const programPath = path.join(process.cwd(), 'program', 'target', 'deploy', 'hash_program.so');
        
        if (!fs.existsSync(programPath)) {
            console.log("Program not found, building...");
            const { execSync } = await import('child_process');
            execSync('cargo build-sbf', { cwd: path.join(process.cwd(), 'program'), stdio: 'inherit' });
        }
        
        console.log('Program path:', programPath);
        await this.svm.addProgramFromFile(PROGRAM_ID, programPath);
        
        console.log(`Program deployed at: ${PROGRAM_ID.toString()}`);
    }

    async runHashTest(instruction, data, testName) {
        const instructionData = new Uint8Array([instruction, ...data]);
        
        const ix = new TransactionInstruction({
            keys: [],
            programId: PROGRAM_ID,
            data: Buffer.from(instructionData)
        });

        const tx = new Transaction().add(ix);
        tx.recentBlockhash = this.svm.latestBlockhash();
        tx.feePayer = this.payer.publicKey;
        tx.sign(this.payer);

        console.log(`\\n--- ${testName} ---`);
        console.log(`Instruction: ${instruction}, Data size: ${data.length} bytes`);
        
        console.log("Sending transaction...");
        let result;
        try {
            result = await this.svm.sendTransaction(tx);
            console.log("Transaction sent successfully");
            console.log("Result type:", typeof result);
            console.log("Result:", result);
            console.log("Result constructor:", result.constructor.name);
            console.log("Result stringified:", JSON.stringify(result, null, 2));
            console.log("Available methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(result)));
            
            // Try to get error information
            if (result.constructor.name === 'FailedTransactionMetadata') {
                console.log("This is a failed transaction");
                // Try common methods that might exist
                if (typeof result.err === 'function') {
                    const errorObj = result.err();
                    console.log("Error method result:", errorObj);
                    console.log("Error object methods:", Object.getOwnPropertyNames(Object.getPrototypeOf(errorObj)));
                    
                    // Try to get more details from TransactionErrorInstructionError
                    if (errorObj.constructor.name === 'TransactionErrorInstructionError') {
                        console.log("Instruction error details:");
                        if (typeof errorObj.instructionIndex === 'function') {
                            console.log("  Instruction index:", errorObj.instructionIndex());
                        }
                        if (typeof errorObj.error === 'function') {
                            console.log("  Inner error:", errorObj.error());
                        }
                        if (typeof errorObj.toString === 'function') {
                            console.log("  Error toString:", errorObj.toString());
                        }
                    }
                }
                if (typeof result.logs === 'function') {
                    console.log("Logs function result:", result.logs());
                }
            }
        } catch (error) {
            console.log("Transaction failed with error:", error);
            return {
                testName,
                instruction,
                dataSize: data.length,
                computeUnitsUsed: null,
                success: false,
                logs: [],
                error: error.toString()
            };
        }
        
        // Extract CU usage from logs
        let computeUnitsUsed = null;
        const logs = typeof result.logs === 'function' ? result.logs() : result.logs;
        
        if (logs && Array.isArray(logs)) {
            for (const log of logs) {
                if (log.includes('consumed') && log.includes('compute units')) {
                    const match = log.match(/consumed (\\d+) of/);
                    if (match) {
                        computeUnitsUsed = parseInt(match[1]);
                        break;
                    }
                }
            }
        }
        
        // Also check if there's a direct method on the result object
        if (!computeUnitsUsed && result.computeUnitsConsumed && typeof result.computeUnitsConsumed === 'function') {
            computeUnitsUsed = result.computeUnitsConsumed();
        }
        
        // Also check if there's a computeUnitsConsumed property
        if (!computeUnitsUsed && result.meta && result.meta.computeUnitsConsumed) {
            computeUnitsUsed = result.meta.computeUnitsConsumed;
        }

        console.log(`CU Used: ${computeUnitsUsed || 'Unknown'}`);
        console.log(`Status: ${result.err ? 'Failed' : 'Success'}`);
        console.log(`Full result keys: ${Object.keys(result)}`);
        
        if (result.err) {
            console.log(`Error details: ${JSON.stringify(result.err)}`);
        }
        
        if (logs && logs.length > 0) {
            console.log("All logs:");
            logs.forEach(log => {
                console.log(`  ${log}`);
            });
        } else {
            console.log("No logs available");
        }

        // Small delay to avoid overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
        
        return {
            testName,
            instruction,
            dataSize: data.length,
            computeUnitsUsed,
            success: !result.err,
            logs: logs || []
        };
    }

    async runAllTests() {
        await this.initialize();

        console.log("\\n=== POSEIDON HASH PERFORMANCE TESTING ===\\n");

        // Test Poseidon single input hashing
        console.log("🔮 Poseidon 1-Input Hash Tests");
        for (const vector of testVectors1) {
            const result = await this.runHashTest(0, vector.data, `Poseidon1: ${vector.name}`);
            this.results.push(result);
        }

        console.log("\\n🔮 Poseidon 2-Input Hash Tests");
        for (const vector of testVectors2) {
            const result = await this.runHashTest(1, vector.data, `Poseidon2: ${vector.name}`);
            this.results.push(result);
        }

        this.printSummary();
    }

    printSummary() {
        console.log("\\n\\n=== PERFORMANCE SUMMARY ===\\n");

        const poseidon1Results = this.results.filter(r => r.instruction === 0 && r.success);
        const poseidon2Results = this.results.filter(r => r.instruction === 1 && r.success);

        if (poseidon1Results.length > 0) {
            console.log("Poseidon 1-Input Hash Performance:");
            poseidon1Results.forEach(r => {
                console.log(`  ${r.testName}: ${r.computeUnitsUsed || 'Unknown'} CU`);
            });
            
            const avgCU = poseidon1Results.reduce((sum, r) => sum + (r.computeUnitsUsed || 0), 0) / poseidon1Results.length;
            console.log(`  Average: ${Math.round(avgCU)} CU\\n`);
        }

        if (poseidon2Results.length > 0) {
            console.log("Poseidon 2-Input Hash Performance:");
            poseidon2Results.forEach(r => {
                console.log(`  ${r.testName}: ${r.computeUnitsUsed || 'Unknown'} CU`);
            });
            
            const avgCU = poseidon2Results.reduce((sum, r) => sum + (r.computeUnitsUsed || 0), 0) / poseidon2Results.length;
            console.log(`  Average: ${Math.round(avgCU)} CU\\n`);
        }

        // Performance comparison between 1-input and 2-input Poseidon
        if (poseidon1Results.length > 0 && poseidon2Results.length > 0) {
            const poseidon1Avg = poseidon1Results.reduce((sum, r) => sum + (r.computeUnitsUsed || 0), 0) / poseidon1Results.length;
            const poseidon2Avg = poseidon2Results.reduce((sum, r) => sum + (r.computeUnitsUsed || 0), 0) / poseidon2Results.length;
            
            if (poseidon1Avg > 0 && poseidon2Avg > 0) {
                console.log(`📊 Performance Comparison:`);
                console.log(`  Poseidon 2-input vs 1-input: ${(poseidon2Avg / poseidon1Avg).toFixed(2)}x more expensive`);
            }
        }
    }
}

// Run the tests
async function main() {
    const tester = new HashTester();
    
    try {
        await tester.runAllTests();
    } catch (error) {
        console.error("Test failed:", error);
        process.exit(1);
    }
}

main();