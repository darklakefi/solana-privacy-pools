use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::{instructions::TransferChecked, state::Mint};

use crate::state::{PoolStateLeanIMT, NullifierStateZC};
use super::types::{WithdrawalData, WithdrawProofData};
use crate::constants::{POOL_PDA_SEED};
use pinocchio::instruction::{Seed, Signer};

/// Process a private withdrawal using SPL tokens
/// 
/// Accounts:
/// 0. Pool state account (writable, signer via PDA)
/// 1. Nullifier account (writable)
/// 2. Processooor/withdrawer (signer)
/// 3. Pool's token account (writable)
/// 4. User's token account (writable)
/// 5. Asset mint
/// 6. Token program
pub fn withdraw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    withdrawal_data: WithdrawalData,
    proof_data: WithdrawProofData,
) -> ProgramResult {
    if accounts.len() < 7 {
        log!("Not enough accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    
    let pool_account = &accounts[0];
    let nullifier_account = &accounts[1];
    let processooor_account = &accounts[2];
    let pool_token_account = &accounts[3];
    let user_token_account = &accounts[4];
    let mint_account = &accounts[5];
    let _token_program = &accounts[6];
    
    // Validate signer
    if !processooor_account.is_signer() {
        log!("Processooor must sign");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if processooor_account.key() != &withdrawal_data.processooor {
        log!("Invalid processooor");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Get mutable reference to pool state using Lean IMT
    let pool_state = PoolStateLeanIMT::from_account_mut(pool_account)?;
    
    // Verify the mint matches the pool's asset mint
    if *mint_account.key() != Pubkey::from(pool_state.asset_mint) {
        log!("Wrong token mint");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify the context
    let expected_context = crate::crypto::poseidon::compute_context(&withdrawal_data, &pool_state.scope);
    if expected_context != proof_data.context() {
        log!("Context mismatch");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Validate tree depths (less critical for Lean IMT but still checked)
    if proof_data.state_tree_depth() > 32 || proof_data.asp_tree_depth() > 32 {
        log!("Invalid tree depth");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify the state root is known
    if !pool_state.is_known_root(&proof_data.state_root()) {
        log!("Unknown state root");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify the ZK proof
    if !crate::crypto::verifying_key::verify_withdraw_proof(&proof_data) {
        log!("Invalid withdrawal proof");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Update nullifier state using zero-copy
    let nullifier_state = NullifierStateZC::from_account_mut(nullifier_account)?;
    nullifier_state.set_spent(proof_data.existing_nullifier_hash());
    
    // Insert new commitment into state tree
    pool_state.insert_state_commitment(proof_data.new_commitment_hash())?;
    
    // Transfer tokens from pool to user
    let withdrawn_value = proof_data.withdrawn_value();
    log!("Transferring tokens to withdrawer");
    
    // Read decimals from the mint account
    let mint = unsafe { Mint::from_account_info_unchecked(mint_account)? };
    let decimals = mint.decimals();
    
    // Use PDA seeds for pool authority signing
    let seeds = [Seed::from(POOL_PDA_SEED), Seed::from(&pool_state.asset_mint)];
    let signer = Signer::from(&seeds);
    TransferChecked {
        from: pool_token_account,
        to: user_token_account,
        mint: mint_account,
        authority: pool_account,
        amount: withdrawn_value,
        decimals,
    }.invoke_signed(&[signer])?;
    
    log!("Withdrawal successful");
    
    Ok(())
}