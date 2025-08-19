#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Read the verifying key
const vkeyPath = path.join(__dirname, '../../privacy-pools-core/packages/circuits/build/withdraw/groth16_vkey.json');
const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf8'));

// Convert a decimal string to little-endian bytes
function fieldToBytes(fieldStr) {
    const bigInt = BigInt(fieldStr);
    const bytes = [];
    let temp = bigInt;
    
    for (let i = 0; i < 32; i++) {
        bytes.push(Number(temp & 0xFFn));
        temp = temp >> 8n;
    }
    
    return bytes;
}

// Convert G1 point to bytes (64 bytes: x || y)
function g1ToBytes(point) {
    const x = fieldToBytes(point[0]);
    const y = fieldToBytes(point[1]);
    return [...x, ...y];
}

// Convert G2 point to bytes (128 bytes: x_c0 || x_c1 || y_c0 || y_c1)
function g2ToBytes(point) {
    const x_c0 = fieldToBytes(point[0][0]);
    const x_c1 = fieldToBytes(point[0][1]);
    const y_c0 = fieldToBytes(point[1][0]);
    const y_c1 = fieldToBytes(point[1][1]);
    return [...x_c0, ...x_c1, ...y_c0, ...y_c1];
}

// Convert the verifying key
console.log('Converting withdraw circuit verifying key...\n');

// Alpha G1
const alphaG1 = g1ToBytes(vkey.vk_alpha_1);
console.log('pub const WITHDRAW_VK_ALPHA_G1: [u8; 64] = [');
console.log('    ' + alphaG1.join(', '));
console.log('];\n');

// Beta G2
const betaG2 = g2ToBytes(vkey.vk_beta_2);
console.log('pub const WITHDRAW_VK_BETA_G2: [u8; 128] = [');
for (let i = 0; i < 128; i += 32) {
    console.log('    ' + betaG2.slice(i, i + 32).join(', ') + ',');
}
console.log('];\n');

// Gamma G2
const gammaG2 = g2ToBytes(vkey.vk_gamma_2);
console.log('pub const WITHDRAW_VK_GAMMA_G2: [u8; 128] = [');
for (let i = 0; i < 128; i += 32) {
    console.log('    ' + gammaG2.slice(i, i + 32).join(', ') + ',');
}
console.log('];\n');

// Delta G2
const deltaG2 = g2ToBytes(vkey.vk_delta_2);
console.log('pub const WITHDRAW_VK_DELTA_G2: [u8; 128] = [');
for (let i = 0; i < 128; i += 32) {
    console.log('    ' + deltaG2.slice(i, i + 32).join(', ') + ',');
}
console.log('];\n');

// IC points
console.log('pub const WITHDRAW_VK_IC: [[u8; 64]; 9] = [');
for (let i = 0; i < vkey.IC.length; i++) {
    const ic = g1ToBytes(vkey.IC[i]);
    console.log('    [' + ic.join(', ') + '],');
}
console.log('];\n');

console.log('Conversion complete!');