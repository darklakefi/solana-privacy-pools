use super::lean_imt::{new_poseidon_tree, LeanIMT};
use crate::constants::ROOT_HISTORY_SIZE;
use pinocchio::{account_info::AccountInfo, program_error::ProgramError, pubkey::Pubkey};

/// Pool state with Lean IMT trees
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

    /// Fee configuration
    pub withdrawal_fee_basis_points: u16, // e.g., 30 = 0.3%
    pub deposit_fee_basis_points: u16,    // e.g., 0 = 0% (typically zero)
    pub _fee_padding1: [u8; 4],
    pub withdrawal_fee_min: u64,          // Minimum fee in lamports
    pub fee_collector: [u8; 32],          // Authority to collect fees
    pub accumulated_fees: u64,            // Total fees accumulated

    /// Root history (circular buffer)
    pub roots: [[u8; 32]; ROOT_HISTORY_SIZE],
    pub current_root_index: u64,

    /// Lean IMT for state tree
    pub state_tree: LeanIMT,

    /// Lean IMT for ASP tree
    pub asp_tree: LeanIMT,
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
        fee_collector: Option<Pubkey>,
    ) {
        self.is_initialized = 1;
        self._padding1 = [0u8; 7];
        self.authority.copy_from_slice(authority.as_ref());
        self.asset_mint.copy_from_slice(asset_mint.as_ref());
        self.entrypoint.copy_from_slice(entrypoint.as_ref());
        self.withdrawal_verifier
            .copy_from_slice(withdrawal_verifier.as_ref());
        self.scope = scope;
        self.nonce = 0;
        self.is_dead = 0;
        self._padding2 = [0u8; 7];

        // Initialize fee configuration
        // Default: 0.3% withdrawal fee (30 basis points), 0% deposit fee
        self.withdrawal_fee_basis_points = 30;
        self.deposit_fee_basis_points = 0;
        self._fee_padding1 = [0u8; 4];
        self.withdrawal_fee_min = 0; // No minimum fee
        // Fee collector defaults to pool authority if not specified
        let fee_collector_key = fee_collector.unwrap_or(authority);
        self.fee_collector.copy_from_slice(fee_collector_key.as_ref());
        self.accumulated_fees = 0;

        // Initialize root history
        for i in 0..ROOT_HISTORY_SIZE {
            self.roots[i] = [0u8; 32];
        }
        self.current_root_index = 0;

        // Initialize Lean IMT trees with Poseidon hash
        self.state_tree = new_poseidon_tree();
        self.asp_tree = new_poseidon_tree();
    }

    pub fn insert_state_commitment(&mut self, commitment: [u8; 32]) -> Result<(), ProgramError> {
        use pinocchio_log::log;

        // Copy tree to work around packed struct issues
        let mut tree = self.state_tree;
        let new_root = tree
            .insert(commitment)
            .map_err(|_| ProgramError::InvalidArgument)?;

        // Write back the modified tree
        self.state_tree = tree;

        log!(
            "New state tree root after insertion: first byte = {}",
            new_root[0]
        );

        // Debug: check if the tree was actually modified
        log!("State tree size after insert: {}", self.state_tree.size);
        log!("State tree depth after insert: {}", self.state_tree.depth);

        // Add to root history
        self.add_root(new_root);

        Ok(())
    }

    pub fn insert_asp_label(&mut self, label: [u8; 32]) -> Result<(), ProgramError> {
        // Copy tree to work around packed struct issues
        let mut tree = self.asp_tree;
        tree.insert(label)
            .map_err(|_| ProgramError::InvalidArgument)?;

        // Write back the modified tree
        self.asp_tree = tree;
        Ok(())
    }

    pub fn add_root(&mut self, root: [u8; 32]) {
        let index = (self.current_root_index as usize) % ROOT_HISTORY_SIZE;
        self.roots[index] = root;
        self.current_root_index =
            ((self.current_root_index + 1) as usize % ROOT_HISTORY_SIZE) as u64;
    }

    pub fn is_known_root(&self, root: &[u8; 32]) -> bool {
        self.roots.iter().any(|r| r == root)
    }

    pub fn get_state_root(&self) -> [u8; 32] {
        // Copy to avoid alignment issues
        let tree = self.state_tree;
        tree.root()
    }

    pub fn get_asp_root(&self) -> [u8; 32] {
        // Copy to avoid alignment issues
        let tree = self.asp_tree;
        tree.root()
    }

    pub fn get_state_depth(&self) -> u32 {
        // Copy to avoid alignment issues
        let tree = self.state_tree;
        tree.get_depth()
    }

    pub fn get_asp_depth(&self) -> u32 {
        // Copy to avoid alignment issues
        let tree = self.asp_tree;
        tree.get_depth()
    }

    /// Increment nonce directly in the buffer
    pub fn increment_nonce_in_buffer(buffer: &mut [u8]) -> u64 {
        use pinocchio_log::log;

        // Nonce is at offset: is_initialized(1) + padding(7) + 4*pubkeys(128) + scope(32) = 168
        const NONCE_OFFSET: usize = 1 + 7 + (4 * 32) + 32;

        if buffer.len() < NONCE_OFFSET + 8 {
            log!("Buffer too small for nonce update");
            return 0;
        }

        // Read current nonce
        let nonce_bytes = &buffer[NONCE_OFFSET..NONCE_OFFSET + 8];
        let current_nonce = u64::from_le_bytes(nonce_bytes.try_into().unwrap());

        // Increment
        let new_nonce = current_nonce + 1;

        // Write back
        buffer[NONCE_OFFSET..NONCE_OFFSET + 8].copy_from_slice(&new_nonce.to_le_bytes());

        log!("Nonce incremented from {} to {}", current_nonce, new_nonce);
        new_nonce
    }

    /// Calculate withdrawal fee based on configured basis points
    /// Formula: fee = max(amount * basis_points / 10000, minimum_fee)
    pub fn calculate_withdrawal_fee(&self, amount: u64) -> Result<u64, ProgramError> {
        // Calculate basis point fee (amount * basis_points / 10000)
        let basis_fee = (amount as u128)
            .checked_mul(self.withdrawal_fee_basis_points as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(10_000)
            .ok_or(ProgramError::ArithmeticOverflow)? as u64;

        // Return the maximum of basis_fee and minimum_fee
        Ok(basis_fee.max(self.withdrawal_fee_min))
    }

    /// Calculate deposit fee based on configured basis points
    pub fn calculate_deposit_fee(&self, amount: u64) -> Result<u64, ProgramError> {
        // Calculate basis point fee (amount * basis_points / 10000)
        let fee = (amount as u128)
            .checked_mul(self.deposit_fee_basis_points as u128)
            .ok_or(ProgramError::ArithmeticOverflow)?
            .checked_div(10_000)
            .ok_or(ProgramError::ArithmeticOverflow)? as u64;

        Ok(fee)
    }
}
