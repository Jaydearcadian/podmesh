# PodMesh

**MagicBlock Hackathon submission** — Policy-bound autonomous payments on Solana with MagicBlock Ephemeral Rollups.

> Developer: [jaydearcadian](https://github.com/jaydearcadian)

---

## What is PodMesh?

PodMesh is a protocol for giving autonomous agents real spending power without giving them unrestricted wallet access. A user creates a **Pod** — a policy-enforced spending account anchored on Solana — and delegates it to an agent. The agent can execute payments through MagicBlock's Ephemeral Rollup (ER) at low latency, but every payment is validated against the Pod's immutable policy before it is signed. Epoch receipts are committed back to Solana by a crank, producing a permanent, auditable trail.

---

## Problem

Autonomous agents (AI, bots, trading programs) need to spend money on behalf of users, but existing approaches are unsafe:

- **Full wallet access** — the agent can drain everything.
- **Manual approval** — defeats the purpose of autonomy.
- **Custodial escrow** — introduces counterparty risk and latency.

PodMesh solves this with an on-chain policy object (the Pod) that the agent can never bypass. Spend limits, allowed payment categories, slippage caps, and expiry are set at creation time and cannot be changed after the fact. The agent's execution path goes through the MagicBlock ER for speed, but settlement and policy state are ultimately committed back to Solana base layer.

---

## MagicBlock Hackathon Context

PodMesh was built for the **MagicBlock hackathon**. The integration targets MagicBlock's Ephemeral Rollups infrastructure, specifically:

- `@magicblock-labs/ephemeral-rollups-sdk` (JS `0.11.2`, Rust `0.2.5`)
- The MagicBlock devnet router: `https://devnet-router.magicblock.app`
- The MagicBlock delegation program: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
- The MagicBlock devnet ER validator: `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`

Both Anchor programs are deployed and live on Solana devnet. All four core instructions have been executed on devnet and confirmed with explorer links.

---

## Architecture

### Layers

```
┌────────────────────────────────────────────────────────────┐
│  Browser Frontend (React + Vite + Tailwind)                │
│  Wallet adapter, Pod UI, Agent commerce demo, Proof page   │
└────────────────────────┬───────────────────────────────────┘
                         │ @solana/web3.js + ephemeral-rollups-sdk (JS)
┌────────────────────────▼───────────────────────────────────┐
│  MagicBlock devnet router                                   │
│  https://devnet-router.magicblock.app                      │
│  Low-latency RPC for ER-delegated accounts                 │
└────────────────────────┬───────────────────────────────────┘
                         │ commit / commit-and-undelegate
┌────────────────────────▼───────────────────────────────────┐
│  Solana Devnet (base layer)                                │
│                                                            │
│  pod_factory  FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm │
│  settlement   A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc │
│  DELeGG       DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh │
└────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Role |
|-----------|------|
| **Pod Factory** (`pod_factory`) | Creates Pod PDAs with immutable spend policy; records receipts; delegates Pod to MagicBlock ER via CPI to DELeGG |
| **Settlement** (`settlement`) | Accepts epoch Merkle roots from a crank; stores volume, receipt count, fee split (20% crank / 80% treasury) |
| **MagicBlock ER** | Holds delegated Pod state; agents mutate receipts and counters at rollup speed; crank commits state back to Solana |
| **Browser Frontend** | Multi-page React app for Pod creation, agent execution, receipt log, settlement, architecture overview, and hackathon proof page |
| **Scripts** | TypeScript test scripts that exercise every on-chain instruction end-to-end against devnet |

---

## Deployed Solana Devnet Programs

| Program | Program ID | Explorer |
|---------|-----------|---------|
| `pod_factory` | `FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm` | [View on Solana Explorer](https://explorer.solana.com/address/FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm?cluster=devnet) |
| `settlement` | `A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc` | [View on Solana Explorer](https://explorer.solana.com/address/A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc?cluster=devnet) |

Both programs compile to `.so` artifacts (`target/deploy/`) and are confirmed executable on devnet.

Build artifacts:
```
target/deploy/pod_factory.so   283 KB  ✓
target/deploy/settlement.so    204 KB  ✓
```

Build environment: Anchor CLI `0.32.1`, Solana CLI `2.3.13 (Agave)`, Rust `stable 1.95.0`.

---

## Pod Factory

Source: `programs/pod_factory/src/lib.rs`

### Instructions

#### `create_spend_pod`

Creates a PDA (seeds: `[b"pod", owner_pubkey]`) that stores the spend policy. Args:

| Argument | Type | Description |
|---|---|---|
| `max_per_tx_lamports` | `u64` | Maximum lamports per single transaction |
| `max_per_epoch_lamports` | `u64` | Maximum lamports per epoch |
| `allowed_category_hashes` | `Vec<[u8; 32]>` | Up to 16 hashed spend categories |
| `expiry_ts` | `i64` | Unix timestamp after which the Pod expires |
| `slippage_bps` | `u16` | Maximum allowed slippage in basis points |
| `require_delivery_oracle` | `bool` | Whether an oracle attestation is required |

Policy is hashed and stored immutably in `pod.policy_hash`.

#### `record_receipt`

Records a payment receipt against a Pod. Pre-checks enforced on-chain:

- Caller must be Pod owner
- `now <= pod.expiry_ts`
- `amount_lamports <= pod.max_per_tx_lamports`
- `slippage_bps <= pod.slippage_bps`
- `category_hash` must be in `pod.allowed_category_hashes`
- Oracle attestation if `require_delivery_oracle`
- Epoch accumulator resets each new epoch; enforces `max_per_epoch_lamports`

Emits: `ReceiptRecorded { pod, owner, amount_lamports, epoch, sequence }`.

#### `delegate_pod`

CPIs into the MagicBlock delegation program (`DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`) using the `ephemeral-rollups-sdk` `DelegateAccounts` struct API. Creates three auxiliary accounts:

| Account | Seeds | Program |
|---------|-------|---------|
| `buffer` | `[b"buffer", pod.key()]` | `pod_factory` |
| `delegation_record` | `[b"delegation", pod.key()]` | DELeGG |
| `delegation_metadata` | `[b"delegation-metadata", pod.key()]` | DELeGG |

Configured with `commit_frequency_ms: 3_000` (3-second commit cycle).

#### `commit_pod` / `commit_and_undelegate_pod`

Wrappers around `ephemeral_rollups_sdk::ephem::commit_accounts` and `commit_and_undelegate_accounts` for cranking delegated Pod state back to Solana.

---

## Settlement Program

Source: `programs/settlement/src/lib.rs`

### Instruction: `settle_epoch`

Creates an `EpochSettlement` PDA (seeds: `[b"epoch", epoch.to_le_bytes()]`). Args:

| Argument | Type | Description |
|---|---|---|
| `epoch` | `u64` | Devnet epoch number |
| `merkle_root` | `[u8; 32]` | Merkle root of all receipts in the epoch |
| `total_volume_lamports` | `u64` | Total spend volume |
| `receipt_count` | `u64` | Number of receipts |
| `total_fees_lamports` | `u64` | Total protocol fees |

Fee split: 20% → `crank_reward_lamports`, 80% → `treasury_lamports`.

Emits: `EpochSettled { epoch, merkle_root, total_volume_lamports, receipt_count, ... }`.

---

## MagicBlock Ephemeral Rollups Integration

### How Delegation Works

1. `delegate_pod` is called on the base layer. This CPIs into `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`, which marks the Pod PDA as delegated and sets up the buffer, delegation record, and metadata accounts.
2. The MagicBlock ER validator (`MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`) takes custody of the account.
3. An agent sends transactions to the MagicBlock devnet router (`https://devnet-router.magicblock.app`). These are processed at ER speed — sub-second finality, no Solana block-time constraint.
4. At configurable intervals (3 seconds in the MVP config), the crank commits ER state back to Solana base layer via `commit_pod` or `commit_and_undelegate_pod`.

### What ER Enables for Agents

| Capability | Without ER | With ER |
|---|---|---|
| **Latency** | ~400 ms (Solana block) | Sub-second |
| **State ownership** | Always on L1 | Delegated to ER validator |
| **Policy enforcement** | Every tx hits L1 | Policy state in ER, enforced locally |
| **Settlement cadence** | Per-tx | Batched per commit cycle |
| **Cost** | Per-tx L1 fees | Batched amortized fees |

In practical terms: an agent can process a stream of micro-payments (e.g., RFQ fills, bill-pay intents) through the ER at real-time speed, with policy limits enforced inside the ER, and only commit aggregated state back to Solana periodically. This is the key property for autonomous agent commerce.

### SDK Usage (JS)

```typescript
import {
  ConnectionMagicRouter,
  createCommitInstruction,
  createCommitAndUndelegateInstruction,
  createDelegateInstruction,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";

// Connect to the MagicBlock devnet router
const erConnection = new ConnectionMagicRouter(
  "https://devnet-router.magicblock.app"
);
```

### SDK Usage (Rust — `ephemeral-rollups-sdk = "0.2.5"`)

```rust
use ephemeral_rollups_sdk::cpi::{delegate_account, DelegateAccounts, DelegateConfig};

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
    DelegateConfig { commit_frequency_ms: 3_000, validator: Some(validator) },
)?;
```

---

## Browser Frontend

Source: `client/src/App.tsx`

Multi-page React app built with Vite, Tailwind CSS, shadcn/ui, and `wouter` for routing.

### Pages

| Route | Description |
|-------|-------------|
| `/` | Overview and navigation |
| `/pod` | Create a Pod — policy form, devnet wallet connection, Pod PDA derivation |
| `/agent` | Agent execution — BillPay and OTC/RFQ intents routed through Magic Router |
| `/receipts` | Receipts log — per-receipt approval status, Devnet Explorer links |
| `/settlement` | Epoch settlement — settle via Magic Router, view on-chain settlement state |
| `/architecture` | Architecture diagram and tech stack |
| `/proof` | Hackathon submission evidence — live checklist of all confirmed devnet transactions |

### Transaction Routing Labels

Every action in the frontend carries one of three badges to be transparent about what is simulated vs. live:

- **Solana Devnet** — real on-chain transaction confirmed on Solana devnet
- **MagicBlock ER** — routed via `devnet-router.magicblock.app`
- **Pending program deploy** — requires `anchor deploy` (programs are deployed; badge used for UI states that need a running session)

### Running the Frontend

```bash
npm install
npm run dev
```

The app opens on `http://localhost:5173`. Connect a Phantom, Backpack, or Solflare wallet configured to Solana devnet and funded with devnet SOL.

### Vercel Deployment

The frontend is a static Vite build and deploys to Vercel with zero config:

```bash
npm run build        # produces client/dist/
vercel --prod        # or connect the repo in the Vercel dashboard
```

Set no environment variables are required for the frontend to function. The backend (`server/index.ts`) is an optional Express layer for session storage; the frontend works standalone in static mode.

---

## Anchor Programs

Rust, Solana CLI, and Anchor CLI are required.

```bash
# Build
anchor build

# Deploy (requires ~2 SOL in the deployer wallet)
anchor deploy --provider.cluster devnet
```

The deployer keypair lives at `~/.config/solana/id.json` (or override in `Anchor.toml`).

Program sources:
- `programs/pod_factory/src/lib.rs`
- `programs/settlement/src/lib.rs`

IDLs (generated by `anchor build`):
- `target/idl/pod_factory.json`
- `target/idl/settlement.json`

### Anchor ESM/CJS Interop

`@coral-xyz/anchor` is a CommonJS module. In this ESM project (`"type": "module"`), use default import and destructure:

```typescript
import anchor from "@coral-xyz/anchor";
const { BN, AnchorProvider, Program, Wallet, setProvider } = anchor;
```

Named imports (`import { BN } from "@coral-xyz/anchor"`) fail with `tsx`.

---

## Scripts

All scripts in `scripts/` target Solana devnet and use the deployer keypair at `.keys/podmesh-devnet-deployer.json` (or `KEYPAIR` env override).

### `scripts/create-spend-pod.ts`

Creates a Pod PDA on devnet. Seeds: `[b"pod", ownerPublicKey]`.

```bash
npx tsx scripts/create-spend-pod.ts
# Override keypair:
KEYPAIR=/path/to/keypair.json npx tsx scripts/create-spend-pod.ts
```

### `scripts/record-receipt.ts`

Records a receipt against an existing Pod PDA.

```bash
npx tsx scripts/record-receipt.ts
```

### `scripts/settle-epoch.ts`

Calls `settle_epoch` on the settlement program for a given epoch.

```bash
npx tsx scripts/settle-epoch.ts
```

### `scripts/delegate-pod.ts`

Delegates the Pod PDA to the MagicBlock ER via `delegate_pod`.

```bash
npx tsx scripts/delegate-pod.ts
```

### `scripts/podmesh-crank.ts`

Commits a delegated Pod account through the MagicBlock router.

```bash
POD_ACCOUNT=<pod-pda> \
PAYER_SECRET_JSON='[1,2,...]' \
MERKLE_ROOT=<hex-root> \
npx tsx scripts/podmesh-crank.ts
```

---

## Devnet E2E Flow — Tested and Confirmed

All five steps below executed against Solana devnet and confirmed with Solana Explorer links.

**Owner / payer:** `2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ` (burner deployer keypair)  
**Pod PDA:** `GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL`  
**Devnet epoch at test time:** `1060`

---

### Step 1 — `create_spend_pod`

Policy created with: 0.05 SOL per-tx cap, 1.0 SOL per-epoch cap, 3 allowed category hashes (`grocery:general`, `food_delivery:restaurant`, `grocery:pharmacy`), 150 bps slippage, 90-day expiry.

**Transaction:** `2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F`

- [Transaction on Solana Explorer](https://explorer.solana.com/tx/2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F?cluster=devnet)
- [Pod PDA account](https://explorer.solana.com/address/GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL?cluster=devnet)

On-chain state after creation:

```json
{
  "owner":                 "2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ",
  "bump":                  251,
  "maxPerTxLamports":      "50000000",
  "maxPerEpochLamports":   "1000000000",
  "epochSpentLamports":    "0",
  "expiryTs":              "1784990719",
  "slippageBps":           150,
  "requireDeliveryOracle": false,
  "receiptCount":          "0",
  "lastEpoch":             "0"
}
```

---

### Step 2 — Agent payment transfer (0.001 SOL)

The agent executes a `SystemProgram.transfer` within policy limits (0.001 SOL < 0.05 SOL per-tx cap).

**Payer (agent wallet):** `2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ`  
**Merchant receiver:** `EFqNZm8MFWQP7c3iYBNxYx6XbMEpMmxaUmkFS39FtsJ1`  
**Amount:** 0.001 SOL (1,000,000 lamports)

**Transaction:** `FQCEkhHfu9d8XmZMzBe7iwt6APtcYfKxPpKPM67NZ7KSUbPN1PFyc3ndDHK2Q2raCfeeU7YRvi4yKAjX1ePviVW`

- [Transaction on Solana Explorer](https://explorer.solana.com/tx/FQCEkhHfu9d8XmZMzBe7iwt6APtcYfKxPpKPM67NZ7KSUbPN1PFyc3ndDHK2Q2raCfeeU7YRvi4yKAjX1ePviVW?cluster=devnet)
- [Payer account](https://explorer.solana.com/address/2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ?cluster=devnet)
- [Merchant account](https://explorer.solana.com/address/EFqNZm8MFWQP7c3iYBNxYx6XbMEpMmxaUmkFS39FtsJ1?cluster=devnet)

---

### Step 3 — `record_receipt`

Anchors the payment on-chain. Amount (1,000,000 lamports) passes all policy checks: within per-tx cap, within per-epoch cap, category hash matches, slippage within limit.

**Transaction:** `4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw`

- [Transaction on Solana Explorer](https://explorer.solana.com/tx/4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw?cluster=devnet)

On-chain Pod state after receipt:

```json
{
  "receiptCount":       "1",
  "epochSpentLamports": "1000000",
  "lastEpoch":          "1060"
}
```

Event emitted: `ReceiptRecorded { pod, owner, amount_lamports: 1000000, epoch: 1060, sequence: 1 }`

---

### Step 4 — `settle_epoch`

Epoch 1060 settled. Epoch Settlement PDA: `7ucH3LPdx2PfS3LUpKSoFYVWuxYK54LikxSm7qCrhDk9`  
(seeds: `[b"epoch", 1060u64.to_le_bytes()]`)

**Transaction:** `5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd`

- [Transaction on Solana Explorer](https://explorer.solana.com/tx/5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd?cluster=devnet)
- [Epoch Settlement PDA](https://explorer.solana.com/address/7ucH3LPdx2PfS3LUpKSoFYVWuxYK54LikxSm7qCrhDk9?cluster=devnet)

On-chain EpochSettlement state:

```json
{
  "authority":           "2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ",
  "epoch":               1060,
  "totalVolumeLamports": "1000000",
  "receiptCount":        "1",
  "totalFeesLamports":   "5000",
  "crankRewardLamports": "1000",
  "treasuryLamports":    "4000",
  "settled":             true
}
```

Event emitted: `EpochSettled { epoch: 1060, total_volume_lamports: 1000000, receipt_count: 1 }`

---

### Step 5 — `delegate_pod` (MagicBlock CPI)

Pod PDA delegated to the MagicBlock ER. Delegation accounts created:

| Account | Address |
|---------|---------|
| `buffer` | `CcoYiQ6tiGo94yqQf1WkbV3eMphgDoRjsm2ih6HpKJwZ` |
| `delegation_record` | `41ALi2pbJvKd5YDcodUi3gBHXmn5cEnTbGcbFFah5652` |
| `delegation_metadata` | `5eeTGhbG8Pqr1DcByKWX1yMckQZa5XbFBJbyypYsrJWU` |

**Validator:** `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`

**Transaction:** `4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE`

- [Transaction on Solana Explorer](https://explorer.solana.com/tx/4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE?cluster=devnet)

Pod PDA is now delegated with a 3-second commit frequency. The delegation CPI (`pod_factory` → `DELeGG`) executed correctly on devnet.

---

### Full E2E Instruction Matrix

| Step | Action | Program / Context | Signature | Status |
|------|--------|-------------------|-----------|--------|
| 1 | `create_spend_pod` | `pod_factory` | [`2uRUDPGL...SSJi6F`](https://explorer.solana.com/tx/2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F?cluster=devnet) | ✓ |
| 2 | `SystemProgram.transfer 0.001 SOL` | Solana base layer | [`FQCEkhHf...PviVW`](https://explorer.solana.com/tx/FQCEkhHfu9d8XmZMzBe7iwt6APtcYfKxPpKPM67NZ7KSUbPN1PFyc3ndDHK2Q2raCfeeU7YRvi4yKAjX1ePviVW?cluster=devnet) | ✓ |
| 3 | `record_receipt` | `pod_factory` | [`4n2snHrv...FdBGw`](https://explorer.solana.com/tx/4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw?cluster=devnet) | ✓ |
| 4 | `settle_epoch` | `settlement` | [`5SiWbxXF...dfKd`](https://explorer.solana.com/tx/5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd?cluster=devnet) | ✓ |
| 5 | `delegate_pod` (MagicBlock CPI) | `pod_factory` → `DELeGG` | [`4K73yk4E...mt7FE`](https://explorer.solana.com/tx/4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE?cluster=devnet) | ✓ |

---

## Marketplace-Ready Flow

The intended production flow for an agent commerce marketplace:

1. **User creates a Pod** — sets spend policy (category whitelist, per-tx cap, per-epoch cap, slippage, expiry). Pod PDA is created on Solana base layer.
2. **User delegates Pod to ER** — calls `delegate_pod`. Pod state is handed to the MagicBlock ER validator.
3. **Agent executes payments** — agent sends payment intents to the Magic Router. The ER validates against Pod policy at sub-second speed. Receipts accumulate in ER state.
4. **Crank commits** — every 3 seconds (configurable), a crank commits ER state back to Solana, producing an on-chain receipt trail.
5. **Epoch settlement** — at epoch boundaries, the crank calls `settle_epoch` with a Merkle root of all receipts. The settlement program records volume, receipt count, and distributes fees.
6. **User undelegates** — when done, `commit_and_undelegate_pod` returns Pod custody to Solana base layer.

---

## Current Limitations

These are honest constraints of the MVP, not implementation defects:

| Item | Status | Notes |
|------|--------|-------|
| Live ER state mutations via Magic Router | Pending | Requires an active MagicBlock ER validator session against the deployed programs. The delegation CPI completes on devnet, but real-time ER execution depends on validator liveness. |
| Cross-program: `settlement` → `pod_factory` CPI | Pending | Full cross-program integration (settlement triggering pod state updates) is designed but not tested end-to-end. |
| `commit_and_undelegate` full round-trip | Pending | Delegation succeeds; commit-and-undelegate requires an active ER session. |
| Oracle integration | Not implemented | `require_delivery_oracle = false` was used in all devnet tests. The flag exists in the Pod state; oracle infrastructure is out of scope for the hackathon. |
| Merkle root construction from live receipts | Partial | The `podmesh-crank.ts` script accepts a `MERKLE_ROOT` env var. Automated Merkle tree construction from receipt events is not included. |

---

## Local Setup

### Prerequisites

- Node.js 18+
- Rust (stable)
- Solana CLI 2.3+ (`solana-install init 2.3.13`)
- Anchor CLI 0.32.1 (`cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.32.1 && avm use 0.32.1`)

### Frontend

```bash
cd podmesh-mvp
npm install
npm run dev
```

### Anchor Programs

```bash
anchor build
anchor deploy --provider.cluster devnet
```

> **Note on build environment:** Anchor 0.32.1 with Solana CLI 2.3.x may encounter a dependency chain issue where `hashbrown 0.17.0` / `indexmap 2.14.0` use `edition = "2024"`, which is not supported by the bundled `cargo 1.84.0` in Solana platform-tools. See `BUILD_NOTES.md` for the registry patch workaround, or upgrade to Solana CLI ≥ 2.4.x which ships `cargo 1.86+`.

### Devnet Keypairs

The deployer keypair is at `.keys/podmesh-devnet-deployer.json`. Scripts accept a `KEYPAIR` environment variable to override.

Fund with devnet SOL before deploying or running scripts:

```bash
solana airdrop 2 <your-pubkey> --url devnet
```

---

## Live Stack

| Service | Address |
|---------|---------|
| Solana devnet RPC | `https://api.devnet.solana.com` |
| MagicBlock devnet router | `https://devnet-router.magicblock.app` |
| MagicBlock delegation program | `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` |
| MagicBlock devnet ER validator | `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` |
| `pod_factory` program | `FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm` |
| `settlement` program | `A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc` |

---

## License

MIT
