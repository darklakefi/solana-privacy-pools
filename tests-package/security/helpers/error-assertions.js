/**
 * Error assertion utilities for testing failure modes
 */

/**
 * Assert that a transaction fails with an expected error
 * @param {Function} fn Async function that should fail
 * @param {string} expectedError Expected error substring
 * @returns {Promise<Error>} The caught error
 */
async function expectTransactionFailure(fn, expectedError = null) {
    let error = null;
    let success = false;

    try {
        await fn();
        success = true;
    } catch (err) {
        error = err;
    }

    if (success) {
        throw new Error(`Expected transaction to fail${expectedError ? ` with "${expectedError}"` : ''}, but it succeeded`);
    }

    if (expectedError) {
        const errorMessage = error.message || '';
        const errorLogs = error.logs ? error.logs.join('\n') : '';
        const fullError = errorMessage + '\n' + errorLogs;

        if (!fullError.includes(expectedError)) {
            throw new Error(
                `Expected error to contain "${expectedError}"\n` +
                `Got: ${errorMessage}\n` +
                `Logs: ${errorLogs}`
            );
        }
    }

    return error;
}

/**
 * Assert that a transaction succeeds (does not throw)
 * @param {Function} fn Async function that should succeed
 * @returns {Promise<any>} The result of the function
 */
async function expectTransactionSuccess(fn) {
    try {
        return await fn();
    } catch (error) {
        const errorMessage = error.message || '';
        const errorLogs = error.logs ? error.logs.join('\n') : '';
        throw new Error(
            `Expected transaction to succeed, but it failed\n` +
            `Error: ${errorMessage}\n` +
            `Logs: ${errorLogs}`
        );
    }
}

/**
 * Common error messages from the program
 */
const ErrorMessages = {
    NULLIFIER_ALREADY_SPENT: 'NullifierAlreadySpent',
    INVALID_PROOF: 'InvalidProof',
    INVALID_ROOT: 'InvalidRoot',
    UNAUTHORIZED: 'Unauthorized',
    INVALID_AMOUNT: 'InvalidAmount',
    POOL_NOT_WOUND_DOWN: 'PoolNotWoundDown',
    WRONG_DEPOSITOR: 'WrongDepositor',
};

module.exports = {
    expectTransactionFailure,
    expectTransactionSuccess,
    ErrorMessages,
};
