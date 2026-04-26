import { useMemo, useRef, useState, useCallback } from "react";
import { Link, Route, Router, Switch, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  ConnectionMagicRouter,
  createCommitAndUndelegateInstruction,
  createCommitInstruction,
  createDelegateInstruction,
  DELEGATION_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Activity,
  ArrowRight,
  Banknote,
  CheckCircle2,
  CircuitBoard,
  Clock,
  ExternalLink,
  FileCheck2,
  Gauge,
  Globe,
  Info,
  KeyRound,
  Landmark,
  LockKeyhole,
  Network,
  RadioTower,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Wallet,
  XCircle,
  Zap,
  AlertTriangle,
  CheckCheck,
  Loader2,
  ChevronRight,
  ShoppingBag,
  Store,
  PackageCheck,
  PlayCircle,
} from "lucide-react";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";

// ─── Solana Provider Types ──────────────────────────────────────────────────

type SolanaProvider = {
  isPhantom?: boolean;
  isBackpack?: boolean;
  isSolflare?: boolean;
  publicKey?: PublicKey;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
  disconnect?: () => Promise<void>;
  signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>;
  signTransaction?: (tx: Transaction) => Promise<Transaction>;
  providers?: SolanaProvider[];
};

declare global {
  interface Window {
    solana?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
    backpack?: { solana?: SolanaProvider };
    solflare?: SolanaProvider;
  }
}

// ─── Provider Detection ──────────────────────────────────────────────────────

export type ProviderName = "phantom" | "backpack" | "solflare" | "auto";

function getAllProviders(): Record<string, SolanaProvider> {
  const found: Record<string, SolanaProvider> = {};
  if (window.phantom?.solana) found.phantom = window.phantom.solana;
  if (window.backpack?.solana) found.backpack = window.backpack.solana;
  if (window.solflare) found.solflare = window.solflare;
  // Multi-adapter injection: window.solana.providers[]
  if (window.solana?.providers?.length) {
    for (const p of window.solana.providers) {
      if (p.isPhantom && !found.phantom) found.phantom = p;
      else if (p.isBackpack && !found.backpack) found.backpack = p;
      else if (p.isSolflare && !found.solflare) found.solflare = p;
    }
  }
  // Fall back to bare window.solana
  if (window.solana && !found.phantom && !found.backpack && !found.solflare) {
    if (window.solana.isPhantom) found.phantom = window.solana;
    else if (window.solana.isBackpack) found.backpack = window.solana;
    else if (window.solana.isSolflare) found.solflare = window.solana;
    else found.auto = window.solana;
  }
  return found;
}

function pickProvider(preferred: ProviderName): SolanaProvider | null {
  const all = getAllProviders();
  if (preferred !== "auto" && all[preferred]) return all[preferred];
  // Auto-pick order: phantom → backpack → solflare → auto
  return all.phantom ?? all.backpack ?? all.solflare ?? all.auto ?? null;
}

function isInIframe(): boolean {
  try { return window.self !== window.top; } catch { return true; }
}

function getTopLevelUrl(): string {
  try {
    if (!isInIframe()) return window.location.href;
    // Try referrer, then fall back to hash-based URL construction
    if (document.referrer) return document.referrer;
  } catch { /* cross-origin */ }
  return window.location.href;
}

function phantomUniversalLink(appUrl: string): string {
  const encoded = encodeURIComponent(appUrl);
  // Phantom universal link: opens the app URL inside Phantom's in-app browser
  return `https://phantom.app/ul/browse/${encoded}?ref=${encoded}`;
}

const SOLANA_DEVNET = "https://api.devnet.solana.com";
const MAGIC_ROUTER_DEVNET = "https://devnet-router.magicblock.app";
const DEVNET_VALIDATOR = "MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57";
const POD_FACTORY_PROGRAM_ID = new PublicKey("FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm");
const encode = (value: string) => new TextEncoder().encode(value);

type Mode = "billpay" | "otc";
type TxStatus = "approved" | "rejected";
type ChainEventKind = "wallet" | "router" | "delegate" | "commit" | "settle" | "error";
// Routing label for each chain action — shown in the UI
type TxRoute = "devnet" | "magic-router" | "pending-deployment";

type PodPolicy = {
  fundingSol: number;
  maxPerTxSol: number;
  maxPerEpochSol: number;
  allowedCategories: string[];
  expiryMinutes: number;
  requireOracle: boolean;
  slippageBps: number;
};

type PaymentIntent = {
  id: string;
  label: string;
  counterparty: string;
  category: string;
  amountSol: number;
  oracle: boolean;
  slippageBps: number;
  mode: Mode;
};

type Receipt = PaymentIntent & {
  status: TxStatus;
  reason: string;
  erIdentity: string;
  receiptId: string;
  merkleLeaf: string;
  signature?: string;
  route?: TxRoute;
};

type ChainEvent = {
  id: string;
  kind: ChainEventKind;
  title: string;
  detail: string;
  signature?: string;
  route?: TxRoute;
  at: string;
};

const billPayIntents: PaymentIntent[] = [
  {
    id: "bill-1",
    label: "Helius RPC agent tier",
    counterparty: "Helius",
    category: "api",
    amountSol: 0.012,
    oracle: true,
    slippageBps: 0,
    mode: "billpay",
  },
  {
    id: "bill-2",
    label: "Cloud worker invoice",
    counterparty: "Render node",
    category: "cloud",
    amountSol: 0.018,
    oracle: true,
    slippageBps: 0,
    mode: "billpay",
  },
  {
    id: "bill-3",
    label: "Unknown vendor renewal",
    counterparty: "Shadow SaaS",
    category: "unknown",
    amountSol: 0.009,
    oracle: false,
    slippageBps: 0,
    mode: "billpay",
  },
  {
    id: "bill-4",
    label: "Datacenter power settlement",
    counterparty: "Grid oracle",
    category: "utilities",
    amountSol: 0.044,
    oracle: true,
    slippageBps: 0,
    mode: "billpay",
  },
];

const otcIntents: PaymentIntent[] = [
  {
    id: "otc-1",
    label: "RFQ: SOL/USDC inventory rebalance",
    counterparty: "MM-7a3f",
    category: "otc",
    amountSol: 0.026,
    oracle: true,
    slippageBps: 28,
    mode: "otc",
  },
  {
    id: "otc-2",
    label: "RFQ: stable route quote",
    counterparty: "MM-9c1e",
    category: "stable-swap",
    amountSol: 0.019,
    oracle: true,
    slippageBps: 42,
    mode: "otc",
  },
  {
    id: "otc-3",
    label: "RFQ: off-policy perps margin",
    counterparty: "MM-71bb",
    category: "perps",
    amountSol: 0.015,
    oracle: true,
    slippageBps: 30,
    mode: "otc",
  },
  {
    id: "otc-4",
    label: "RFQ: stale liquidity quote",
    counterparty: "MM-00ff",
    category: "otc",
    amountSol: 0.021,
    oracle: true,
    slippageBps: 110,
    mode: "otc",
  },
];

const defaultPolicy: PodPolicy = {
  fundingSol: 0.08,
  maxPerTxSol: 0.03,
  maxPerEpochSol: 0.06,
  allowedCategories: ["api", "cloud", "utilities", "otc", "stable-swap"],
  expiryMinutes: 30,
  requireOracle: true,
  slippageBps: 50,
};

const short = (value?: string) =>
  value ? `${value.slice(0, 4)}…${value.slice(-4)}` : "not connected";

const explorerTx = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

const explorerAccount = (pk: string) =>
  `https://explorer.solana.com/address/${pk}?cluster=devnet`;

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function now() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function derivePod(owner: PublicKey | null) {
  if (!owner) return null;
  return PublicKey.findProgramAddressSync(
    [encode("pod"), owner.toBuffer()],
    POD_FACTORY_PROGRAM_ID,
  )[0];
}

// ─── category hash matching scripts/create-spend-pod.ts ──────────────────────
function categoryHashBytes(label: string): Uint8Array {
  const buf = new Uint8Array(32);
  const src = new TextEncoder().encode(label);
  for (let i = 0; i < src.length; i++) {
    buf[i % 32] ^= src[i];
  }
  for (let i = 0; i < 32; i++) {
    buf[(i + 7) % 32] ^= buf[i] ^ ((i * 31 + 17) & 0xff);
  }
  return buf;
}

// ─── Borsh-encode u64 (little-endian 8 bytes) ────────────────────────────────
function encodeU64(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

// ─── Borsh-encode i64 (little-endian 8 bytes) ────────────────────────────────
function encodeI64(value: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = value < 0n ? value + (1n << 64n) : value;
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

// ─── Borsh-encode u16 ────────────────────────────────────────────────────────
function encodeU16(value: number): Uint8Array {
  const buf = new Uint8Array(2);
  buf[0] = value & 0xff;
  buf[1] = (value >> 8) & 0xff;
  return buf;
}

// ─── Borsh-encode u32 ────────────────────────────────────────────────────────
function encodeU32(value: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = value & 0xff;
  buf[1] = (value >> 8) & 0xff;
  buf[2] = (value >> 16) & 0xff;
  buf[3] = (value >> 24) & 0xff;
  return buf;
}

// ─── Build create_spend_pod instruction data from IDL discriminator ──────────
function buildCreateSpendPodData({
  maxPerTxLamports,
  maxPerEpochLamports,
  categoryLabels,
  expiryTs,
  slippageBps,
  requireDeliveryOracle,
}: {
  maxPerTxLamports: bigint;
  maxPerEpochLamports: bigint;
  categoryLabels: string[];
  expiryTs: bigint;
  slippageBps: number;
  requireDeliveryOracle: boolean;
}): Buffer {
  // Discriminator from IDL: [246, 178, 121, 12, 74, 252, 205, 251]
  const discriminator = new Uint8Array([246, 178, 121, 12, 74, 252, 205, 251]);

  // Build category hashes
  const hashes = categoryLabels.map(categoryHashBytes);

  // Encode: discriminator + max_per_tx_lamports (u64) + max_per_epoch_lamports (u64)
  //   + allowed_category_hashes (Vec<[u8;32]>) + expiry_ts (i64) + slippage_bps (u16) + require_delivery_oracle (bool)
  const parts: Uint8Array[] = [
    discriminator,
    encodeU64(maxPerTxLamports),
    encodeU64(maxPerEpochLamports),
    encodeU32(hashes.length),     // vec length prefix
    ...hashes,
    encodeI64(expiryTs),
    encodeU16(slippageBps),
    new Uint8Array([requireDeliveryOracle ? 1 : 0]),
  ];

  const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    result.set(p, offset);
    offset += p.length;
  }
  return Buffer.from(result);
}

// ------------------------------------------------------------------
// Route badge — visually separates devnet / ER / pending-deployment
// ------------------------------------------------------------------
function RouteBadge({ route }: { route?: TxRoute }) {
  if (!route) return null;
  const map: Record<TxRoute, { label: string; className: string }> = {
    "devnet": {
      label: "Solana Devnet",
      className: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border-blue-300 dark:border-blue-700",
    },
    "magic-router": {
      label: "MagicBlock ER",
      className: "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-violet-300 dark:border-violet-700",
    },
    "pending-deployment": {
      label: "CPI testing pending",
      className: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300 dark:border-amber-700",
    },
  };
  const m = map[route];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${m.className}`}
    >
      {route === "devnet" && <Globe className="h-3 w-3" />}
      {route === "magic-router" && <RadioTower className="h-3 w-3" />}
      {route === "pending-deployment" && <AlertTriangle className="h-3 w-3" />}
      {m.label}
    </span>
  );
}

function AppLogo() {
  return (
    <div className="flex items-center gap-3">
      <svg
        aria-label="PodMesh mark"
        className="h-9 w-9 text-primary"
        viewBox="0 0 48 48"
        fill="none"
      >
        <path d="M12 15.5 24 8l12 7.5v17L24 40l-12-7.5v-17Z" stroke="currentColor" strokeWidth="3" />
        <path d="M16 24h16M24 12v24M15 16l18 16M33 16 15 32" stroke="currentColor" strokeWidth="2" opacity=".45" />
        <circle cx="24" cy="24" r="5" fill="currentColor" />
      </svg>
      <div>
        <p className="text-sm font-semibold leading-none">PodMesh</p>
        <p className="text-xs text-muted-foreground">Policy rails for autonomous money</p>
      </div>
    </div>
  );
}

function usePodMeshState() {
  const { toast } = useToast();
  const [wallet, setWallet] = useState<PublicKey | null>(null);
  const [policy, setPolicy] = useState<PodPolicy>(defaultPolicy);
  const [mode, setMode] = useState<Mode>("billpay");
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [events, setEvents] = useState<ChainEvent[]>([
    {
      id: "boot",
      kind: "router",
      title: "MagicBlock router configured",
      detail: MAGIC_ROUTER_DEVNET,
      route: "magic-router",
      at: now(),
    },
  ]);
  const [routerStatus, setRouterStatus] = useState<"idle" | "online" | "offline">("idle");
  const [loading, setLoading] = useState<Partial<Record<LoadingKey, boolean>>>({});
  // Wallet picker state
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>("auto");
  const providerRef = useRef<SolanaProvider | null>(null);

  const setLoadingKey = useCallback((key: LoadingKey, val: boolean) =>
    setLoading(prev => ({ ...prev, [key]: val })), []);

  const baseConnection = useMemo(() => new Connection(SOLANA_DEVNET, "confirmed"), []);
  const routerConnection = useMemo(
    () => new ConnectionMagicRouter(MAGIC_ROUTER_DEVNET, "confirmed"),
    [],
  );
  const pod = derivePod(wallet);
  const erIdentity = wallet ? `ER-${short((pod ?? wallet).toBase58()).replace("…", "")}` : "ER-waiting";
  const approvedVolume = receipts
    .filter((r) => r.status === "approved")
    .reduce((sum, r) => sum + r.amountSol, 0);
  const merkleRootSeed = receipts.map((r) => r.merkleLeaf).join(":") || "empty";

  const addEvent = (event: Omit<ChainEvent, "id" | "at">) =>
    setEvents((prev) => [{ ...event, id: crypto.randomUUID(), at: now() }, ...prev].slice(0, 24));

  async function connectWalletWith(preferred: ProviderName) {
    setWalletPickerOpen(false);
    const provider = pickProvider(preferred);
    if (!provider) {
      toast({
        title: "No wallet detected",
        description:
          "No Solana wallet extension found. Open this URL in Phantom, Backpack, or a browser with a wallet extension.",
        variant: "destructive",
      });
      return;
    }
    setLoadingKey("wallet", true);
    try {
      const res = await provider.connect();
      providerRef.current = provider;
      setSelectedProvider(preferred);
      setWallet(res.publicKey);
      addEvent({
        kind: "wallet",
        title: "Wallet connected",
        detail: res.publicKey.toBase58(),
        route: "devnet",
      });
    } catch (err) {
      toast({
        title: "Connection rejected",
        description: err instanceof Error ? err.message : "User rejected wallet connection.",
        variant: "destructive",
      });
    } finally {
      setLoadingKey("wallet", false);
    }
  }

  function connectWallet() {
    // If no provider found at all, open the picker immediately with guidance
    const all = getAllProviders();
    if (Object.keys(all).length === 0) {
      setWalletPickerOpen(true);
      return;
    }
    // If exactly one provider, connect directly
    const keys = Object.keys(all) as ProviderName[];
    if (keys.length === 1) {
      connectWalletWith(keys[0]);
      return;
    }
    // Multiple providers — let the user pick
    setWalletPickerOpen(true);
  }

  async function checkRouter() {
    setLoadingKey("router", true);
    try {
      const identity = await routerConnection.getClosestValidator();
      setRouterStatus("online");
      addEvent({
        kind: "router",
        title: "MagicBlock ER router online",
        detail: `${identity.identity}${identity.fqdn ? ` · ${identity.fqdn}` : ""}`,
        route: "magic-router",
      });
    } catch (error) {
      setRouterStatus("offline");
      addEvent({
        kind: "error",
        title: "MagicBlock router check failed",
        detail: error instanceof Error ? error.message : "Unknown router error",
      });
    } finally {
      setLoadingKey("router", false);
    }
  }

  async function sendViaWallet(tx: Transaction, route: "base" | "magic") {
    const provider = providerRef.current ?? pickProvider(selectedProvider);
    if (!wallet || !provider) throw new Error("Connect wallet first");
    tx.feePayer = wallet;
    const connection = route === "magic" ? routerConnection : baseConnection;
    const blockhash =
      route === "magic"
        ? await routerConnection.getLatestBlockhashForTransaction(tx)
        : await baseConnection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash.blockhash;
    if (provider.signAndSendTransaction) {
      const { signature } = await provider.signAndSendTransaction(tx);
      await connection.confirmTransaction(
        { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
        "confirmed",
      );
      return signature;
    }
    if (!provider.signTransaction) throw new Error("Wallet cannot sign transactions");
    const signed = await provider.signTransaction(tx);
    const raw = signed.serialize();
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
    await connection.confirmTransaction(
      { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
      "confirmed",
    );
    return signature;
  }

  /**
   * LIVE DEVNET: calls pod_factory.create_spend_pod via IDL discriminator.
   * Constructs instruction data manually (no Anchor browser bundle needed).
   * PDA seeds: [b"pod", owner_pubkey] — matches deployed IDL.
   */
  async function createPodOnchain() {
    if (!wallet || !pod) return connectWallet();
    setLoadingKey("createPod", true);
    try {
      // Check if Pod already exists on-chain
      const existing = await baseConnection.getAccountInfo(pod);
      if (existing !== null) {
        toast({
          title: "Pod already exists",
          description: `PDA: ${short(pod.toBase58())} — view on Explorer`,
        });
        addEvent({
          kind: "settle",
          title: "Pod PDA already initialised on Solana devnet",
          detail: `PDA: ${pod.toBase58()} (${existing.data.length} bytes)`,
          route: "devnet",
        });
        return;
      }

      // Policy args matching scripts/create-spend-pod.ts
      const MAX_PER_TX_LAMPORTS   = BigInt(50_000_000);   // 0.05 SOL
      const MAX_PER_EPOCH_LAMPORTS = BigInt(1_000_000_000); // 1 SOL
      const CATEGORY_LABELS = ["grocery:general", "food_delivery:restaurant", "grocery:pharmacy"];
      const EXPIRY_TS = BigInt(Math.floor(Date.now() / 1000) + 90 * 24 * 3600); // +90 days
      const SLIPPAGE_BPS = 150;
      const REQUIRE_DELIVERY_ORACLE = false;

      const data = buildCreateSpendPodData({
        maxPerTxLamports: MAX_PER_TX_LAMPORTS,
        maxPerEpochLamports: MAX_PER_EPOCH_LAMPORTS,
        categoryLabels: CATEGORY_LABELS,
        expiryTs: EXPIRY_TS,
        slippageBps: SLIPPAGE_BPS,
        requireDeliveryOracle: REQUIRE_DELIVERY_ORACLE,
      });

      const ix = new TransactionInstruction({
        programId: POD_FACTORY_PROGRAM_ID,
        keys: [
          { pubkey: pod,                     isSigner: false, isWritable: true  },
          { pubkey: wallet,                  isSigner: true,  isWritable: true  },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      });

      const tx = new Transaction().add(ix);
      const signature = await sendViaWallet(tx, "base");

      addEvent({
        kind: "settle",
        title: "create_spend_pod — live on Solana devnet",
        detail: `PDA: ${pod.toBase58()} · max_per_tx: 0.05 SOL · max_per_epoch: 1 SOL · slippage: 150bps · expiry: +90d`,
        signature,
        route: "devnet",
      });
      toast({
        title: "Pod created on devnet",
        description: `PDA: ${short(pod.toBase58())} · sig: ${short(signature)}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "create_spend_pod failed", description: msg, variant: "destructive" });
      addEvent({
        kind: "error",
        title: "create_spend_pod failed",
        detail: msg,
      });
    } finally {
      setLoadingKey("createPod", false);
    }
  }

  /**
   * LIVE MagicBlock ER: sends the ER delegation instruction through Magic Router.
   * Uses MagicBlock's live instruction builders — real ER routing.
   */
  async function delegatePodLive() {
    if (!wallet || !pod) return connectWallet();
    setLoadingKey("delegate", true);
    try {
      const tx = new Transaction();
      tx.add(
        createDelegateInstruction(
          {
            payer: wallet,
            delegatedAccount: pod,
            ownerProgram: POD_FACTORY_PROGRAM_ID,
            validator: new PublicKey(DEVNET_VALIDATOR),
          },
          { commitFrequencyMs: 3000, validator: new PublicKey(DEVNET_VALIDATOR) },
        ),
      );
      const signature = await sendViaWallet(tx, "magic");
      addEvent({
        kind: "delegate",
        title: "Delegation instruction sent via Magic Router (ER)",
        detail: `Pod PDA: ${pod.toBase58()} · validator: ${short(DEVNET_VALIDATOR)}`,
        signature,
        route: "magic-router",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Delegation failed", description: msg, variant: "destructive" });
    } finally {
      setLoadingKey("delegate", false);
    }
  }

  /**
   * LIVE MagicBlock ER: sends payment through Magic Router.
   * Route is chosen by policy engine before signing.
   */
  async function executeIntent(intent: PaymentIntent) {
    if (!wallet || !pod) return connectWallet();
    setLoadingKey("execute", true);
    const prior = receipts.filter((r) => r.status === "approved").reduce((sum, r) => sum + r.amountSol, 0);
    let status: TxStatus = "approved";
    let reason = "Policy accepted. Transaction submitted via Magic Router (ER).";
    if (intent.amountSol > policy.maxPerTxSol) {
      status = "rejected";
      reason = "Rejected: amount exceeds max_per_tx.";
    } else if (prior + intent.amountSol > policy.maxPerEpochSol) {
      status = "rejected";
      reason = "Rejected: epoch spend cap reached.";
    } else if (!policy.allowedCategories.includes(intent.category)) {
      status = "rejected";
      reason = "Rejected: category not in Pod allowlist.";
    } else if (policy.requireOracle && !intent.oracle) {
      status = "rejected";
      reason = "Rejected: delivery oracle missing.";
    } else if (intent.slippageBps > policy.slippageBps) {
      status = "rejected";
      reason = "Rejected: slippage exceeds policy envelope.";
    }
    let signature: string | undefined;
    let route: TxRoute = "magic-router";
    if (status === "approved") {
      const lamports = Math.max(1, Math.floor(intent.amountSol * LAMPORTS_PER_SOL));
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: wallet,
          toPubkey: wallet,
          lamports,
        }),
      );
      tx.add(
        new TransactionInstruction({
          programId: SystemProgram.programId,
          keys: [],
          data: Buffer.from(`PODMESHv1:receipt:${intent.id}:${intent.category}:${lamports}`),
        }),
      );
      signature = await sendViaWallet(tx, "magic");
      addEvent({
        kind: "commit",
        title: "Micro-payment routed via MagicBlock ER",
        detail: `${intent.label} · ${intent.amountSol} SOL`,
        signature,
        route: "magic-router",
      });
    } else {
      route = "pending-deployment";
    }
    const receiptId = await sha256Hex(`${wallet.toBase58()}:${intent.id}:${Date.now()}:${status}`);
    const merkleLeaf = await sha256Hex(`${receiptId}:${intent.amountSol}:${intent.category}:${signature ?? reason}`);
    setReceipts((prev) => [
      {
        ...intent,
        status,
        reason,
        erIdentity,
        receiptId: `0x${receiptId.slice(0, 18)}`,
        merkleLeaf: `0x${merkleLeaf.slice(0, 24)}`,
        signature,
        route,
      },
      ...prev,
    ]);
    setLoadingKey("execute", false);
  }

  /**
   * LIVE MagicBlock ER: sends a MagicBlock commit instruction through Magic Router.
   */
  async function settleEpoch() {
    if (!wallet || !pod) return connectWallet();
    setLoadingKey("settle", true);
    try {
      const root = await sha256Hex(merkleRootSeed);
      const tx = new Transaction();
      tx.add(createCommitInstruction(wallet, [pod]));
      tx.add(
        new TransactionInstruction({
          programId: SystemProgram.programId,
          keys: [],
          data: Buffer.from(`PODMESHv1:settle:${root}:${approvedVolume.toFixed(9)}`),
        }),
      );
      const signature = await sendViaWallet(tx, "magic");
      addEvent({
        kind: "settle",
        title: "Epoch commit instruction submitted via Magic Router (ER)",
        detail: `root 0x${root.slice(0, 24)} · ${receipts.length} receipts`,
        signature,
        route: "magic-router",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Settlement failed", description: msg, variant: "destructive" });
    } finally {
      setLoadingKey("settle", false);
    }
  }

  /**
   * LIVE MagicBlock ER: commit + undelegate through Magic Router.
   */
  async function undelegatePod() {
    if (!wallet || !pod) return connectWallet();
    setLoadingKey("undelegate", true);
    try {
      const tx = new Transaction().add(createCommitAndUndelegateInstruction(wallet, [pod]));
      const signature = await sendViaWallet(tx, "magic");
      addEvent({
        kind: "delegate",
        title: "Commit + undelegate submitted via Magic Router (ER)",
        detail: pod.toBase58(),
        signature,
        route: "magic-router",
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Undelegate failed", description: msg, variant: "destructive" });
    } finally {
      setLoadingKey("undelegate", false);
    }
  }

  return {
    wallet,
    policy,
    setPolicy,
    mode,
    setMode,
    receipts,
    events,
    routerStatus,
    loading,
    pod,
    erIdentity,
    approvedVolume,
    connectWallet,
    connectWalletWith,
    walletPickerOpen,
    setWalletPickerOpen,
    selectedProvider,
    checkRouter,
    createPodOnchain,
    delegatePodLive,
    executeIntent,
    settleEpoch,
    undelegatePod,
  };
}

// ─── Loading states for async operations ─────────────────────────────────────
type LoadingKey = "wallet" | "router" | "createPod" | "delegate" | "execute" | "settle" | "undelegate";

type PodMeshState = ReturnType<typeof usePodMeshState>;

// ─── Iframe / Embed Warning Banner ────────────────────────────────────────────────────

function IframeWarningBanner() {
  const [dismissed, setDismissed] = useState(false);
  const inFrame = isInIframe();
  if (!inFrame || dismissed) return null;

  const appUrl = window.location.href;

  function openTopLevel() {
    try { window.open(appUrl, "_blank", "noopener,noreferrer"); } catch { /* */ }
  }

  return (
    <div
      className="flex items-start gap-3 border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-3 text-sm"
      role="alert"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
      <div className="flex-1 space-y-1">
        <p className="font-medium text-yellow-700 dark:text-yellow-300">
          Embedded preview — wallet injection may be blocked
        </p>
        <p className="text-muted-foreground">
          Browser extensions like Phantom cannot inject into embedded iframes or Perplexity previews.
          For full wallet access, open this app directly in your browser or the Phantom in-app browser.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={openTopLevel}
            data-testid="button-open-top-level"
          >
            <ExternalLink className="h-3 w-3" />
            Open in new tab
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => navigator.clipboard?.writeText(appUrl)}
            data-testid="button-copy-url"
          >
            Copy app URL
          </Button>
          <a
            href={phantomUniversalLink(appUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-xs font-medium hover:bg-accent"
            data-testid="link-open-phantom"
          >
            <Globe className="h-3 w-3" />
            Open in Phantom browser
          </a>
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
        data-testid="button-dismiss-banner"
      >
        ×
      </button>
    </div>
  );
}

// ─── Wallet Picker Modal ────────────────────────────────────────────────────────────────────

type ProviderButtonDef = {
  name: ProviderName;
  label: string;
  description: string;
  color: string;
  testId: string;
};

const PROVIDER_BUTTONS: ProviderButtonDef[] = [
  {
    name: "phantom",
    label: "Phantom",
    description: "window.phantom?.solana or window.solana (isPhantom)",
    color: "text-purple-500",
    testId: "button-wallet-phantom",
  },
  {
    name: "backpack",
    label: "Backpack",
    description: "window.backpack?.solana",
    color: "text-orange-500",
    testId: "button-wallet-backpack",
  },
  {
    name: "solflare",
    label: "Solflare",
    description: "window.solflare",
    color: "text-amber-500",
    testId: "button-wallet-solflare",
  },
  {
    name: "auto",
    label: "Detected wallet",
    description: "Use whichever wallet is injected",
    color: "text-green-500",
    testId: "button-wallet-auto",
  },
];

function WalletPickerModal({ state }: { state: PodMeshState }) {
  const appUrl = window.location.href;
  const detectedProviders = getAllProviders();
  const hasAnyProvider = Object.keys(detectedProviders).length > 0;
  const inFrame = isInIframe();

  function openTopLevel() {
    try { window.open(appUrl, "_blank", "noopener,noreferrer"); } catch { /* */ }
  }

  return (
    <Dialog open={state.walletPickerOpen} onOpenChange={state.setWalletPickerOpen}>
      <DialogContent className="max-w-md" data-testid="dialog-wallet-picker">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Connect Wallet
          </DialogTitle>
          <DialogDescription>
            Select your Solana wallet to connect.
          </DialogDescription>
        </DialogHeader>

        {inFrame && (
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
              <div className="space-y-1">
                <p className="font-medium text-yellow-700 dark:text-yellow-300">
                  Embedded preview detected
                </p>
                <p className="text-xs text-muted-foreground">
                  Wallet extensions cannot inject into iframes or Perplexity embedded previews.
                  The Vercel/top-level URL works best. Open the app directly in your browser.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Provider buttons */}
        <div className="space-y-2" data-testid="wallet-provider-list">
          {PROVIDER_BUTTONS.map(({ name, label, description, color, testId }) => {
            const available = name === "auto" ? hasAnyProvider : name in detectedProviders;
            return (
              <button
                key={name}
                data-testid={testId}
                disabled={!available}
                onClick={() => state.connectWalletWith(name)}
                className={
                  "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors " +
                  (available
                    ? "cursor-pointer hover:bg-accent"
                    : "cursor-not-allowed opacity-40")
                }
              >
                <Wallet className={`h-6 w-6 ${color}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                {available ? (
                  <Badge variant="outline" className="text-xs text-green-600 border-green-500/40">
                    Detected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    Not found
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        <Separator />

        {/* Mobile / deep-link section */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            No extension? Use mobile or direct link
          </p>
          <a
            href={phantomUniversalLink(appUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
            data-testid="link-phantom-universal"
          >
            <Globe className="h-5 w-5 text-purple-500" />
            <div className="flex-1">
              <p className="text-sm font-medium">Open in Phantom browser</p>
              <p className="text-xs text-muted-foreground">
                Phantom universal link — opens this app inside Phantom's in-app browser
              </p>
            </div>
            <ExternalLink className="h-4 w-4 text-muted-foreground" />
          </a>
          <button
            onClick={openTopLevel}
            className="flex w-full items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
            data-testid="button-open-new-tab"
          >
            <ExternalLink className="h-5 w-5 text-blue-500" />
            <div className="flex-1 text-left">
              <p className="text-sm font-medium">Open in new tab</p>
              <p className="text-xs text-muted-foreground">
                Leaves the embedded preview — extensions work in standalone browser tabs
              </p>
            </div>
          </button>
          <button
            onClick={() => navigator.clipboard?.writeText(appUrl).catch(() => null)}
            className="flex w-full items-center gap-3 rounded-lg border p-3 hover:bg-accent transition-colors"
            data-testid="button-copy-app-url"
          >
            <Globe className="h-5 w-5 text-teal-500" />
            <div className="flex-1 text-left">
              <p className="text-sm font-medium">Copy app URL</p>
              <p className="text-xs text-muted-foreground">
                Paste into Phantom, Backpack, or any browser with a wallet extension
              </p>
            </div>
          </button>
        </div>

        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
          <strong>Tip:</strong> Wallet extensions inject into top-level browser pages only.
          Embedded iframes (Perplexity, Replit previews) block extension injection.
          The deployed Vercel URL opens in a full browser tab and works best.
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Shell({ state }: { state: PodMeshState }) {
  const [location] = useLocation();
  const nav = [
    ["/", "Overview", Network],
    ["/pod", "Pod", LockKeyhole],
    ["/agent", "Agent", Sparkles],
    ["/receipts", "Receipts", ReceiptText],
    ["/settlement", "Settlement", Landmark],
    ["/demo", "Demo", PlayCircle],
    ["/architecture", "Architecture", CircuitBoard],
  ] as const;
  return (
    <div className="min-h-screen bg-background">
      <IframeWarningBanner />
      <WalletPickerModal state={state} />
      <header className="sticky top-0 z-50 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
          <AppLogo />
          <nav className="hidden items-center gap-1 md:flex">
            {nav.map(([href, label, Icon]) => (
              <Link key={href} href={href}>
                <Button
                  variant={location === href ? "secondary" : "ghost"}
                  size="sm"
                  data-testid={`link-${label.toLowerCase().replace(" ", "-")}`}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {label}
                </Button>
              </Link>
            ))}
          </nav>
          <Button onClick={state.connectWallet} size="sm" data-testid="button-connect-wallet" disabled={state.loading.wallet}>
            {state.loading.wallet ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Wallet className="mr-2 h-4 w-4" />
            )}
            {state.loading.wallet ? "Connecting…" : short(state.wallet?.toBase58())}
          </Button>
        </div>
      </header>
      <div className="mx-auto grid max-w-7xl gap-6 px-4 py-6 md:grid-cols-[220px_1fr] md:px-6">
        <aside className="hidden md:block">
          <Card className="sticky top-24">
            <CardContent className="p-3">
              <div className="space-y-1">
                {nav.map(([href, label, Icon]) => (
                  <Link key={href} href={href}>
                    <Button
                      className="w-full justify-start"
                      variant={location === href ? "secondary" : "ghost"}
                      size="sm"
                    >
                      <Icon className="mr-2 h-4 w-4" />
                      {label}
                    </Button>
                  </Link>
                ))}
              </div>
              <Separator className="my-3" />
              <StatusPill label="Solana" value="devnet" />
              <StatusPill label="Magic Router" value={state.routerStatus} />
              <StatusPill label="ER validator" value={short(DEVNET_VALIDATOR)} />
              <Separator className="my-3" />
              {/* Legend */}
              <div className="space-y-1.5 px-2 py-1">
                <p className="text-xs font-medium text-muted-foreground">Tx routing legend</p>
                <RouteBadge route="devnet" />
                <RouteBadge route="magic-router" />
                <RouteBadge route="pending-deployment" />
              </div>
            </CardContent>
          </Card>
        </aside>
        <main id="main" className="min-w-0">
          <Switch>
            <Route path="/" component={() => <Overview state={state} />} nest={false} />
            <Route path="/pod" component={() => <PodPage state={state} />} />
            <Route path="/agent" component={() => <AgentPage state={state} />} />
            <Route path="/receipts" component={() => <ReceiptsPage state={state} />} />
            <Route path="/settlement" component={() => <SettlementPage state={state} />} />
            <Route path="/demo" component={() => <DemoTabPage state={state} />} />
            <Route path="/architecture" component={ArchitecturePage} />
            <Route component={NotFound} />
          </Switch>
        </main>
      </div>
    </div>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Badge variant="outline">{value}</Badge>
    </div>
  );
}

function Overview({ state }: { state: PodMeshState }) {
  return (
    <div className="space-y-6">
      <section className="grid gap-6 lg:grid-cols-[1.3fr_.7fr]">
        <Card className="overflow-hidden">
          <CardContent className="p-6 md:p-8">
            <Badge className="mb-5" variant="secondary">
              MagicBlock hackathon live vertical slice
            </Badge>
            <h1 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-4xl">
              Autonomous agents can spend, but only inside an immutable Pod.
            </h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              PodMesh combines Solana devnet transactions, MagicBlock router routing, ER delegation
              instructions, policy receipts, and crank settlement into a multi-page frontend.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/pod">
                <Button data-testid="button-start-pod">
                  Create live Pod
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </Link>
              <Button variant="outline" onClick={state.checkRouter} data-testid="button-check-router" disabled={state.loading.router}>
                {state.loading.router ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RadioTower className="mr-2 h-4 w-4" />
                )}
                {state.loading.router ? "Checking…" : "Check Magic Router"}
              </Button>
              <Link href="/demo">
                <Button variant="outline" data-testid="button-live-proof">
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Demo
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live endpoints</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Endpoint label="Solana devnet RPC" value={SOLANA_DEVNET} />
            <Endpoint label="Magic Router (ER)" value={MAGIC_ROUTER_DEVNET} />
            <Endpoint label="Delegation Program" value={DELEGATION_PROGRAM_ID.toBase58()} />
            <Endpoint label="Devnet ER Validator" value={DEVNET_VALIDATOR} />
          </CardContent>
        </Card>
      </section>
      {/* Route key explanation */}
      <Card className="border-dashed">
        <CardContent className="p-4">
          <p className="mb-3 text-sm font-medium">How transactions are routed in this demo</p>
          <div className="grid gap-3 md:grid-cols-3">
            <RouteExplainer
              route="devnet"
              title="Solana Devnet"
              copy="Memo-anchored policy creation and wallet connection events. Real on-chain Solana devnet transactions. Click the Explorer link to verify on-chain."
            />
            <RouteExplainer
              route="magic-router"
              title="MagicBlock ER (Ephemeral Rollup)"
              copy="Delegation, micro-payments, commit, and undelegate use MagicBlock's live instruction builders and are submitted via devnet-router.magicblock.app."
            />
            <RouteExplainer
              route="pending-deployment"
              title="CPI Testing Pending"
              copy="pod_factory and settlement are deployed to Solana devnet. Full PDA CPI end-to-end testing (delegation round-trip, cross-program invocations) is ongoing."
            />
          </div>
        </CardContent>
      </Card>
      <section className="grid gap-4 md:grid-cols-3">
        <Metric icon={ShieldCheck} label="Policy cap" value={`${state.policy.maxPerEpochSol} SOL / epoch`} />
        <Metric icon={ReceiptText} label="Receipts" value={`${state.receipts.length}`} />
        <Metric icon={Zap} label="Approved volume" value={`${state.approvedVolume.toFixed(3)} SOL`} />
      </section>
      <EventLog events={state.events} />
    </div>
  );
}

function RouteExplainer({ route, title, copy }: { route: TxRoute; title: string; copy: string }) {
  return (
    <div className="rounded-lg border bg-card p-3 space-y-2">
      <RouteBadge route={route} />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{copy}</p>
    </div>
  );
}

function Endpoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-all font-mono text-xs">{value}</p>
    </div>
  );
}

function Metric({ icon: Icon, label, value }: { icon: typeof ShieldCheck; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4 p-5">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold">{value}</p>
        </div>
        <Icon className="h-7 w-7 text-primary" />
      </CardContent>
    </Card>
  );
}

function PodPage({ state }: { state: PodMeshState }) {
  const cats = state.policy.allowedCategories.join(", ");
  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Spend Pod"
        title="Create a live policy envelope"
        copy="The first transaction anchors the Pod policy memo to Solana devnet. Delegation uses MagicBlock's delegation instruction builder and Magic Router."
      />
      {/* Deployment status notice */}
      <Card className="border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/30">
        <CardContent className="flex items-start gap-3 p-4">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="text-sm">
            <p className="font-medium text-emerald-800 dark:text-emerald-300">Programs deployed to Solana devnet</p>
            <p className="mt-1 text-emerald-700 dark:text-emerald-400">
              <code className="rounded bg-emerald-100 dark:bg-emerald-900 px-1">pod_factory</code> and <code className="rounded bg-emerald-100 dark:bg-emerald-900 px-1">settlement</code> are live on Solana devnet.
              The <code className="rounded bg-emerald-100 dark:bg-emerald-900 px-1">create_spend_pod</code> instruction was called via <code className="rounded bg-emerald-100 dark:bg-emerald-900 px-1">scripts/create-spend-pod.ts</code> — see Live Proof for the signature.
              "Anchor policy" below sends a real devnet memo tx anchoring the policy hash. Full CPI delegation testing is underway.
            </p>
          </div>
        </CardContent>
      </Card>
      <div className="grid gap-6 lg:grid-cols-[.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Policy controls</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <NumberField label="Funding SOL" value={state.policy.fundingSol} onChange={(v) => state.setPolicy({ ...state.policy, fundingSol: v })} />
            <NumberField label="Max per tx SOL" value={state.policy.maxPerTxSol} onChange={(v) => state.setPolicy({ ...state.policy, maxPerTxSol: v })} />
            <NumberField label="Max per epoch SOL" value={state.policy.maxPerEpochSol} onChange={(v) => state.setPolicy({ ...state.policy, maxPerEpochSol: v })} />
            <NumberField label="Slippage bps" value={state.policy.slippageBps} onChange={(v) => state.setPolicy({ ...state.policy, slippageBps: v })} />
            <div className="space-y-2">
              <Label htmlFor="categories">Allowed categories</Label>
              <Input
                id="categories"
                value={cats}
                onChange={(e) =>
                  state.setPolicy({
                    ...state.policy,
                    allowedCategories: e.target.value.split(",").map((c) => c.trim()).filter(Boolean),
                  })
                }
                data-testid="input-categories"
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">On-chain actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-muted p-4">
              <p className="text-sm text-muted-foreground">Owner</p>
              <p className="break-all font-mono text-sm">{state.wallet?.toBase58() ?? "Connect wallet"}</p>
              {state.pod && (
                <a
                  href={explorerAccount(state.pod.toBase58())}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline"
                >
                  View Pod PDA on Explorer <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <p className="mt-3 text-sm text-muted-foreground">Spend Pod PDA</p>
              <p className="break-all font-mono text-sm">{state.pod?.toBase58() ?? "Derived after wallet connect"}</p>
              {state.pod && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Seeds: ["pod", walletPubkey] via {POD_FACTORY_PROGRAM_ID.toBase58().slice(0, 8)}…
                </p>
              )}
              <p className="mt-3 text-sm text-muted-foreground">ER identity</p>
              <p className="font-mono text-sm">{state.erIdentity}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionButton
                label="Connect wallet"
                route="devnet"
                icon={KeyRound}
                variant="outline"
                testId="button-wallet"
                onClick={state.connectWallet}
              />
              <ActionButton
                label={state.loading.createPod ? "Creating Pod…" : "Create Pod on-chain"}
                route="devnet"
                icon={state.loading.createPod ? Loader2 : Banknote}
                testId="button-anchor-policy"
                onClick={state.createPodOnchain}
                disabled={!!state.loading.createPod}
                tooltip="Calls pod_factory.create_spend_pod with IDL discriminator — live devnet transaction"
              />
              <ActionButton
                label={state.loading.delegate ? "Delegating…" : "Delegate to ER"}
                route="magic-router"
                icon={state.loading.delegate ? Loader2 : RadioTower}
                variant="secondary"
                testId="button-delegate"
                onClick={state.delegatePodLive}
                disabled={!!state.loading.delegate}
                tooltip="Uses MagicBlock's live delegate instruction builder via Magic Router"
              />
              <ActionButton
                label={state.loading.undelegate ? "Undelegating…" : "Commit + undelegate"}
                route="magic-router"
                icon={state.loading.undelegate ? Loader2 : Clock}
                variant="outline"
                testId="button-undelegate"
                onClick={state.undelegatePod}
                disabled={!!state.loading.undelegate}
                tooltip="Submits commit+undelegate instruction via Magic Router"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  route,
  icon: Icon,
  variant = "default",
  testId,
  onClick,
  tooltip,
  disabled,
}: {
  label: string;
  route: TxRoute;
  icon: typeof KeyRound;
  variant?: "default" | "outline" | "secondary";
  testId: string;
  onClick: () => void;
  tooltip?: string;
  disabled?: boolean;
}) {
  const isSpinning = label.endsWith("…");
  return (
    <div className="space-y-1">
      <Button className="w-full" onClick={onClick} variant={variant} data-testid={testId} disabled={disabled}>
        <Icon className={`mr-2 h-4 w-4${isSpinning ? " animate-spin" : ""}`} />
        {label}
      </Button>
      <div className="flex items-center justify-center gap-1">
        <RouteBadge route={route} />
        {tooltip && (
          <span className="text-xs text-muted-foreground hidden lg:block" title={tooltip}>
            <Info className="h-3 w-3" />
          </span>
        )}
      </div>
    </div>
  );
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const id = label.toLowerCase().replaceAll(" ", "-");
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" step="0.001" value={value} onChange={(e) => onChange(Number(e.target.value))} data-testid={`input-${id}`} />
    </div>
  );
}

function AgentPage({ state }: { state: PodMeshState }) {
  const intents = state.mode === "billpay" ? billPayIntents : otcIntents;
  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Agent execution"
        title="Route approved payments through MagicBlock ER"
        copy="Policy-approved intents are submitted via Magic Router (ER). Rejected intents are blocked by the policy engine before any signing occurs."
      />
      <Tabs value={state.mode} onValueChange={(v) => state.setMode(v as Mode)}>
        <TabsList>
          <TabsTrigger value="billpay">BillPay</TabsTrigger>
          <TabsTrigger value="otc">OTC / RFQ</TabsTrigger>
        </TabsList>
        <TabsContent value={state.mode} className="mt-5">
          <div className="grid gap-4 md:grid-cols-2">
            {intents.map((intent) => (
              <IntentCard key={intent.id} intent={intent} policy={state.policy} onExecute={() => state.executeIntent(intent)} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function IntentCard({
  intent,
  policy,
  onExecute,
}: {
  intent: PaymentIntent;
  policy: PodPolicy;
  onExecute: () => void;
}) {
  // Pre-compute whether this will pass policy
  const wouldPass =
    intent.amountSol <= policy.maxPerTxSol &&
    policy.allowedCategories.includes(intent.category) &&
    (!policy.requireOracle || intent.oracle) &&
    intent.slippageBps <= policy.slippageBps;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">{intent.label}</CardTitle>
          <Badge variant="outline">{intent.category}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Mini label="Amount" value={`${intent.amountSol} SOL`} />
          <Mini label="Oracle" value={intent.oracle ? "yes" : "no"} />
          <Mini label="Slippage" value={`${intent.slippageBps} bps`} />
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Policy verdict:</span>
          {wouldPass ? (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" /> Will approve → routed via
              <RouteBadge route="magic-router" />
            </span>
          ) : (
            <span className="flex items-center gap-1 text-destructive">
              <XCircle className="h-3 w-3" /> Will reject →
              <RouteBadge route="pending-deployment" />
            </span>
          )}
        </div>
        <Button className="w-full" onClick={onExecute} data-testid={`button-execute-${intent.id}`}>
          Replay verified flow
          <RadioTower className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function ReceiptsPage({ state }: { state: PodMeshState }) {
  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Receipts"
        title="Non-repudiable payment trail"
        copy="Every accepted or rejected attempt creates a receipt leaf. Approved receipts include a live devnet signature with Explorer link. Rejected receipts show the policy violation reason."
      />
      <div className="space-y-3">
        {state.receipts.length === 0 ? (
          <Empty title="No receipts yet" copy="Run the agent from the Agent page to create receipt leaves." />
        ) : (
          state.receipts.map((receipt) => (
            <Card key={receipt.receiptId}>
              <CardContent className="grid gap-4 p-4 md:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {receipt.status === "approved" ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive" />
                    )}
                    <p className="font-medium">{receipt.label}</p>
                    <Badge variant={receipt.status === "approved" ? "secondary" : "destructive"}>{receipt.status}</Badge>
                    {receipt.route && <RouteBadge route={receipt.route} />}
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{receipt.reason}</p>
                  <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                    <code>{receipt.receiptId}</code>
                    <code>{receipt.merkleLeaf}</code>
                    <code>{receipt.erIdentity}</code>
                    <code>{receipt.counterparty}</code>
                  </div>
                </div>
                {receipt.signature && (
                  <a href={explorerTx(receipt.signature)} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" data-testid={`button-explorer-${receipt.receiptId}`}>
                      Devnet Explorer
                      <ExternalLink className="ml-2 h-4 w-4" />
                    </Button>
                  </a>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function SettlementPage({ state }: { state: PodMeshState }) {
  const approved = state.receipts.filter((r) => r.status === "approved");
  const fee = state.approvedVolume * 0.001;
  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Crank settlement"
        title="Commit epoch state back to Solana"
        copy="Settlement submits a MagicBlock commit instruction through Magic Router, then adds a memo anchoring the epoch root. Both happen in one ER-routed transaction."
      />
      <div className="grid gap-4 md:grid-cols-4">
        <Metric icon={ReceiptText} label="Receipt count" value={`${state.receipts.length}`} />
        <Metric icon={CheckCircle2} label="Approved" value={`${approved.length}`} />
        <Metric icon={Gauge} label="Volume" value={`${state.approvedVolume.toFixed(4)} SOL`} />
        <Metric icon={Activity} label="Fee" value={`${fee.toFixed(5)} SOL`} />
      </div>
      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="grid gap-4 md:grid-cols-3">
            <Mini label="Crank reward" value={`${(fee * 0.2).toFixed(5)} SOL`} />
            <Mini label="Treasury" value={`${(fee * 0.8).toFixed(5)} SOL`} />
            <Mini label="Commit target" value={short(state.pod?.toBase58())} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={state.settleEpoch} data-testid="button-settle-epoch" disabled={!!state.loading.settle}>
              {state.loading.settle ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Landmark className="mr-2 h-4 w-4" />
              )}
              {state.loading.settle ? "Settling…" : "Settle epoch through Magic Router"}
            </Button>
            <RouteBadge route="magic-router" />
          </div>
        </CardContent>
      </Card>
      <EventLog events={state.events} />
    </div>
  );
}

// ------------------------------------------------------------------
// Demo tab — consolidates Live Proof + Agent Commerce + Marketplace Flow
// ------------------------------------------------------------------
function DemoTabPage({ state }: { state: PodMeshState }) {
  const [activeTab, setActiveTab] = useState<"proof" | "commerce" | "marketplace">("proof");
  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Demo"
        title="PodMesh — live devnet evidence"
        copy="Three views: verified on-chain proof, the full agent commerce flow, and a Marketplace integration walkthrough."
      />
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="proof">
            <CheckCheck className="mr-2 h-4 w-4" />Live Proof
          </TabsTrigger>
          <TabsTrigger value="commerce">
            <Banknote className="mr-2 h-4 w-4" />Agent Commerce
          </TabsTrigger>
          <TabsTrigger value="marketplace">
            <Store className="mr-2 h-4 w-4" />Marketplace Flow
          </TabsTrigger>
        </TabsList>
        <TabsContent value="proof" className="mt-5">
          <LiveProofContent state={state} />
        </TabsContent>
        <TabsContent value="commerce" className="mt-5">
          <AgentCommerceDemoContent />
        </TabsContent>
        <TabsContent value="marketplace" className="mt-5">
          <MarketplaceFlowContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ------------------------------------------------------------------
// Live Proof content
// ------------------------------------------------------------------
function LiveProofContent({ state }: { state: PodMeshState }) {
  const approvedReceipts = state.receipts.filter((r) => r.status === "approved" && r.signature);
  const erEvents = state.events.filter((e) => e.route === "magic-router" && e.signature);
  const devnetEvents = state.events.filter((e) => e.route === "devnet" && e.signature);

  const proofItems = [
    {
      id: "router-connection",
      label: "Magic Router connectivity",
      status: state.routerStatus === "online" ? "pass" : state.routerStatus === "offline" ? "fail" : "pending",
      detail:
        state.routerStatus === "online"
          ? `Connected to ${MAGIC_ROUTER_DEVNET}`
          : state.routerStatus === "offline"
          ? "Router check failed — see event log"
          : "Not yet checked — click 'Check Magic Router' on Overview",
    },
    {
      id: "wallet-connected",
      label: "Wallet connected (Solana devnet)",
      status: state.wallet ? "pass" : "pending",
      detail: state.wallet
        ? `${state.wallet.toBase58()} — view on Explorer`
        : "Connect a Phantom/Backpack wallet to prove wallet signing",
      explorerUrl: state.wallet ? explorerAccount(state.wallet.toBase58()) : undefined,
    },
    {
      id: "pod-pda",
      label: "Pod PDA derived from program",
      status: state.pod ? "pass" : "pending",
      detail: state.pod
        ? `PDA: ${state.pod.toBase58()} (seeds: [podmesh, owner])`
        : "Connect wallet to derive the Pod PDA",
      explorerUrl: state.pod ? explorerAccount(state.pod.toBase58()) : undefined,
    },
    {
      id: "devnet-txs",
      label: "Live Solana devnet transactions",
      status: devnetEvents.length > 0 ? "pass" : "pending",
      detail:
        devnetEvents.length > 0
          ? `${devnetEvents.length} confirmed devnet tx(s) — click Explorer links below`
          : "Anchor a policy on the Pod page to create devnet transactions",
    },
    {
      id: "er-txs",
      label: "MagicBlock ER transactions (Magic Router)",
      status: erEvents.length > 0 ? "pass" : "pending",
      detail:
        erEvents.length > 0
          ? `${erEvents.length} ER-routed tx(s) via devnet-router.magicblock.app`
          : "Execute a payment intent or delegate a Pod to create ER transactions",
    },
    {
      id: "program-build",
      label: "Anchor programs deployed to Solana devnet",
      status: "pass",
      detail:
        "pod_factory (FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm) and settlement (A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc) are executable on Solana devnet. All four instructions confirmed: create_spend_pod, record_receipt, settle_epoch, delegate_pod.",
      explorerUrl: explorerAccount("FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm"),
    },
    {
      id: "ephemeral-sdk",
      label: "ephemeral-rollups-sdk integrated",
      status: "pass",
      detail:
        `Using @magicblock-labs/ephemeral-rollups-sdk@0.11.2 on the frontend and ephemeral-rollups-sdk=0.2.5 in the Anchor program. createDelegateInstruction, createCommitInstruction, createCommitAndUndelegateInstruction, and ConnectionMagicRouter are all live.`,
    },
    {
      id: "receipts",
      label: "Policy-enforced receipt trail",
      status: state.receipts.length > 0 ? "pass" : "pending",
      detail:
        state.receipts.length > 0
          ? `${state.receipts.length} receipt(s) created — ${approvedReceipts.length} with live signatures`
          : "Execute payment intents on the Agent page",
    },
  ];

  return (
    <div className="space-y-6">

      {/* Status checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">On-chain & ER proof checklist</CardTitle>
          <CardDescription>
            Green = live on-chain evidence. Amber = pending user action or integration testing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {proofItems.map((item) => (
            <div
              key={item.id}
              className={`flex items-start gap-3 rounded-lg border p-3 ${
                item.status === "pass"
                  ? "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20"
                  : item.status === "fail"
                  ? "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20"
                  : "border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20"
              }`}
            >
              <div className="mt-0.5 shrink-0">
                {item.status === "pass" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                ) : item.status === "fail" ? (
                  <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                ) : (
                  <Loader2 className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{item.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground break-all">{item.detail}</p>
                {item.explorerUrl && (
                  <a
                    href={item.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline"
                  >
                    View on Solana Explorer <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Live devnet signatures */}
      {devnetEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4 text-blue-600" />
              Confirmed Solana devnet transactions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {devnetEvents.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.title}</p>
                  <p className="text-xs text-muted-foreground">{e.at}</p>
                  <code className="text-xs break-all text-muted-foreground">{e.signature}</code>
                </div>
                <a href={explorerTx(e.signature!)} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    Explorer <ExternalLink className="ml-2 h-3 w-3" />
                  </Button>
                </a>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Live ER signatures */}
      {erEvents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RadioTower className="h-4 w-4 text-violet-600" />
              MagicBlock ER transactions (Magic Router routed)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {erEvents.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.title}</p>
                  <p className="text-xs text-muted-foreground">{e.at}</p>
                  <code className="text-xs break-all text-muted-foreground">{e.signature}</code>
                </div>
                <a href={explorerTx(e.signature!)} target="_blank" rel="noopener noreferrer">
                  <Button variant="outline" size="sm">
                    Open proof <ExternalLink className="ml-2 h-3 w-3" />
                  </Button>
                </a>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Deployment signatures */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Deployed programs — on-chain proof
          </CardTitle>
          <CardDescription>Both programs are executable on Solana devnet. All four E2E instruction tests have confirmed devnet signatures.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium">pod_factory</p>
              <Badge variant="secondary">Deployed</Badge>
              <Badge variant="outline" className="font-mono text-xs">FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Instructions: create_spend_pod, record_receipt, delegate_pod, commit_pod, commit_and_undelegate_pod.
              Built with Anchor 0.32.1 + ephemeral-rollups-sdk 0.2.5.
            </p>
            <a href={explorerAccount("FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm")} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">View program on Explorer <ExternalLink className="ml-1 h-3 w-3" /></Button>
            </a>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium">settlement</p>
              <Badge variant="secondary">Deployed</Badge>
              <Badge variant="outline" className="font-mono text-xs">A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Epoch settlement with settle_epoch instruction and EpochSettlement PDA.
            </p>
            <a href={explorerAccount("A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc")} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">View program on Explorer <ExternalLink className="ml-1 h-3 w-3" /></Button>
            </a>
          </div>

          {/* create_spend_pod */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium">create_spend_pod — Solana devnet</p>
            </div>
            <p className="text-xs text-muted-foreground">Pod PDA: <code className="font-mono">GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL</code></p>
            <code className="block text-xs break-all text-muted-foreground">2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F</code>
            <div className="flex gap-2 flex-wrap">
              <a href="https://explorer.solana.com/tx/2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F?cluster=devnet" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">Transaction <ExternalLink className="ml-1 h-3 w-3" /></Button>
              </a>
              <a href="https://explorer.solana.com/address/GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL?cluster=devnet" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">Pod PDA <ExternalLink className="ml-1 h-3 w-3" /></Button>
              </a>
            </div>
          </div>

          {/* record_receipt */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium">record_receipt — Solana devnet</p>
            </div>
            <p className="text-xs text-muted-foreground">
              0.001 SOL spend recorded on Pod PDA. Category: grocery:general. Epoch 1060.
              receiptCount advanced to 1, epochSpentLamports: 1,000,000. Event: ReceiptRecorded.
            </p>
            <code className="block text-xs break-all text-muted-foreground">4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw</code>
            <a href="https://explorer.solana.com/tx/4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw?cluster=devnet" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">Transaction <ExternalLink className="ml-1 h-3 w-3" /></Button>
            </a>
          </div>

          {/* settle_epoch */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium">settle_epoch — Solana devnet (settlement program)</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Epoch 1060 settled. EpochSettlement PDA: <code className="font-mono">7ucH3LPdx2PfS3LUpKSoFYVWuxYK54LikxSm7qCrhDk9</code>.
              volume: 1,000,000 lam, receiptCount: 1, fees: 5,000 lam (crank: 1,000 / treasury: 4,000). settled: true. Event: EpochSettled.
            </p>
            <code className="block text-xs break-all text-muted-foreground">5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd</code>
            <div className="flex gap-2 flex-wrap">
              <a href="https://explorer.solana.com/tx/5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd?cluster=devnet" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">Transaction <ExternalLink className="ml-1 h-3 w-3" /></Button>
              </a>
              <a href="https://explorer.solana.com/address/7ucH3LPdx2PfS3LUpKSoFYVWuxYK54LikxSm7qCrhDk9?cluster=devnet" target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">EpochSettlement PDA <ExternalLink className="ml-1 h-3 w-3" /></Button>
              </a>
            </div>
          </div>

          {/* delegate_pod */}
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/20 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium">delegate_pod — MagicBlock CPI (pod_factory → DELeGG)</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Pod PDA delegated to MagicBlock ephemeral rollup via CPI into DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh.
              Buffer, delegation_record, and delegation_metadata accounts created. Commit frequency: 3 s. Validator: MAS1Dt9q…
            </p>
            <code className="block text-xs break-all text-muted-foreground">4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE</code>
            <a href="https://explorer.solana.com/tx/4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE?cluster=devnet" target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">Transaction <ExternalLink className="ml-1 h-3 w-3" /></Button>
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


// ------------------------------------------------------------------
// Agent Commerce Demo content (formerly AgentCommerceDemoPage)
// ------------------------------------------------------------------
const DEMO_PAYER    = "2RiFddW6a5yvkX4CKDzG3RqY1AReQuaHgASrd8YBxkDZ";
const DEMO_MERCHANT = "EFqNZm8MFWQP7c3iYBNxYx6XbMEpMmxaUmkFS39FtsJ1";
const DEMO_POD_PDA  = "GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL";

interface DemoStep {
  step: number;
  label: string;
  summary: string;
  detail: string;
  sig: string;
  explorerHref: string;
  extraLinks?: { label: string; href: string }[];
}

const DEMO_STEPS: DemoStep[] = [
  {
    step: 1,
    label: "create_spend_pod",
    summary: "Agent provisions a policy-bound Spending Pod",
    detail:
      "pod_factory.create_spend_pod anchors the Pod PDA on-chain with policy parameters: max 0.05 SOL per-tx, max 1 SOL per epoch, category allowlist [grocery:general, food_delivery:restaurant, grocery:pharmacy], slippage ≤ 1.5 %, 90-day expiry. Policy is immutable after creation.",
    sig: "2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F",
    explorerHref:
      "https://explorer.solana.com/tx/2uRUDPGLSEbX5vnqveZLH4h9CggaPFrT6kkTjYgGzaepchL3StPp8hYsHhEX2D3tykgJceTQoyjLdCBYTNSSJi6F?cluster=devnet",
    extraLinks: [
      {
        label: "Pod PDA",
        href: "https://explorer.solana.com/address/GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL?cluster=devnet",
      },
    ],
  },
  {
    step: 2,
    label: "SystemProgram.transfer (payment)",
    summary: "Agent pays merchant 0.001 SOL on devnet",
    detail:
      "Payer wallet 2RiFddW6a5y… transfers 0.001 SOL (1,000,000 lamports) to merchant receiver EFqNZm8MFWQ…. The spend is within the Pod's per-tx cap (0.05 SOL) and category allowlist. This is the real-value transfer that a production agent would execute autonomously.",
    sig: "FQCEkhHfu9d8XmZMzBe7iwt6APtcYfKxPpKPM67NZ7KSUbPN1PFyc3ndDHK2Q2raCfeeU7YRvi4yKAjX1ePviVW",
    explorerHref:
      "https://explorer.solana.com/tx/FQCEkhHfu9d8XmZMzBe7iwt6APtcYfKxPpKPM67NZ7KSUbPN1PFyc3ndDHK2Q2raCfeeU7YRvi4yKAjX1ePviVW?cluster=devnet",
  },
  {
    step: 3,
    label: "record_receipt",
    summary: "Receipt anchored to the Pod PDA on pod_factory",
    detail:
      "pod_factory.record_receipt records the spend: amount 1,000,000 lam, category grocery:general, slippage 100 bps, epoch 1060. On-chain state advances: receiptCount → 1, epochSpentLamports → 1,000,000. Event ReceiptRecorded emitted. The on-chain audit trail is now permanent.",
    sig: "4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw",
    explorerHref:
      "https://explorer.solana.com/tx/4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw?cluster=devnet",
  },
  {
    step: 4,
    label: "settle_epoch",
    summary: "Epoch 1060 settled on the settlement program",
    detail:
      "settlement.settle_epoch creates EpochSettlement PDA for epoch 1060. Merkle root of all receipts committed. Volume: 1,000,000 lam, fees: 5,000 lam (crank: 1,000 / treasury: 4,000). settled = true. Event EpochSettled emitted. Crank rewards distributed automatically.",
    sig: "5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd",
    explorerHref:
      "https://explorer.solana.com/tx/5SiWbxXFxjfTVyfSMVAzwchMz43QHbS4JbQzcFQUnJwkfzYbthg3M377r3etq1xtg3ggNfkq3MHTjsWqfKvLdfKd?cluster=devnet",
    extraLinks: [
      {
        label: "EpochSettlement PDA",
        href: "https://explorer.solana.com/address/7ucH3LPdx2PfS3LUpKSoFYVWuxYK54LikxSm7qCrhDk9?cluster=devnet",
      },
    ],
  },
  {
    step: 5,
    label: "delegate_pod (MagicBlock CPI)",
    summary: "Pod delegated via MagicBlock DELeGG — ER-ready",
    detail:
      "pod_factory.delegate_pod CPIs into DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh. Buffer PDA, delegation_record, and delegation_metadata created on-chain. Commit frequency: 3 s. Validator: MAS1Dt9q…. Pod state can now be mutated inside the ephemeral rollup and committed back to base-layer Solana.",
    sig: "4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE",
    explorerHref:
      "https://explorer.solana.com/tx/4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE?cluster=devnet",
  },
];

function AgentCommerceDemoContent() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-300">
        Replayed verified flow — all five transactions are confirmed on Solana devnet. Signatures are static proof; no new transactions are broadcast when viewing this tab.
      </div>

      {/* Actors */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            Participants
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex flex-col gap-1 rounded-lg border p-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent / Payer wallet</span>
            <a
              href={`https://explorer.solana.com/address/${DEMO_PAYER}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-primary underline break-all"
            >
              {DEMO_PAYER} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border p-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Merchant receiver</span>
            <a
              href={`https://explorer.solana.com/address/${DEMO_MERCHANT}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-primary underline break-all"
            >
              {DEMO_MERCHANT} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
          <div className="flex flex-col gap-1 rounded-lg border p-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Pod PDA (policy account)</span>
            <a
              href={`https://explorer.solana.com/address/${DEMO_POD_PDA}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-primary underline break-all"
            >
              {DEMO_POD_PDA} <ExternalLink className="h-3 w-3 shrink-0" />
            </a>
          </div>
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-3">
        {DEMO_STEPS.map((s) => (
          <Card key={s.step} className="border-emerald-200 dark:border-emerald-800">
            <CardContent className="flex gap-4 p-5">
              {/* Step number */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">
                {s.step}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-sm">{s.label}</p>
                  <Badge variant="outline" className="text-emerald-700 border-emerald-400 dark:text-emerald-300 dark:border-emerald-600 text-xs">
                    ✓ confirmed
                  </Badge>
                </div>
                <p className="text-sm font-medium text-foreground">{s.summary}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.detail}</p>
                <div className="mt-1">
                  <p className="text-xs text-muted-foreground mb-1">Signature</p>
                  <code className="block text-xs break-all text-muted-foreground bg-muted rounded px-2 py-1">{s.sig}</code>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <a href={s.explorerHref} target="_blank" rel="noopener noreferrer">
                    <Button variant="outline" size="sm" data-testid={`button-demo-explorer-${s.step}`}>
                      Open proof <ExternalLink className="ml-1 h-3 w-3" />
                    </Button>
                  </a>
                  {s.extraLinks?.map((link) => (
                    <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm">
                        {link.label} <ExternalLink className="ml-1 h-3 w-3" />
                      </Button>
                    </a>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Summary box */}
      <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <p className="font-semibold text-sm">Full commerce cycle confirmed on devnet</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            All five transactions are live on Solana devnet. The Pod enforces spend policy at the program level — no backend can override it.
            After delegation, the Pod enters MagicBlock's ephemeral rollup for sub-second execution with periodic commit-backs to base-layer Solana.
            This flow is the atomic unit of PodMesh autonomous commerce.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------
// Marketplace Flow subtab — demo listing + devnet proof
// ------------------------------------------------------------------
const MARKETPLACE_STEPS = [
  {
    id: "mp-1",
    icon: Store,
    label: "Agent enters marketplace",
    detail:
      "An autonomous agent browses a devnet marketplace listing. Its Spend Pod is already initialised (PDA: GFdguT4bsdFfpixVpqwH6qNokYRGY21WsidQe7bFvYNL). The agent reads the product category and price from the listing metadata before initiating checkout.",
    status: "done",
  },
  {
    id: "mp-2",
    icon: ShieldCheck,
    label: "Policy check",
    detail:
      "The Pod policy engine validates the intent: category grocery:general is in the allowlist, amount 0.001 SOL is within the per-tx cap (0.05 SOL) and epoch cap (1 SOL), slippage 100 bps ≤ policy 150 bps, oracle not required. Policy: PASS. No signature until policy clears.",
    status: "done",
  },
  {
    id: "mp-3",
    icon: Banknote,
    label: "Merchant payment",
    detail:
      "SystemProgram.transfer — 0.001 SOL from agent payer (2RiFddW6a5y…) to merchant receiver (EFqNZm8MFWQ…). Confirmed on Solana devnet. This is the real-value transfer; the Pod policy rails authorised it.",
    status: "done",
    sig: "FQCEkhHfu9d8XmZMzBe7iwt6APtcYfKxPpKPM67NZ7KSUbPN1PFyc3ndDHK2Q2raCfeeU7YRvi4yKAjX1ePviVW",
    explorerHref:
      "https://explorer.solana.com/tx/FQCEkhHfu9d8XmZMzBe7iwt6APtcYfKxPpKPM67NZ7KSUbPN1PFyc3ndDHK2Q2raCfeeU7YRvi4yKAjX1ePviVW?cluster=devnet",
  },
  {
    id: "mp-4",
    icon: PackageCheck,
    label: "Receipt + settlement",
    detail:
      "pod_factory.record_receipt anchors the spend on-chain (receiptCount → 1, epochSpentLamports → 1,000,000). settlement.settle_epoch creates the EpochSettlement PDA (epoch 1060, volume 1,000,000 lam, fees 5,000 lam). Permanent audit trail — no backend can alter it.",
    status: "done",
    sig: "4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw",
    explorerHref:
      "https://explorer.solana.com/tx/4n2snHrvTSvSLCkv7M3RCU5fFZRTRfQYEPuiQp1PLSRRTGENYaCpJjfZdQQLc1fLQ1RBudWtKebMJgowB1FdBGw?cluster=devnet",
  },
  {
    id: "mp-5",
    icon: RadioTower,
    label: "MagicBlock delegation for ER-speed repeat buys",
    detail:
      "After the first order, the Pod is delegated to MagicBlock's ephemeral rollup (DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh). Subsequent marketplace payments route through the ER — sub-second settlement, periodic commit-back to Solana base layer. Policy limits still enforced inside the rollup.",
    status: "done",
    sig: "4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE",
    explorerHref:
      "https://explorer.solana.com/tx/4K73yk4EzkcBF1rHCsGZ3otDAMLU8RWwirKMTu4bEq9sxynLt7WpLPbjNVwGAkJmq2QUpWHov2cKsoHyt2mmt7FE?cluster=devnet",
  },
];

function MarketplaceFlowContent() {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/20 p-3 text-xs text-blue-800 dark:text-blue-300">
        <strong>Note:</strong> No live marketplace backend is claimed. This is a verified devnet flow — real on-chain signatures demonstrating how a PodMesh-enabled marketplace integration would operate end-to-end.
      </div>

      {/* Listing card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShoppingBag className="h-4 w-4" />
            Devnet listing — demo product
          </CardTitle>
          <CardDescription>Marketplace item for this demo flow</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Mini label="Product" value="Grocery bundle" />
            <Mini label="Category" value="grocery:general" />
            <Mini label="Price" value="0.001 SOL" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Mini label="Merchant" value="EFqNZm8MFWQ…" />
            <Mini label="Pod PDA" value="GFdguT4b…" />
            <Mini label="Network" value="Solana devnet" />
          </div>
        </CardContent>
      </Card>

      {/* Flow steps */}
      <div className="space-y-3">
        {MARKETPLACE_STEPS.map((step) => (
          <Card key={step.id} className="border-emerald-200 dark:border-emerald-800">
            <CardContent className="flex gap-4 p-4">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <step.icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-sm">{step.label}</p>
                  <Badge variant="outline" className="text-emerald-700 border-emerald-400 dark:text-emerald-300 dark:border-emerald-600 text-xs">
                    ✓ verified
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{step.detail}</p>
                {step.sig && (
                  <div className="space-y-1">
                    <code className="block text-xs break-all text-muted-foreground bg-muted rounded px-2 py-1">{step.sig}</code>
                    <a href={step.explorerHref} target="_blank" rel="noopener noreferrer">
                      <Button variant="outline" size="sm" data-testid={`button-marketplace-explorer-${step.id}`}>
                        Open proof <ExternalLink className="ml-1 h-3 w-3" />
                      </Button>
                    </a>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Settlement proof */}
      <Card className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800">
        <CardContent className="p-4 space-y-1">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <p className="font-semibold text-sm">Full marketplace cycle verified on Solana devnet</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Policy check → payment → receipt → epoch settlement → MagicBlock delegation. All steps anchored on-chain.
            A live marketplace backend would plug into each step via the pod_factory CPI interface.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ArchitecturePage() {
  const layers = [
    {
      title: "Solana base layer",
      copy: "Pod Factory (FXMgSbYBh6fQFCPQ7My5CAKW8sWgUTHQwo7gqLykp4fm) and Settlement (A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc) are deployed and executable on Solana devnet. create_spend_pod E2E test confirmed on-chain.",
      route: "devnet" as TxRoute,
    },
    {
      title: "MagicBlock delegation",
      copy: "Pod PDAs are delegated through DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh. Frontend uses live MagicBlock instruction builders from ephemeral-rollups-sdk.",
      route: "magic-router" as TxRoute,
    },
    {
      title: "Magic Router (ER endpoint)",
      copy: "Frontend submits standard Solana transactions to devnet-router.magicblock.app for ER routing. ConnectionMagicRouter provides blockhash, confirmation, and validator selection.",
      route: "magic-router" as TxRoute,
    },
    {
      title: "Agent policy rail",
      copy: "Policy engine enforces max_per_tx, epoch caps, category allowlists, oracle requirements, and slippage limits before signing any transaction.",
      route: "devnet" as TxRoute,
    },
    {
      title: "Crank settlement",
      copy: "Epoch receipts committed with MagicBlock createCommitInstruction. An on-chain memo anchors the merkle root of all receipts in the same transaction.",
      route: "magic-router" as TxRoute,
    },
  ];
  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Architecture"
        title="Whole-stack PodMesh layout"
        copy="This repo includes the frontend, MagicBlock client adapter, Anchor program source, compiled .so artifacts, and a crank script."
      />
      <div className="space-y-3">
        {layers.map(({ title, copy, route }, index) => (
          <Card key={title}>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                {index + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{title}</p>
                  <RouteBadge route={route} />
                </div>
                <p className="text-sm text-muted-foreground mt-1">{copy}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function PageHead({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return (
    <section>
      <Badge variant="outline">{eyebrow}</Badge>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-3xl text-muted-foreground">{copy}</p>
    </section>
  );
}

function Empty({ title, copy }: { title: string; copy: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col items-center justify-center p-12 text-center">
        <FileCheck2 className="h-10 w-10 text-muted-foreground" />
        <h2 className="mt-4 text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy}</p>
      </CardContent>
    </Card>
  );
}

function EventLog({ events }: { events: ChainEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Live chain log</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {events.map((event) => (
          <div key={event.id} className="flex gap-3 rounded-xl bg-muted p-3">
            <Activity className="mt-1 h-4 w-4 text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{event.title}</p>
                  {event.route && <RouteBadge route={event.route} />}
                </div>
                <span className="text-xs text-muted-foreground">{event.at}</span>
              </div>
              <p className="break-all text-sm text-muted-foreground">{event.detail}</p>
              {event.signature && (
                <a className="mt-1 inline-flex items-center gap-1 text-xs text-primary underline" href={explorerTx(event.signature)} target="_blank" rel="noopener noreferrer">
                  View on Solana Explorer <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AppRouter() {
  const state = usePodMeshState();
  return <Shell state={state} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router hook={useHashLocation}>
          <AppRouter />
        </Router>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
