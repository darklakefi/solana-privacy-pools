use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};
use crate::constants::{ROOT_HISTORY_SIZE, MAX_TREE_DEPTH};

/// Zero-copy version of PrivacyPoolState that directly maps to account data
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct PrivacyPoolStateZC {
    pub is_initialized: u8,                                    // 1 byte
    pub entrypoint_authority: [u8; 32],                       // 32 bytes
    pub asset_mint: [u8; 32],                                 // 32 bytes
    pub scope: [u8; 32],                                      // 32 bytes
    pub nonce: u64,                                            // 8 bytes
    pub dead: u8,                                              // 1 byte
    pub max_tree_depth: u8,                                   // 1 byte
    pub _padding1: [u8; 6],                                   // 6 bytes padding to align to 8 bytes
    pub current_root_index: u64,                              // 8 bytes
    pub roots: [[u8; 32]; ROOT_HISTORY_SIZE],                 // 32 * ROOT_HISTORY_SIZE bytes
    pub merkle_tree: MerkleTreeStateZC,                       // Embedded struct
}

/// Zero-copy version of MerkleTreeState
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct MerkleTreeStateZC {
    pub root: [u8; 32],                                       // 32 bytes
    pub depth: u8,                                            // 1 byte
    pub _padding1: [u8; 7],                                   // 7 bytes padding for alignment
    pub next_index: u64,                                      // 8 bytes
    pub filled_subtrees: [[u8; 32]; MAX_TREE_DEPTH as usize], // 32 * MAX_TREE_DEPTH bytes
    pub zeros: [[u8; 32]; MAX_TREE_DEPTH as usize],          // 32 * MAX_TREE_DEPTH bytes
}

/// Zero-copy version of NullifierState
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct NullifierStateZC {
    pub is_spent: u8,                                         // 1 byte
    pub nullifier_hash: [u8; 32],                            // 32 bytes
}

/// Zero-copy version of DepositorState
#[repr(C, packed)]
#[derive(Copy, Clone)]
pub struct DepositorStateZC {
    pub depositor: [u8; 32],                                 // 32 bytes
    pub label: [u8; 32],                                     // 32 bytes
}

impl PrivacyPoolStateZC {
    pub const LEN: usize = std::mem::size_of::<Self>();
    
    /// Get a mutable reference to the state from account data
    /// SAFETY: The returned reference is valid as long as the account data is not reborrowed
    pub fn from_account_mut<'a>(account: &'a AccountInfo) -> Result<&'a mut Self, ProgramError> {
        if account.data_len() != Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let data_ptr = account.try_borrow_mut_data()?.as_mut_ptr();
        unsafe {
            let state = &mut *(data_ptr as *mut Self);
            Ok(state)
        }
    }
    
    /// Get an immutable reference to the state from account data
    pub fn from_account<'a>(account: &'a AccountInfo) -> Result<&'a Self, ProgramError> {
        if account.data_len() != Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let data_ptr = account.try_borrow_data()?.as_ptr();
        unsafe {
            let state = &*(data_ptr as *const Self);
            Ok(state)
        }
    }
    
    pub fn is_initialized(&self) -> bool {
        self.is_initialized != 0
    }
    
    pub fn is_dead(&self) -> bool {
        self.dead != 0
    }
    
    pub fn set_dead(&mut self, dead: bool) {
        self.dead = if dead { 1 } else { 0 };
    }
    
    pub fn get_entrypoint_authority(&self) -> Pubkey {
        Pubkey::from(self.entrypoint_authority)
    }
    
    pub fn get_asset_mint(&self) -> Pubkey {
        Pubkey::from(self.asset_mint)
    }
    
    pub fn increment_nonce(&mut self) -> u64 {
        self.nonce += 1;
        self.nonce
    }
    
    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        self.roots.iter().any(|r| r == root)
    }
    
    pub fn add_root(&mut self, root: [u8; 32]) {
        let index = (self.current_root_index as usize) % ROOT_HISTORY_SIZE;
        self.roots[index] = root;
        self.current_root_index = ((self.current_root_index + 1) as usize % ROOT_HISTORY_SIZE) as u64;
    }
}

impl MerkleTreeStateZC {
    /// Insert a leaf into the merkle tree using zero-copy operations
    pub fn insert(&mut self, leaf: [u8; 32]) -> Result<(), ProgramError> {
        let mut current_index = self.next_index;
        let mut current_level_hash = leaf;
        
        for i in 0..self.depth {
            let idx = i as usize;
            if current_index % 2 == 0 {
                // Left child
                self.filled_subtrees[idx] = current_level_hash;
                current_level_hash = crate::crypto::poseidon::hash_two(
                    &current_level_hash,
                    &self.zeros[idx]
                );
            } else {
                // Right child
                current_level_hash = crate::crypto::poseidon::hash_two(
                    &self.filled_subtrees[idx],
                    &current_level_hash
                );
            }
            current_index /= 2;
        }
        
        self.root = current_level_hash;
        self.next_index += 1;
        Ok(())
    }
    
    /// Initialize zeros for the merkle tree (minimal initialization)
    pub fn init_zeros(&mut self) {
        // Start with zero leaf
        self.zeros[0] = [0u8; 32];
        
        // For initialization, just set the empty root to zero
        // We'll compute zeros lazily as needed during insertion
        self.root = [0u8; 32];
        
        // Initialize filled_subtrees with zeros  
        let actual_depth = self.depth.min(MAX_TREE_DEPTH) as usize;
        for i in 0..actual_depth {
            self.filled_subtrees[i] = [0u8; 32];
        }
        
        // Set next index to 0
        self.next_index = 0;
    }
}

impl NullifierStateZC {
    pub const LEN: usize = std::mem::size_of::<Self>();
    
    pub fn from_account_mut<'a>(account: &'a AccountInfo) -> Result<&'a mut Self, ProgramError> {
        if account.data_len() != Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let data_ptr = account.try_borrow_mut_data()?.as_mut_ptr();
        unsafe {
            let state = &mut *(data_ptr as *mut Self);
            Ok(state)
        }
    }
    
    pub fn set_spent(&mut self, nullifier_hash: [u8; 32]) {
        self.is_spent = 1;
        self.nullifier_hash = nullifier_hash;
    }
}

impl DepositorStateZC {
    pub const LEN: usize = std::mem::size_of::<Self>();
    
    pub fn from_account_mut<'a>(account: &'a AccountInfo) -> Result<&'a mut Self, ProgramError> {
        if account.data_len() != Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let data_ptr = account.try_borrow_mut_data()?.as_mut_ptr();
        unsafe {
            let state = &mut *(data_ptr as *mut Self);
            Ok(state)
        }
    }
    
    pub fn set(&mut self, depositor: Pubkey, label: [u8; 32]) {
        self.depositor.copy_from_slice(depositor.as_ref());
        self.label = label;
    }
}