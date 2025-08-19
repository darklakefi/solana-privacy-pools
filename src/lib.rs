use pinocchio::{
    account_info::AccountInfo,
    entrypoint,
    instruction::Signer,
    msg,
    program_error::ProgramError,
    pubkey::Pubkey,
    ProgramResult,
};

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    match instruction_data.first() {
        Some(0) => hello_world(accounts),
        Some(1) => verify_groth16_proof(accounts, &instruction_data[1..]),
        _ => {
            msg!("Invalid instruction");
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

fn hello_world(accounts: &[AccountInfo]) -> ProgramResult {
    msg!("Hello, Solana Privacy Pools!");
    
    if accounts.is_empty() {
        msg!("No accounts provided");
        return Err(ProgramError::NotEnoughAccountKeys);
    }
    
    let signer = &accounts[0];
    if !signer.is_signer() {
        msg!("First account must be a signer");
        return Err(ProgramError::MissingRequiredSignature);
    }
    
    msg!("Hello from signer: {}", signer.key());
    Ok(())
}

fn verify_groth16_proof(_accounts: &[AccountInfo], _proof_data: &[u8]) -> ProgramResult {
    msg!("Groth16 proof verification placeholder");
    Ok(())
}