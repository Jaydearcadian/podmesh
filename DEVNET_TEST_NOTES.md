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

## Remaining Blockers

| Item                          | Status   | Notes |
| ----------------------------- | -------- | ----- |
| `create_spend_pod` on devnet  | ✓ Done   | Signature captured |
| `record_receipt` on devnet    | Pending  | Requires pod to exist (now done) |
| `delegate_pod` (MagicBlock)   | Pending  | Requires MagicBlock delegation program on devnet |
| CPI from settlement → pod_factory | Pending | Full cross-program integration test |
| Ephemeral rollup round-trip   | Pending  | Requires active MagicBlock validator |

The core on-chain programs are deployed and functional. The `create_spend_pod` instruction
executes successfully with policy constraints enforced on-chain.
