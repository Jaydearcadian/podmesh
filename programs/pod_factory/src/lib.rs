use anchor_lang::prelude::*;
use solana_program::hash::hashv;
use ephemeral_rollups_sdk::cpi::{delegate_account, DelegateAccounts, DelegateConfig};
use ephemeral_rollups_sdk::ephem::{commit_accounts, commit_and_undelegate_accounts};

declare_id!("FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm");

pub const POD_SEED: &[u8] = b"pod";

#[program]
pub mod pod_factory {
    use super::*;

    pub fn create_spend_pod(
        ctx: Context<CreateSpendPod>,
        max_per_tx_lamports: u64,
        max_per_epoch_lamports: u64,
        allowed_category_hashes: Vec<[u8; 32]>,
        expiry_ts: i64,
        slippage_bps: u16,
        require_delivery_oracle: bool,
    ) -> Result<()> {
        require!(max_per_tx_lamports > 0, PodError::InvalidPolicy);
        require!(max_per_epoch_lamports >= max_per_tx_lamports, PodError::InvalidPolicy);
        require!(allowed_category_hashes.len() <= 16, PodError::TooManyCategories);

        let pod = &mut ctx.accounts.pod;
        pod.owner = ctx.accounts.owner.key();
        pod.bump = ctx.bumps.pod;
        pod.max_per_tx_lamports = max_per_tx_lamports;
        pod.max_per_epoch_lamports = max_per_epoch_lamports;
        pod.epoch_spent_lamports = 0;
        pod.allowed_category_hashes = allowed_category_hashes;
        pod.expiry_ts = expiry_ts;
        pod.slippage_bps = slippage_bps;
        pod.require_delivery_oracle = require_delivery_oracle;
        pod.receipt_count = 0;
        pod.last_epoch = 0;
        pod.policy_hash = pod.policy_hash()?;
        Ok(())
    }

    pub fn record_receipt(
        ctx: Context<RecordReceipt>,
        amount_lamports: u64,
        category_hash: [u8; 32],
        slippage_bps: u16,
        oracle_attested: bool,
        epoch: u64,
        receipt_hash: [u8; 32],
    ) -> Result<()> {
        let pod = &mut ctx.accounts.pod;
        let now = Clock::get()?.unix_timestamp;
        require!(ctx.accounts.owner.key() == pod.owner, PodError::Unauthorized);
        require!(now <= pod.expiry_ts, PodError::Expired);
        require!(amount_lamports <= pod.max_per_tx_lamports, PodError::MaxPerTxExceeded);
        require!(slippage_bps <= pod.slippage_bps, PodError::SlippageExceeded);
        require!(
            pod.allowed_category_hashes.iter().any(|h| h == &category_hash),
            PodError::CategoryNotAllowed
        );
        if pod.require_delivery_oracle {
            require!(oracle_attested, PodError::OracleRequired);
        }
        if pod.last_epoch != epoch {
            pod.last_epoch = epoch;
            pod.epoch_spent_lamports = 0;
        }
        require!(
            pod.epoch_spent_lamports.saturating_add(amount_lamports) <= pod.max_per_epoch_lamports,
            PodError::MaxPerEpochExceeded
        );
        pod.epoch_spent_lamports = pod.epoch_spent_lamports.saturating_add(amount_lamports);
        pod.receipt_count = pod.receipt_count.saturating_add(1);
        emit!(ReceiptRecorded {
            pod: pod.key(),
            owner: pod.owner,
            amount_lamports,
            category_hash,
            epoch,
            receipt_hash,
            sequence: pod.receipt_count,
        });
        Ok(())
    }

    /// Delegate the Pod PDA to the MagicBlock ephemeral rollup via the delegation program.
    /// Requires buffer, delegation_record, and delegation_metadata accounts derived from the PDA.
    pub fn delegate_pod(ctx: Context<DelegatePod>, validator: Pubkey) -> Result<()> {
        let owner_key = ctx.accounts.owner.key();
        // Signer seeds for the pod PDA (without bump — the SDK derives it internally)
        let pda_seeds: &[&[u8]] = &[POD_SEED, owner_key.as_ref()];

        delegate_account(
            DelegateAccounts {
                payer: ctx.accounts.owner.as_ref(),
                pda: &ctx.accounts.pod.to_account_info(),
                owner_program: &ctx.accounts.owner_program,
                buffer: &ctx.accounts.buffer,
                delegation_record: &ctx.accounts.delegation_record,
                delegation_metadata: &ctx.accounts.delegation_metadata,
                delegation_program: &ctx.accounts.delegation_program,
                system_program: &ctx.accounts.system_program,
            },
            pda_seeds,
            DelegateConfig {
                commit_frequency_ms: 3_000,
                validator: Some(validator),
            },
        )
        .map_err(|e| {
            msg!("delegate_account failed: {:?}", e);
            error!(PodError::DelegationFailed)
        })?;
        Ok(())
    }

    pub fn commit_pod(ctx: Context<CommitPod>) -> Result<()> {
        commit_accounts(
            &ctx.accounts.owner,
            vec![&ctx.accounts.pod.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }

    pub fn commit_and_undelegate_pod(ctx: Context<CommitPod>) -> Result<()> {
        commit_and_undelegate_accounts(
            &ctx.accounts.owner,
            vec![&ctx.accounts.pod.to_account_info()],
            &ctx.accounts.magic_context,
            &ctx.accounts.magic_program,
        )?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CreateSpendPod<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + SpendPod::INIT_SPACE,
        seeds = [POD_SEED, owner.key().as_ref()],
        bump
    )]
    pub pod: Account<'info, SpendPod>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordReceipt<'info> {
    #[account(mut, seeds = [POD_SEED, owner.key().as_ref()], bump = pod.bump)]
    pub pod: Account<'info, SpendPod>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct DelegatePod<'info> {
    #[account(mut, seeds = [POD_SEED, owner.key().as_ref()], bump = pod.bump)]
    pub pod: Account<'info, SpendPod>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: this program's id — supplied as the owner_program for delegation metadata
    pub owner_program: UncheckedAccount<'info>,
    /// CHECK: buffer PDA derived from [b"buffer", pod.key()] under owner_program
    #[account(mut)]
    pub buffer: UncheckedAccount<'info>,
    /// CHECK: delegation_record PDA derived by the delegation program
    #[account(mut)]
    pub delegation_record: UncheckedAccount<'info>,
    /// CHECK: delegation_metadata PDA derived by the delegation program
    #[account(mut)]
    pub delegation_metadata: UncheckedAccount<'info>,
    /// CHECK: MagicBlock delegation program (DELeGG…)
    pub delegation_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CommitPod<'info> {
    #[account(mut, seeds = [POD_SEED, owner.key().as_ref()], bump = pod.bump)]
    pub pod: Account<'info, SpendPod>,
    #[account(mut)]
    pub owner: Signer<'info>,
    /// CHECK: MagicBlock context account (MagicContext111…)
    pub magic_context: UncheckedAccount<'info>,
    /// CHECK: MagicBlock magic program (Magic111…)
    pub magic_program: UncheckedAccount<'info>,
}

#[account]
#[derive(InitSpace)]
pub struct SpendPod {
    pub owner: Pubkey,
    pub bump: u8,
    pub max_per_tx_lamports: u64,
    pub max_per_epoch_lamports: u64,
    pub epoch_spent_lamports: u64,
    #[max_len(16)]
    pub allowed_category_hashes: Vec<[u8; 32]>,
    pub expiry_ts: i64,
    pub slippage_bps: u16,
    pub require_delivery_oracle: bool,
    pub receipt_count: u64,
    pub last_epoch: u64,
    pub policy_hash: [u8; 32],
}

impl SpendPod {
    pub fn policy_hash(&self) -> Result<[u8; 32]> {
        let mut data = Vec::with_capacity(256);
        data.extend_from_slice(self.owner.as_ref());
        data.extend_from_slice(&self.max_per_tx_lamports.to_le_bytes());
        data.extend_from_slice(&self.max_per_epoch_lamports.to_le_bytes());
        for hash in self.allowed_category_hashes.iter() {
            data.extend_from_slice(hash);
        }
        data.extend_from_slice(&self.expiry_ts.to_le_bytes());
        data.extend_from_slice(&self.slippage_bps.to_le_bytes());
        data.push(self.require_delivery_oracle as u8);
        Ok(hashv(&[&data]).to_bytes())
    }
}

#[event]
pub struct ReceiptRecorded {
    pub pod: Pubkey,
    pub owner: Pubkey,
    pub amount_lamports: u64,
    pub category_hash: [u8; 32],
    pub epoch: u64,
    pub receipt_hash: [u8; 32],
    pub sequence: u64,
}

#[error_code]
pub enum PodError {
    #[msg("Invalid Pod policy")]
    InvalidPolicy,
    #[msg("Too many category hashes")]
    TooManyCategories,
    #[msg("Unauthorized Pod owner")]
    Unauthorized,
    #[msg("Pod expired")]
    Expired,
    #[msg("Amount exceeds max_per_tx")]
    MaxPerTxExceeded,
    #[msg("Epoch spend cap exceeded")]
    MaxPerEpochExceeded,
    #[msg("Category is not allowed")]
    CategoryNotAllowed,
    #[msg("Slippage exceeds policy")]
    SlippageExceeded,
    #[msg("Delivery oracle attestation required")]
    OracleRequired,
    #[msg("Delegation CPI failed")]
    DelegationFailed,
}
