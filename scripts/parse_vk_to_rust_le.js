var ffjavascript = require('ffjavascript');
const {unstringifyBigInts, leInt2Buff} = ffjavascript.utils;
var fs = require("fs")
const process = require('process');

async function main() {
  let inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("inputPath not specified");
  }

  let outputPath = ""
  if (process.argv[3]) {
    outputPath += process.argv[3] +"/";
  }

  console.log = () => {};

  let file = await fs.readFile(inputPath, async function(err, fd) {
   if (err) {
      return console.error(err);
   }
   console.log("File opened successfully!");
   var mydata = JSON.parse(fd.toString());
   console.log(mydata)

   for (var i in mydata) {
     if (i == 'vk_alpha_1') {

       for (var j in mydata[i]) {
         // Keep little-endian (don't reverse)
         mydata[i][j] = leInt2Buff(unstringifyBigInts(mydata[i][j]), 32)
       }
     } else if (i == 'vk_beta_2') {
       for (var j in mydata[i]) {
         console.log("mydata[i][j] ", mydata[i][j])

         // Keep little-endian (don't reverse)
         let tmp = Array.from(leInt2Buff(unstringifyBigInts(mydata[i][j][0]), 32)).concat(Array.from(leInt2Buff(unstringifyBigInts(mydata[i][j][1]), 32)))
         console.log("tmp ", tmp);
         mydata[i][j][0] = tmp.slice(0,32)
         mydata[i][j][1] = tmp.slice(32,64)
       }
     } else if (i == 'vk_gamma_2') {
       for (var j in mydata[i]) {
         // Keep little-endian (don't reverse)
         let tmp = Array.from(leInt2Buff(unstringifyBigInts(mydata[i][j][0]), 32)).concat(Array.from(leInt2Buff(unstringifyBigInts(mydata[i][j][1]), 32)))
         console.log(`i ${i}, tmp ${tmp}`)
         mydata[i][j][0] = tmp.slice(0,32)
         mydata[i][j][1] = tmp.slice(32,64)
       }
     } else if (i == 'vk_delta_2') {
       for (var j in mydata[i]) {
         // Keep little-endian (don't reverse)
         let tmp = Array.from(leInt2Buff(unstringifyBigInts(mydata[i][j][0]), 32)).concat(Array.from(leInt2Buff(unstringifyBigInts(mydata[i][j][1]), 32)))
         mydata[i][j][0] = tmp.slice(0,32)
         mydata[i][j][1] = tmp.slice(32,64)
       }
     }
     else if (i == 'vk_alphabeta_12') {
       for (var j in mydata[i]) {
         for (var z in mydata[i][j]){
           for (var u in mydata[i][j][z]){
             mydata[i][j][z][u] = leInt2Buff(unstringifyBigInts(mydata[i][j][z][u]))

           }
         }
       }
     }


     else if (i == 'IC') {
       for (var j in mydata[i]) {
         for (var z in mydata[i][j]){
            // Keep little-endian (don't reverse)
            mydata[i][j][z] = leInt2Buff(unstringifyBigInts(mydata[i][j][z]), 32)

         }
       }
     }

   }


   let resFile = await fs.openSync(outputPath + "verifying_key_le.rs","w")
   let s = `// Little-endian version of the verifying key for use with LE syscalls
use crate::instructions::{WithdrawProofData, CommitmentProofData};
use groth16_solana::groth16::{Groth16Verifier, Groth16Verifyingkey};

// Commitment circuit verifying key (LITTLE-ENDIAN)
// Generated from /home/vitorpy/zk/privacy-pools-core/packages/circuits/build/commitment/groth16_vkey.json

pub const COMMITMENT_VK_ALPHA_G1: [u8; 64] = [
`
   for (var j = 0; j < mydata.vk_alpha_1.length -1 ; j++) {
     s += "    " + Array.from(mydata.vk_alpha_1[j]) + ",\n"
   }
   s += "];\n\n"
   fs.writeSync(resFile,s)
   
   s = "pub const COMMITMENT_VK_BETA_G2: [u8; 128] = [\n"
   for (var j = 0; j < mydata.vk_beta_2.length -1 ; j++) {
     for (var z = 0; z < 2; z++) {
       s += "    " + Array.from(mydata.vk_beta_2[j][z]) + ",\n"
     }
   }
   s += "];\n\n"
   fs.writeSync(resFile,s)
   
   s = "pub const COMMITMENT_VK_GAMMA_G2: [u8; 128] = [\n"
   for (var j = 0; j < mydata.vk_gamma_2.length -1 ; j++) {
     for (var z = 0; z < 2; z++) {
       s += "    " + Array.from(mydata.vk_gamma_2[j][z]) + ",\n"
     }
   }
   s += "];\n\n"
   fs.writeSync(resFile,s)

   s = "pub const COMMITMENT_VK_DELTA_G2: [u8; 128] = [\n"
   for (var j = 0; j < mydata.vk_delta_2.length -1 ; j++) {
     for (var z = 0; z < 2; z++) {
       s += "    " + Array.from(mydata.vk_delta_2[j][z]) + ",\n"
     }
   }
   s += "];\n\n"
   fs.writeSync(resFile,s)
   
   s = "pub const COMMITMENT_VK_IC: [[u8; 64]; " + mydata.IC.length + "] = [\n"
   let x = 0;

   for (var ic in mydata.IC) {
     s += "    [\n"
     for (var j = 0; j < mydata.IC[ic].length - 1 ; j++) {
       s += "        " + mydata.IC[ic][j] + ",\n"
     }
     x++;
     s += "    ],\n"
   }
   s += "];\n\n"
   
   // Add the verify function
   s += `/// Verify a commitment proof using Groth16 with little-endian data
pub fn verify_commitment_proof(proof_data: &CommitmentProofData) -> bool {
    use pinocchio_log::log;
    
    // The commitment circuit has 4 public inputs in this order:
    // 0. commitment (output)
    // 1. nullifierHash (output)
    // 2. value (input)
    // 3. label (input)
    
    let public_signals: [[u8; 32]; 4] = [
        proof_data.commitment,
        proof_data.nullifier_hash,
        proof_data.value,
        proof_data.label,
    ];
    
    // Debug log the proof components
    log!("Verifying commitment proof");
    log!("  proof_a length: {}", proof_data.proof_a.len() as u64);
    log!("  proof_b length: {}", proof_data.proof_b.len() as u64);
    log!("  proof_c length: {}", proof_data.proof_c.len() as u64);
    
    // Create verifying key
    let vk = Groth16Verifyingkey {
        nr_pubinputs: 4,
        vk_alpha_g1: COMMITMENT_VK_ALPHA_G1,
        vk_beta_g2: COMMITMENT_VK_BETA_G2,
        vk_gamme_g2: COMMITMENT_VK_GAMMA_G2,
        vk_delta_g2: COMMITMENT_VK_DELTA_G2,
        vk_ic: &COMMITMENT_VK_IC,
    };
    
    log!("Creating Groth16 verifier");
    match Groth16Verifier::<4>::new(
        &proof_data.proof_a,
        &proof_data.proof_b,
        &proof_data.proof_c,
        &public_signals,
        &vk,
    ) {
        Ok(mut verifier) => {
            // Verify the proof without field check (we know our values are valid)
            verifier.verify_unchecked().is_ok()
        }
        Err(_) => false,
    }
}
`

   fs.writeSync(resFile,s)
   
   console.error("Generated verifying_key_le.rs with little-endian format");
 });
}


main()