const {
  Keypair,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} = require("@solana/spl-token");
const { generateWithdrawProof } = require("./proof");
const { getVaultPDA } = require("./pool");
const { generateMerkleProofs } = require("./merkle");
const { parsePoolState } = require("./pool-parser");
const { keccak256 } = require("js-sha3");
const {
  programKeypair,
  NULLIFIER_STATE_SIZE,
  INSTRUCTIONS,
  WSOL_MINT,
} = require("./constants");

// Field modulus for BN254
const FIELD_MODULUS = BigInt(
  "21888242871839275222246405745257275088548364400416034343698204186575808495617",
);

// Helper to reduce hash to field element
function reduceHashToField(hashBuffer) {
  let hashBigInt = BigInt(0);
  for (let i = 0; i < 32; i++) {
    hashBigInt = (hashBigInt << 8n) | BigInt(hashBuffer[i]);
  }
  return hashBigInt % FIELD_MODULUS;
}

/**
 * Simplified withdraw function that handles all the complexity internally
 *
 * @param {Connection} connection - Solana connection
 * @param {PublicKey} poolStateAccount - Pool state account
 * @param {Keypair} user - User performing withdrawal
 * @param {Object} depositInfo - User's deposit information
 * @param {Array} allDeposits - All deposits in the pool (for merkle tree)
 * @param {PublicKey} mint - Token mint (defaults to WSOL)
 * @param {BigInt} withdrawAmount - Optional amount to withdraw (defaults to full amount)
 */
async function withdrawSimple(
  connection,
  poolStateAccount,
  user,
  depositInfo,
  allDeposits,
  mint = WSOL_MINT,
  withdrawAmount = null,
) {
  // Default to withdrawing full amount
  const withdrawnValue = withdrawAmount || depositInfo.value;

  // Get current pool state for roots
  const poolAccountInfo = await connection.getAccountInfo(poolStateAccount);
  const poolState = parsePoolState(poolAccountInfo.data);

  // Debug: Check deposit info structure
  console.log("    Debug: depositInfo keys:", Object.keys(depositInfo));
  console.log("    Debug: allDeposits[0] keys:", Object.keys(allDeposits[0]));

  // Generate merkle proofs for this deposit
  const depositIndex = allDeposits.findIndex((d) => {
    // Handle both Buffer and Uint8Array
    const dCommit = Buffer.isBuffer(d.commitment)
      ? d.commitment
      : Buffer.from(d.commitment);
    const infoCommit = Buffer.isBuffer(depositInfo.commitment)
      ? depositInfo.commitment
      : Buffer.from(depositInfo.commitment);
    return dCommit.toString("hex") === infoCommit.toString("hex");
  });

  if (depositIndex === -1) {
    throw new Error("Deposit not found in deposits array");
  }

  console.log("    Debug: Found deposit at index:", depositIndex);
  const merkleProofs = await generateMerkleProofs(allDeposits, depositIndex);
  console.log("    Debug: Generated merkle proofs");

  // Get the current state root from the state tree
  // With vendored LeanIMT, the root is at sideNodes[depth]
  console.log("    Debug: State tree depth:", poolState.stateTree.depth);
  console.log("    Debug: State tree size:", poolState.stateTree.size);
  const stateRootFromPool = poolState.stateTree.root;

  // Convert state root to BigInt (big-endian)
  let stateRootFromPoolBigInt = BigInt(0);
  for (let i = 0; i < 32; i++) {
    stateRootFromPoolBigInt =
      (stateRootFromPoolBigInt << 8n) | BigInt(stateRootFromPool[i]);
  }

  console.log(
    "    Debug: State root from pool:",
    stateRootFromPoolBigInt.toString(16).slice(0, 16) + "...",
  );
  console.log(
    "    Debug: State root from merkle:",
    merkleProofs.stateRoot.toString(16).slice(0, 16) + "...",
  );

  // Use the actual pool state root, not our computed one
  const stateRootBigInt = stateRootFromPoolBigInt;

  // Compute context: keccak256(processooor_pubkey, scope) % FIELD
  const scopeBuffer = Buffer.isBuffer(poolState.scope)
    ? poolState.scope
    : Buffer.from(poolState.scope);
  // Compute context to match circuit: keccak256("IPrivacyPool.Withdrawal", scope) % SNARK_SCALAR_FIELD
  // The circuit only includes the prefix and scope, not the processor or withdrawal data
  const withdrawalDataBytes = Buffer.alloc(8);
  withdrawalDataBytes.writeBigUInt64LE(withdrawAmount, 0);
  
  const contextData = Buffer.concat([
    Buffer.from("IPrivacyPool.Withdrawal"),
    scopeBuffer // scope
  ]);
  const contextHash = Buffer.from(keccak256.array(contextData));
  const contextReduced = reduceHashToField(contextHash);
  console.log(`    Debug: Context data length: ${contextData.length}`);
  console.log(`    Debug: Context hash first 4 bytes: ${contextHash[0]} ${contextHash[1]} ${contextHash[2]} ${contextHash[3]}`);
  console.log(`    Debug: Context reduced (hex): ${contextReduced.toString(16)}`);

  // Get vault PDA
  const { vaultPDA } = getVaultPDA(mint);

  // Get token accounts
  const userTokenAccount = await getAssociatedTokenAddress(
    mint,
    user.publicKey,
  );
  const poolTokenAccount = await getAssociatedTokenAddress(
    mint,
    vaultPDA,
    true,
  );

  // Generate new nullifier and secret for the change commitment
  const newNullifier = BigInt(
    Math.floor(Math.random() * Number.MAX_SAFE_INTEGER),
  );
  const newSecret = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

  // Generate withdraw proof
  console.log("    Debug: Calling generateWithdrawProof...");
  console.log(
    "    Debug: stateRootBigInt type:",
    typeof stateRootBigInt,
    "value:",
    stateRootBigInt.toString(16).slice(0, 16) + "...",
  );
  console.log("    Debug: First few state siblings:", 
    merkleProofs.stateProof.slice(0, 3).map(s => s ? s.toString(16).slice(0, 16) + "..." : "0"));
  console.log("    Debug: merkleProofs.stateIndex:", merkleProofs.stateIndex);
  console.log("    Debug: merkleProofs.aspIndex:", merkleProofs.aspIndex);
  console.log(
    "    Debug: merkleProofs.stateProof is array?",
    Array.isArray(merkleProofs.stateProof),
  );
  console.log(
    "    Debug: merkleProofs.stateProof length:",
    merkleProofs.stateProof ? merkleProofs.stateProof.length : "undefined",
  );
  console.log(
    "    Debug: First 3 stateProof elements:",
    merkleProofs.stateProof
      ? merkleProofs.stateProof.slice(0, 3).map((s) => typeof s)
      : "undefined",
  );

  const { proof, publicSignals } = await generateWithdrawProof(
    withdrawnValue,
    stateRootBigInt,
    merkleProofs.stateTreeDepth,
    merkleProofs.aspRoot,
    merkleProofs.aspTreeDepth,
    contextReduced,
    depositInfo.label,
    depositInfo.value,
    depositInfo.nullifier,
    depositInfo.secret,
    newNullifier,
    newSecret,
    merkleProofs.stateProof,
    merkleProofs.stateIndex,
    merkleProofs.aspProof,
    merkleProofs.aspIndex,
  );

  // Create nullifier state account
  const nullifierState = Keypair.generate();
  const nullifierRent =
    await connection.getMinimumBalanceForRentExemption(NULLIFIER_STATE_SIZE);

  const createNullifierAccountIx = SystemProgram.createAccount({
    fromPubkey: user.publicKey,
    newAccountPubkey: nullifierState.publicKey,
    space: NULLIFIER_STATE_SIZE,
    lamports: Number(nullifierRent),
    programId: programKeypair.publicKey,
  });

  // Build withdraw instruction data matching Rust parser expectations:
  // 1 byte: instruction type
  // 32 bytes: processor pubkey
  // 4 bytes: withdrawal data length
  // N bytes: withdrawal data (for now just the withdrawn value as 8 bytes)
  // 64 bytes: proof_a
  // 128 bytes: proof_b
  // 64 bytes: proof_c
  // 4 bytes: public signals count
  // 8 * 32 bytes: public signals
  
  const processorPubkey = user.publicKey; // User is the processor
  // withdrawalDataBytes already defined above for context computation
  
  const totalSize = 1 + 32 + 4 + withdrawalDataBytes.length + 64 + 128 + 64 + 4 + (8 * 32);
  const withdrawData = Buffer.alloc(totalSize);
  let offset = 0;

  // Instruction type
  withdrawData[offset++] = INSTRUCTIONS.WITHDRAW;

  // Processor pubkey
  withdrawData.set(processorPubkey.toBuffer(), offset);
  offset += 32;

  // Withdrawal data length
  withdrawData.writeUInt32LE(withdrawalDataBytes.length, offset);
  offset += 4;
  
  // Withdrawal data (just the value for now)
  withdrawData.set(withdrawalDataBytes, offset);
  offset += withdrawalDataBytes.length;

  // Add proof data
  withdrawData.set(proof.proofA, offset);
  offset += 64;
  withdrawData.set(proof.proofB, offset);
  offset += 128;
  withdrawData.set(proof.proofC, offset);
  offset += 64;

  // Public signals count
  withdrawData.writeUInt32LE(8, offset);
  offset += 4;
  
  // Add public signals (8 * 32 bytes)
  for (const signal of publicSignals) {
    withdrawData.set(signal, offset);
    offset += 32;
  }

  const withdrawIx = new TransactionInstruction({
    keys: [
      { pubkey: poolStateAccount, isSigner: false, isWritable: true },
      { pubkey: vaultPDA, isSigner: false, isWritable: false },
      { pubkey: nullifierState.publicKey, isSigner: false, isWritable: true },
      { pubkey: user.publicKey, isSigner: true, isWritable: false },
      { pubkey: poolTokenAccount, isSigner: false, isWritable: true },
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: programKeypair.publicKey,
    data: withdrawData,
  });

  const withdrawTx = new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(createNullifierAccountIx)
    .add(withdrawIx);

  const txSig = await sendAndConfirmTransaction(
    connection,
    withdrawTx,
    [user, nullifierState],
    { commitment: "confirmed" },
  );

  return {
    txSig,
    nullifierState: nullifierState.publicKey,
    nullifierHash: publicSignals[1], // Nullifier hash from proof
    newCommitment: publicSignals[0], // New commitment for change
  };
}

module.exports = {
  withdrawSimple,
};
