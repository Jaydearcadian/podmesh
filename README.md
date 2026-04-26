# PodMesh

PodMesh is a MagicBlock hackathon MVP for policy-bound autonomous payments.

The repo contains:

- Multi-page React frontend for Pod creation, agent execution, receipts, settlement, and architecture.
- Live Solana devnet wallet transaction paths.
- MagicBlock Router integration via `@magicblock-labs/ephemeral-rollups-sdk`.
- MagicBlock delegation, commit, and commit-and-undelegate instruction builders.
- Anchor program sources for `pod_factory` and `settlement`.
- Crank script for committing a Pod account through Magic Router.

## Live stack

- Solana devnet: `https://api.devnet.solana.com`
- MagicBlock devnet router: `https://devnet-router.magicblock.app`
- MagicBlock delegation program: `DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`
- Devnet ER validator: `MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57`

## Frontend

```bash
npm install
npm run dev
```

Open the app, connect a devnet-funded browser wallet, then:

1. Check Magic Router status.
2. Anchor a Pod policy on Solana devnet.
3. Attempt MagicBlock delegation for the Pod PDA.
4. Execute BillPay or OTC intents through the Magic Router.
5. Settle an epoch through the Magic Router.

## Programs

Solana, Rust, and Anchor are required:

```bash
anchor build
anchor deploy --provider.cluster devnet
```

The program sources are in:

- `programs/pod_factory/src/lib.rs`
- `programs/settlement/src/lib.rs`

`pod_factory` defines immutable spend policies, receipt recording, and MagicBlock delegation/commit entrypoints.

`settlement` records epoch Merkle roots, total volume, receipt counts, and crank/treasury fee split.

## Crank

```bash
POD_ACCOUNT=<pod-pda> \
PAYER_SECRET_JSON='[1,2,...]' \
MERKLE_ROOT=<hex-root> \
npx tsx scripts/podmesh-crank.ts
```

## Hackathon pitch

PodMesh lets a user safely give an autonomous agent spending power without giving it wallet-draining authority. Funds sit in a Pod with immutable policy limits. The agent can pay bills or execute OTC/RFQ payments through MagicBlock’s real-time router, but over-limit, wrong-category, high-slippage, or missing-oracle payments are rejected before signing. Epoch receipts are committed back to Solana by a crank.
