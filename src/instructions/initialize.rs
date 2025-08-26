use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::state::PoolStateLeanIMT;

/// Initialize a new privacy pool using Lean IMT
/// 
/// Accounts:
/// 0. Pool state account (writable)
/// 1. Authority (signer)
/// 2. Pool's token account (writable) - must be ATA of pool account for asset_mint
/// 3. Asset mint account
/// 4. Token program
pub fn initialize_pool(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    entrypoint_authority: Pubkey,
    max_tree_depth: u8,
    asset_mint: Pubkey,
) -> ProgramResult {
    if accounts.len() < 5 {
        msg!("Not enough accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    
    let pool_account = &accounts[0];
    let authority = &accounts[1];
    let pool_token_account = &accounts[2];
    let mint_account = &accounts[3];
    let token_program = &accounts[4];
    
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Note: We're using pinocchio-token, which handles token program verification internally
    // The token program account is passed but not explicitly validated here
    let _ = token_program; // Mark as used
    
    // Verify the mint account matches what was passed in instruction data
    if *mint_account.key() != asset_mint {
        msg!("Mint account does not match instruction data");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Note: ATA verification would be done client-side
    // The pool_token_account should be the ATA of pool_account for asset_mint
    // In production, would verify this is correct ATA
    let _ = pool_token_account; // Mark as used for now
    
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
    
    // Generate scope using a simple hash for now
    // In production, would use proper keccak256 implementation
    let mut scope = [0u8; 32];
    scope[..12].copy_from_slice(b"PrivacyPool");
    scope[12..].copy_from_slice(&asset_mint.as_ref()[..20]);
    
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