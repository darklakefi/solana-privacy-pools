use pinocchio::{
    account_info::AccountInfo,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};
use pinocchio_log::log;
use pinocchio_token::{instructions::TransferChecked, state::Mint};

use crate::state::PoolStateLeanIMT;
use crate::constants::VAULT_PDA_SEED;
use pinocchio::instruction::{Seed, Signer};

/// Withdraw accumulated fees from the pool
///
/// This instruction allows the authorized fee collector to withdraw
/// accumulated protocol fees from the pool's token account.
///
/// Accounts:
/// 0. Pool state account (writable)
/// 1. Vault PDA (token authority)
/// 2. Fee collector (signer) - must match pool_state.fee_collector
/// 3. Pool's token account (writable)
/// 4. Fee collector's token account (writable)
/// 5. Asset mint
/// 6. Token program
pub fn withdraw_fees(
    program_id: &Pubkey,
    accounts: &[AccountInfo],
    amount: u64,
) -> ProgramResult {
    if accounts.len() < 7 {
        log!("Not enough accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }

    let pool_account = &accounts[0];
    let vault_account = &accounts[1];
    let fee_collector_account = &accounts[2];
    let pool_token_account = &accounts[3];
    let collector_token_account = &accounts[4];
    let mint_account = &accounts[5];
    let _token_program = &accounts[6];

    // Validate fee collector is signer
    if !fee_collector_account.is_signer() {
        log!("Fee collector must sign");
        return Err(ProgramError::MissingRequiredSignature);
    }

    // Get mutable reference to pool state
    let pool_state = PoolStateLeanIMT::from_account_mut(pool_account)?;

    // Verify the fee collector matches the pool's configured fee collector
    if *fee_collector_account.key() != Pubkey::from(pool_state.fee_collector) {
        log!("Invalid fee collector - not authorized");
        return Err(ProgramError::InvalidArgument);
    }

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

    // Verify requested amount doesn't exceed accumulated fees
    if amount > pool_state.accumulated_fees {
        log!("Insufficient accumulated fees");
        log!("  Requested: {}", amount);
        log!("  Available: {}", pool_state.accumulated_fees);
        return Err(ProgramError::InsufficientFunds);
    }

    // Deduct the amount from accumulated fees
    pool_state.accumulated_fees = pool_state.accumulated_fees
        .checked_sub(amount)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    log!("Withdrawing fees:");
    log!("  Amount: {}", amount);
    log!("  Remaining accumulated fees: {}", pool_state.accumulated_fees);

    // Transfer fees from pool to fee collector
    let mint = unsafe { Mint::from_account_info_unchecked(mint_account)? };
    let decimals = mint.decimals();

    // Use vault PDA seeds for signing (including bump)
    let bump_seed = [vault_bump];
    let seeds = [Seed::from(VAULT_PDA_SEED), Seed::from(&pool_state.asset_mint), Seed::from(&bump_seed)];
    let signer = Signer::from(&seeds);

    TransferChecked {
        from: pool_token_account,
        to: collector_token_account,
        mint: mint_account,
        authority: vault_account,
        amount,
        decimals,
    }.invoke_signed(&[signer])?;

    log!("Fee withdrawal successful");

    Ok(())
}
