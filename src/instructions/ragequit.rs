use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{BorshSerialize};
use crate::state::*;
use super::types::RagequitProofData;

/// Process a ragequit (original depositor exit)
pub fn ragequit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    proof_data: RagequitProofData,
) -> ProgramResult {
    let pool_account = &accounts[0];
    let depositor_account = &accounts[1];
    let nullifier_account = &accounts[2];
    let ragequitter = &accounts[3];
    let asset_vault = &accounts[4];
    let ragequitter_token_account = &accounts[5];
    
    if !ragequitter.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let depositor_state = get_depositor_state(depositor_account)?;
    if depositor_state.depositor != *ragequitter.key() {
        msg!("Only original depositor can ragequit");
        return Err(ProgramError::InvalidArgument);
    }
    
    if depositor_state.label != proof_data.label() {
        msg!("Label mismatch");
        return Err(ProgramError::InvalidArgument);
    }
    
    if !crate::crypto::verifying_key::verify_ragequit_proof(&proof_data) {
        msg!("Invalid ragequit proof");
        return Err(ProgramError::InvalidArgument);
    }
    
    let nullifier_state = NullifierState::new(proof_data.nullifier_hash());
    let nullifier_data = nullifier_state.try_to_vec()?;
    nullifier_account.try_borrow_mut_data()?[..].copy_from_slice(&nullifier_data);
    
    msg!("Ragequit processed: {} tokens to {:?}", 
         proof_data.value(), 
         ragequitter.key());
    Ok(())
}