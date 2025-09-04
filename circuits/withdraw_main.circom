pragma circom 2.0.0;

include "./withdraw.circom";

component main { public [ withdrawnValue, stateRoot, stateTreeDepth, ASPRoot, ASPTreeDepth, context ] } = Withdraw(20);