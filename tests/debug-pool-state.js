const { Connection, PublicKey } = require('@solana/web3.js');
const { parsePoolState } = require('./lib/pool-parser');

async function debugPoolState() {
    const connection = new Connection('http://localhost:8899', 'confirmed');

    // Get the pool state account (this will be different each run)
    // You'll need to pass this as an argument or get it from somewhere
    const poolStateAddress = process.argv[2];

    if (!poolStateAddress) {
        console.log("Usage: node debug-pool-state.js <POOL_STATE_ADDRESS>");
        process.exit(1);
    }

    const poolStatePubkey = new PublicKey(poolStateAddress);
    const accountInfo = await connection.getAccountInfo(poolStatePubkey);

    if (!accountInfo) {
        console.log("Pool state account not found!");
        process.exit(1);
    }

    const poolState = parsePoolState(accountInfo.data);

    console.log("\n=== Pool State Debug Info ===\n");
    console.log("State Tree:");
    console.log("  Size:", poolState.stateTree.size);
    console.log("  Depth:", poolState.stateTree.depth);
    console.log("  Root (from sideNodes[depth]):", poolState.stateTree.root.toString('hex'));

    // Show first few side nodes
    console.log("  Side nodes:");
    for (let i = 0; i <= Math.min(3, poolState.stateTree.depth); i++) {
        const node = poolState.stateTree.sideNodes[i];
        const isZero = node.every(b => b === 0);
        console.log(`    [${i}]: ${isZero ? "ALL ZEROS" : node.toString('hex').slice(0, 16) + "..."}`);
    }

    console.log("\nASP Tree:");
    console.log("  Size:", poolState.aspTree.size);
    console.log("  Depth:", poolState.aspTree.depth);
    console.log("  Root (from sideNodes[depth]):", poolState.aspTree.root.toString('hex'));

    console.log("\nRoots array:");
    for (let i = 0; i < 5; i++) {
        const root = poolState.roots[i];
        const isZero = root.every(b => b === 0);
        console.log(`  [${i}]: ${isZero ? "ALL ZEROS" : root.toString('hex').slice(0, 16) + "..."}`);
    }
    console.log("  Current root index:", poolState.currentRootIndex);
}

debugPoolState().catch(console.error);
