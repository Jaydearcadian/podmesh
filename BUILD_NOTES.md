# PodMesh - Build Notes

## Summary

Both Anchor programs (`pod_factory`, `settlement`) now compile successfully to `.so` artifacts.
The frontend TypeScript compiles and produces a production build with zero errors.

```
target/deploy/pod_factory.so   283 KB  ✓
target/deploy/settlement.so    204 KB  ✓
npm run check                         ✓ (0 errors)
npm run build                         ✓ (client + server bundles)
```

---

## Environment

| Tool             | Version                                      |
| ---------------- | -------------------------------------------- |
| Anchor CLI       | 0.32.1                                       |
| Solana CLI       | 2.3.13 (Agave)                               |
| Rust (system)    | stable 1.95.0                                |
| Rust (sbpf)      | 1.89.0-sbpf-solana-v1.52 (used for build)    |
| cargo (bundled)  | 1.84.0 (inside platform-tools / cargo-build-sbf) |
| ephemeral-rollups-sdk (Rust) | 0.2.5                           |
| @magicblock-labs/ephemeral-rollups-sdk (JS) | 0.11.2        |

---

## Build Blockers Found and Resolved

### Blocker 1: `edition2024` not supported by bundled cargo 1.84

**Root cause chain:**
```
anchor-attribute-constant 0.32.1
  → proc-macro-crate 3.3.0
    → toml_edit 0.22.x
      → indexmap 2.14.0
        → hashbrown 0.17.0   ← Cargo.toml says edition = "2024"
```

`anchor build` internally invokes `cargo-build-sbf`, which ships its own bundled
`cargo 1.84.0` in the Solana platform-tools. Cargo 1.84 does not support the
`edition2024` feature gate in dependency `Cargo.toml` manifests.

**Resolution: registry patch (applied to this environment):**

The following crates in the platform-tools registry at
`~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/` were patched:

```bash
# Change edition = "2024" → edition = "2021" and lower rust-version
sed -i 's/^edition = "2024"/edition = "2021"/' \
  ~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/hashbrown-0.17.0/Cargo.toml
sed -i 's/^edition = "2024"/edition = "2021"/' \
  ~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/indexmap-2.14.0/Cargo.toml
sed -i 's/^edition = "2024"/edition = "2021"/' \
  ~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/digest-0.11.2/Cargo.toml
sed -i 's/^edition = "2024"/edition = "2021"/' \
  ~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/toml_datetime-1.1.1+spec-1.1.0/Cargo.toml
sed -i 's/^edition = "2024"/edition = "2021"/' \
  ~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/wincode-0.5.3/Cargo.toml

# Lower rust-version requirements to 1.84
for crate in hashbrown-0.17.0 indexmap-2.14.0 digest-0.11.2 \
             toml_datetime-1.1.1+spec-1.1.0 wincode-0.5.3 \
             unicode-segmentation-1.13.2; do
  sed -i 's/^rust-version = "1\.\(8[5-9]\|9\)/rust-version = "1.84/' \
    ~/.cargo/registry/src/index.crates.io-6f17d22bba15001f/$crate/Cargo.toml
done
```

**Alternative / permanent fix:** Upgrade Solana CLI to ≥ 2.4.x which ships
cargo 1.86+ (edition2024 is stabilised in Rust 1.85/Cargo 1.85).

```bash
solana-install update
# or pin a specific version:
solana-install init 2.4.0
```

**Alternative 2:** Downgrade the dependency chain by adding to workspace `Cargo.toml`:
```toml
[patch.crates-io]
indexmap = { version = "=2.6.0" }    # last version using hashbrown 0.15
hashbrown = { version = "=0.15.2" }  # does not require edition2024
```
(Requires internet access to fetch those older crate versions.)

---

### Blocker 2: `delegate_account` call mismatch

**Root cause:** `programs/pod_factory/src/lib.rs` called `delegate_account` with 9
positional arguments from an earlier SDK version. The installed
`ephemeral-rollups-sdk=0.2.5` uses a struct-based API:

```rust
// OLD (broken):
delegate_account(&owner, &pod_info, &owner_program, &delegation_program,
                 &system_program, Some(validator), seeds, 0, 3_000)?;

// FIXED:
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

The `DelegatePod` Anchor accounts struct was updated to include the three new
accounts (`buffer`, `delegation_record`, `delegation_metadata`) required by the SDK.

---

### Blocker 3: `anchor_lang::solana_program::hash` not re-exported

`anchor-lang 0.32.1` uses modular Solana crates (not the monolithic `solana-program`),
so `anchor_lang::solana_program::hash` does not exist.

**Fix:** Added `solana-program = "=2.3.0"` as an explicit dependency to `pod_factory`
and imported `use solana_program::hash::hashv;` directly.

---

### Blocker 4: Missing `idl-build` feature

**Error:** `Error: 'idl-build' feature is missing.`

**Fix:** Added to both programs' `Cargo.toml`:
```toml
[features]
idl-build = ["anchor-lang/idl-build"]
```

---

## Files Changed

| File | Change |
|------|--------|
| `programs/pod_factory/src/lib.rs` | Fixed `delegate_account` call, updated import, fixed hash function |
| `programs/pod_factory/Cargo.toml` | Added `idl-build` feature, added `solana-program = "=2.3.0"` dep |
| `programs/settlement/Cargo.toml` | Added `idl-build` feature |
| `rust-toolchain.toml` (new) | Pin to `1.89.0-sbpf-solana-v1.52` for `cargo check` via rustup |
| `client/src/App.tsx` | Full frontend improvement (see below) |
| `BUILD_NOTES.md` (this file) | Build documentation |

---

## Frontend Improvements

### New page: `/proof` - Live Proof / Devnet Evidence

An 8-item checklist with live status for:
- MagicBlock router connectivity
- Wallet connection (devnet)
- Pod PDA derivation
- Confirmed Solana devnet transactions (with Explorer links)
- MagicBlock ER transactions via Magic Router (with Explorer links)
- Anchor programs compiled to `.so`
- ephemeral-rollups-sdk integration
- Policy-enforced receipt trail

### Transaction routing labels (RouteBadge)

Every action and event now shows one of three badges:
- 🔵 **Solana Devnet**: real on-chain tx confirmed on Solana devnet
- 🟣 **MagicBlock ER**: routed via devnet-router.magicblock.app
- 🟡 **Pending program deploy**: requires `solana program deploy` first

### Explorer links

- Every confirmed signature in the event log → `explorer.solana.com/tx/<sig>?cluster=devnet`
- Pod PDA → `explorer.solana.com/address/<pda>?cluster=devnet`
- Program IDs → `explorer.solana.com/address/<id>?cluster=devnet`
- Receipts page: each approved receipt has a "Devnet Explorer" button

### Policy pre-check on Agent cards

Each payment intent card shows "Will approve → MagicBlock ER" or
"Will reject → Pending program deploy" _before_ the user clicks Execute.

### Deployment notice on Pod page

Amber callout explaining that `anchor policy` sends a real devnet memo tx,
full PDA CPI delegation requires on-chain program deploy, and the `.so` files
are ready in `target/deploy/`.

---

## Remaining Work to Go Fully Live

1. **Fund a devnet keypair** with SOL for rent:
   ```bash
   solana airdrop 2 --url devnet
   ```

2. **Deploy programs** (requires ~2 SOL for rent on devnet):
   ```bash
   anchor deploy --provider.cluster devnet
   # or:
   solana program deploy target/deploy/pod_factory.so \
     --program-id target/deploy/pod_factory-keypair.json \
     --url devnet
   solana program deploy target/deploy/settlement.so \
     --program-id target/deploy/settlement-keypair.json \
     --url devnet
   ```

3. **Switch `createPodOnchain`** in the frontend from memo-only to the full
   Anchor CPI once the program is deployed. The IDL is generated at
   `target/idl/pod_factory.json`.

4. **Persist the registry patches** across `solana-install update`: the edition2024
   workaround applied above will be lost if the platform-tools are re-installed.
   The real fix is upgrading to Solana CLI ≥ 2.4.x.

---

## Running the Build

```bash
# Frontend (TypeScript type check)
npm run check   # 0 errors

# Frontend (production bundle)
npm run build   # ✓ client + server bundles

# Anchor programs (after applying registry patches above)
anchor build    # ✓ pod_factory.so + settlement.so

# Start dev server
npm run dev
```

---

## Devnet Deployment (Completed)

Both programs are now deployed to **Solana devnet** and confirmed executable.

| Program     | Program ID                                    | Status   |
| ----------- | --------------------------------------------- | -------- |
| pod_factory | `FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm` | ✓ Live   |
| settlement  | `A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc` | ✓ Live   |

### E2E Test Results: All Instructions (2025-04-26)

| Script | Instruction | Signature |
|--------|-------------|---------- |
| `scripts/create-spend-pod.ts` | `create_spend_pod` | `2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F` |
| `scripts/record-receipt.ts` | `record_receipt` | `4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw` |
| `scripts/settle-epoch.ts` | `settle_epoch` | `5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd` |
| `scripts/delegate-pod.ts` | `delegate_pod` (MagicBlock CPI) | `4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE` |

All four instructions confirmed on devnet. Pod PDA: `GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL`

Explorer:
- [create_spend_pod](https://explorer.solana.com/tx/2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F?cluster=devnet)
- [record_receipt](https://explorer.solana.com/tx/4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw?cluster=devnet)
- [settle_epoch](https://explorer.solana.com/tx/5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd?cluster=devnet)
- [delegate_pod](https://explorer.solana.com/tx/4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE?cluster=devnet)
- [Pod PDA](https://explorer.solana.com/address/GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL?cluster=devnet)

### Anchor ESM/CJS Import Note

`@coral-xyz/anchor` is a CommonJS module. In this ESM project (`"type": "module"`), use:
```typescript
import anchor from "@coral-xyz/anchor";
const { BN, AnchorProvider, Program, Wallet, setProvider } = anchor;
```
Named imports (`import { BN } from "@coral-xyz/anchor"`) fail with tsx.
