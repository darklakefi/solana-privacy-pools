use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::state::zero_copy::PrivacyPoolStateZC;
use solana_program::keccak;

/// Initialize a new privacy pool using zero-copy accounts
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
    
    if max_tree_depth == 0 || max_tree_depth > crate::constants::MAX_TREE_DEPTH {
        msg!("Invalid tree depth");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Get mutable reference to pool state using zero-copy
    let pool_state = PrivacyPoolStateZC::from_account_mut(pool_account)?;
    
    if pool_state.is_initialized() {
        msg!("Pool already initialized");
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    
    // Generate scope
    let mut hasher = keccak::Hasher::default();
    hasher.hash(b"PrivacyPool");
    hasher.hash(asset_mint.as_ref());
    let scope = hasher.result().to_bytes();
    
    // Initialize pool state
    pool_state.is_initialized = 1;
    pool_state.entrypoint_authority.copy_from_slice(entrypoint_authority.as_ref());
    pool_state.asset_mint.copy_from_slice(asset_mint.as_ref());
    pool_state.scope = scope;
    pool_state.nonce = 0;
    pool_state.dead = 0;
    pool_state.max_tree_depth = max_tree_depth;
    pool_state.current_root_index = 0;
    
    // Initialize merkle tree
    pool_state.merkle_tree.depth = max_tree_depth;
    pool_state.merkle_tree.next_index = 0;
    pool_state.merkle_tree.init_zeros();
    
    // Initialize root history with zeros
    for i in 0..crate::constants::ROOT_HISTORY_SIZE {
        pool_state.roots[i] = [0u8; 32];
    }
    
    msg!("Pool initialized with max depth {}", max_tree_depth);
    Ok(())
}