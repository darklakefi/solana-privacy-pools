const { buildPoseidon } = require("circomlibjs");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const { programKeypair } = require("./lib/constants");

async function testPoseidonComparison() {
  console.log("=== Poseidon Hash Comparison Test ===\n");

  // Connect to local validator
  const connection = new Connection("http://localhost:8899", "confirmed");
  const payer = Keypair.generate();

  // Fund the payer
  console.log("Funding payer account...");
  const airdropSig = await connection.requestAirdrop(
    payer.publicKey,
    2 * LAMPORTS_PER_SOL,
  );
  await connection.confirmTransaction(airdropSig);

  // Initialize JS Poseidon
  const poseidonJs = await buildPoseidon();

  // Test cases - using simple values that are valid field elements
  const testCases = [
    {
      name: "Zero values",
      left: BigInt(0),
      right: BigInt(0),
    },
    {
      name: "Small values",
      left: BigInt(1),
      right: BigInt(2),
    },
    {
      name: "Medium values",
      left: BigInt(
        "0x0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20",
      ),
      right: BigInt(
        "0x2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f40",
      ),
    },
  ];

  let allMatch = true;

  for (const testCase of testCases) {
    console.log(`\n--- Test: ${testCase.name} ---`);
    console.log(`Left:  0x${testCase.left.toString(16).padStart(64, "0")}`);
    console.log(`Right: 0x${testCase.right.toString(16).padStart(64, "0")}`);

    // Compute JS Poseidon hash
    const hashJs = poseidonJs.F.toObject(
      poseidonJs([testCase.left, testCase.right]),
    );
    console.log(`\nJS Poseidon result:`);
    console.log(`  0x${hashJs.toString(16).padStart(64, "0")}`);

    // Convert to bytes for Rust (big-endian)
    const leftBytes = Buffer.alloc(32);
    const rightBytes = Buffer.alloc(32);

    let tempLeft = testCase.left;
    let tempRight = testCase.right;
    for (let i = 31; i >= 0; i--) {
      leftBytes[i] = Number(tempLeft & 0xffn);
      rightBytes[i] = Number(tempRight & 0xffn);
      tempLeft = tempLeft >> 8n;
      tempRight = tempRight >> 8n;
    }

    // Call Rust program with test instruction (discriminator 99)
    const instructionData = Buffer.concat([
      Buffer.from([99]), // Test instruction discriminator
      leftBytes,
      rightBytes,
    ]);

    const testIx = new TransactionInstruction({
      keys: [],
      programId: programKeypair.publicKey,
      data: instructionData,
    });

    const tx = new Transaction().add(testIx);

    try {
      console.log("\nCalling Rust program...");
      const txSig = await sendAndConfirmTransaction(connection, tx, [payer], {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
      });

      // Get transaction logs
      const txDetails = await connection.getTransaction(txSig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });

      if (txDetails && txDetails.meta && txDetails.meta.logMessages) {
        console.log("\nAll transaction logs:");
        let rustHex = "";
        let collectingHash = false;

        txDetails.meta.logMessages.forEach((log, index) => {
          console.log(`  [${index}] ${log}`);

          // Look for hash result indicator
          if (log.includes("Poseidon hash result")) {
            collectingHash = true;
          } else if (collectingHash && log.includes("Program log: ")) {
            // Extract hex from program log
            const hexPart = log
              .replace("Program log: ", "")
              .replace(
                `Program ${programKeypair.publicKey.toBase58()} log: `,
                "",
              )
              .trim();
            if (/^[0-9a-f]+$/i.test(hexPart) && hexPart.length === 16) {
              rustHex += hexPart;
            }
          }
        });

        if (rustHex.length === 64) {
          console.log(`\nRust Poseidon result:`);
          console.log(`  0x${rustHex}`);

          // Compare with JS result
          const jsHex = hashJs.toString(16).padStart(64, "0");
          if (rustHex.toLowerCase() === jsHex.toLowerCase()) {
            console.log("\n✅ HASHES MATCH!");
          } else {
            console.log("\n❌ HASHES DO NOT MATCH!");
            console.log(`  JS:   0x${jsHex}`);
            console.log(`  Rust: 0x${rustHex}`);
            allMatch = false;
          }
        } else {
          console.log(
            `\n⚠️  Could not extract full Rust hash (got ${rustHex.length} chars)`,
          );
          allMatch = false;
        }
      }
    } catch (error) {
      console.error("Error calling Rust program:", error.message);
      if (error.logs) {
        console.log("Transaction logs:", error.logs);
      }
      allMatch = false;
    }
  }

  console.log("\n=== Test Complete ===");
  if (allMatch) {
    console.log("✅ All hashes match between JS and Rust!");
  } else {
    console.log("❌ Some hashes do not match. See details above.");
  }
}

// Run the test
testPoseidonComparison().catch(console.error);
