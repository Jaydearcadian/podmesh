# PodMesh — Devnet E2E Test Results

Recorded: 2025-01-27

---

## Programs Deployed to Devnet

| Program     | Program ID                                    | Status      |
| ----------- | --------------------------------------------- | ----------- |
| pod_factory | `FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm` | ✓ Deployed, executable |
| settlement  | `A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc` | ✓ Deployed, executable |

Explorer links:
- [pod_factory on Solana Explorer](https://explorer.solana.com/address/FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm?cluster=devnet)
- [settlement on Solana Explorer](https://explorer.solana.com/address/A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc?cluster=devnet)

---

## E2E Test: `create_spend_pod`

### Test Script

`scripts/create-spend-pod.ts` — uses `@coral-xyz/anchor@0.30.1` with the generated IDL at
`target/idl/pod_factory.json`. Run with:

```bash
npx tsx scripts/create-spend-pod.ts
# Optional override:
KEYPAIR=/path/to/keypair.json npx tsx scripts/create-spend-pod.ts
```

### PDA Derivation

Seeds from IDL and Rust source (`POD_SEED = b"pod"`):
```
PDA = findProgramAddressSync(["pod", ownerPublicKey], podFactoryProgramId)
```

### Test Execution (2025-01-27)

**Owner / Payer:** `2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ` (burner deployer keypair)

**Pod PDA:** `GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL`

**Transaction Signature:**
```
2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F
```

**Explorer:**
- [Transaction](https://explorer.solana.com/tx/2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F?cluster=devnet)
- [Pod PDA Account](https://explorer.solana.com/address/GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL?cluster=devnet)

### Args Used

| Argument                 | Value                    | Notes                          |
| ------------------------ | ------------------------ | ------------------------------ |
| `max_per_tx_lamports`    | 50,000,000 (0.05 SOL)   | Max per single transaction     |
| `max_per_epoch_lamports` | 1,000,000,000 (1.0 SOL) | Max per epoch (≈2 days devnet) |
| `allowed_category_hashes`| 3 hashes                | grocery:general, food_delivery:restaurant, grocery:pharmacy |
| `expiry_ts`              | +90 days from execution  | Unix timestamp                 |
| `slippage_bps`           | 150 (1.5%)              | Max slippage                   |
| `require_delivery_oracle`| false                   | No oracle required for test    |

### On-Chain Pod State After Creation

```json
{
  "owner":                 "2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ",
  "bump":                  251,
  "maxPerTxLamports":      "50000000",
  "maxPerEpochLamports":   "1000000000",
  "epochSpentLamports":    "0",
  "allowedCategoryHashes": ["(3 entries)"],
  "expiryTs":              "1784990719",
  "slippageBps":           150,
  "requireDeliveryOracle": false,
  "receiptCount":          "0",
  "lastEpoch":             "0"
}
```

---

## IDL Mismatch Note

The task spec mentioned args `policy_uri`, `settlement_authority`, and `oracle`. These are **not
present** in the deployed program's IDL. The deployed `create_spend_pod` instruction uses:
- `slippage_bps` (u16) instead of settlement/oracle pubkey args
- `require_delivery_oracle` (bool) as the oracle requirement flag

The test was written to match the **actual deployed IDL** (`target/idl/pod_factory.json`).

---

## ESM/CJS Interop Note

`@coral-xyz/anchor` is a CommonJS module. When imported inside an ESM (`"type": "module"`)
TypeScript project via `tsx`, named exports cannot be destructured directly with `import {...}`.

The working pattern:
```typescript
import anchor from "@coral-xyz/anchor";  // default import
const { BN, AnchorProvider, Program, Wallet, setProvider } = anchor;  // destructure
```

---

## E2E Test: `record_receipt`

### Test Script

`scripts/record-receipt.ts` — calls `record_receipt` on the existing Pod PDA.

```bash
npx tsx scripts/record-receipt.ts
```

### Test Execution (2025-04-26)

**Owner:** `2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ`

**Pod PDA:** `GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL`

**Transaction Signature:**
```
4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw
```

**Explorer:**
- [Transaction](https://explorer.solana.com/tx/4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw?cluster=devnet)

### Args Used

| Argument          | Value                     | Notes                              |
| ----------------- | ------------------------- | ---------------------------------- |
| `amount_lamports` | 1,000,000 (0.001 SOL)    | Below 0.05 SOL per-tx cap          |
| `category_hash`   | `grocery:general` hash    | Must match pod.allowed_category_hashes |
| `slippage_bps`    | 100                       | Below 150 bps cap                  |
| `oracle_attested` | false                     | Pod does not require oracle        |
| `epoch`           | 1060 (devnet current)     | From `connection.getEpochInfo()`   |
| `receipt_hash`    | timestamp-derived         | Unique per receipt                 |

### On-Chain Pod State After record_receipt

```json
{
  "receiptCount": "1",
  "epochSpentLamports": "1000000",
  "lastEpoch": "1060"
}
```

Event emitted: `ReceiptRecorded { pod, owner, amount_lamports: 1000000, epoch: 1060, sequence: 1 }`

---

## E2E Test: `settle_epoch`

### Test Script

`scripts/settle-epoch.ts` — calls `settle_epoch` on the settlement program.

```bash
npx tsx scripts/settle-epoch.ts
```

### Test Execution (2025-04-26)

**Crank Authority:** `2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ`

**Epoch Settlement PDA:** `7ucH3LPdx2PfS3LUpKSoFYVWuxYK54LikxSm7qCrhDk9`
(seeds: `[b"epoch", 1060u64.to_le_bytes()]`)

**Transaction Signature:**
```
5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd
```

**Explorer:**
- [Transaction](https://explorer.solana.com/tx/5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd?cluster=devnet)
- [Epoch Settlement PDA](https://explorer.solana.com/address/7ucH3LPdx2PfS3LUpKSoFYVWuxYK54LikxSm7qCrhDk9?cluster=devnet)

### Args Used

| Argument                 | Value                      | Notes                               |
| ------------------------ | -------------------------- | ----------------------------------- |
| `epoch`                  | 1060                       | Devnet current epoch                |
| `merkle_root`            | deterministic hash         | `podmesh-epoch-1060-<timestamp>`    |
| `total_volume_lamports`  | 1,000,000 (0.001 SOL)     | Matches receipt recorded above      |
| `receipt_count`          | 1                          | One receipt in this epoch           |
| `total_fees_lamports`    | 5,000 (0.5% of volume)    | 5% → crank reward, 95% → treasury   |

### On-Chain EpochSettlement State After settle_epoch

```json
{
  "authority":            "2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ",
  "epoch":                1060,
  "totalVolumeLamports":  "1000000",
  "receiptCount":         "1",
  "totalFeesLamports":    "5000",
  "crankRewardLamports":  "1000",
  "treasuryLamports":     "4000",
  "settled":              true
}
```

Event emitted: `EpochSettled { epoch: 1060, total_volume_lamports: 1000000, receipt_count: 1, ... }`

---

## E2E Test: `delegate_pod` (MagicBlock Ephemeral Rollup)

### Test Script

`scripts/delegate-pod.ts` — calls `delegate_pod` which CPIs into the MagicBlock delegation program.

```bash
npx tsx scripts/delegate-pod.ts
```

### Test Execution (2025-04-26)

**Owner:** `2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ`

**Pod PDA:** `GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL`

**Delegation Accounts Derived:**
```
buffer PDA:           CcoYiQ6tiGo94yqQf1WkbV3eMphgDoRjsm2ih6HpKJwZ
  seeds: [b"buffer", pod.key()] under pod_factory
delegation_record:    41ALi2pbJvKd5YDcodUi3gBHXmn5cEnTbGcbFFah5652
  seeds: [b"delegation", pod.key()] under DELeGG
delegation_metadata:  5eeTGhbG8Pqr1DcByKWX1yMckQZa5XbFBJbyypYsrJWU
  seeds: [b"delegation-metadata", pod.key()] under DELeGG
```

**Validator:** `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57` (MagicBlock devnet default)

**Delegation Program:** `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh` (✓ deployed on devnet)

**Transaction Signature:**
```
4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE
```

**Explorer:**
- [Transaction](https://explorer.solana.com/tx/4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE?cluster=devnet)

### Result

✓ **delegate_pod succeeded.** The Pod PDA is now delegated to the MagicBlock ephemeral rollup
with a 3-second commit frequency. The delegation CPI (pod_factory → DELeGG program) executed
correctly on devnet. The pod's buffer, delegation record, and delegation metadata accounts
were created on-chain.

---

## Full E2E Instruction Matrix

| Instruction               | Program     | Signature (devnet)                                                         | Status |
| ------------------------- | ----------- | -------------------------------------------------------------------------- | ------ |
| `create_spend_pod`        | pod_factory | `2uRUDPGLSEb...SSJi6F`                                                     | ✓ Done |
| `record_receipt`          | pod_factory | `4n2snHrvTSv...FdBGw`                                                      | ✓ Done |
| `settle_epoch`            | settlement  | `5SiWbxXFxjf...dfKd`                                                       | ✓ Done |
| `delegate_pod` (MagicBlock) | pod_factory → DELeGG | `4K73yk4Ezkc...mt7FE`                                          | ✓ Done |

---

## Remaining Blockers

| Item                              | Status   | Notes |
| --------------------------------- | -------- | ----- |
| `create_spend_pod` on devnet      | ✓ Done   | Signature: `2uRUDPGLSEb...SSJi6F` |
| `record_receipt` on devnet        | ✓ Done   | Signature: `4n2snHrvTSv...FdBGw` |
| `settle_epoch` on devnet          | ✓ Done   | Signature: `5SiWbxXFxjf...dfKd` |
| `delegate_pod` (MagicBlock DELeGG) | ✓ Done  | Signature: `4K73yk4Ezkc...mt7FE` |
| Ephemeral rollup state mutations  | Pending  | Requires active validator session (beyond devnet baseline) |
| CPI from settlement → pod_factory | Pending  | Full cross-program integration test |

All four primary on-chain instructions now execute successfully on devnet.

---

## Live Payment Transfer: Agent → Merchant

### Details

| Field              | Value |
| ------------------ | ----- |
| **Instruction**    | SystemProgram.transfer (0.001 SOL) |
| **Payer / Agent wallet** | `2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ` |
| **Merchant receiver**    | `EFqNZm8MFWQP7c3iYBNxYx6XbMEpMmxaUmkFS39FtsJ1` |
| **Amount**         | 0.001 SOL (1,000,000 lamports) |
| **Network**        | Solana devnet |

**Transaction Signature:**
```
FQCEkhHfu9d8XmZMzBe7iwt6APtcYfKxPpKPM67NZ7KSUbPN1PFyc3ndDHK2Q2raCfeeU7YRvi4yKAjX1ePviVW
```

**Explorer:**
- [Transaction](https://explorer.solana.com/tx/FQCEkhHfu9d8XmZMzBe7iwt6APtcYfKxPpKPM67NZ7KSUbPN1PFyc3ndDHK2Q2raCfeeU7YRvi4yKAjX1ePviVW?cluster=devnet)
- [Payer account](https://explorer.solana.com/address/2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ?cluster=devnet)
- [Merchant account](https://explorer.solana.com/address/EFqNZm8MFWQP7c3iYBNxYx6XbMEpMmxaUmkFS39FtsJ1?cluster=devnet)

### Context

This transfer represents the agent's autonomous payment step in the Agent Commerce Demo flow:

1. `create_spend_pod` — policy-bound Pod created with 0.05 SOL per-tx cap
2. **`SystemProgram.transfer 0.001 SOL`** ← this transfer (within policy limits)
3. `record_receipt` — spend anchored to Pod PDA on pod_factory
4. `settle_epoch` — epoch 1060 settled on settlement program
5. `delegate_pod` — Pod delegated via MagicBlock CPI for ER-ready execution

The transfer amount (0.001 SOL) is within the Pod's max_per_tx_lamports (50,000,000 = 0.05 SOL) and matches the amount recorded in `record_receipt`.

---

## Updated E2E Instruction Matrix

| Step | Instruction / Action            | Program / Context                  | Signature                                      | Status |
| ---- | ------------------------------- | ---------------------------------- | ---------------------------------------------- | ------ |
| 1    | `create_spend_pod`              | pod_factory                        | `2uRUDPGLSEb...SSJi6F`                         | ✓ Done |
| 2    | `SystemProgram.transfer 0.001 SOL` | Solana base layer               | `FQCEkhHfu9d...PviVW`                          | ✓ Done |
| 3    | `record_receipt`                | pod_factory                        | `4n2snHrvTSv...FdBGw`                          | ✓ Done |
| 4    | `settle_epoch`                  | settlement                         | `5SiWbxXFxjf...dfKd`                           | ✓ Done |
| 5    | `delegate_pod` (MagicBlock CPI) | pod_factory → DELeGG               | `4K73yk4Ezkc...mt7FE`                          | ✓ Done |
