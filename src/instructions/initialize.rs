use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    syscalls::sol_keccak256,
    ProgramResult,
};
use pinocchio_log::log;

use crate::state::PoolStateLeanIMT;
use crate::crypto::verifying_key::{
    WITHDRAW_VK_ALPHA_G1, WITHDRAW_VK_BETA_G2, 
    WITHDRAW_VK_GAMMA_G2, WITHDRAW_VK_DELTA_G2, WITHDRAW_VK_IC
};

/// Compute a unique hash of the withdraw circuit's verifying key
/// This ensures only proofs from the correct circuit can be verified
fn compute_verifier_key_hash() -> Pubkey {
    // Concatenate all verifying key components
    let mut vk_data = Vec::with_capacity(64 + 128 * 3 + 64 * 9);
    
    // Add alpha_g1
    vk_data.extend_from_slice(&WITHDRAW_VK_ALPHA_G1);
    
    // Add beta_g2, gamma_g2, delta_g2
    vk_data.extend_from_slice(&WITHDRAW_VK_BETA_G2);
    vk_data.extend_from_slice(&WITHDRAW_VK_GAMMA_G2);
    vk_data.extend_from_slice(&WITHDRAW_VK_DELTA_G2);
    
    // Add IC points
    for ic_point in WITHDRAW_VK_IC.iter() {
        vk_data.extend_from_slice(ic_point);
    }
    
    log!("compute_verifier_key_hash: vk_data.len() = {}", vk_data.len() as u64);
    
    // Hash the entire verifying key
    // sol_keccak256 expects array of slices
    let slice: [&[u8]; 1] = [vk_data.as_slice()];
    
    let mut hash = [0u8; 32];
    unsafe {
        sol_keccak256(
            slice.as_ptr() as *const u8,
            slice.len() as u64,
            hash.as_mut_ptr()
        );
    }
    
    Pubkey::from(hash)
}

/// Initialize a new privacy pool using Lean IMT
/// 
/// Accounts:
/// 0. Pool state account (writable) - PDA to be created
/// 1. Authority (signer) - pays for account creation
/// 2. Pool's token account (writable) - must be ATA of pool account for asset_mint
/// 3. Asset mint account
/// 4. Token program
/// 5. System program - for creating the PDA
pub fn initialize_pool(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    entrypoint_authority: Pubkey,
    max_tree_depth: u8,
    asset_mint: Pubkey,
) -> ProgramResult {
    log!("Initialize: Starting initialization");
    
    if accounts.len() < 6 {
        log!("Not enough accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    
    let pool_account = &accounts[0];  // Pre-created account via createAccountWithSeed
    let authority = &accounts[1];
    let pool_token_account = &accounts[2];
    let mint_account = &accounts[3];
    let token_program = &accounts[4];
    let system_program = &accounts[5];
    
    if !authority.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    // Verify the pool account was created with the correct seed
    // Use "ps-" + first 29 chars of base58 mint address
    // We need to use base58 to match JavaScript
    log!("Initialize: About to encode mint address");
    
    extern crate alloc;
    use alloc::format;
    
    // Encode mint as base58 and take first 29 chars
    log!("Initialize: Starting bs58 encode");
    let mint_base58 = bs58::encode(asset_mint.as_ref()).into_string();
    log!("Initialize: bs58 encode complete");
    
    log!("Initialize: Creating seed string");
    let seed = format!("ps-{}", &mint_base58[..29.min(mint_base58.len())]);
    log!("Initialize: Seed string created");
    
    log!("Initialize: Creating expected pool address");
    let expected_pool_address = pinocchio::pubkey::create_with_seed(
        authority.key(),
        seed.as_bytes(),
        program_id
    )?;
    log!("Initialize: Expected pool address created");
    
    // Verify the pool account is at the expected address
    if pool_account.key() != &expected_pool_address {
        log!("Invalid pool account - doesn't match expected seed derivation");
        return Err(ProgramError::InvalidArgument);
    }
    log!("Initialize: Pool account address verified");
    
    // Verify the mint account matches what was passed in instruction data
    if *mint_account.key() != asset_mint {
        log!("Mint account does not match instruction data");
        return Err(ProgramError::InvalidArgument);
    }

    // Check that the account exists and is owned by the program
    if pool_account.data_len() == 0 {
        log!("Pool account doesn't exist - must be created with createAccountWithSeed first");
        return Err(ProgramError::UninitializedAccount);
    }
    
    if pool_account.owner() != program_id {
        log!("Pool account not owned by program");
        return Err(ProgramError::IllegalOwner);
    }
    
    // Check if pool is already initialized
    let pool_data_check = pool_account.try_borrow_data()?;
    if pool_data_check[0] != 0 {
        log!("Pool already initialized");
        return Err(ProgramError::AccountAlreadyInitialized);
    }
    drop(pool_data_check);

    // TODO: call ATA program
    let _ = pool_token_account; // Mark as used for now
    let _ = token_program;
    let _ = system_program;
    
    // Note: max_tree_depth is less critical for Lean IMT as it grows dynamically
    // But we'll still validate it for compatibility
    if max_tree_depth == 0 || max_tree_depth > crate::constants::MAX_TREE_DEPTH {
        log!("Invalid tree depth");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Get mutable reference to pool state
    log!("Initialize: Getting mutable reference to pool data");
    let mut pool_data = pool_account.try_borrow_mut_data()?;
    
    log!("Initialize: Pool data len = {}", pool_data.len() as u64);
    
    log!("Initialize: Casting to PoolStateLeanIMT");
    let pool_state = unsafe {
        &mut *(pool_data.as_mut_ptr() as *mut PoolStateLeanIMT)
    };
    log!("Initialize: Cast complete");
    
    // Generate scope using keccak256 hash of PrivacyPool prefix and asset mint
    log!("Initialize: Creating scope data slices");
    
    // sol_keccak256 expects an array of byte slices (fat pointers)
    let prefix = b"PrivacyPool";
    let mint_bytes = asset_mint.as_ref();
    
    // Create array of slices - each slice is a fat pointer (ptr + len)
    let slices: [&[u8]; 2] = [prefix, mint_bytes];
    
    log!("Initialize: Scope data slices created");
    
    log!("Initialize: Computing keccak256 for scope");
    let mut scope = [0u8; 32];
    unsafe {
        sol_keccak256(
            slices.as_ptr() as *const u8,
            slices.len() as u64,
            scope.as_mut_ptr()
        );
    }
    log!("Initialize: Scope computed");
    
    // Compute withdrawal verifier key hash from the actual verifying key constants
    // This creates a unique identifier for the withdraw circuit's verifying key
    log!("Initialize: Computing verifier key hash");
    let withdrawal_verifier = compute_verifier_key_hash();
    log!("Initialize: Verifier key hash computed");
    
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