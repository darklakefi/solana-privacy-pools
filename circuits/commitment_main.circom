pragma circom 2.1.9;

include "./commitment.circom";

// Value and label must be public inputs for on-chain verification
component main { public [value, label] } = CommitmentHasher();