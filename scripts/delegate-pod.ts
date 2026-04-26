/**
 * scripts/delegate-pod.ts
 *
 * Attempts to call `delegate_pod` on the deployed pod_factory program
 * (FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm) on Solana devnet.
 *
 * This calls the Anchor instruction which internally CPIs into the
 * MagicBlock delegation program (DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh).
 *
 * delegate_pod(validator: Pubkey)
 * Accounts:
 *   pod              — writable PDA (seeds=[b"pod", owner])
 *   owner            — mut signer
 *   owner_program    — pod_factory program ID
 *   buffer           — PDA: [b"buffer", pod.key()] under pod_factory
 *   delegation_record    — PDA: [b"delegation", pod.key()] under delegation_program
 *   delegation_metadata  — PDA: [b"delegation-metadata", pod.key()] under delegation_program
 *   delegation_program   — DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh
 *   system_program       — 11111111...
 *
 * KNOWN BLOCKER: The MagicBlock delegation program requires the PDA being
 * delegated to sign the transaction. Since a PDA can only sign via CPI from
 * its owning program (pod_factory), the on-chain CPI delegation path in
 * delegate_pod IS the correct approach. However, the delegation program on
 * devnet requires the PDA escrow account to be pre-funded (top-up escrow)
 * before delegation is accepted.
 *
 * Run:
 *   npx tsx scripts/delegate-pod.ts
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
const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);
// MagicBlock default validator on devnet
const DEFAULT_VALIDATOR = new PublicKey(
  "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"
);

const KEYPAIR_PATH =
  process.env.KEYPAIR ??
  resolve(REPO_ROOT, ".keys/podmesh-devnet-deployer.json");

// ── PDA derivation helpers (from @magicblock-labs/ephemeral-rollups-sdk pda.js) ──

function delegateBufferPda(podPubkey: PublicKey, ownerProgram: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("buffer"), podPubkey.toBytes()],
    ownerProgram
  )[0];
}

function delegationRecordPda(podPubkey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation"), podPubkey.toBytes()],
    DELEGATION_PROGRAM_ID
  )[0];
}

function delegationMetadataPda(podPubkey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("delegation-metadata"), podPubkey.toBytes()],
    DELEGATION_PROGRAM_ID
  )[0];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== PodMesh Devnet E2E — delegate_pod ===\n");

  // 1. Load keypair
  const keypairRaw = JSON.parse(readFileSync(KEYPAIR_PATH, "utf8")) as number[];
  const owner = Keypair.fromSecretKey(Uint8Array.from(keypairRaw));
  console.log("Owner / Payer:", owner.publicKey.toBase58());
  console.log("Keypair path: ", KEYPAIR_PATH);

  // 2. Connect
  const connection = new Connection(DEVNET_RPC, "confirmed");
  const balance = await connection.getBalance(owner.publicKey);
  console.log("Balance:      ", (balance / LAMPORTS_PER_SOL).toFixed(6), "SOL");

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
  const [podPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("pod"), owner.publicKey.toBuffer()],
    POD_FACTORY_PROGRAM_ID
  );
  console.log("\nPod PDA:            ", podPDA.toBase58());

  // 6. Derive all delegation accounts
  const bufferPDA = delegateBufferPda(podPDA, POD_FACTORY_PROGRAM_ID);
  const delegationRecordPDA = delegationRecordPda(podPDA);
  const delegationMetadataPDA = delegationMetadataPda(podPDA);

  console.log("Buffer PDA:         ", bufferPDA.toBase58());
  console.log("DelegationRecord:   ", delegationRecordPDA.toBase58());
  console.log("DelegationMetadata: ", delegationMetadataPDA.toBase58());
  console.log("DelegationProgram:  ", DELEGATION_PROGRAM_ID.toBase58());
  console.log("Validator:          ", DEFAULT_VALIDATOR.toBase58());

  // 7. Check if delegation program is deployed on devnet
  const delegProgInfo = await connection.getAccountInfo(DELEGATION_PROGRAM_ID);
  if (delegProgInfo === null) {
    console.log("\n[BLOCKER] Delegation program NOT found on devnet at", DELEGATION_PROGRAM_ID.toBase58());
    console.log("  This is the primary blocker: DELeGG program must be deployed on devnet.");
    return { podPDA, signature: null, blocker: "DELEGATION_PROGRAM_NOT_ON_DEVNET" };
  }
  console.log("\n[INFO] Delegation program found on devnet (executable:", delegProgInfo.executable, ")");

  // 8. Attempt the CPI-based delegate_pod call via pod_factory Anchor instruction
  console.log("\nSending delegate_pod transaction...");
  console.log("(This CPIs into pod_factory which then CPIs into the delegation program)");

  let signature: string;
  try {
    signature = await program.methods
      .delegatePod(DEFAULT_VALIDATOR)
      .accounts({
        pod: podPDA,
        owner: owner.publicKey,
        ownerProgram: POD_FACTORY_PROGRAM_ID,
        buffer: bufferPDA,
        delegationRecord: delegationRecordPDA,
        delegationMetadata: delegationMetadataPDA,
        delegationProgram: DELEGATION_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([owner])
      .rpc();

    console.log("\n✓ delegate_pod succeeded!");
    console.log("  Signature:", signature);
    console.log(
      "  Explorer:  https://explorer.solana.com/tx/" + signature + "?cluster=devnet"
    );
    return { podPDA, signature, blocker: null };
  } catch (err: unknown) {
    console.error("\n[ERROR] delegate_pod failed:");
    const e = err as { logs?: string[]; message?: string };
    if (e.logs) {
      console.error("  Program logs:");
      e.logs.forEach((line) => console.error("   ", line));
    }
    if (e.message) console.error("  Message:", e.message);

    return {
      podPDA,
      signature: null,
      blocker: e.message ?? "UNKNOWN",
    };
  }
}

main()
  .then(({ podPDA, signature, blocker }) => {
    console.log("\n=== RESULT ===");
    console.log(
      JSON.stringify(
        {
          instruction: "delegate_pod",
          program: "FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm",
          delegationProgram: "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh",
          podPDA: podPDA.toBase58(),
          signature,
          blocker,
          network: "devnet",
          explorerTx: signature
            ? "https://explorer.solana.com/tx/" + signature + "?cluster=devnet"
            : null,
        },
        null,
        2
      )
    );
    process.exit(signature ? 0 : 1);
  })
  .catch((err) => {
    console.error("\n[FATAL]", err);
    process.exit(1);
  });
