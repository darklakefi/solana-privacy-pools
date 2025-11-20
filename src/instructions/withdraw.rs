use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::{instructions::TransferChecked, state::Mint};
use pinocchio::sysvars::{rent::Rent, Sysvar};

use crate::state::{PoolStateLeanIMT, NullifierStateZC};
use super::types::{WithdrawalData, WithdrawProofData};
use crate::constants::{VAULT_PDA_SEED, NULLIFIER_PDA_SEED, ERROR_NULLIFIER_ALREADY_SPENT};
use pinocchio::instruction::{Seed, Signer};

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
/// 8. System program (for nullifier account creation)
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
        program_id
    );
    if vault_account.key() != &expected_vault {
        log!("Invalid vault account");
        return Err(ProgramError::InvalidArgument);
    }

    // Verify the nullifier PDA (ensures deterministic account from nullifier hash)
    let nullifier_hash = proof_data.existing_nullifier_hash();
    let (expected_nullifier, nullifier_bump) = pinocchio::pubkey::find_program_address(
        &[NULLIFIER_PDA_SEED, &nullifier_hash],
        program_id
    );
    if nullifier_account.key() != &expected_nullifier {
        log!("Invalid nullifier account - must be PDA");
        return Err(ProgramError::InvalidArgument);
    }

    // Initialize nullifier account if it doesn't exist
    const NULLIFIER_ACCOUNT_SIZE: usize = core::mem::size_of::<crate::state::NullifierStateZC>();

    if nullifier_account.data_len() == 0 {
        // Account needs to be created via SystemProgram.createAccount CPI
        log!("Creating nullifier account via CPI");

        // Calculate rent-exempt balance
        let rent_lamports = Rent::get()?.minimum_balance(NULLIFIER_ACCOUNT_SIZE);

        // Build createAccount instruction data: [0, lamports_u64_le, space_u64_le, owner_32_bytes]
        let mut create_account_data = [0u8; 52];
        create_account_data[0..4].copy_from_slice(&0u32.to_le_bytes()); // CreateAccount discriminator
        create_account_data[4..12].copy_from_slice(&rent_lamports.to_le_bytes());
        create_account_data[12..20].copy_from_slice(&(NULLIFIER_ACCOUNT_SIZE as u64).to_le_bytes());
        create_account_data[20..52].copy_from_slice(program_id.as_ref());

        // CreateAccount via CPI with PDA signing
        let create_account_ix = pinocchio::instruction::Instruction {
            program_id: system_program.key(),
            accounts: &[
                pinocchio::instruction::AccountMeta {
                    pubkey: processooor_account.key(),
                    is_signer: true,
                    is_writable: true,
                },
                pinocchio::instruction::AccountMeta {
                    pubkey: nullifier_account.key(),
                    is_signer: true,
                    is_writable: true,
                },
            ],
            data: &create_account_data,
        };

        let bump_seed = [nullifier_bump];
        let signer_seeds = [
            Seed::from(NULLIFIER_PDA_SEED),
            Seed::from(&nullifier_hash),
            Seed::from(&bump_seed),
        ];

        pinocchio::program::invoke_signed(
            &create_account_ix,
            &[processooor_account, nullifier_account, system_program],
            &[Signer::from(&signer_seeds)]
        )?;

        log!("Nullifier account created");
    } else if nullifier_account.data_len() != NULLIFIER_ACCOUNT_SIZE {
        log!("Nullifier account has wrong size: {} bytes, expected {}",
            nullifier_account.data_len() as u64,
            NULLIFIER_ACCOUNT_SIZE as u64);
        return Err(ProgramError::InvalidAccountData);
    }

    // Verify account is owned by our program
    if nullifier_account.owner() != program_id {
        log!("Nullifier account has wrong owner");
        return Err(ProgramError::InvalidAccountData);
    }

    // Verify the context
    let expected_context = crate::crypto::poseidon::compute_context(&withdrawal_data, &pool_state.scope);
    let proof_context = proof_data.context();
    
    // Debug logging - convert first few bytes to hex for display
    log!("Context verification:");
    log!("  Expected context first 4 bytes: {} {} {} {}", 
        expected_context[0], expected_context[1], expected_context[2], expected_context[3]);
    log!("  Proof context first 4 bytes: {} {} {} {}", 
        proof_context[0], proof_context[1], proof_context[2], proof_context[3]);
    log!("  Withdrawal data len: {}", withdrawal_data.data.len());
    log!("  Processor first 4 bytes: {} {} {} {}",
        withdrawal_data.processooor.as_ref()[0],
        withdrawal_data.processooor.as_ref()[1], 
        withdrawal_data.processooor.as_ref()[2],
        withdrawal_data.processooor.as_ref()[3]);
    
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
        log!("InvalidMerkleRoot");
        return Err(ProgramError::InvalidArgument);
    }
    
    // Verify the ZK proof
    if !crate::crypto::verifying_key::verify_withdraw_proof(&proof_data) {
        log!("Invalid withdrawal proof");
        return Err(ProgramError::InvalidArgument);
    }

    // Check nullifier hasn't been spent (prevent double-spend)
    let nullifier_state = NullifierStateZC::from_account_mut(nullifier_account)?;
    if nullifier_state.is_spent == 1 {
        log!("NullifierAlreadySpent");
        return Err(ProgramError::Custom(ERROR_NULLIFIER_ALREADY_SPENT));
    }

    // Mark nullifier as spent
    nullifier_state.set_spent(proof_data.existing_nullifier_hash());
    
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
    let seeds = [Seed::from(VAULT_PDA_SEED), Seed::from(&pool_state.asset_mint), Seed::from(&bump_seed)];
    let signer = Signer::from(&seeds);
    TransferChecked {
        from: pool_token_account,
        to: user_token_account,
        mint: mint_account,
        authority: vault_account,
        amount: withdrawn_value,
        decimals,
    }.invoke_signed(&[signer])?;
    
    log!("Withdrawal successful");
    
    Ok(())
}