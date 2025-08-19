use pinocchio::{
    account_info::AccountInfo,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

use crate::{BorshSerialize, BorshDeserialize};
use crate::state::*;
use crate::constants::*;

#[derive(Debug)]
pub enum PrivacyPoolInstruction {
    InitializePool {
        entrypoint_authority: Pubkey,
        max_tree_depth: u8,
        asset_mint: Pubkey,
    },
    Deposit {
        depositor: Pubkey,
        value: u64,
        precommitment_hash: [u8; 32],
    },
    Withdraw {
        withdrawal_data: WithdrawalData,
        proof_data: WithdrawProofData,
    },
    Ragequit {
        proof_data: RagequitProofData,
    },
    WindDown,
}

#[derive(Debug)]
pub struct WithdrawalData {
    pub processooor: Pubkey,
    pub data: Vec<u8>,
}

#[derive(Debug)]
pub struct WithdrawProofData {
    pub proof_a: [u8; 64],
    pub proof_b: [u8; 128],
    pub proof_c: [u8; 64],
    pub public_signals: Vec<[u8; 32]>,
}

#[derive(Debug)]
pub struct RagequitProofData {
    pub proof_a: [u8; 64],
    pub proof_b: [u8; 128], 
    pub proof_c: [u8; 64],
    pub public_signals: Vec<[u8; 32]>,
}

impl WithdrawProofData {
    pub fn withdrawn_value(&self) -> u64 {
        u64::from_le_bytes(self.public_signals[0][..8].try_into().unwrap_or([0u8; 8]))
    }
    
    pub fn state_root(&self) -> [u8; 32] {
        self.public_signals[1]
    }
    
    pub fn state_tree_depth(&self) -> u8 {
        self.public_signals[2][0]
    }
    
    pub fn asp_root(&self) -> [u8; 32] {
        self.public_signals[3]
    }
    
    pub fn asp_tree_depth(&self) -> u8 {
        self.public_signals[4][0]
    }
    
    pub fn context(&self) -> [u8; 32] {
        self.public_signals[5]
    }
    
    pub fn new_commitment_hash(&self) -> [u8; 32] {
        self.public_signals[6]
    }
    
    pub fn existing_nullifier_hash(&self) -> [u8; 32] {
        self.public_signals[7]
    }
}

impl RagequitProofData {
    pub fn value(&self) -> u64 {
        u64::from_le_bytes(self.public_signals[0][..8].try_into().unwrap_or([0u8; 8]))
    }
    
    pub fn label(&self) -> [u8; 32] {
        self.public_signals[1]
    }
    
    pub fn commitment_hash(&self) -> [u8; 32] {
        self.public_signals[2]
    }
    
    pub fn nullifier_hash(&self) -> [u8; 32] {
        self.public_signals[3]
    }
}

/// Initialize a new privacy pool
pub fn initialize_pool(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    entrypoint_authority: Pubkey,
    max_tree_depth: u8,
    asset_mint: Pubkey,
) -> ProgramResult {
    let pool_account = &accounts[0];
    let payer = &accounts[1];
    
    if !payer.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    if pool_account.data_len() != PrivacyPoolState::LEN {
        return Err(ProgramError::InvalidAccountData);
    }
    
    let mut pool_state = PrivacyPoolState::new(entrypoint_authority, asset_mint, max_tree_depth);
    
    let serialized = pool_state.try_to_vec()?;
    pool_account.try_borrow_mut_data()?[..].copy_from_slice(&serialized);
    
    msg!("Privacy pool initialized with authority: {}", entrypoint_authority);
    Ok(())
}

/// Make a deposit to the privacy pool
pub fn deposit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    depositor: Pubkey,
    value: u64,
    precommitment_hash: [u8; 32],
) -> ProgramResult {
    let pool_account = &accounts[0];
    let entrypoint_account = &accounts[1];
    let depositor_account = &accounts[2];
    let asset_vault = &accounts[3];
    let user_token_account = &accounts[4];
    
    if !entrypoint_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut pool_state = get_privacy_pool_state(pool_account)?;
    
    if pool_state.dead {
        msg!("Pool is dead, deposits not allowed");
        return Err(ProgramError::InvalidAccountData);
    }
    
    if value >= u128::MAX as u64 {
        msg!("Invalid deposit value");
        return Err(ProgramError::InvalidArgument);
    }
    
    let nonce = pool_state.increment_nonce();
    
    let label = crate::poseidon::compute_label(&pool_state.scope, nonce);
    
    let commitment = crate::poseidon::compute_commitment(value, &label, &precommitment_hash);
    
    pool_state.merkle_tree.insert(commitment)?;
    pool_state.add_root(pool_state.merkle_tree.root);
    
    let depositor_state = DepositorState::new(depositor, label);
    let depositor_data = depositor_state.try_to_vec()?;
    depositor_account.try_borrow_mut_data()?[..].copy_from_slice(&depositor_data);
    
    let pool_data = pool_state.try_to_vec()?;
    pool_account.try_borrow_mut_data()?[..].copy_from_slice(&pool_data);
    
    msg!("Deposited {} tokens, commitment: {:?}", value, commitment);
    Ok(())
}

/// Process a private withdrawal
pub fn withdraw(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    withdrawal_data: WithdrawalData,
    proof_data: WithdrawProofData,
) -> ProgramResult {
    let pool_account = &accounts[0];
    let processooor_account = &accounts[1];
    let nullifier_account = &accounts[2];
    let asset_vault = &accounts[3];
    let processooor_token_account = &accounts[4];
    
    if processooor_account.key != &withdrawal_data.processooor {
        msg!("Invalid processooor");
        return Err(ProgramError::InvalidArgument);
    }
    
    if !processooor_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut pool_state = get_privacy_pool_state(pool_account)?;
    
    let expected_context = crate::poseidon::compute_context(&withdrawal_data, &pool_state.scope);
    if expected_context != proof_data.context() {
        msg!("Context mismatch");
        return Err(ProgramError::InvalidArgument);
    }
    
    if proof_data.state_tree_depth() > pool_state.max_tree_depth || 
       proof_data.asp_tree_depth() > pool_state.max_tree_depth {
        msg!("Invalid tree depth");
        return Err(ProgramError::InvalidArgument);
    }
    
    if !pool_state.is_known_root(&proof_data.state_root()) {
        msg!("Unknown state root");
        return Err(ProgramError::InvalidArgument);
    }
    
    if !crate::verifying_key::verify_withdraw_proof(&proof_data) {
        msg!("Invalid withdrawal proof");
        return Err(ProgramError::InvalidArgument);
    }
    
    let nullifier_state = NullifierState::new(proof_data.existing_nullifier_hash());
    let nullifier_data = nullifier_state.try_to_vec()?;
    nullifier_account.try_borrow_mut_data()?[..].copy_from_slice(&nullifier_data);
    
    pool_state.merkle_tree.insert(proof_data.new_commitment_hash())?;
    pool_state.add_root(pool_state.merkle_tree.root);
    
    let pool_data = pool_state.try_to_vec()?;
    pool_account.try_borrow_mut_data()?[..].copy_from_slice(&pool_data);
    
    msg!("Withdrawal processed: {} tokens to {}", 
         proof_data.withdrawn_value(), 
         withdrawal_data.processooor);
    Ok(())
}

/// Process a ragequit (original depositor exit)
pub fn ragequit(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    proof_data: RagequitProofData,
) -> ProgramResult {
    let pool_account = &accounts[0];
    let depositor_account = &accounts[1];
    let nullifier_account = &accounts[2];
    let ragequitter = &accounts[3];
    let asset_vault = &accounts[4];
    let ragequitter_token_account = &accounts[5];
    
    if !ragequitter.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let depositor_state = get_depositor_state(depositor_account)?;
    if depositor_state.depositor != *ragequitter.key() {
        msg!("Only original depositor can ragequit");
        return Err(ProgramError::InvalidArgument);
    }
    
    if depositor_state.label != proof_data.label() {
        msg!("Label mismatch");
        return Err(ProgramError::InvalidArgument);
    }
    
    if !crate::verifying_key::verify_ragequit_proof(&proof_data) {
        msg!("Invalid ragequit proof");
        return Err(ProgramError::InvalidArgument);
    }
    
    let nullifier_state = NullifierState::new(proof_data.nullifier_hash());
    let nullifier_data = nullifier_state.try_to_vec()?;
    nullifier_account.try_borrow_mut_data()?[..].copy_from_slice(&nullifier_data);
    
    msg!("Ragequit processed: {} tokens to {}", 
         proof_data.value(), 
         ragequitter.key());
    Ok(())
}

/// Wind down the pool (disable deposits)
pub fn wind_down(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
) -> ProgramResult {
    let pool_account = &accounts[0];
    let entrypoint_account = &accounts[1];
    
    if !entrypoint_account.is_signer() {
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    let mut pool_state = get_privacy_pool_state(pool_account)?;
    
    if pool_state.entrypoint_authority != *entrypoint_account.key() {
        msg!("Only entrypoint can wind down pool");
        return Err(ProgramError::InvalidArgument);
    }
    
    if pool_state.dead {
        msg!("Pool already dead");
        return Err(ProgramError::InvalidAccountData);
    }
    
    pool_state.dead = true;
    
    let pool_data = pool_state.try_to_vec()?;
    pool_account.try_borrow_mut_data()?[..].copy_from_slice(&pool_data);
    
    msg!("Pool wound down");
    Ok(())
}