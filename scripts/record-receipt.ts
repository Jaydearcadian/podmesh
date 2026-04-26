/**
 * scripts/record-receipt.ts
 *
 * Calls `record_receipt` on the deployed pod_factory program
 * (FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm) on Solana devnet.
 *
 * The Pod PDA must already exist (created by create-spend-pod.ts).
 * Pod PDA:  GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL
 * Owner:    2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ
 *
 * record_receipt(
 *   amount_lamports:  u64
 *   category_hash:   [u8; 32]
 *   slippage_bps:    u16
 *   oracle_attested: bool
 *   epoch:           u64
 *   receipt_hash:    [u8; 32]
 * )
 * Accounts: { pod (mut, PDA), owner (signer) }
 *
 * Run:
 *   npx tsx scripts/record-receipt.ts
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

import anchor from "@coral-xyz/anchor";
const { AnchorProvider, Program, Wallet, BN, setProvider } = anchor;

// ── Config ──────────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const DEVNET_RPC = "https://api.devnet.solana.com";
const POD_FACTORY_PROGRAM_ID = new PublicKey(
  "FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm"
);

const KEYPAIR_PATH =
  process.env.KEYPAIR ??
  resolve(REPO_ROOT, ".keys/podmesh-devnet-deployer.json");

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Same deterministic category-hash function used in create-spend-pod.ts
 * so the hash matches what's stored in pod.allowed_category_hashes.
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

/**
 * Build a 32-byte receipt hash from a string identifier.
 */
function receiptHashBytes(id: string): number[] {
  const buf = Buffer.alloc(32, 0);
  const src = Buffer.from(id, "utf8");
  for (let i = 0; i < src.length; i++) {
    buf[i % 32] ^= src[i];
  }
  return Array.from(buf);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== PodMesh Devnet E2E — record_receipt ===\n");

  // 1. Load keypair
  const keypairRaw = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")) as number[];
  const owner = Keypair.fromSecretKey(Uint8Array.from(keypairRaw));
  console.log("Owner / Payer:", owner.publicKey.toBase58());
  console.log("Keypair path: ", KEYPAIR_PATH);

  // 2. Connect
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const balance = await connection.getBalance(owner.publicKey);
  console.log("Balance:      ", (balance / LAMPORTS_PER_SOL).toFixed(6), "SOL");

  if (balance < 0.005 * LAMPORTS_PER_SOL) {
    throw new Error(
      "Insufficient balance — need at least 0.005 SOL.\n" +
        "Run: solana airdrop 1 " + owner.publicKey.toBase58() + " --url devnet"
    );
  }

  // 3. Load IDL
  const idlPath = resolve(REPO_ROOT, "target/idl/pod_factory.json");
  const idl = JSON.parse(readFileSync(idlPath, "utf8"));

  // 4. Build Anchor provider + program
  const wallet = new Wallet(owner);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  setProvider(provider);
  const program = new Program(idl, provider) as any;

  // 5. Derive Pod PDA
  const [podPDA, podBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("pod"), owner.publicKey.toBuffer()],
    POD_FACTORY_PROGRAM_ID
  );
  console.log("\nPod PDA:     ", podPDA.toBase58());
  console.log("Pod bump:    ", podBump);

  // 6. Verify pod exists and decode state
  const podInfo = await connection.getAccountInfo(podPDA);
  if (podInfo === null) {
    throw new Error(
      "Pod account does not exist. Run scripts/create-spend-pod.ts first."
    );
  }
  console.log("\n[INFO] Pod account exists (data length:", podInfo.data.length, "bytes)");

  let podState: any;
  try {
    podState = await program.account.spendPod.fetch(podPDA);
    console.log("\nCurrent pod state:");
    console.log("  owner:                ", podState.owner?.toBase58?.() ?? podState.owner);
    console.log("  maxPerTxLamports:     ", podState.maxPerTxLamports?.toString());
    console.log("  maxPerEpochLamports:  ", podState.maxPerEpochLamports?.toString());
    console.log("  epochSpentLamports:   ", podState.epochSpentLamports?.toString());
    console.log("  slippageBps:          ", podState.slippageBps);
    console.log("  requireDeliveryOracle:", podState.requireDeliveryOracle);
    console.log("  receiptCount:         ", podState.receiptCount?.toString());
    console.log("  lastEpoch:            ", podState.lastEpoch?.toString());
    console.log("  expiryTs:             ", podState.expiryTs?.toString());
    console.log("  allowedCategoryHashes:", podState.allowedCategoryHashes?.length, "entries");
  } catch (e) {
    console.log("  (could not decode pod state:", (e as Error).message, ")");
    throw e;
  }

  // 7. Build instruction args
  //
  // record_receipt args:
  //   amount_lamports: u64   — must be <= maxPerTxLamports (50_000_000 = 0.05 SOL)
  //   category_hash:   [u8;32] — must be in pod.allowed_category_hashes
  //   slippage_bps:    u16   — must be <= pod.slippage_bps (150)
  //   oracle_attested: bool  — must be true if pod.require_delivery_oracle (it's false)
  //   epoch:           u64   — current epoch (use Solana Clock epoch)
  //   receipt_hash:    [u8;32] — unique receipt identifier

  // Use the same category hash as was stored during create_spend_pod
  const CATEGORY_LABEL = "grocery:general";
  const CATEGORY_HASH = categoryHashBytes(CATEGORY_LABEL);

  // Use a small amount well under the 0.05 SOL cap
  const AMOUNT_LAMPORTS = new BN(1_000_000); // 0.001 SOL

  // Slippage at 100bps which is <= 150bps cap
  const SLIPPAGE_BPS = 100;

  // oracle_attested = false since require_delivery_oracle = false
  const ORACLE_ATTESTED = false;

  // Get current epoch from the cluster
  const epochInfo = await connection.getEpochInfo();
  const EPOCH = new BN(epochInfo.epoch);

  // Unique receipt hash from timestamp
  const receiptId = `receipt:${Date.now()}`;
  const RECEIPT_HASH = receiptHashBytes(receiptId);

  console.log("\nInstruction args:");
  console.log(
    "  amountLamports:  ",
    AMOUNT_LAMPORTS.toString(),
    "lamports (",
    (AMOUNT_LAMPORTS.toNumber() / LAMPORTS_PER_SOL).toFixed(6),
    "SOL )"
  );
  console.log(
    "  categoryHash:    ",
    Buffer.from(CATEGORY_HASH).toString("hex").slice(0, 16) + "... (" + CATEGORY_LABEL + ")"
  );
  console.log("  slippageBps:     ", SLIPPAGE_BPS);
  console.log("  oracleAttested:  ", ORACLE_ATTESTED);
  console.log("  epoch:           ", EPOCH.toString(), "(devnet epoch)");
  console.log(
    "  receiptHash:     ",
    Buffer.from(RECEIPT_HASH).toString("hex").slice(0, 16) + "... (" + receiptId + ")"
  );

  // 8. Send transaction
  console.log("\nSending record_receipt transaction...");

  let signature: string;
  try {
    signature = await program.methods
      .recordReceipt(
        AMOUNT_LAMPORTS,
        CATEGORY_HASH,
        SLIPPAGE_BPS,
        ORACLE_ATTESTED,
        EPOCH,
        RECEIPT_HASH
      )
      .accounts({
        pod: podPDA,
        owner: owner.publicKey,
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

  console.log("\n✓ record_receipt succeeded!");
  console.log("  Signature:", signature);
  console.log(
    "  Explorer:  https://explorer.solana.com/tx/" + signature + "?cluster=devnet"
  );

  // 9. Verify updated pod state
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const newState = await program.account.spendPod.fetch(podPDA);
    console.log("\n✓ Pod state after record_receipt:");
    console.log("  receiptCount:       ", newState.receiptCount?.toString());
    console.log("  epochSpentLamports: ", newState.epochSpentLamports?.toString());
    console.log("  lastEpoch:          ", newState.lastEpoch?.toString());
  } catch (e) {
    console.log("  (pod fetch failed:", (e as Error).message, ")");
  }

  return { podPDA, signature };
}

main()
  .then(({ podPDA, signature }) => {
    console.log("\n=== RESULT ===");
    console.log(
      JSON.stringify(
        {
          instruction: "record_receipt",
          program: "FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm",
          podPDA: podPDA.toBase58(),
          signature,
          network: "devnet",
          explorerTx: "https://explorer.solana.com/tx/" + signature + "?cluster=devnet",
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
