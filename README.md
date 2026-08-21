# AtomicAgent

**An AI sourcing agent for Indian MSMEs. Three x402-gated verification services
and one supplier payment settle as a single indivisible Algorand transaction —
or nothing settles at all.**

🔗 🔗 **[Live app](https://atomicagent-web-five.vercel.app)** ·
**[On-chain proof](https://lora.algokit.io/testnet/group/CDQ%2BTwwkGDCw2%2BYrSvV5Pa2S7XQbRgDvY23alw81K38%3D)** ·
**[Orchestrator health](https://atomicagentorchestrator-production.up.railway.app/health)**

Built for the x402 Global Challenge by **G-SYNC** — Achutha A Kaddi, Madhumitha D.

---

## The problem

An MSME orders 500 units of steel sheet. They pay the supplier on day zero.
On day two the stock check comes back: the supplier holds 400 units.

The money left two days ago. Recovering it is now a legal problem, not a
technical one.

This happens because **nothing binds the payment to the verification**. They are
separate events with a gap between them, and the gap is where the loss lives.

## What x402 does not solve on its own

x402 turns HTTP 402 into a real payment handshake: a resource server responds
`402 Payment Required` with its terms, the client signs a payment and retries,
and a facilitator settles it.

That works well for a single API call. It does not answer the harder question:
**what happens when you need three independent services to agree before any money
should move?**

Published work on x402 identifies the same gap — payment is not bound to whether
the service actually delivered — and the proposed fixes reach for trusted
execution hardware or zero-knowledge proofs.

## What AtomicAgent does instead

Algorand already has the primitive. An **atomic transaction group** is a set of
transactions sharing one 32-byte identifier. The network accepts all of them or
none. There is no partial state.

AtomicAgent puts the whole decision in one group:

| Slot | Type | From → To | Amount | Signed by |
|------|------|-----------|--------|-----------|
| 0 | pay | facilitator → self | 0 ALGO | **facilitator** |
| 1 | axfer | buyer → price service | tier fee | buyer |
| 2 | axfer | buyer → stock service | tier fee | buyer |
| 3 | axfer | buyer → seller service | tier fee | buyer |
| 4 | axfer | buyer → supplier | order total | buyer |

The buyer signs **once**, for slots 1 to 4.

Each of the three services receives the **same signed group** and its own
`paymentIndex`. Each asks the facilitator to `verify()` its own slot — and stops
there. **No money moves during verification.**

Only if all three return a confirmed answer does the orchestrator call
`settle()`, once, for the entire group.

If any check refuses, the group is discarded unbroadcast. **Searching the
explorer returns no result, because nothing was ever submitted.** There is
nothing to reverse and nothing to refund.

---

## The agent decides how much verification to buy

Each service offers the same check at three price points:

| Tier | Fee | Method | Confidence |
|------|-----|--------|------------|
| shallow | 0.01 | cached snapshot | 68% |
| standard | 0.05 | live source lookup | 90% |
| deep | 0.20 | full audit, cross-referenced | 99% |

These are three entries in the 402 response's `accepts` array — which x402
defines as a list precisely so a client can choose.

The buyer sets a budget. The agent starts every check at the cheapest tier, reads
how certain each answer is, and escalates only where a cheap answer falls below
its confidence threshold.

**Round 1 — shallow on all three, 0.03 total**

| Check | Certainty | Why | Decision |
|-------|-----------|-----|----------|
| price | 62% | cached snapshot is 11 hours old | escalate |
| availability | 68% | pending allocations unresolved | escalate |
| verification | 68% | registry snapshot is stale | escalate |

**Round 2 — standard on all three, +0.15**

| Check | Certainty | Why | Decision |
|-------|-----------|-----|----------|
| price | 90% | confirmed | stop |
| availability | 90% | confirmed | stop |
| verification | 80% | dispute history not visible at this tier | escalate |

**Round 3 — deep on one check, +0.20**

| Check | Certainty | Decision |
|-------|-----------|----------|
| verification | 99% | confirmed, settle |

Settled at **0.38 of a 0.50 budget**.

Escalation changes the amounts, which changes the group, so **the user signs
again**. That is deliberate: pre-authorising a maximum would let the agent spend
money the buyer never specifically approved.

Every decision is recorded with the rationale the agent wrote at the time, and
displayed verbatim in the interface.

### Why this needs x402 specifically

Under a subscription every call is prepaid, so the marginal cost of the deepest
check is zero and the rational move is always to run it. There is nothing to
decide and nothing to audit.

**Escalating because a cheap answer was uncertain only makes sense when each
request costs money.** This is not x402 used as a paywall — it is behaviour that
per-request pricing makes possible and a prepaid model cannot express.

---

## On-chain proof

A real run through the deployed application, on Algorand TestNet:

**Group:** [`CDQ+TwwkGDCw2+YrSvV5Pa2S7XQbRgDvY23alw81K38=`](https://lora.algokit.io/testnet/group/CDQ%2BTwwkGDCw2%2BYrSvV5Pa2S7XQbRgDvY23alw81K38%3D)
**Block:** 66527148 · **6 transactions, one block**

| Slot | To | Amount |
|------|-----|--------|
| 0 | facilitator fee payer → self | 0 ALGO |
| 1 | price service | 0.05 aUSDC |
| 2 | availability service | 0.05 aUSDC |
| 3 | verification service | **0.20 aUSDC** |
| 4 | **carbon service, registered by URL** | **0.025 aUSDC** |
| 5 | supplier | 2,500 aUSDC |

Two things are visible on the explorer that are worth reading closely.

**The buyer paid no network fee.** Slot 0 is a pay-to-self transaction from the
facilitator's fee payer, arriving unsigned in the group the buyer signs. The
facilitator signs it and covers every fee in the group. The buyer holds no ALGO
and never needs any.

**The three verification fees are not equal.** 0.05, 0.05, 0.20 — that is the
agent having escalated the seller check twice, to deep tier, because the cheaper
answers were not certain enough. The spending decision is legible directly from
the chain.

Full detail in **[PROOF.md](./PROOF.md)**.

---

## Architecture

    Browser + Pera wallet
             |
             v
    +--------------------------+
    |  Orchestrator            |
    |  builds the group        |
    |  fans out verification   |
    |  settles once            |
    +---+--------+--------+----+
        |        |        |          same signed group,
        v        v        v          different paymentIndex
    +-------+ +-------+ +-------+
    | price | | stock | | seller|    each independently x402-gated
    | 4101  | | 4102  | | 4103  |
    +---+---+ +---+---+ +---+---+
        |         |         |        verify() only
        +---------+---------+        no money moves
                  |
                  v
    +--------------------------+
    |  GoPlausible facilitator |
    +------------+-------------+
                 |
                 v
    +--------------------------+
    |  Algorand atomic group   |    settle() once, all or nothing
    +--------------------------+

### The pattern this deliberately does not use

`@x402-avm/express` ships `paymentMiddlewareFromConfig`, which runs
verify → serve → settle inside a single request. That is correct for one paid
endpoint and wrong here: it would settle the price check before the stock check
had even run.

AtomicAgent splits the two. Services verify; only the orchestrator settles, and
only once, and only if every check confirmed.

### Stack

| | |
|---|---|
| Chain | Algorand TestNet |
| Protocol | x402 via `@x402-avm/core` and `@x402-avm/avm` 2.6.1 |
| Facilitator | GoPlausible, public endpoint |
| Backend | Node 20, Express, TypeScript strict, Zod — four services on Railway |
| Frontend | React 19, Vite, Tailwind, three.js — on Vercel |
| Wallet | `@txnlab/use-wallet-react`, Pera Mobile |

---

## Running it locally

    pnpm install
    cp .env.example .env      # fill in your own TestNet addresses
    pnpm dev                  # starts all five processes

Open http://localhost:5173

You will need a TestNet Algorand account holding the payment asset, and Pera
Wallet on your phone set to TestNet.

    pnpm -r --parallel typecheck   # all packages
    pnpm health                    # check every service is reachable
    node scripts/test-e2e.mjs      # full backend run, no browser

### Try the failure path

The demo offers three scenarios. Two of them abort:

- **Steel sheet** (`SKU-4471`) — escalates, then settles
- **Galvanised coil** (`SKU-4472`) — the live price has moved above your ceiling
- **Bearing assembly** (`SKU-9002`) — refused at every tier

Running an aborting scenario is worth doing. The signed group is discarded and
nothing reaches the chain.

---

## What we did not build

We did not invent atomic transaction groups. Algorand provides them in its base
protocol, and that is the point — the mechanism that makes this work was already
there, in the network, with no contract to deploy and no contract to audit.

Our contribution is applying that primitive to multi-service x402 orchestration,
so that payment for verification is bound to that verification having actually
happened.

---

## Repository

| Path | Contains |
|------|----------|
| `packages/shared/` | types, schemas, tier definitions — no chain code |
| `apps/service-price/` | x402-gated, paymentIndex 1 |
| `apps/service-availability/` | x402-gated, paymentIndex 2 |
| `apps/service-verification/` | x402-gated, paymentIndex 3 |
| `apps/orchestrator/` | group construction, verify fan-out, settlement |
| `apps/web/` | React frontend |
| `scripts/` | SDK probes, account tooling, end-to-end tests |

The three services are reference implementations of a paid verification
endpoint. Their data layer is a fixture; the interface a real supplier ERP or
government registry would implement is the same one they implement now. The
protocol layer, the group construction, the escalation logic and the settlement
are all real, and the transaction above is the evidence.

---

**G-SYNC** · Achutha A Kaddi · Madhumitha D
Bengaluru, 2026