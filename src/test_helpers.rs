#[cfg(test)]
use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

#[cfg(test)]
use crate::state::*;
#[cfg(test)]
use crate::instructions::*;
#[cfg(test)]
use crate::{BorshSerialize, BorshDeserialize};

#[cfg(test)]
pub struct TestContext {
    pub program_id: Pubkey,
    pub entrypoint_authority: Pubkey,
    pub asset_mint: Pubkey,
    pub pool_account: TestAccount,
    pub depositor_accounts: Vec<TestAccount>,
    pub nullifier_accounts: Vec<TestAccount>,
}

#[cfg(test)]
pub struct TestAccount {
    pub key: Pubkey,
    pub lamports: u64,
    pub data: Vec<u8>,
    pub owner: Pubkey,
    pub executable: bool,
    pub rent_epoch: u64,
}

#[cfg(test)]
impl TestAccount {
    pub fn new(key: Pubkey, owner: Pubkey, data_len: usize) -> Self {
        Self {
            key,
            lamports: 1000000,
            data: vec![0u8; data_len],
            owner,
            executable: false,
            rent_epoch: 0,
        }
    }
    
    pub fn to_account_info(&mut self) -> AccountInfo {
        // For now, we'll just panic - this needs proper AccountInfo construction
        // TODO: Fix this once we resolve the pinocchio API compatibility
        panic!("AccountInfo construction needs to be implemented for current pinocchio version")
    }
}

#[cfg(test)]
impl TestContext {
    pub fn new() -> Self {
        let program_id = Pubkey::from([1u8; 32]);
        let entrypoint_authority = Pubkey::from([2u8; 32]);
        let asset_mint = Pubkey::from([3u8; 32]);
        let pool_key = Pubkey::from([4u8; 32]);
        
        let pool_account = TestAccount::new(
            pool_key,
            program_id,
            PrivacyPoolState::LEN,
        );
        
        Self {
            program_id,
            entrypoint_authority,
            asset_mint,
            pool_account,
            depositor_accounts: Vec::new(),
            nullifier_accounts: Vec::new(),
        }
    }
    
    pub fn initialize_pool(&mut self) -> ProgramResult {
        let pool_state = PrivacyPoolState::new(
            self.entrypoint_authority,
            self.asset_mint,
            20, // max_tree_depth
        );
        
        let serialized = pool_state.try_to_vec()?;
        self.pool_account.data = serialized;
        
        Ok(())
    }
    
    pub fn create_depositor_account(&mut self, depositor: Pubkey, label: [u8; 32]) -> usize {
        let key = Pubkey::from([5u8; 32]); // Generate unique key
        let mut account = TestAccount::new(key, self.program_id, DepositorState::LEN);
        
        let depositor_state = DepositorState::new(depositor, label);
        let serialized = depositor_state.try_to_vec().unwrap();
        account.data = serialized;
        
        self.depositor_accounts.push(account);
        self.depositor_accounts.len() - 1
    }
    
    pub fn create_nullifier_account(&mut self, nullifier_hash: [u8; 32]) -> usize {
        let key = Pubkey::from([6u8; 32]); // Generate unique key  
        let mut account = TestAccount::new(key, self.program_id, NullifierState::LEN);
        
        let nullifier_state = NullifierState::new(nullifier_hash);
        let serialized = nullifier_state.try_to_vec().unwrap();
        account.data = serialized;
        
        self.nullifier_accounts.push(account);
        self.nullifier_accounts.len() - 1
    }
    
    pub fn get_pool_state(&mut self) -> Result<PrivacyPoolState, ProgramError> {
        PrivacyPoolState::try_from_slice(&self.pool_account.data)
    }
    
    pub fn set_pool_state(&mut self, state: PrivacyPoolState) -> Result<(), ProgramError> {
        let serialized = state.try_to_vec()?;
        self.pool_account.data = serialized;
        Ok(())
    }
}

#[cfg(test)]
pub fn create_test_withdrawal_data() -> WithdrawalData {
    WithdrawalData {
        processooor: Pubkey::from([10u8; 32]),
        data: vec![1, 2, 3, 4],
    }
}

#[cfg(test)]
pub fn create_test_withdraw_proof_data() -> WithdrawProofData {
    WithdrawProofData {
        proof_a: [1u8; 64],
        proof_b: [2u8; 128],
        proof_c: [3u8; 64],
        public_signals: vec![
            [100u8; 32], // withdrawn_value  
            [200u8; 32], // state_root
            [1u8; 32],   // state_tree_depth
            [201u8; 32], // asp_root
            [2u8; 32],   // asp_tree_depth
            [202u8; 32], // context
            [203u8; 32], // new_commitment_hash
            [204u8; 32], // existing_nullifier_hash
        ],
    }
}

#[cfg(test)]
pub fn create_test_ragequit_proof_data() -> RagequitProofData {
    RagequitProofData {
        proof_a: [4u8; 64],
        proof_b: [5u8; 128],
        proof_c: [6u8; 64],
        public_signals: vec![
            [100u8; 32], // value
            [50u8; 32],  // label  
            [51u8; 32],  // commitment_hash
            [52u8; 32],  // nullifier_hash
        ],
    }
}