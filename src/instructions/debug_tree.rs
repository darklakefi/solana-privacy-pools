use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;

use crate::state::lean_imt::LeanIMT;

/// Debug instruction specifically for testing LeanIMT insert and persistence
pub fn debug_tree_insert(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    value: [u8; 32],
) -> ProgramResult {
    if accounts.is_empty() {
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_account = &accounts[0];

    // Ensure the account is writable
    if !pool_account.is_writable() {
        return Err(ProgramError::InvalidAccountData);
    }

    // Get mutable access to pool data
    let mut pool_data = pool_account.try_borrow_mut_data()?;

    log!("Debug Tree Insert Operation");

    // Calculate offset to state_tree
    // PoolStateLeanIMT layout:
    // is_initialized (1) + padding (7) + authority (32) + asset_mint (32) +
    // entrypoint (32) + withdrawal_verifier (32) + scope (32) + nonce (8) +
    // is_dead (1) + padding (7) + roots (32*30) + current_root_index (8) = 1152 bytes
    const STATE_TREE_OFFSET: usize = 1152;

    // Get a mutable pointer to the tree within the buffer for zero-copy access
    let tree_ptr = unsafe { 
        pool_data.as_mut_ptr().add(STATE_TREE_OFFSET) as *mut LeanIMT 
    };

    // Log initial state
    let (initial_size, initial_depth) = unsafe {
        let tree = &*tree_ptr;
        (tree.size, tree.depth)
    };
    log!("Before: size={}, depth={}", initial_size, initial_depth);
    
    log!("Inserting value: first 4 bytes = [{}, {}, {}, {}]", 
         value[0], value[1], value[2], value[3]);

    // Perform insert operation directly on the tree in memory
    let result = unsafe {
        let tree = &mut *tree_ptr;
        tree.insert(value)
    };

    match result {
        Ok(root) => {
            // Log post-insert state
            let (new_size, new_depth) = unsafe {
                let tree = &*tree_ptr;
                (tree.size, tree.depth)
            };
            
            log!("After: size={}, depth={}", new_size, new_depth);
            log!("New root: first 4 bytes = [{}, {}, {}, {}]", 
                 root[0], root[1], root[2], root[3]);
            
            // Verify the root persisted by reading it back
            let stored_root = unsafe { (*tree_ptr).root() };
            log!("Verification - stored root: first 4 bytes = [{}, {}, {}, {}]", 
                 stored_root[0], stored_root[1], stored_root[2], stored_root[3]);
            
            Ok(())
        }
        Err(_) => {
            log!("Insert failed");
            Err(ProgramError::InvalidArgument)
        }
    }
}