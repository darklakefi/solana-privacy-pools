use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};

// Constants matching the Solidity implementation
pub const MAX_TREE_DEPTH: usize = 32;
pub const ROOT_HISTORY_SIZE: usize = 64;

/// Lean Incremental Merkle Tree implementation matching the Solidity version
/// This is a zero-copy structure that fits in a Solana account
#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct LeanIMTStateZC {
    /// Current number of leaves in the tree
    pub size: u64,
    /// Current depth of the tree (dynamic, increases as needed)
    pub depth: u32,
    /// Padding for alignment
    pub _padding: u32,
    /// Side nodes at each level (equivalent to sideNodes mapping in Solidity)
    /// sideNodes[level] = node value of the last even position at that level
    pub side_nodes: [[u8; 32]; MAX_TREE_DEPTH + 1], // +1 because root is at depth
    /// Mapping from leaf values to their indices (we'll use a simple array for now)
    /// In production, this would need a different approach
    pub leaf_indices: [[u8; 32]; 1024], // Store leaf values that exist
    pub leaf_count: u64,
}

impl LeanIMTStateZC {
    pub const LEN: usize = std::mem::size_of::<Self>();
    
    /// Get mutable reference from account
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
    
    /// Initialize the tree
    pub fn initialize(&mut self) {
        self.size = 0;
        self.depth = 0;
        self._padding = 0;
        
        // Initialize all side nodes to zero
        for i in 0..=MAX_TREE_DEPTH {
            self.side_nodes[i] = [0u8; 32];
        }
        
        // Initialize leaf tracking
        self.leaf_count = 0;
        for i in 0..1024 {
            self.leaf_indices[i] = [0u8; 32];
        }
    }
    
    /// Insert a leaf into the Lean IMT
    /// This follows the exact algorithm from the Solidity implementation
    pub fn insert(&mut self, leaf: [u8; 32]) -> Result<[u8; 32], ProgramError> {
        // Check if leaf already exists (simplified check)
        if self.has_leaf(&leaf) {
            return Err(ProgramError::InvalidArgument);
        }
        
        let index = self.size;
        
        // Calculate new depth if needed
        // A new insertion can increase tree depth by at most 1
        let mut tree_depth = self.depth as usize;
        if (1u64 << tree_depth) < index + 1 {
            tree_depth += 1;
            self.depth = tree_depth as u32;
        }
        
        // Start with the leaf as current node
        let mut node = leaf;
        
        // Traverse up the tree
        for level in 0..tree_depth {
            // Check if we're at an odd position at this level
            if ((index >> level) & 1) == 1 {
                // We're a right child, hash with the saved left sibling
                node = crate::crypto::poseidon::hash_two(
                    &self.side_nodes[level],
                    &node
                );
            } else {
                // We're a left child, save this node for later
                self.side_nodes[level] = node;
            }
        }
        
        // Increment size
        self.size = index + 1;
        
        // Save the root at the current depth
        self.side_nodes[tree_depth] = node;
        
        // Track the leaf (simplified - in production would need better approach)
        if self.leaf_count < 1024 {
            self.leaf_indices[self.leaf_count as usize] = leaf;
            self.leaf_count += 1;
        }
        
        Ok(node)
    }
    
    /// Get the current root
    pub fn root(&self) -> [u8; 32] {
        self.side_nodes[self.depth as usize]
    }
    
    /// Check if a leaf exists in the tree
    pub fn has_leaf(&self, leaf: &[u8; 32]) -> bool {
        for i in 0..self.leaf_count {
            if self.leaf_indices[i as usize] == *leaf {
                return true;
            }
        }
        false
    }
    
    /// Get the index of a leaf (returns None if not found)
    pub fn index_of(&self, leaf: &[u8; 32]) -> Option<u64> {
        for i in 0..self.leaf_count {
            if self.leaf_indices[i as usize] == *leaf {
                return Some(i);
            }
        }
        None
    }
}

/// Pool state using Lean IMT
#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct PoolStateLeanIMT {
    /// Pool configuration
    pub is_initialized: u8,
    pub _padding1: [u8; 7],
    pub authority: [u8; 32],
    pub asset_mint: [u8; 32],
    pub entrypoint: [u8; 32],
    pub withdrawal_verifier: [u8; 32],
    pub scope: [u8; 32],
    pub nonce: u64,
    pub is_dead: u8,
    pub _padding2: [u8; 7],
    
    /// Root history (circular buffer)
    pub roots: [[u8; 32]; ROOT_HISTORY_SIZE],
    pub current_root_index: u64,
    
    /// Lean IMT for state tree
    pub state_tree: LeanIMTStateZC,
    
    /// Lean IMT for ASP tree
    pub asp_tree: LeanIMTStateZC,
}

impl PoolStateLeanIMT {
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
    
    pub fn initialize(
        &mut self,
        authority: Pubkey,
        asset_mint: Pubkey,
        entrypoint: Pubkey,
        withdrawal_verifier: Pubkey,
        scope: [u8; 32],
    ) {
        self.is_initialized = 1;
        self.authority.copy_from_slice(authority.as_ref());
        self.asset_mint.copy_from_slice(asset_mint.as_ref());
        self.entrypoint.copy_from_slice(entrypoint.as_ref());
        self.withdrawal_verifier.copy_from_slice(withdrawal_verifier.as_ref());
        self.scope = scope;
        self.nonce = 0;
        self.is_dead = 0;
        
        // Initialize root history
        for i in 0..ROOT_HISTORY_SIZE {
            self.roots[i] = [0u8; 32];
        }
        self.current_root_index = 0;
        
        // Initialize trees
        self.state_tree.initialize();
        self.asp_tree.initialize();
    }
    
    pub fn insert_state_commitment(&mut self, commitment: [u8; 32]) -> Result<(), ProgramError> {
        // Insert into state tree
        let new_root = self.state_tree.insert(commitment)?;
        
        // Add to root history
        self.add_root(new_root);
        
        Ok(())
    }
    
    pub fn insert_asp_label(&mut self, label: [u8; 32]) -> Result<(), ProgramError> {
        // Insert into ASP tree
        self.asp_tree.insert(label)?;
        Ok(())
    }
    
    pub fn add_root(&mut self, root: [u8; 32]) {
        let index = (self.current_root_index as usize) % ROOT_HISTORY_SIZE;
        self.roots[index] = root;
        self.current_root_index = ((self.current_root_index + 1) as usize % ROOT_HISTORY_SIZE) as u64;
    }
    
    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        self.roots.iter().any(|r| r == root)
    }
    
    pub fn get_state_root(&self) -> [u8; 32] {
        self.state_tree.root()
    }
    
    pub fn get_asp_root(&self) -> [u8; 32] {
        self.asp_tree.root()
    }
    
    pub fn get_state_depth(&self) -> u32 {
        self.state_tree.depth
    }
    
    pub fn get_asp_depth(&self) -> u32 {
        self.asp_tree.depth
    }
    
    pub fn increment_nonce(&mut self) -> u64 {
        self.nonce += 1;
        self.nonce
    }
}

#[cfg(test)]
#[path = "lean_imt_test.rs"]
mod lean_imt_test;