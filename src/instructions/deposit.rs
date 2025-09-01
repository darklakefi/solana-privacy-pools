use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::instructions::Transfer;

use crate::state::{PoolStateLeanIMT, DepositorStateZC};
use crate::instructions::CommitmentProofData;

/// Make a deposit to the privacy pool using SPL tokens with ZK proof
/// 
/// Accounts:
/// 0. Pool state account (writable)
/// 1. Depositor state account (writable)
/// 2. Depositor (signer)
/// 3. User's token account (writable)
/// 4. Pool's token account (writable)
/// 5. Token program
pub fn deposit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    depositor: Pubkey,
    value: u64,
    proof_data: CommitmentProofData,
) -> ProgramResult {
    if accounts.len() < 6 {
        log!("Not enough accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    
    let pool_account = &accounts[0];
    let depositor_state_account = &accounts[1];
    let depositor_signer = &accounts[2];
    let user_token_account = &accounts[3];
    let pool_token_account = &accounts[4];
    let _token_program = &accounts[5];
    
    // Validate signer
    if !depositor_signer.is_signer() {
        log!("Depositor must sign");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if depositor_signer.key() != &depositor {
        log!("Invalid depositor");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Get pool state - properly maintain the borrow
    let mut pool_data = pool_account.try_borrow_mut_data()?;
    
    log!("Deposit: pool_data.len() = {}, expected PoolStateLeanIMT::LEN = {}", pool_data.len() as u64, PoolStateLeanIMT::LEN as u64);
    
    if pool_data.len() != PoolStateLeanIMT::LEN {
        log!("Invalid pool account size: got {} but expected {}", pool_data.len() as u64, PoolStateLeanIMT::LEN as u64);
        return Err(ProgramError::InvalidAccountData);
    }
    
    
    // Cast to our state structure
    let pool_state = unsafe {
        &mut *(pool_data.as_mut_ptr() as *mut PoolStateLeanIMT)
    };
    
    
    if pool_state.is_dead != 0 {
        log!("Pool is dead");
        return Err(ProgramError::InvalidAccountData);
    }
    
    // Validate value
    if value == 0 {
        log!("Cannot deposit zero");
        return Err(ProgramError::InvalidArgument);
    }
    
    if value >= u128::MAX as u64 {
        log!("Value too large");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Get current nonce for label generation (before incrementing)
    let current_nonce = pool_state.nonce;
    
    // Generate label (must match what the circuit expects)
    let label = crate::crypto::poseidon::compute_label(&pool_state.scope, current_nonce);
    
    // Now increment nonce for next deposit
    let new_nonce = PoolStateLeanIMT::increment_nonce_in_buffer(&mut pool_data);
    // Also update the struct field to keep it in sync
    pool_state.nonce = new_nonce;
    
    // Convert label to bytes for proof verification
    let label_bytes = {
        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(&label);
        bytes
    };
    
    // Debug logging
    log!("Deposit: Computing label:");
    // Convert scope to hex string for logging
    let scope_hex = pool_state.scope.iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join("");
    log!("  Scope: {}", scope_hex.as_str());
    log!("  Nonce: {}", current_nonce);
    // Convert label to hex string for logging
    let expected_hex = label_bytes.iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join("");
    let proof_hex = proof_data.label.iter()
        .map(|b| format!("{:02x}", b))
        .collect::<Vec<_>>()
        .join("");
    log!("  Expected label: {}", expected_hex.as_str());
    log!("  Proof label: {}", proof_hex.as_str());
    
    // Verify the proof data matches our expected values
    if proof_data.label != label_bytes {
        log!("Label mismatch in proof");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Convert value to bytes for verification (big-endian to match circuit output)
    let value_bytes = {
        let mut bytes = [0u8; 32];
        bytes[24..32].copy_from_slice(&value.to_be_bytes());
        bytes
    };
    
    if proof_data.value != value_bytes {
        log!("Value mismatch in proof");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify the commitment proof
    if !crate::crypto::verifying_key::verify_commitment_proof(&proof_data) {
        log!("Invalid commitment proof");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Extract the commitment from the proof (already verified)
    let commitment = proof_data.commitment;
    
    // Transfer tokens from user to pool using pinocchio-token
    Transfer {
        from: user_token_account,
        to: pool_token_account,
        authority: depositor_signer,
        amount: value,
    }.invoke()?;
    
    // Insert commitment into state tree
    pool_state.insert_state_commitment(commitment)?;
    log!("State tree insertion complete");
    
    // Insert label into ASP tree  
    log!("Inserting into ASP tree...");
    pool_state.insert_asp_label(label)?;
    log!("ASP tree insertion complete");
    
    // Update depositor state
    // We need to keep pool_data alive, so work with depositor through raw pointer too
    {
        let mut depositor_data = depositor_state_account.try_borrow_mut_data()?;
        if depositor_data.len() != DepositorStateZC::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        let depositor_state = unsafe {
            &mut *(depositor_data.as_mut_ptr() as *mut DepositorStateZC)
        };
        depositor_state.set(depositor, label);
        // depositor_data RefMut guard dropped here
    }
    
    log!("Deposit successful");
    
    // Debug: Check if changes are in the buffer  
    let nonce_after = u64::from_le_bytes(pool_data[168..176].try_into().unwrap());
    log!("Nonce in buffer after modifications: {}", nonce_after);
    
    // Debug: Check state tree size in buffer
    // After: is_initialized(1) + padding(7) + 5*pubkeys(160) + scope(32) + nonce(8) + is_dead(1) + padding(7) = 216
    // Then: roots[64][32] = 2048, current_root_index(8) = 2056
    // Then state_tree starts at 216 + 2048 + 8 = 2272
    let state_tree_offset = 216 + (64 * 32) + 8; 
    let state_tree_size = u64::from_le_bytes(pool_data[state_tree_offset..state_tree_offset+8].try_into().unwrap());
    log!("State tree size in buffer: {}", state_tree_size);
    
    // IMPORTANT: pool_data RefMut guard is dropped here at function end
    // This ensures all changes to pool_state are persisted
    
    Ok(())
}