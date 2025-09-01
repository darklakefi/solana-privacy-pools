// Fixed proof generation using ffjavascript curve operations
const snarkjs = require('snarkjs');
const path = require('path');
const fs = require('fs');
const { keccak256 } = require('js-sha3');
const { buildBn128, utils } = require('ffjavascript');
const { unstringifyBigInts } = utils;

// Circuit paths
const COMMITMENT_WASM = path.join(__dirname, '../../../privacy-pools-core/packages/circuits/build/commitment/commitment_js/commitment.wasm');
const COMMITMENT_ZKEY = path.join(__dirname, '../../../privacy-pools-core/packages/circuits/build/commitment/groth16_pkey.zkey');
const COMMITMENT_VKEY = path.join(__dirname, '../../../privacy-pools-core/packages/circuits/build/commitment/groth16_vkey.json');

const WITHDRAW_WASM = path.join(__dirname, '../../../privacy-pools-core/packages/circuits/build/withdraw/withdraw_js/withdraw.wasm');
const WITHDRAW_ZKEY = path.join(__dirname, '../../../privacy-pools-core/packages/circuits/build/withdraw/groth16_pkey.zkey');
const WITHDRAW_VKEY = path.join(__dirname, '../../../privacy-pools-core/packages/circuits/build/withdraw/groth16_vkey.json');

// Field modulus for BN254
const FIELD_MODULUS = BigInt('21888242871839275222246405745257275088548364400416034343698204186575808495617');

// Helper function to convert BigInt to 32-byte buffer
function to32ByteBuffer(bigInt) {
    const hexString = bigInt.toString(16).padStart(64, '0');
    return new Uint8Array(Buffer.from(hexString, 'hex'));
}

// Convert G1 point to uncompressed format
function g1Uncompressed(curve, p1Raw) {
    const p1 = curve.G1.fromObject(p1Raw);
    const buff = new Uint8Array(64);
    curve.G1.toRprUncompressed(buff, 0, p1);
    return buff;
}

// Negate and serialize G1 point
async function negateAndSerializeG1(curve, p1Uncompressed) {
    const p1 = curve.G1.toAffine(curve.G1.fromRprUncompressed(p1Uncompressed, 0));
    const negatedP1 = curve.G1.neg(p1);
    const serializedNegatedP1 = new Uint8Array(64);
    curve.G1.toRprUncompressed(serializedNegatedP1, 0, negatedP1);
    return serializedNegatedP1;
}

// Convert G2 point to uncompressed format
function g2Uncompressed(curve, p2Raw) {
    const p2 = curve.G2.fromObject(p2Raw);
    const buff = new Uint8Array(128);
    curve.G2.toRprUncompressed(buff, 0, p2);
    return buff;
}

// Helper function to reduce a hash to field element
function reduceHashToField(hashBuffer) {
    // Convert hash to BigInt (big-endian)
    let hashBigInt = BigInt(0);
    for (let i = 0; i < 32; i++) {
        hashBigInt = (hashBigInt << 8n) | BigInt(hashBuffer[i]);
    }
    
    // Reduce modulo field
    hashBigInt = hashBigInt % FIELD_MODULUS;
    
    // Convert back to bytes (big-endian)
    const reduced = Buffer.alloc(32);
    let temp = hashBigInt;
    for (let j = 31; j >= 0; j--) {
        reduced[j] = Number(temp & 0xFFn);
        temp = temp >> 8n;
    }
    
    return { bigint: hashBigInt, buffer: reduced };
}

// Compute scope hash for a given mint
function computeScope(mintBuffer) {
    const scopeData = Buffer.concat([
        Buffer.from('PrivacyPool'),
        mintBuffer
    ]);
    const scopeHash = Buffer.from(keccak256.array(scopeData));
    return reduceHashToField(scopeHash);
}

// Compute label from scope and nonce
function computeLabel(scopeBuffer, nonce) {
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(BigInt(nonce));
    
    const labelData = Buffer.concat([scopeBuffer, nonceBuffer]);
    const labelHash = Buffer.from(keccak256.array(labelData));
    return reduceHashToField(labelHash);
}

// Generate commitment proof with proper curve serialization
async function generateCommitmentProof(value, label, nullifier, secret) {
    if (!fs.existsSync(COMMITMENT_WASM) || !fs.existsSync(COMMITMENT_ZKEY)) {
        console.log('   ⚠️  Circuit files not found, using mock proof for testing');
        // Return mock proof for testing
        return {
            proof: {
                proofA: new Uint8Array(64),
                proofB: new Uint8Array(128),
                proofC: new Uint8Array(64)
            },
            publicSignals: {
                value: Buffer.alloc(32),
                label: Buffer.alloc(32),
                commitment: Buffer.alloc(32),
                nullifierHash: Buffer.alloc(32)
            }
        };
    }
    
    // Prepare witness input
    const input = {
        value: value.toString(),
        label: label.toString(),
        nullifier: nullifier.toString(),
        secret: secret.toString()
    };
    
    // Generate witness and proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        COMMITMENT_WASM,
        COMMITMENT_ZKEY
    );
    
    console.log('   Circuit public signals:', publicSignals.map((s, i) => 
        `[${i}]: ${BigInt(s).toString(16).padStart(64, '0')}`).join('\n   '));
    
    // Build the curve for proper serialization
    const curve = await buildBn128();
    const proofProc = unstringifyBigInts(proof);
    const publicSignalsUnstrigified = unstringifyBigInts(publicSignals);
    
    // Process proof_a: convert to uncompressed format and negate
    let proofA = g1Uncompressed(curve, proofProc.pi_a);
    proofA = await negateAndSerializeG1(curve, proofA);
    
    // Process proof_b: convert to uncompressed format
    const proofB = g2Uncompressed(curve, proofProc.pi_b);
    
    // Process proof_c: convert to uncompressed format
    const proofC = g1Uncompressed(curve, proofProc.pi_c);
    
    // Terminate the curve
    await curve.terminate();
    
    // Convert public signals to 32-byte buffers
    const formattedPublicSignals = publicSignalsUnstrigified.map((signal) => {
        return to32ByteBuffer(BigInt(signal));
    });
    
    // Map to our expected format
    // Circuit outputs: [commitment, nullifierHash, value, label]
    return {
        proof: { 
            proofA: new Uint8Array(proofA),
            proofB: new Uint8Array(proofB),
            proofC: new Uint8Array(proofC)
        },
        publicSignals: {
            value: formattedPublicSignals[2],
            label: formattedPublicSignals[3],
            commitment: formattedPublicSignals[0],
            nullifierHash: formattedPublicSignals[1]
        },
        rawProof: proof,
        rawPublicSignals: publicSignals
    };
}

// Verify proof with snarkjs
async function verifyCommitmentProof(proof, publicSignals) {
    if (!fs.existsSync(COMMITMENT_VKEY)) {
        console.error('Verifying key not found!');
        return false;
    }
    
    const vKey = JSON.parse(fs.readFileSync(COMMITMENT_VKEY, 'utf8'));
    return await snarkjs.groth16.verify(vKey, publicSignals, proof);
}

// Generate withdraw proof with proper curve serialization
async function generateWithdrawProof(
    withdrawnValue,
    stateRoot,
    stateTreeDepth,
    ASPRoot,
    ASPTreeDepth,
    context,
    label,
    existingValue,
    existingNullifier,
    existingSecret,
    newNullifier,
    newSecret,
    stateSiblings,
    stateIndex,
    ASPSiblings,
    ASPIndex
) {
    if (!fs.existsSync(WITHDRAW_WASM) || !fs.existsSync(WITHDRAW_ZKEY)) {
        console.log('   ⚠️  Withdraw circuit files not found, using mock proof for testing');
        // Return mock proof for testing
        return {
            proof: {
                proofA: new Uint8Array(64),
                proofB: new Uint8Array(128),
                proofC: new Uint8Array(64)
            },
            publicSignals: {
                withdrawnValue: Buffer.alloc(32),
                stateRoot: Buffer.alloc(32),
                stateTreeDepth: Buffer.alloc(32),
                ASPRoot: Buffer.alloc(32),
                ASPTreeDepth: Buffer.alloc(32),
                context: Buffer.alloc(32),
                newCommitmentHash: Buffer.alloc(32),
                existingNullifierHash: Buffer.alloc(32)
            }
        };
    }
    
    // Prepare witness input
    const input = {
        withdrawnValue: withdrawnValue.toString(),
        stateRoot: stateRoot.toString(),
        stateTreeDepth: stateTreeDepth.toString(),
        ASPRoot: ASPRoot.toString(),
        ASPTreeDepth: ASPTreeDepth.toString(),
        context: context.toString(),
        label: label.toString(),
        existingValue: existingValue.toString(),
        existingNullifier: existingNullifier.toString(),
        existingSecret: existingSecret.toString(),
        newNullifier: newNullifier.toString(),
        newSecret: newSecret.toString(),
        stateSiblings: stateSiblings.map(s => s.toString()),
        stateIndex: stateIndex.toString(),
        ASPSiblings: ASPSiblings.map(s => s.toString()),
        ASPIndex: ASPIndex.toString()
    };
    
    // Generate witness and proof
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        input,
        WITHDRAW_WASM,
        WITHDRAW_ZKEY
    );
    
    console.log('   Withdraw circuit public signals:', publicSignals.map((s, i) => 
        `[${i}]: ${BigInt(s).toString(16).padStart(64, '0')}`).join('\n   '));
    
    // Build the curve for proper serialization
    const curve = await buildBn128();
    const proofProc = unstringifyBigInts(proof);
    const publicSignalsUnstrigified = unstringifyBigInts(publicSignals);
    
    // Process proof_a: convert to uncompressed format and negate
    let proofA = g1Uncompressed(curve, proofProc.pi_a);
    proofA = await negateAndSerializeG1(curve, proofA);
    
    // Process proof_b: convert to uncompressed format
    const proofB = g2Uncompressed(curve, proofProc.pi_b);
    
    // Process proof_c: convert to uncompressed format
    const proofC = g1Uncompressed(curve, proofProc.pi_c);
    
    // Terminate the curve
    await curve.terminate();
    
    // Convert public signals to 32-byte buffers
    const formattedPublicSignals = publicSignalsUnstrigified.map((signal) => {
        return to32ByteBuffer(BigInt(signal));
    });
    
    // Map to our expected format
    // Circuit outputs: [newCommitmentHash, existingNullifierHash]
    // Public inputs: [withdrawnValue, stateRoot, stateTreeDepth, ASPRoot, ASPTreeDepth, context]
    return {
        proof: { 
            proofA: new Uint8Array(proofA),
            proofB: new Uint8Array(proofB),
            proofC: new Uint8Array(proofC)
        },
        publicSignals: {
            withdrawnValue: formattedPublicSignals[0],
            stateRoot: formattedPublicSignals[1],
            stateTreeDepth: formattedPublicSignals[2],
            ASPRoot: formattedPublicSignals[3],
            ASPTreeDepth: formattedPublicSignals[4],
            context: formattedPublicSignals[5],
            newCommitmentHash: formattedPublicSignals[6],
            existingNullifierHash: formattedPublicSignals[7]
        },
        rawProof: proof,
        rawPublicSignals: publicSignals
    };
}

// Verify withdraw proof with snarkjs
async function verifyWithdrawProof(proof, publicSignals) {
    if (!fs.existsSync(WITHDRAW_VKEY)) {
        console.error('Withdraw verifying key not found!');
        return false;
    }
    
    const vKey = JSON.parse(fs.readFileSync(WITHDRAW_VKEY, 'utf8'));
    return await snarkjs.groth16.verify(vKey, publicSignals, proof);
}

module.exports = {
    FIELD_MODULUS,
    to32ByteBuffer,
    reduceHashToField,
    computeScope,
    computeLabel,
    generateCommitmentProof,
    verifyCommitmentProof,
    generateWithdrawProof,
    verifyWithdrawProof,
    COMMITMENT_WASM,
    COMMITMENT_ZKEY,
    COMMITMENT_VKEY,
    WITHDRAW_WASM,
    WITHDRAW_ZKEY,
    WITHDRAW_VKEY
};