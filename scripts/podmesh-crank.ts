import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ConnectionMagicRouter,
  createCommitInstruction,
} from "@magicblock-labs/ephemeral-rollups-sdk";

const MAGIC_ROUTER_DEVNET = process.env.MAGIC_ROUTER_DEVNET ?? "https://devnet-router.magicblock.app";
const SOLANA_DEVNET = process.env.SOLANA_DEVNET ?? "https://api.devnet.solana.com";

function bytes32(hexOrText: string) {
  const cleaned = hexOrText.startsWith("0x") ? hexOrText.slice(2) : hexOrText;
  if (/^[0-9a-fA-F]{64}$/.test(cleaned)) return Buffer.from(cleaned, "hex");
  return Buffer.from(cleaned.padEnd(32, "0")).subarray(0, 32);
}

async function main() {
  const pod = process.env.POD_ACCOUNT;
  const payerSecret = process.env.PAYER_SECRET_JSON;
  if (!pod || !payerSecret) {
    throw new Error("Set POD_ACCOUNT and PAYER_SECRET_JSON to run the live crank.");
  }
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(payerSecret)));
  const podPubkey = new PublicKey(pod);
  const router = new ConnectionMagicRouter(MAGIC_ROUTER_DEVNET, "confirmed");
  const base = new Connection(SOLANA_DEVNET, "confirmed");
  const epoch = BigInt(Math.floor(Date.now() / 300_000));
  const merkleRoot = bytes32(process.env.MERKLE_ROOT ?? `podmesh-${epoch}`);
  const tx = new Transaction().add(createCommitInstruction(payer.publicKey, [podPubkey]));
  tx.add(
    new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [],
      data: Buffer.from(`PODMESH_CRANK:${epoch}:${merkleRoot.toString("hex")}`),
    }),
  );
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await router.getLatestBlockhashForTransaction(tx)).blockhash;
  tx.sign(payer);
  const sig = await router.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  await base.confirmTransaction(sig, "confirmed");
  console.log(JSON.stringify({ signature: sig, epoch: epoch.toString(), pod }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
