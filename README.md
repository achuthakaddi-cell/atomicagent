# AtomicAgent

**x402 settles one payment for one service. Agents rarely need one service.
AtomicAgent is the settlement pattern for the rest: N services verify one signed
transaction group, and payment fires only if every one of them delivers.**

[Live app](https://atomicagent-web-five.vercel.app) ·
[On-chain proof](https://lora.algokit.io/testnet/group/CDQ%2BTwwkGDCw2%2BYrSvV5Pa2S7XQbRgDvY23alw81K38%3D) ·
[Orchestrator health](https://atomicagentorchestrator-production.up.railway.app/health)

Built for the x402 Global Challenge by **G-SYNC** - Achutha A Kaddi, Madhumitha D.

---

## The problem nobody is asking about

Take the canonical agent example: an agent building a game. It needs 3D models,
background music, sound effects, and voice generation. Four services, four x402
payments, four separate settlements.

The models settle. The music settles. **The voice service fails.**

Money is gone. There is no game. The models and music are worthless without the
rest, and the agent has no recourse - each payment was independently valid and
independently final.

This is not a bug in x402. x402 does exactly what it says: it binds one payment
to one HTTP request. The gap is that **agents compose services, and the outcome
usually depends on all of them.**

Published work on x402 identifies the same gap - payment is not bound to whether
the service actually delivered - and the proposed fixes reach for trusted
execution hardware or zero-knowledge proofs.

## What AtomicAgent does instead

Algorand already has the primitive. An **atomic transaction group** is a set of
transactions sharing one 32-byte identifier. The network accepts all of them or
none. There is no partial state.

AtomicAgent puts the whole decision in one group. Every service is paid in the
same group as the thing the agent actually wanted:

| Slot | Type | From -> To | Amount | Signed by |
|------|------|-----------|--------|-----------|
| 0 | pay | facilitator -> self | 0 ALGO | **facilitator** |
| 1 | axfer | buyer -> service A | tier fee | buyer |
| 2 | axfer | buyer -> service B | tier fee | buyer |
| 3 | axfer | buyer -> service C | tier fee | buyer |
| 4 | axfer | buyer -> the actual purchase | order total | buyer |

The buyer signs **once**, for slots 1 to 4.

Each service receives the **same signed group** and its own `paymentIndex`. Each
asks the facilitator to `verify()` its own slot - and stops there. **No money
moves during verification.**

Only if every service returns a confirmed answer does the orchestrator call
`settle()`, once, for the entire group.

If any check refuses, the group is discarded unbroadcast. **Searching the
explorer returns no result, because nothing was ever submitted.** There is
nothing to reverse and nothing to refund.

### Where else this applies

The pattern is not specific to what we demonstrate below:

| Agent | Services that must all succeed |
|---|---|
| Game builder | 3D models, music, sound effects, voice |
| Travel | flight, hotel, visa check |
| Research | three providers that must corroborate |
| Trading | price feed, risk model, compliance check |

In every case the failure of one makes the others worthless. In every case x402
alone settles each independently.

---

## The demonstration: MSME sourcing

An MSME orders 500 units of steel sheet. They pay the supplier on day zero. On
day two the stock check comes back: the supplier holds 400 units.

The money left two days ago. Recovering it is a legal problem now, not a
technical one.

Three checks have to agree before payment makes sense - is the price right, is
the stock actually there, is the seller a real registered business. AtomicAgent
puts all three and the order payment in one group.

This is the worked example, not the product. The product is the settlement
pattern above.

---

## Evidence that the pattern is general

### Any x402 service can join a group it was never written for

Slot 4 of the proof group pays a **carbon-estimation service**. It is not one of
AtomicAgent's three checks. It was registered during that session by pasting a
URL into the interface.

Everything needed to build that payment - amount, payee, asset, network - was
read from that service's own 402 challenge at runtime. No import, no
configuration entry, no code written for it anywhere in the orchestrator.

**Adding a service is pasting a URL.** That is what makes this infrastructure
rather than an application.

### The agent decides how much verification to buy

Each service offers the same check at three price points:

| Tier | Fee | Method | Confidence |
|------|-----|--------|------------|
| shallow | 0.01 | cached snapshot | 68% |
| standard | 0.05 | live source lookup | 90% |
| deep | 0.20 | full audit, cross-referenced | 99% |

These are three entries in the 402 response's `accepts` array - which x402
defines as a list precisely so a client can choose.

The buyer sets a budget. The agent starts every check at the cheapest tier, reads
how certain each answer is, and escalates only where a cheap answer falls below
its confidence threshold.

**Round 1 - shallow on all three, 0.03 total**

| Check | Certainty | Why | Decision |
|-------|-----------|-----|----------|
| price | 62% | cached snapshot is 11 hours old | escalate |
| availability | 68% | pending allocations unresolved | escalate |
| verification | 68% | registry snapshot is stale | escalate |

**Round 2 - standard on all three, +0.15**

| Check | Certainty | Why | Decision |
|-------|-----------|-----|----------|
| price | 90% | confirmed | stop |
| availability | 90% | confirmed | stop |
| verification | 80% | dispute history not visible at this tier | escalate |

**Round 3 - deep on one check, +0.20**

| Check | Certainty | Decision |
|-------|-----------|----------|
| verification | 99% | confirmed, settle |

Settled at **0.38 of a 0.50 budget**.

Escalation changes the amounts, which changes the group, so **the user signs
again**. That is deliberate: pre-authorising a maximum would let the agent spend
money the buyer never specifically approved.

Every decision is recorded with the rationale the agent wrote at the time, and
displayed verbatim in the interface.

**This behaviour requires per-request payment.** Under a subscription the
marginal cost of the deepest check is zero, so the rational move is always to run
it and there is nothing to decide or to audit. Escalating *because a cheap answer
was uncertain* only makes sense when each request costs money.

---

## What this replaces

| | Existing approach | AtomicAgent |
|---|---|---|
| Multiple services | Pay each separately | One signed group |
| One fails after two succeed | Money spent, no result | **Nothing settled** |
| Binding payment to delivery | Escrow contract, TEE, or trust | Algorand's base protocol |
| Contract risk to audit | Yes | **None - there is no contract** |
| Wallet signatures per run | One per service | **One, for all** |
| Network fee to the buyer | Gas, per transaction | **Zero** |
| How much to verify | Fixed price | **The agent decides, within a budget** |
| Adding a new service | Write an integration | **Paste a URL** |

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
verify -> serve -> settle inside a single request. That is correct for one paid
endpoint and wrong here: it would settle the price check before the stock check
had even run.

AtomicAgent splits the two. Services verify; only the orchestrator settles, and
only once, and only if every check confirmed.

### Asset opt-in is handled in the app

On Algorand an account cannot receive an asset it has not opted into, and opting
in raises that account's minimum balance. An agent paying a service therefore has
to know the recipient can receive the asset **before** it spends anything - and
nothing in x402 checks that.

The app detects both conditions on connect and offers a one-click opt-in, or
directs the user to fund the account when they cannot afford the minimum balance
increase. Any Algorand application handling ASAs needs this; it is included
because a judge connecting their own wallet hits it immediately.

### Stack

| | |
|---|---|
| Chain | Algorand TestNet |
| Payment asset | TestNet USDC (`10458941`) |
| Protocol | x402 via `@x402-avm/core` and `@x402-avm/avm` 2.6.1 |
| Facilitator | GoPlausible, public endpoint |
| Backend | Node 20, Express, TypeScript strict, Zod - four services on Railway |
| Frontend | React 19, Vite, Tailwind, three.js - on Vercel |
| Wallet | `@txnlab/use-wallet-react`, Pera Mobile |

---

## On-chain proof

A real run through the deployed application, on Algorand TestNet:

**Group:** [`CDQ+TwwkGDCw2+YrSvV5Pa2S7XQbRgDvY23alw81K38=`](https://lora.algokit.io/testnet/group/CDQ%2BTwwkGDCw2%2BYrSvV5Pa2S7XQbRgDvY23alw81K38%3D)

**Block:** 66527148 · **6 transactions, one block**

| Slot | To | Amount |
|------|-----|--------|
| 0 | facilitator fee payer -> self | 0 ALGO |
| 1 | price service | 0.05 |
| 2 | availability service | 0.05 |
| 3 | verification service | **0.20** |
| 4 | **carbon service, registered at runtime** | 0.025 |
| 5 | supplier | 2,500 |

Three things are visible on the explorer worth reading closely.

**The buyer paid no network fee.** Slot 0 is a pay-to-self transaction from the
facilitator's fee payer, arriving unsigned in the group the buyer signs. The
facilitator signs it and covers every fee. The buyer holds no ALGO and never
needs any.

**The verification fees are not equal.** 0.05, 0.05, 0.20 - the agent escalated
the seller check twice because the cheaper answers were not certain enough. The
spending decision is legible directly from the chain.

**Slot 4 is a service the orchestrator was never written for.** Registered by
URL during that session, its payment built entirely from its own 402 challenge.

**A note on the asset.** These proof groups settled in a custom demo ASA
(`769239123`), used while TestNet USDC faucet availability was uncertain. The
deployed application now runs on TestNet USDC (`10458941`). Switching required
one environment variable and no code change - which is itself the point about
how little of this is hard-coded.

Full detail in **[PROOF.md](./PROOF.md)**.

---

## Running it locally

    pnpm install
    cp .env.example .env      # fill in your own TestNet addresses
    pnpm dev                  # starts all five processes

Open http://localhost:5173

You will need a TestNet Algorand account and Pera Wallet on your phone set to
TestNet. The app will detect whether you hold the payment asset and walk you
through opting in.

    pnpm -r --parallel typecheck   # all packages
    pnpm health                    # check every service is reachable
    node scripts/test-e2e.mjs      # full backend run, no browser

### Try the failure path

The demo offers three scenarios. Two of them abort:

- **Steel sheet** (`SKU-4471`) - escalates, then settles
- **Galvanised coil** (`SKU-4472`) - the live price has moved above your ceiling
- **Bearing assembly** (`SKU-9002`) - refused at every tier

Running an aborting scenario is worth doing. The signed group is discarded and
nothing reaches the chain.

---

## What we did not build

We did not invent atomic transaction groups. Algorand provides them in its base
protocol, and that is the point - the mechanism that makes this work was already
there, in the network, with no contract to deploy and no contract to audit.

Our contribution is applying that primitive to multi-service x402 orchestration,
so that payment for a service is bound to that service having actually delivered.

---

## Repository

| Path | Contains |
|------|----------|
| `packages/shared/` | types, schemas, tier definitions - no chain code |
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