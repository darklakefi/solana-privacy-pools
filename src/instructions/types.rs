use pinocchio::{
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::BorshDeserialize;

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

impl BorshDeserialize for PrivacyPoolInstruction {
    fn try_from_slice(data: &[u8]) -> Result<Self, ProgramError> {
        if data.is_empty() {
            return Err(ProgramError::InvalidInstructionData);
        }
        
        match data[0] {
            0 => {
                if data.len() < 1 + 32 + 1 + 32 {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let mut offset = 1;
                let entrypoint_authority = Pubkey::from(
                    <[u8; 32]>::try_from(&data[offset..offset + 32])
                        .map_err(|_| ProgramError::InvalidInstructionData)?
                );
                offset += 32;
                let max_tree_depth = data[offset];
                offset += 1;
                let asset_mint = Pubkey::from(
                    <[u8; 32]>::try_from(&data[offset..offset + 32])
                        .map_err(|_| ProgramError::InvalidInstructionData)?
                );
                
                Ok(PrivacyPoolInstruction::InitializePool {
                    entrypoint_authority,
                    max_tree_depth,
                    asset_mint,
                })
            }
            1 => {
                if data.len() < 1 + 32 + 8 + 32 {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let mut offset = 1;
                let depositor = Pubkey::from(
                    <[u8; 32]>::try_from(&data[offset..offset + 32])
                        .map_err(|_| ProgramError::InvalidInstructionData)?
                );
                offset += 32;
                let value = u64::from_le_bytes(
                    <[u8; 8]>::try_from(&data[offset..offset + 8])
                        .map_err(|_| ProgramError::InvalidInstructionData)?
                );
                offset += 8;
                let precommitment_hash = <[u8; 32]>::try_from(&data[offset..offset + 32])
                    .map_err(|_| ProgramError::InvalidInstructionData)?;
                
                Ok(PrivacyPoolInstruction::Deposit {
                    depositor,
                    value,
                    precommitment_hash,
                })
            }
            4 => {
                // WindDown instruction - no additional data needed
                Ok(PrivacyPoolInstruction::WindDown)
            }
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}