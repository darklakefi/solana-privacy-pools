/**
 * State verification utilities for testing invariants
 */
const { getAccount } = require('@solana/spl-token');
const { getPoolState } = require('./test-setup');

/**
 * Verify pool token balance matches expected amount
 */
async function verifyPoolBalance(connection, poolTokenAccount, expectedAmount) {
    const accountInfo = await getAccount(connection, poolTokenAccount);
    const actualAmount = accountInfo.amount;

    if (actualAmount !== expectedAmount) {
        throw new Error(
            `Pool balance mismatch: expected ${expectedAmount}, got ${actualAmount}`
        );
    }

    return actualAmount;
}

/**
 * Verify that a nullifier has been marked as spent
 */
async function verifyNullifierSpent(connection, poolStateAccount, nullifierHash) {
    const poolState = await getPoolState(connection, poolStateAccount);

    // Check if nullifier is in the spent set
    const nullifierHex = Buffer.from(nullifierHash).toString('hex');
    const isSpent = poolState.spentNullifiers?.has(nullifierHex);

    if (!isSpent) {
        throw new Error(`Expected nullifier ${nullifierHex.slice(0, 16)}... to be spent`);
    }

    return true;
}

/**
 * Verify that a nullifier has NOT been marked as spent
 */
async function verifyNullifierNotSpent(connection, poolStateAccount, nullifierHash) {
    const poolState = await getPoolState(connection, poolStateAccount);

    const nullifierHex = Buffer.from(nullifierHash).toString('hex');
    const isSpent = poolState.spentNullifiers?.has(nullifierHex);

    if (isSpent) {
        throw new Error(`Expected nullifier ${nullifierHex.slice(0, 16)}... to NOT be spent`);
    }

    return true;
}

/**
 * Verify pool state tree size
 */
async function verifyStateTreeSize(connection, poolStateAccount, expectedSize) {
    const poolState = await getPoolState(connection, poolStateAccount);

    if (poolState.stateTree.size !== expectedSize) {
        throw new Error(
            `State tree size mismatch: expected ${expectedSize}, got ${poolState.stateTree.size}`
        );
    }

    return poolState.stateTree.size;
}

/**
 * Verify ASP tree size
 */
async function verifyAspTreeSize(connection, poolStateAccount, expectedSize) {
    const poolState = await getPoolState(connection, poolStateAccount);

    if (poolState.aspTree.size !== expectedSize) {
        throw new Error(
            `ASP tree size mismatch: expected ${expectedSize}, got ${poolState.aspTree.size}`
        );
    }

    return poolState.aspTree.size;
}

/**
 * Capture pool state snapshot for comparison
 */
async function capturePoolSnapshot(connection, poolStateAccount, poolTokenAccount) {
    const poolState = await getPoolState(connection, poolStateAccount);
    const tokenAccount = await getAccount(connection, poolTokenAccount);

    return {
        stateTreeSize: poolState.stateTree.size,
        aspTreeSize: poolState.aspTree.size,
        stateTreeRoot: poolState.stateTree.root,
        aspTreeRoot: poolState.aspTree.root,
        totalDeposits: poolState.totalDeposits,
        balance: tokenAccount.amount,
        timestamp: Date.now(),
    };
}

/**
 * Verify pool state hasn't changed by comparing snapshots
 */
function verifyPoolUnchanged(beforeSnapshot, afterSnapshot) {
    const differences = [];

    if (beforeSnapshot.stateTreeSize !== afterSnapshot.stateTreeSize) {
        differences.push(`stateTreeSize: ${beforeSnapshot.stateTreeSize} -> ${afterSnapshot.stateTreeSize}`);
    }
    if (beforeSnapshot.aspTreeSize !== afterSnapshot.aspTreeSize) {
        differences.push(`aspTreeSize: ${beforeSnapshot.aspTreeSize} -> ${afterSnapshot.aspTreeSize}`);
    }
    if (beforeSnapshot.totalDeposits !== afterSnapshot.totalDeposits) {
        differences.push(`totalDeposits: ${beforeSnapshot.totalDeposits} -> ${afterSnapshot.totalDeposits}`);
    }
    if (beforeSnapshot.balance !== afterSnapshot.balance) {
        differences.push(`balance: ${beforeSnapshot.balance} -> ${afterSnapshot.balance}`);
    }

    if (differences.length > 0) {
        throw new Error(
            `Pool state changed unexpectedly:\n  ${differences.join('\n  ')}`
        );
    }

    return true;
}

module.exports = {
    verifyPoolBalance,
    verifyNullifierSpent,
    verifyNullifierNotSpent,
    verifyStateTreeSize,
    verifyAspTreeSize,
    capturePoolSnapshot,
    verifyPoolUnchanged,
};
