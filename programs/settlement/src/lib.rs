use anchor_lang::prelude::*;

declare_id!("A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc");

pub const EPOCH_SEED: &[u8] = b"epoch";

#[program]
pub mod settlement {
    use super::*;

    pub fn settle_epoch(
        ctx: Context<SettleEpoch>,
        epoch: u64,
        merkle_root: [u8; 32],
        total_volume_lamports: u64,
        receipt_count: u64,
        total_fees_lamports: u64,
    ) -> Result<()> {
        let settlement = &mut ctx.accounts.epoch_settlement;
        require!(!settlement.settled, SettlementError::AlreadySettled);
        settlement.authority = ctx.accounts.crank_authority.key();
        settlement.epoch = epoch;
        settlement.merkle_root = merkle_root;
        settlement.total_volume_lamports = total_volume_lamports;
        settlement.receipt_count = receipt_count;
        settlement.total_fees_lamports = total_fees_lamports;
        settlement.crank_reward_lamports = total_fees_lamports / 5;
        settlement.treasury_lamports = total_fees_lamports.saturating_sub(settlement.crank_reward_lamports);
        settlement.settled = true;
        settlement.bump = ctx.bumps.epoch_settlement;
        emit!(EpochSettled {
            epoch,
            merkle_root,
            total_volume_lamports,
            receipt_count,
            total_fees_lamports,
            crank_authority: ctx.accounts.crank_authority.key(),
        });
        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(epoch: u64)]
pub struct SettleEpoch<'info> {
    #[account(
        init,
        payer = crank_authority,
        space = 8 + EpochSettlement::INIT_SPACE,
        seeds = [EPOCH_SEED, &epoch.to_le_bytes()],
        bump
    )]
    pub epoch_settlement: Account<'info, EpochSettlement>,
    #[account(mut)]
    pub crank_authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct EpochSettlement {
    pub authority: Pubkey,
    pub epoch: u64,
    pub merkle_root: [u8; 32],
    pub total_volume_lamports: u64,
    pub receipt_count: u64,
    pub total_fees_lamports: u64,
    pub crank_reward_lamports: u64,
    pub treasury_lamports: u64,
    pub settled: bool,
    pub bump: u8,
}

#[event]
pub struct EpochSettled {
    pub epoch: u64,
    pub merkle_root: [u8; 32],
    pub total_volume_lamports: u64,
    pub receipt_count: u64,
    pub total_fees_lamports: u64,
    pub crank_authority: Pubkey,
}

#[error_code]
pub enum SettlementError {
    #[msg("Epoch is already settled")]
    AlreadySettled,
}
