use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
};

use solana_program::keccak;

use crate::{BorshSerialize, BorshDeserialize, constants::*};

impl BorshSerialize for PrivacyPoolState {
    fn try_to_vec(&self) -> Result<Vec<u8>, ProgramError> {
        let mut data = Vec::with_capacity(Self::LEN);
        data.push(if self.is_initialized { 1 } else { 0 });
        data.extend_from_slice(self.entrypoint_authority.as_ref());
        data.extend_from_slice(self.asset_mint.as_ref());
        data.extend_from_slice(&self.scope);
        data.extend_from_slice(&self.nonce.to_le_bytes());
        data.push(if self.dead { 1 } else { 0 });
        data.push(self.max_tree_depth);
        data.extend_from_slice(&self.current_root_index.to_le_bytes());
        for root in &self.roots {
            data.extend_from_slice(root);
        }
        data.extend_from_slice(&self.merkle_tree.try_to_vec()?);
        Ok(data)
    }
}

impl BorshDeserialize for PrivacyPoolState {
    fn try_from_slice(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let mut offset = 0;
        let is_initialized = data[offset] != 0;
        offset += 1;
        
        let entrypoint_authority = Pubkey::from(
            <[u8; 32]>::try_from(&data[offset..offset + 32])
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        offset += 32;
        
        let asset_mint = Pubkey::from(
            <[u8; 32]>::try_from(&data[offset..offset + 32])
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        offset += 32;
        
        let scope: [u8; 32] = <[u8; 32]>::try_from(&data[offset..offset + 32])
            .map_err(|_| ProgramError::InvalidAccountData)?;
        offset += 32;
        
        let nonce = u64::from_le_bytes(
            <[u8; 8]>::try_from(&data[offset..offset + 8])
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        offset += 8;
        
        let dead = data[offset] != 0;
        offset += 1;
        
        let max_tree_depth = data[offset];
        offset += 1;
        
        let current_root_index = usize::from_le_bytes(
            <[u8; 8]>::try_from(&data[offset..offset + 8])
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        offset += 8;
        
        let mut roots = [[0u8; 32]; ROOT_HISTORY_SIZE];
        for root in roots.iter_mut() {
            root.copy_from_slice(&data[offset..offset + 32]);
            offset += 32;
        }
        
        let merkle_tree = MerkleTreeState::try_from_slice(&data[offset..])?;
        
        Ok(Self {
            is_initialized,
            entrypoint_authority,
            asset_mint,
            scope,
            nonce,
            dead,
            max_tree_depth,
            current_root_index,
            roots,
            merkle_tree,
        })
    }
}

impl BorshSerialize for MerkleTreeState {
    fn try_to_vec(&self) -> Result<Vec<u8>, ProgramError> {
        let mut data = Vec::with_capacity(Self::LEN);
        data.extend_from_slice(&self.root);
        data.push(self.depth);
        data.extend_from_slice(&self.next_index.to_le_bytes());
        
        for subtree in &self.filled_subtrees {
            data.extend_from_slice(subtree);
        }
        for zero in &self.zeros {
            data.extend_from_slice(zero);
        }
        
        Ok(data)
    }
}

impl BorshDeserialize for MerkleTreeState {
    fn try_from_slice(data: &[u8]) -> Result<Self, ProgramError> {
        let mut offset = 0;
        
        let root: [u8; 32] = <[u8; 32]>::try_from(&data[offset..offset + 32])
            .map_err(|_| ProgramError::InvalidAccountData)?;
        offset += 32;
        
        let depth = data[offset];
        offset += 1;
        
        let next_index = u64::from_le_bytes(
            <[u8; 8]>::try_from(&data[offset..offset + 8])
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        offset += 8;
        
        let mut filled_subtrees = vec![[0u8; 32]; depth as usize];
        for subtree in filled_subtrees.iter_mut() {
            subtree.copy_from_slice(&data[offset..offset + 32]);
            offset += 32;
        }
        
        let mut zeros = vec![[0u8; 32]; (depth + 1) as usize];
        for zero in zeros.iter_mut() {
            zero.copy_from_slice(&data[offset..offset + 32]);
            offset += 32;
        }
        
        Ok(Self {
            root,
            depth,
            next_index,
            filled_subtrees,
            zeros,
        })
    }
}

impl BorshSerialize for NullifierState {
    fn try_to_vec(&self) -> Result<Vec<u8>, ProgramError> {
        let mut data = Vec::with_capacity(Self::LEN);
        data.push(if self.is_spent { 1 } else { 0 });
        data.extend_from_slice(&self.nullifier_hash);
        Ok(data)
    }
}

impl BorshDeserialize for NullifierState {
    fn try_from_slice(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let is_spent = data[0] != 0;
        let nullifier_hash: [u8; 32] = <[u8; 32]>::try_from(&data[1..33])
            .map_err(|_| ProgramError::InvalidAccountData)?;
        
        Ok(Self {
            is_spent,
            nullifier_hash,
        })
    }
}

impl BorshSerialize for DepositorState {
    fn try_to_vec(&self) -> Result<Vec<u8>, ProgramError> {
        let mut data = Vec::with_capacity(Self::LEN);
        data.extend_from_slice(self.depositor.as_ref());
        data.extend_from_slice(&self.label);
        Ok(data)
    }
}

impl BorshDeserialize for DepositorState {
    fn try_from_slice(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() < Self::LEN {
            return Err(ProgramError::InvalidAccountData);
        }
        
        let depositor = Pubkey::from(
            <[u8; 32]>::try_from(&data[0..32])
                .map_err(|_| ProgramError::InvalidAccountData)?
        );
        let label: [u8; 32] = <[u8; 32]>::try_from(&data[32..64])
            .map_err(|_| ProgramError::InvalidAccountData)?;
        
        Ok(Self {
            depositor,
            label,
        })
    }
}

/// Privacy Pool state account
#[derive(Debug)]
pub struct PrivacyPoolState {
    pub is_initialized: bool,
    pub entrypoint_authority: Pubkey,
    pub asset_mint: Pubkey,
    pub scope: [u8; 32],
    pub nonce: u64,
    pub dead: bool,
    pub max_tree_depth: u8,
    pub current_root_index: usize,
    pub roots: [[u8; 32]; ROOT_HISTORY_SIZE],
    pub merkle_tree: MerkleTreeState,
}

/// Merkle tree state for commitments
#[derive(Debug)]
pub struct MerkleTreeState {
    pub root: [u8; 32],
    pub depth: u8,
    pub next_index: u64,
    pub filled_subtrees: Vec<[u8; 32]>,
    pub zeros: Vec<[u8; 32]>,
}

/// Nullifier tracking account
#[derive(Debug)]
pub struct NullifierState {
    pub is_spent: bool,
    pub nullifier_hash: [u8; 32],
}

/// Depositor tracking account  
#[derive(Debug)]
pub struct DepositorState {
    pub depositor: Pubkey,
    pub label: [u8; 32],
}

impl PrivacyPoolState {
    pub const LEN: usize = 1 + 32 + 32 + 32 + 8 + 1 + 1 + 8 + (32 * ROOT_HISTORY_SIZE) + MerkleTreeState::LEN;
    
    pub fn new(entrypoint_authority: Pubkey, asset_mint: Pubkey, max_tree_depth: u8) -> Self {
        let scope = Self::generate_scope(&asset_mint);
        Self {
            is_initialized: true,
            entrypoint_authority,
            asset_mint,
            scope,
            nonce: 0,
            dead: false,
            max_tree_depth,
            current_root_index: 0,
            roots: [[0u8; 32]; ROOT_HISTORY_SIZE],
            merkle_tree: MerkleTreeState::new(max_tree_depth),
        }
    }
    
    fn generate_scope(asset_mint: &Pubkey) -> [u8; 32] {
        let mut hasher = keccak::Hasher::default();
        hasher.hash(b"PrivacyPool");
        hasher.hash(asset_mint.as_ref());
        hasher.result().to_bytes()
    }
    
    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        self.roots.iter().any(|r| r == root)
    }
    
    pub fn add_root(&mut self, root: [u8; 32]) {
        self.roots[self.current_root_index] = root;
        self.current_root_index = (self.current_root_index + 1) % ROOT_HISTORY_SIZE;
    }
    
    pub fn increment_nonce(&mut self) -> u64 {
        self.nonce += 1;
        self.nonce
    }
}

impl MerkleTreeState {
    pub const LEN: usize = 32 + 1 + 8 + (32 * MAX_TREE_DEPTH as usize) + (32 * MAX_TREE_DEPTH as usize);
    
    pub fn new(max_depth: u8) -> Self {
        let zeros = Self::compute_zeros(max_depth);
        Self {
            root: zeros[max_depth as usize],
            depth: max_depth,
            next_index: 0,
            filled_subtrees: vec![[0u8; 32]; max_depth as usize],
            zeros,
        }
    }
    
    fn compute_zeros(max_depth: u8) -> Vec<[u8; 32]> {
        let mut zeros = vec![[0u8; 32]; (max_depth + 1) as usize];
        for i in 1..=max_depth as usize {
            zeros[i] = crate::poseidon::hash_two(&zeros[i-1], &zeros[i-1]);
        }
        zeros
    }
    
    pub fn insert(&mut self, leaf: [u8; 32]) -> Result<(), ProgramError> {
        let mut current_index = self.next_index;
        let mut current_level_hash = leaf;
        let mut left;
        let mut right;
        
        for i in 0..self.depth {
            if current_index % 2 == 0 {
                left = current_level_hash;
                right = self.zeros[i as usize];
                self.filled_subtrees[i as usize] = current_level_hash;
            } else {
                left = self.filled_subtrees[i as usize];
                right = current_level_hash;
            }
            
            current_level_hash = crate::poseidon::hash_two(&left, &right);
            current_index /= 2;
        }
        
        self.root = current_level_hash;
        self.next_index += 1;
        
        Ok(())
    }
}

impl NullifierState {
    pub const LEN: usize = 1 + 32;
    
    pub fn new(nullifier_hash: [u8; 32]) -> Self {
        Self {
            is_spent: true,
            nullifier_hash,
        }
    }
}

impl DepositorState {
    pub const LEN: usize = 32 + 32;
    
    pub fn new(depositor: Pubkey, label: [u8; 32]) -> Self {
        Self {
            depositor,
            label,
        }
    }
}

/// Account validation helpers
pub fn get_privacy_pool_state(account: &AccountInfo) -> Result<PrivacyPoolState, ProgramError> {
    if account.data_len() != PrivacyPoolState::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    
    PrivacyPoolState::try_from_slice(&account.try_borrow_data()?)
}

pub fn get_nullifier_state(account: &AccountInfo) -> Result<NullifierState, ProgramError> {
    if account.data_len() != NullifierState::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    
    NullifierState::try_from_slice(&account.try_borrow_data()?)
}

pub fn get_depositor_state(account: &AccountInfo) -> Result<DepositorState, ProgramError> {
    if account.data_len() != DepositorState::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    
    DepositorState::try_from_slice(&account.try_borrow_data()?)
}