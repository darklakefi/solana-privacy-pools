var ffjavascript = require('ffjavascript');
const {unstringifyBigInts, leInt2Buff} = ffjavascript.utils;
var fs = require("fs")
const process = require('process');

function main() {
  let inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("inputPath not specified");
  }

  // Read the verification key file
  let data = fs.readFileSync(inputPath, 'utf8');
  let mydata = JSON.parse(data);

  // Process the verification key data
  for (var i in mydata) {
    if (i == 'vk_alpha_1') {
      for (var j in mydata[i]) {
        mydata[i][j] = leInt2Buff(unstringifyBigInts(mydata[i][j]), 32).reverse()
      }
    } else if (i == 'vk_beta_2') {
      for (var j in mydata[i]) {
        for (var z in mydata[i][j]){
           mydata[i][j][z] = leInt2Buff(unstringifyBigInts(mydata[i][j][z]), 32).reverse()
        }
      }
    } else if (i == 'vk_gamma_2') {
      for (var j in mydata[i]) {
        for (var z in mydata[i][j]){
           mydata[i][j][z] = leInt2Buff(unstringifyBigInts(mydata[i][j][z]), 32).reverse()
        }
      }
    } else if (i == 'vk_delta_2') {
      for (var j in mydata[i]) {
        for (var z in mydata[i][j]){
           mydata[i][j][z] = leInt2Buff(unstringifyBigInts(mydata[i][j][z]), 32).reverse()
        }
      }
    } else if (i == 'IC') {
      for (var j in mydata[i]) {
        for (var z in mydata[i][j]){
           mydata[i][j][z] = leInt2Buff(unstringifyBigInts(mydata[i][j][z]), 32).reverse()
        }
      }
    }
  }

  // Generate Rust code
  let s = "pub const VERIFYING_KEY: groth16_solana::verifying_key::VerifyingKey = groth16_solana::verifying_key::VerifyingKey {\n";
  s += "\tvk_alpha_g1: [\n";
  for (var j = 0; j < mydata.vk_alpha_1.length - 1; j++) {
    s += "\t\t" + Array.from(mydata.vk_alpha_1[j]) + ",\n";
  }
  s += "\t],\n\n";

  s += "\tvk_beta_g2: [\n";
  for (var j = 0; j < mydata.vk_beta_2.length - 1; j++) {
    for (var z = 0; z < 2; z++) {
      s += "\t\t" + Array.from(mydata.vk_beta_2[j][z]) + ",\n";
    }
  }
  s += "\t],\n\n";

  s += "\tvk_gamme_g2: [\n";
  for (var j = 0; j < mydata.vk_gamma_2.length - 1; j++) {
    for (var z = 0; z < 2; z++) {
      s += "\t\t" + Array.from(mydata.vk_gamma_2[j][z]) + ",\n";
    }
  }
  s += "\t],\n\n";

  s += "\tvk_delta_g2: [\n";
  for (var j = 0; j < mydata.vk_delta_2.length - 1; j++) {
    for (var z = 0; z < 2; z++) {
      s += "\t\t" + Array.from(mydata.vk_delta_2[j][z]) + ",\n";
    }
  }
  s += "\t],\n\n";

  s += "\tvk_ic: &[\n";
  for (var ic in mydata.IC) {
    s += "\t\t[\n";
    for (var j = 0; j < mydata.IC[ic].length - 1; j++) {
      s += "\t\t\t" + Array.from(mydata.IC[ic][j]) + ",\n";
    }
    s += "\t\t],\n";
  }
  s += "\t]\n};";

  // Output to stdout
  console.log(s);
}

main();