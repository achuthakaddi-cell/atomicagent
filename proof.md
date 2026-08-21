# On-chain proof
 
AtomicAgent settles verification fees and a supplier payment as a single
indivisible Algorand atomic transaction group. If any check fails, the group is
never submitted — so there is nothing on chain to reverse.
 
## The settled group
 
**Network:** Algorand TestNet
**Group ID:** `CDQ+TwwkGDCw2+YrSvV5Pa2S7XQbRgDvY23alw81K38=`
**Block:** 66527148
**Timestamp:** 21 August 2026, 17:43:34 UTC
**Transactions:** 6 — one payment, five asset transfers
**Total network fee:** 0.006 ALGO, paid by the facilitator
**Network fee paid by the buyer:** **0 ALGO**
 
🔗 **[View the group on AlgoKit Lora](https://lora.algokit.io/testnet/group/CDQ%2BTwwkGDCw2%2BYrSvV5Pa2S7XQbRgDvY23alw81K38%3D)**
 
## What the group contains
 
| Slot | Type | To | Amount | What it is |
|------|------|-----|--------|------------|
| 0 | pay | `ZMFK…22AA` → self | 0 ALGO | facilitator's fee payer |
| 1 | axfer | `PI3C…MTP4` | 0.05 aUSDC | price check, standard tier |
| 2 | axfer | `KKPN…3DFI` | 0.05 aUSDC | stock check, standard tier |
| 3 | axfer | `243X…ENVU` | 0.20 aUSDC | seller check, **deep tier** |
| 4 | axfer | `4Y2I…RVYE` | 0.025 aUSDC | **service registered at runtime** |
| 5 | axfer | `O7IQ…4XVY` | 2,500 aUSDC | the order payment |
 
**Buyer:** `SH3B4MU5GH5XUQ7PFSYE7NRXUZG6JRNQVCQBHFFOV6Y3F7IAP5GOXH2B2I`
 
## Three things this transaction proves
 
### 1. The buyer paid no network fee
 
Slot 0 is a pay-to-self transaction from the facilitator's fee payer. It arrives
**unsigned** in the group the buyer signs, so the facilitator signs it and covers
every fee in the group. The buyer holds no ALGO for gas and never needs any.
 
The group's total fee of 0.006 ALGO was paid entirely from slot 0. Every
transaction the buyer signed carries a fee of zero.
 
This is x402's fee abstraction working end to end, not described in a diagram.
 
### 2. The agent decided how much verification to buy
 
Slots 1, 2 and 3 are not equal:
 
- **0.05** — price check, escalated once to standard tier
- **0.05** — stock check, escalated once to standard tier
- **0.20** — seller check, escalated twice, to **deep** tier
Each service offers three price points. The agent started every check at the
cheapest tier, read how certain each answer was, and escalated only where a cheap
answer fell below its confidence threshold — within a budget the buyer set. The
run settled at 0.38 of a 0.50 budget.
 
Those uneven amounts on the explorer are that decision, recorded on chain.
 
**This behaviour requires per-request payment.** Under a subscription the
marginal cost of the deepest check is zero, so the rational move is always to run
it and there is nothing to reason about. Escalating *because a cheap answer was
uncertain* only makes sense when each request costs money.
 
### 3. Slot 4 belongs to a service the orchestrator was never written for
 
`4Y2I…RVYE` is a carbon-estimation service. It is not one of AtomicAgent's three
checks. It was registered during this session by pasting a URL into the
interface.
 
Everything needed to build that payment — the amount, the payee, the asset, the
network — was read from that service's own 402 challenge at runtime. There is no
import, no configuration entry, and no code written for it anywhere in the
orchestrator.
 
It also differs from the three built-in services in one deliberate way: it has no
fixed slot. AtomicAgent's own checks pin themselves to slots 1, 2 and 3 and
reject a payment pointed anywhere else. A third-party service cannot do that,
because it does not know what group it is in. It verifies whichever payment index
the client declares — which is exactly what the AVM exact scheme specifies, and
why any x402 service can be bound into a settlement this way.
 
Its refusal would have blocked the group like any other check.
 
## Why the group cannot settle partially
 
Every transaction in an Algorand atomic group carries the same 32-byte group
identifier. The network accepts all of them or none. There is no ordering in
which five fees settle but the order payment does not, and no partial state to
unwind.
 
We did not invent atomic groups. Algorand provides them in its base protocol.
Our contribution is applying them to multi-service x402 orchestration, so that
payment for a service is bound to that service having actually delivered.
 
## The failure path
 
When any check refuses, the orchestrator never calls settle. The signed group is
discarded and no transaction is broadcast.
 
Searching the explorer for that run returns no result, because there is nothing
to find. **Nothing was paid, so nothing needs refunding.**
 
Two of the three demo scenarios take this path:
 
- **Galvanised coil** (`SKU-4472`) — the live price has moved above the buyer's
  ceiling. The cached snapshot said otherwise; escalating to a live lookup is
  what caught it.
- **Bearing assembly** (`SKU-9002`) — refused at every tier.
A registered external service refusing produces the same outcome.
 
## An earlier group, for comparison
 
Before the pluggable-service work, the same flow settled five transactions:
 
**Group:** [`Aqy5GZcrjU+9ioBiiPZ0a239cRdQSxCJhC/JFJQsKxE=`](https://lora.algokit.io/testnet/group/Aqy5GZcrjU%2B9ioBiiPZ0a239cRdQSxCJhC%2FJFJQsKxE%3D)
**Block:** 66490781
 
Same mechanism, one fewer participant. The group grows as services register and
the order payment stays last, so nothing already in it is renumbered.
 
## Payment asset
 
[**769239123** — AtomicAgent Demo USD (aUSDC)](https://lora.algokit.io/testnet/asset/769239123), 6 decimals.
 
A custom ASA is used so the demo does not depend on TestNet USDC faucet
availability. Switching to TestNet USDC (`10458941`) or MainNet USDC
(`31566704`) requires changing one environment variable and no code.
 
## Verify it yourself
 
1. Open the [group on Lora](https://lora.algokit.io/testnet/group/CDQ%2BTwwkGDCw2%2BYrSvV5Pa2S7XQbRgDvY23alw81K38%3D)
2. Confirm 6 transactions, one block, one group ID
3. Confirm slot 0 is a 0 ALGO pay-to-self from an address that is not the buyer,
   and that it carries the whole 0.006 ALGO fee
4. Confirm the buyer's own transactions each carry a fee of zero
5. Note that slots 1, 2 and 3 differ in amount — that is the agent's spending
   decision, not a fixed price list
6. Note slot 4, paying a fifth account 0.025 — a service registered by URL during
   the session, which the orchestrator had no compile-time knowledge of`