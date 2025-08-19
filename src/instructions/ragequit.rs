use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::state::zero_copy::{PrivacyPoolStateZC, DepositorStateZC, NullifierStateZC};
use super::types::RagequitProofData;

/// Process a ragequit withdrawal using zero-copy accounts
pub fn ragequit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    proof_data: RagequitProofData,
) -> ProgramResult {
    let pool_account = &accounts[0];
    let depositor_account = &accounts[1];
    let ragequitter_account = &accounts[2];
    let nullifier_account = &accounts[3];
    
    if !ragequitter_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Get pool state using zero-copy (currently unused but will be needed for validation)
    let _pool_state = PrivacyPoolStateZC::from_account(pool_account)?;
    
    // Verify depositor
    let depositor_state = DepositorStateZC::from_account_mut(depositor_account)?;
    if &depositor_state.depositor != ragequitter_account.key().as_ref() {
        msg!("Not original depositor");
        return Err(ProgramError::InvalidArgument);
    }
    
    if depositor_state.label != proof_data.label() {
        msg!("Label mismatch");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify the proof
    if !crate::crypto::verifying_key::verify_ragequit_proof(&proof_data) {
        msg!("Invalid ragequit proof");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Update nullifier state using zero-copy
    let nullifier_state = NullifierStateZC::from_account_mut(nullifier_account)?;
    nullifier_state.set_spent(proof_data.nullifier_hash());
    
    msg!("Ragequit processed: {} tokens to {:?}", 
         proof_data.value(), 
         ragequitter_account.key());
    Ok(())
}