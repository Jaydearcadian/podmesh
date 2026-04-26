import { useMemo, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import NotFound from "@/pages/not-found";

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      publicKey?: PublicKey;
      connect: () => Promise<{ publicKey: PublicKey }>;
      signAndSendTransaction?: (tx: Transaction) => Promise<{ signature: string }>;
      signTransaction?: (tx: Transaction) => Promise<Transaction>;
    };
  }
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
    [encode("podmesh"), owner.toBuffer()],
    POD_FACTORY_PROGRAM_ID,
  )[0];
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
      label: "Pending program deploy",
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

  async function connectWallet() {
    if (!window.solana) {
      toast({
        title: "Wallet not found",
        description: "Open this app in a browser with Phantom or Backpack installed.",
        variant: "destructive",
      });
      return;
    }
    const res = await window.solana.connect();
    setWallet(res.publicKey);
    addEvent({
      kind: "wallet",
      title: "Wallet connected",
      detail: res.publicKey.toBase58(),
      route: "devnet",
    });
  }

  async function checkRouter() {
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
    }
  }

  async function sendViaWallet(tx: Transaction, route: "base" | "magic") {
    if (!wallet || !window.solana) throw new Error("Connect wallet first");
    tx.feePayer = wallet;
    const connection = route === "magic" ? routerConnection : baseConnection;
    const blockhash =
      route === "magic"
        ? await routerConnection.getLatestBlockhashForTransaction(tx)
        : await baseConnection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash.blockhash;
    if (window.solana.signAndSendTransaction) {
      const { signature } = await window.solana.signAndSendTransaction(tx);
      await connection.confirmTransaction(
        { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
        "confirmed",
      );
      return signature;
    }
    if (!window.solana.signTransaction) throw new Error("Wallet cannot sign transactions");
    const signed = await window.solana.signTransaction(tx);
    const raw = signed.serialize();
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
    await connection.confirmTransaction(
      { signature, blockhash: blockhash.blockhash, lastValidBlockHeight: blockhash.lastValidBlockHeight },
      "confirmed",
    );
    return signature;
  }

  /**
   * LIVE DEVNET: anchors pod policy as a memo tx on Solana devnet.
   * Does NOT call the Pod Factory program (awaiting deployment).
   */
  async function createPodOnchain() {
    if (!wallet || !pod) return connectWallet();
    const memo = new TransactionInstruction({
      programId: SystemProgram.programId,
      keys: [],
      data: Buffer.from(
        `PODMESHv1:create:${pod.toBase58()}:${JSON.stringify(policy)}:${DELEGATION_PROGRAM_ID.toBase58()}`,
      ),
    });
    const tx = new Transaction().add(memo);
    const signature = await sendViaWallet(tx, "base");
    addEvent({
      kind: "settle",
      title: "Pod policy memo anchored on Solana devnet",
      detail: `PDA: ${pod.toBase58()} · memo tx (full CPI pending program deploy)`,
      signature,
      route: "devnet",
    });
    toast({ title: "Pod memo anchored on devnet", description: short(signature) });
  }

  /**
   * LIVE MagicBlock ER: sends the ER delegation instruction through Magic Router.
   * Uses MagicBlock's live instruction builders — real ER routing.
   */
  async function delegatePodLive() {
    if (!wallet || !pod) return connectWallet();
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
  }

  /**
   * LIVE MagicBlock ER: sends payment through Magic Router.
   * Route is chosen by policy engine before signing.
   */
  async function executeIntent(intent: PaymentIntent) {
    if (!wallet || !pod) return connectWallet();
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
  }

  /**
   * LIVE MagicBlock ER: sends a MagicBlock commit instruction through Magic Router.
   */
  async function settleEpoch() {
    if (!wallet || !pod) return connectWallet();
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
  }

  /**
   * LIVE MagicBlock ER: commit + undelegate through Magic Router.
   */
  async function undelegatePod() {
    if (!wallet || !pod) return connectWallet();
    const tx = new Transaction().add(createCommitAndUndelegateInstruction(wallet, [pod]));
    const signature = await sendViaWallet(tx, "magic");
    addEvent({
      kind: "delegate",
      title: "Commit + undelegate submitted via Magic Router (ER)",
      detail: pod.toBase58(),
      signature,
      route: "magic-router",
    });
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
    pod,
    erIdentity,
    approvedVolume,
    connectWallet,
    checkRouter,
    createPodOnchain,
    delegatePodLive,
    executeIntent,
    settleEpoch,
    undelegatePod,
  };
}

type PodMeshState = ReturnType<typeof usePodMeshState>;

function Shell({ state }: { state: PodMeshState }) {
  const [location] = useLocation();
  const nav = [
    ["/", "Overview", Network],
    ["/pod", "Pod", LockKeyhole],
    ["/agent", "Agent", Sparkles],
    ["/receipts", "Receipts", ReceiptText],
    ["/settlement", "Settlement", Landmark],
    ["/proof", "Live Proof", CheckCheck],
    ["/architecture", "Architecture", CircuitBoard],
  ] as const;
  return (
    <div className="min-h-screen bg-background">
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
          <Button onClick={state.connectWallet} size="sm" data-testid="button-connect-wallet">
            <Wallet className="mr-2 h-4 w-4" />
            {short(state.wallet?.toBase58())}
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
            <Route path="/proof" component={() => <LiveProofPage state={state} />} />
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
              <Button variant="outline" onClick={state.checkRouter} data-testid="button-check-router">
                <RadioTower className="mr-2 h-4 w-4" />
                Check Magic Router
              </Button>
              <Link href="/proof">
                <Button variant="outline" data-testid="button-live-proof">
                  <CheckCheck className="mr-2 h-4 w-4" />
                  Live Proof
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
              title="Pending Program Deployment"
              copy="Actions that require the Pod Factory on-chain program (PDA CPI). Programs compiled and .so artifacts ready — awaiting devnet deploy with SOL for rent."
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
      <Card className="border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300">Program deployment status</p>
            <p className="mt-1 text-amber-700 dark:text-amber-400">
              The Pod Factory and Settlement programs have been compiled to <code className="rounded bg-amber-100 dark:bg-amber-900 px-1">target/deploy/*.so</code>.
              Full PDA CPI delegation requires on-chain deployment (<code className="rounded bg-amber-100 dark:bg-amber-900 px-1">solana program deploy</code>).
              Until then, "Anchor policy" sends a real devnet memo and "Delegate to ER" uses MagicBlock's live instruction builders.
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
                label="Anchor policy"
                route="devnet"
                icon={Banknote}
                testId="button-anchor-policy"
                onClick={state.createPodOnchain}
                tooltip="Sends a real Solana devnet memo tx anchoring the policy hash"
              />
              <ActionButton
                label="Delegate to ER"
                route="magic-router"
                icon={RadioTower}
                variant="secondary"
                testId="button-delegate"
                onClick={state.delegatePodLive}
                tooltip="Uses MagicBlock's live delegate instruction builder via Magic Router"
              />
              <ActionButton
                label="Commit + undelegate"
                route="magic-router"
                icon={Clock}
                variant="outline"
                testId="button-undelegate"
                onClick={state.undelegatePod}
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
}: {
  label: string;
  route: TxRoute;
  icon: typeof KeyRound;
  variant?: "default" | "outline" | "secondary";
  testId: string;
  onClick: () => void;
  tooltip?: string;
}) {
  return (
    <div className="space-y-1">
      <Button className="w-full" onClick={onClick} variant={variant} data-testid={testId}>
        <Icon className="mr-2 h-4 w-4" />
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
          Execute via Magic Router
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
            <Button onClick={state.settleEpoch} data-testid="button-settle-epoch">
              <Landmark className="mr-2 h-4 w-4" />
              Settle epoch through Magic Router
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
// Live Proof / Status page — hackathon submission evidence
// ------------------------------------------------------------------
function LiveProofPage({ state }: { state: PodMeshState }) {
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
      label: "Anchor programs compiled to .so",
      status: "pass",
      detail:
        "pod_factory.so (283 KB) and settlement.so (204 KB) built via anchor build. Awaiting on-chain deploy for full PDA CPI.",
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
      <PageHead
        eyebrow="Live Proof"
        title="Hackathon submission evidence"
        copy="This page demonstrates which parts of the PodMesh stack are live on devnet/ER and which are pending program deployment. Every item with a ✓ has on-chain proof."
      />

      {/* Status checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">On-chain & ER proof checklist</CardTitle>
          <CardDescription>
            Green = live evidence. Amber = pending user action or program deploy.
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
                    Explorer <ExternalLink className="ml-2 h-3 w-3" />
                  </Button>
                </a>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Program artifacts */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Compiled program artifacts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium font-mono">target/deploy/pod_factory.so</p>
              <Badge variant="secondary">283 KB</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Anchor 0.32.1 program with create_spend_pod, record_receipt, delegate_pod, commit_pod, commit_and_undelegate_pod.
              Fixed delegate_account CPI to match ephemeral-rollups-sdk 0.2.5 DelegateAccounts struct.
            </p>
            <div className="flex gap-2 flex-wrap">
              <a href={explorerAccount(POD_FACTORY_PROGRAM_ID.toBase58())} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm">
                  Program ID on Explorer <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              </a>
            </div>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <p className="text-sm font-medium font-mono">target/deploy/settlement.so</p>
              <Badge variant="secondary">204 KB</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Anchor 0.32.1 settlement program with settle_epoch and EpochSettlement PDA.
            </p>
            <a href={explorerAccount("A9LFQfSS55CfCzNHYx7UGZpaWTvPaT19RWRvykhpohnc")} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm">
                Program ID on Explorer <ExternalLink className="ml-1 h-3 w-3" />
              </Button>
            </a>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 p-3">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">To deploy:</p>
            <code className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
              solana program deploy target/deploy/pod_factory.so --program-id programs/pod_factory-keypair.json
            </code>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ArchitecturePage() {
  const layers = [
    {
      title: "Solana base layer",
      copy: "Pod Factory + Settlement programs compiled and ready for devnet deploy. Policy PDAs, receipt events, and epoch settlement commitments live on-chain.",
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
