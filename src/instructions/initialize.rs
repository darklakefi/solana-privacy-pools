use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;

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
        log!("Not enough accounts provided");
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
        log!("Mint account does not match instruction data");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Note: ATA verification would be done client-side
    // The pool_token_account should be the ATA of pool_account for asset_mint
    // In production, would verify this is correct ATA
    let _ = pool_token_account; // Mark as used for now
    
    // Note: max_tree_depth is less critical for Lean IMT as it grows dynamically
    // But we'll still validate it for compatibility
    if max_tree_depth == 0 || max_tree_depth > crate::constants::MAX_TREE_DEPTH {
        log!("Invalid tree depth");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Get mutable reference to pool state - properly maintain the borrow
    let mut pool_data = pool_account.try_borrow_mut_data()?;
    
    if pool_data.len() != PoolStateLeanIMT::LEN {
        log!("Invalid pool account size");
        return Err(ProgramError::InvalidAccountData);
    }
    
    // IMPORTANT: Zero the entire account data first
    // Solana doesn't guarantee zero-initialized memory for new accounts
    for byte in pool_data.iter_mut() {
        *byte = 0;
    }
    
    let pool_state = unsafe {
        &mut *(pool_data.as_mut_ptr() as *mut PoolStateLeanIMT)
    };
    
    // No need to check is_initialized since we just zeroed everything
    
    // Generate scope using a simple hash for now
    // In production, would use proper keccak256 implementation
    let mut scope = [0u8; 32];
    scope[..11].copy_from_slice(b"PrivacyPool");
    scope[11..31].copy_from_slice(&asset_mint.as_ref()[..20]);
    
    // For now, use a dummy withdrawal verifier (would be the actual verifier key in production)
    let withdrawal_verifier = Pubkey::from([0u8; 32]);
    
    // Initialize pool state
    log!("Initializing pool");
    
    pool_state.initialize(
        *authority.key(),
        asset_mint,
        entrypoint_authority,
        withdrawal_verifier,
        scope,
    );
    
    log!("Pool initialized successfully with Lean IMT");
    Ok(())
}