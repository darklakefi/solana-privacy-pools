const { ComputeBudgetProgram } = require('@solana/web3.js');

// Helper to add compute budget to transactions
function addComputeBudget(transaction, computeUnits = 1200000) {
    const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
        units: computeUnits,
    });
    
    // Add as first instruction
    const instructions = [computeBudgetIx, ...transaction.instructions];
    transaction.instructions = instructions;
    
    return transaction;
}

module.exports = { addComputeBudget };