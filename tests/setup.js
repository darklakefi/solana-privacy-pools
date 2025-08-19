// Test setup file for E2E tests
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Check if program is built
const programPath = path.join(__dirname, '../target/deploy/solana_privacy_pools.so');

if (!fs.existsSync(programPath)) {
    console.log('Program not found. Building...');
    try {
        execSync('cargo build-sbf --release', { 
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit'
        });
    } catch (err) {
        console.error('Failed to build program:', err.message);
        process.exit(1);
    }
}

// Check if circuits are built
const circuitsDir = path.join(__dirname, '../build');
const requiredCircuits = ['commitment', 'withdraw'];

for (const circuit of requiredCircuits) {
    const wasmPath = path.join(circuitsDir, `${circuit}_js/${circuit}.wasm`);
    if (!fs.existsSync(wasmPath)) {
        console.log(`Circuit ${circuit} not found. Building circuits...`);
        try {
            execSync('./build-circuits.sh', {
                cwd: path.join(__dirname, '..'),
                stdio: 'inherit'
            });
            break;
        } catch (err) {
            console.error('Failed to build circuits:', err.message);
            process.exit(1);
        }
    }
}

console.log('Setup complete!');