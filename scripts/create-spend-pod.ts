/**
 * scripts/create-spend-pod.ts
 *
 * Minimal E2E test script for PodMesh devnet deployment.
 *
 * Calls the `create_spend_pod` instruction on the deployed pod_factory program
 * (FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm) on Solana devnet.
 *
 * PDA seeds from IDL: ["pod", owner_pubkey]
 *
 * Run:
 *   npx tsx scripts/create-spend-pod.ts
 *   KEYPAIR=/path/to/other.json npx tsx scripts/create-spend-pod.ts
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  TransactionInstruction,
  Transaction,
} from "@solana/web3.js";

// Anchor is a CJS module — import the namespace and extract what we need
import anchor from "@coral-xyz/anchor";
const { AnchorProvider, Program, Wallet, BN, setProvider } = anchor;

// ── Config ─────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEVNET_RPC = "https://api.devnet.solana.com";
const POD_FACTORY_PROGRAM_ID = new PublicKey(
  "FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm"
);
const SETTLEMENT_PROGRAM_ID = new PublicKey(
  "A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc"
);

// Load keypair — defaults to the burner keypair
const KEYPAIR_PATH =
  process.env.KEYPAIR ??
  resolve(REPO_ROOT, ".keys/podmesh-devnet-deployer.json");

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a deterministic 32-byte category hash from a label string.
 * In production this would match the oracle's hashing scheme exactly.
 */
function categoryHashBytes(label: string): number[] {
  const buf = Buffer.alloc(32, 0);
  const src = Buffer.from(label, "utf8");
  for (let i = 0; i < src.length; i++) {
    buf[i % 32] ^= src[i];
  }
  for (let i = 0; i < 32; i++) {
    buf[(i + 7) % 32] ^= buf[i] ^ ((i * 31 + 17) & 0xff);
  }
  return Array.from(buf);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== PodMesh Devnet E2E — create_spend_pod ===\n");

  // 1. Load keypair
  const keypairRaw = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")) as number[];
  const owner = Keypair.fromSecretKey(Uint8Array.from(keypairRaw));
  console.log("Owner / Payer:", owner.publicKey.toBase58());
  console.log("Keypair path: ", KEYPAIR_PATH);

  // 2. Connect
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const balance = await connection.getBalance(owner.publicKey);
  console.log("Balance:      ", (balance / LAMPORTS_PER_SOL).toFixed(6), "SOL");

  if (balance < 0.01 * LAMPORTS_PER_SOL) {
    throw new Error(
      "Insufficient balance — need at least 0.01 SOL.\n" +
        "Run: solana airdrop 1 " + owner.publicKey.toBase58() + " --url devnet"
    );
  }

  // 3. Load IDL
  const idlPath = resolve(REPO_ROOT, "target/idl/pod_factory.json");
  const idl = JSON.parse(readFileSync(idlPath, "utf8"));

  // 4. Build Anchor provider + program (typed as any to avoid strict IDL typing issues)
  const wallet = new Wallet(owner);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  setProvider(provider);
  const program = new Program(idl, provider) as any;

  // 5. Derive Pod PDA — seeds: [b"pod", owner_pubkey]
  const [podPDA, podBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pod"), owner.publicKey.toBuffer()],
    POD_FACTORY_PROGRAM_ID
  );
  console.log("\nPod PDA:     ", podPDA.toBase58());
  console.log("Pod bump:    ", podBump);
  console.log(
    "Explorer:     https://explorer.solana.com/address/" +
      podPDA.toBase58() +
      "?cluster=devnet"
  );

  // 6. Check if pod already exists
  const existingPod = await connection.getAccountInfo(podPDA);
  if (existingPod !== null) {
    console.log(
      "\n[INFO] Pod account already exists (data length:" + existingPod.data.length + " bytes)."
    );
    console.log("  Owner program:", existingPod.owner.toBase58());

    try {
      const podState = await program.account.spendPod.fetch(podPDA);
      console.log("\nExisting pod state:");
      console.log("  owner:                ", podState.owner?.toBase58?.() ?? podState.owner);
      console.log("  maxPerTxLamports:     ", podState.maxPerTxLamports?.toString());
      console.log("  maxPerEpochLamports:  ", podState.maxPerEpochLamports?.toString());
      console.log("  expiryTs:             ", podState.expiryTs?.toString());
      console.log("  slippageBps:          ", podState.slippageBps);
      console.log("  requireDeliveryOracle:", podState.requireDeliveryOracle);
      console.log("  receiptCount:         ", podState.receiptCount?.toString());
    } catch (e) {
      console.log("  (could not decode pod state:", (e as Error).message, ")");
    }

    return { podPDA, signature: null, alreadyExisted: true };
  }

  // 7. Build instruction args
  //
  // create_spend_pod(
  //   max_per_tx_lamports:     u64   — max lamports per single transaction
  //   max_per_epoch_lamports:  u64   — max lamports per epoch
  //   allowed_category_hashes: Vec<[u8;32]> — allowlist of 32-byte category hashes
  //   expiry_ts:               i64   — unix timestamp when pod expires
  //   slippage_bps:            u16   — max slippage in basis points
  //   require_delivery_oracle: bool  — whether oracle attestation is required
  // )
  //
  // Realistic values for a food/grocery spend pod:

  const MAX_PER_TX_LAMPORTS = new BN(Math.floor(0.05 * LAMPORTS_PER_SOL)); // 0.05 SOL per tx
  const MAX_PER_EPOCH_LAMPORTS = new BN(Math.floor(1.0 * LAMPORTS_PER_SOL)); // 1 SOL per epoch
  const ALLOWED_CATEGORY_HASHES = [
    categoryHashBytes("grocery:general"),
    categoryHashBytes("food_delivery:restaurant"),
    categoryHashBytes("grocery:pharmacy"),
  ];
  const EXPIRY_TS = new BN(Math.floor(Date.now() / 1000) + 90 * 24 * 3600); // 90 days
  const SLIPPAGE_BPS = 150; // 1.5%
  const REQUIRE_DELIVERY_ORACLE = false;

  console.log("\nInstruction args:");
  console.log(
    "  maxPerTxLamports:     ",
    MAX_PER_TX_LAMPORTS.toString(),
    "lamports (",
    (MAX_PER_TX_LAMPORTS.toNumber() / LAMPORTS_PER_SOL).toFixed(4),
    "SOL )"
  );
  console.log(
    "  maxPerEpochLamports:  ",
    MAX_PER_EPOCH_LAMPORTS.toString(),
    "lamports (",
    (MAX_PER_EPOCH_LAMPORTS.toNumber() / LAMPORTS_PER_SOL).toFixed(4),
    "SOL )"
  );
  console.log(
    "  allowedCategoryHashes:",
    ALLOWED_CATEGORY_HASHES.length,
    "categories"
  );
  ALLOWED_CATEGORY_HASHES.forEach((h, i) => {
    const labels = ["grocery:general", "food_delivery:restaurant", "grocery:pharmacy"];
    console.log(
      `    [${i}] ${labels[i].padEnd(28)} ${Buffer.from(h).toString("hex").slice(0, 16)}...`
    );
  });
  console.log("  expiryTs:             ", EXPIRY_TS.toString(), "(90 days)");
  console.log("  slippageBps:          ", SLIPPAGE_BPS, "(1.5%)");
  console.log("  requireDeliveryOracle:", REQUIRE_DELIVERY_ORACLE);

  // 8. Send transaction
  console.log("\nSending create_spend_pod transaction...");

  let signature: string;
  try {
    signature = await program.methods
      .createSpendPod(
        MAX_PER_TX_LAMPORTS,
        MAX_PER_EPOCH_LAMPORTS,
        ALLOWED_CATEGORY_HASHES,
        EXPIRY_TS,
        SLIPPAGE_BPS,
        REQUIRE_DELIVERY_ORACLE
      )
      .accounts({
        pod: podPDA,
        owner: owner.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();
  } catch (err: unknown) {
    console.error("\n[ERROR] Transaction failed:");
    const e = err as { logs?: string[]; message?: string };
    if (e.logs) {
      console.error("  Program logs:");
      e.logs.forEach((line) => console.error("   ", line));
    }
    if (e.message) console.error("  Message:", e.message);
    throw err;
  }

  console.log("\n✓ create_spend_pod succeeded!");
  console.log("  Signature:", signature);
  console.log(
    "  Explorer:  https://explorer.solana.com/tx/" + signature + "?cluster=devnet"
  );

  // 9. Verify pod account on-chain
  await new Promise((r) => setTimeout(r, 2500));
  let podState: any;
  try {
    podState = await program.account.spendPod.fetch(podPDA);
    console.log("\n✓ Pod account verified on-chain:");
    console.log("  PDA:                  ", podPDA.toBase58());
    console.log("  owner:                ", podState.owner?.toBase58?.() ?? podState.owner);
    console.log("  maxPerTxLamports:     ", podState.maxPerTxLamports?.toString());
    console.log("  maxPerEpochLamports:  ", podState.maxPerEpochLamports?.toString());
    console.log("  expiryTs:             ", podState.expiryTs?.toString());
    console.log("  slippageBps:          ", podState.slippageBps);
    console.log("  requireDeliveryOracle:", podState.requireDeliveryOracle);
    console.log("  receiptCount:         ", podState.receiptCount?.toString());
  } catch (e) {
    console.log("  (pod fetch after create failed:", (e as Error).message, ")");
  }

  return { podPDA, signature, alreadyExisted: false };
}

main()
  .then(({ podPDA, signature, alreadyExisted }) => {
    console.log("\n=== RESULT ===");
    console.log(
      JSON.stringify(
        {
          program: "FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm",
          settlement: "A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc",
          podPDA: podPDA.toBase58(),
          signature,
          alreadyExisted,
          network: "devnet",
          explorerTx: signature
            ? "https://explorer.solana.com/tx/" + signature + "?cluster=devnet"
            : null,
          explorerPDA:
            "https://explorer.solana.com/address/" + podPDA.toBase58() + "?cluster=devnet",
        },
        null,
        2
      )
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n[FATAL]", err);
    process.exit(1);
  });
