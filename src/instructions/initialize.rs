use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::state::PoolStateLeanIMT;
use solana_program::keccak;

/// Initialize a new privacy pool using Lean IMT
pub fn initialize_pool(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    entrypoint_authority: Pubkey,
    max_tree_depth: u8,
    asset_mint: Pubkey,
) -> ProgramResult {
    let pool_account = &accounts[0];
    let authority = &accounts[1];
    
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Note: max_tree_depth is less critical for Lean IMT as it grows dynamically
    // But we'll still validate it for compatibility
    if max_tree_depth == 0 || max_tree_depth > crate::constants::MAX_TREE_DEPTH {
        msg!("Invalid tree depth");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Get mutable reference to pool state using zero-copy
    let pool_state = PoolStateLeanIMT::from_account_mut(pool_account)?;
    
    if pool_state.is_initialized != 0 {
        msg!("Pool already initialized");
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    
    // Generate scope
    let mut hasher = keccak::Hasher::default();
    hasher.hash(b"PrivacyPool");
    hasher.hash(asset_mint.as_ref());
    let scope = hasher.result().to_bytes();
    
    // For now, use a dummy withdrawal verifier (would be the actual verifier key in production)
    let withdrawal_verifier = Pubkey::from([0u8; 32]);
    
    // Initialize pool state
    pool_state.initialize(
        *authority.key(),
        asset_mint,
        entrypoint_authority,
        withdrawal_verifier,
        scope,
    );
    
    msg!("Pool initialized with Lean IMT");
    Ok(())
}