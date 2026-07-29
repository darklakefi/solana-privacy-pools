use pinocchio::{
    account_info::AccountInfo,
    cpi::invoke_signed,
    instruction::{AccountMeta, Instruction, Seed, Signer},
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvars::{rent::Rent, Sysvar},
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::{instructions::TransferChecked, state::Mint};

use super::types::{WithdrawProofData, WithdrawalData};
use crate::constants::{NULLIFIER_PDA_SEED, SYSTEM_PROGRAM_ID, VAULT_PDA_SEED};
use crate::state::{NullifierStateZC, PoolStateLeanIMT};

const CREATE_ACCOUNT_DATA_LEN: usize = 4 + 8 + 8 + 32;

fn create_nullifier_account(
    program_id: &Pubkey,
    pool_account: &AccountInfo,
    payer: &AccountInfo,
    nullifier_account: &AccountInfo,
    system_program: &AccountInfo,
    nullifier_hash: &[u8; 32],
    nullifier_bump: u8,
) -> ProgramResult {
    let rent_lamports = Rent::get()?.minimum_balance(NullifierStateZC::LEN);

    // SystemInstruction::CreateAccount is encoded as:
    // discriminant (u32), lamports (u64), space (u64), owner (Pubkey).
    let mut instruction_data = [0u8; CREATE_ACCOUNT_DATA_LEN];
    instruction_data[4..12].copy_from_slice(&rent_lamports.to_le_bytes());
    instruction_data[12..20].copy_from_slice(&(NullifierStateZC::LEN as u64).to_le_bytes());
    instruction_data[20..52].copy_from_slice(program_id);

    let account_metas = [
        AccountMeta::writable_signer(payer.key()),
        AccountMeta::writable_signer(nullifier_account.key()),
    ];
    let instruction = Instruction {
        program_id: system_program.key(),
        accounts: &account_metas,
        data: &instruction_data,
    };

    let bump_seed = [nullifier_bump];
    let signer_seeds = [
        Seed::from(NULLIFIER_PDA_SEED),
        Seed::from(pool_account.key().as_ref()),
        Seed::from(nullifier_hash),
        Seed::from(&bump_seed),
    ];
    let nullifier_signer = Signer::from(&signer_seeds);

    invoke_signed(
        &instruction,
        &[payer, nullifier_account],
        &[nullifier_signer],
    )
}

/// Process a private withdrawal using SPL tokens
///
/// Accounts:
/// 0. Pool state account (writable)
/// 1. Vault PDA (token authority)
/// 2. Nullifier account (writable)
/// 3. Processooor/withdrawer (signer)
/// 4. Pool's token account (writable)
/// 5. User's token account (writable)
/// 6. Asset mint
/// 7. Token program
/// 8. System program
pub fn withdraw(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    withdrawal_data: WithdrawalData,
    proof_data: WithdrawProofData,
) -> ProgramResult {
    if accounts.len() < 9 {
        log!("Not enough accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_account = &accounts[0];
    let vault_account = &accounts[1];
    let nullifier_account = &accounts[2];
    let processooor_account = &accounts[3];
    let pool_token_account = &accounts[4];
    let user_token_account = &accounts[5];
    let mint_account = &accounts[6];
    let _token_program = &accounts[7];
    let system_program = &accounts[8];

    // Validate signer
    if !processooor_account.is_signer() {
        log!("Processooor must sign");
        return Err(ProgramError::MissingRequiredSignature);
    }

    if processooor_account.key() != &withdrawal_data.processooor {
        log!("Invalid processooor");
        return Err(ProgramError::InvalidArgument);
    }

    if !processooor_account.is_writable() || !nullifier_account.is_writable() {
        log!("Nullifier account and payer must be writable");
        return Err(ProgramError::InvalidArgument);
    }

    if system_program.key() != &SYSTEM_PROGRAM_ID {
        log!("Invalid system program");
        return Err(ProgramError::IncorrectProgramId);
    }

    let existing_nullifier_hash = proof_data.existing_nullifier_hash();
    let (expected_nullifier_account, nullifier_bump) = pinocchio::pubkey::find_program_address(
        &[
            NULLIFIER_PDA_SEED,
            pool_account.key().as_ref(),
            &existing_nullifier_hash,
        ],
        program_id,
    );

    if nullifier_account.key() != &expected_nullifier_account {
        log!("Invalid nullifier account");
        return Err(ProgramError::InvalidArgument);
    }

    // A canonical marker may only be created once. Any funded or allocated
    // account at this PDA means this nullifier has already been consumed.
    if nullifier_account.lamports() != 0 || !nullifier_account.data_is_empty() {
        log!("Nullifier already spent");
        return Err(ProgramError::AccountAlreadyInitialized);
    }

    if nullifier_account.owner() != &SYSTEM_PROGRAM_ID {
        log!("Uninitialized nullifier PDA must be system owned");
        return Err(ProgramError::IllegalOwner);
    }

    // Get mutable reference to pool state using Lean IMT
    let pool_state = PoolStateLeanIMT::from_account_mut(pool_account)?;

    // Verify the mint matches the pool's asset mint
    if *mint_account.key() != Pubkey::from(pool_state.asset_mint) {
        log!("Wrong token mint");
        return Err(ProgramError::InvalidArgument);
    }

    // Verify the vault PDA and get bump
    let (expected_vault, vault_bump) = pinocchio::pubkey::find_program_address(
        &[VAULT_PDA_SEED, &pool_state.asset_mint],
        program_id,
    );
    if vault_account.key() != &expected_vault {
        log!("Invalid vault account");
        return Err(ProgramError::InvalidArgument);
    }

    // Verify the context
    let expected_context =
        crate::crypto::poseidon::compute_context(&withdrawal_data, &pool_state.scope);
    let proof_context = proof_data.context();

    // Debug logging - convert first few bytes to hex for display
    log!("Context verification:");
    log!(
        "  Expected context first 4 bytes: {} {} {} {}",
        expected_context[0],
        expected_context[1],
        expected_context[2],
        expected_context[3]
    );
    log!(
        "  Proof context first 4 bytes: {} {} {} {}",
        proof_context[0],
        proof_context[1],
        proof_context[2],
        proof_context[3]
    );
    log!("  Withdrawal data len: {}", withdrawal_data.data.len());
    log!(
        "  Processor first 4 bytes: {} {} {} {}",
        withdrawal_data.processooor.as_ref()[0],
        withdrawal_data.processooor.as_ref()[1],
        withdrawal_data.processooor.as_ref()[2],
        withdrawal_data.processooor.as_ref()[3]
    );

    if expected_context != proof_context {
        log!("Context mismatch");
        return Err(ProgramError::InvalidArgument);
    }

    // Validate tree depths (less critical for Lean IMT but still checked)
    if proof_data.state_tree_depth() > 32 || proof_data.asp_tree_depth() > 32 {
        log!("Invalid tree depth");
        return Err(ProgramError::InvalidArgument);
    }

    // Verify the state root is known
    if !pool_state.is_known_root(&proof_data.state_root()) {
        log!("Unknown state root");
        return Err(ProgramError::InvalidArgument);
    }

    // Verify the ZK proof
    if !crate::crypto::verifying_key::verify_withdraw_proof(&proof_data) {
        log!("Invalid withdrawal proof");
        return Err(ProgramError::InvalidArgument);
    }

    // Atomically create the canonical spent-nullifier marker. Concurrent or
    // replayed withdrawals lock the same PDA, and only the first can create it.
    create_nullifier_account(
        program_id,
        pool_account,
        processooor_account,
        nullifier_account,
        system_program,
        &existing_nullifier_hash,
        nullifier_bump,
    )?;

    if nullifier_account.owner() != program_id {
        log!("Nullifier account not owned by program after creation");
        return Err(ProgramError::IllegalOwner);
    }

    // Update nullifier state using zero-copy
    let nullifier_state = NullifierStateZC::from_account_mut(nullifier_account)?;
    nullifier_state.set_spent(existing_nullifier_hash);

    // Insert new commitment into state tree
    pool_state.insert_state_commitment(proof_data.new_commitment_hash())?;

    // Transfer tokens from pool to user
    let withdrawn_value = proof_data.withdrawn_value();
    log!("Transferring tokens to withdrawer");

    // Read decimals from the mint account
    let mint = unsafe { Mint::from_account_info_unchecked(mint_account)? };
    let decimals = mint.decimals();

    // Use vault PDA seeds for signing (including bump)
    let bump_seed = [vault_bump];
    let seeds = [
        Seed::from(VAULT_PDA_SEED),
        Seed::from(&pool_state.asset_mint),
        Seed::from(&bump_seed),
    ];
    let signer = Signer::from(&seeds);
    TransferChecked {
        from: pool_token_account,
        to: user_token_account,
        mint: mint_account,
        authority: vault_account,
        amount: withdrawn_value,
        decimals,
    }
    .invoke_signed(&[signer])?;

    log!("Withdrawal successful");

    Ok(())
}
