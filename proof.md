# On-chain proof

AtomicAgent settles three x402 verification fees and one supplier payment as a
single indivisible Algorand atomic transaction group. If any check fails, the
group is never submitted — so there is nothing on chain to reverse.

## The settled group

**Network:** Algorand TestNet
**Group ID:** `Aqy5GZcrjU+9ioBiiPZ0a239cRdQSxCJhC/JFJQsKxE=`
**Block:** 66490781
**Timestamp:** 20 August 2026, 14:31:22 UTC
**Transactions:** 5 — one payment, four asset transfers
**Total network fee:** 0.005 ALGO, paid by the facilitator
**Network fee paid by the buyer:** **0 ALGO**

🔗 **[View the group on AlgoKit Lora](https://lora.algokit.io/testnet/group/Aqy5GZcrjU%2B9ioBiiPZ0a239cRdQSxCJhC%2FJFJQsKxE%3D)**

## What the group contains

| Slot | Type | From → To | Amount | Signed by |
|------|------|-----------|--------|-----------|
| 0 | pay | `ZMFK…22AA` → self | 0 ALGO | **facilitator** |
| 1 | axfer | buyer → `PI3C…MTP4` | 0.05 aUSDC | buyer |
| 2 | axfer | buyer → `KKPN…3DFI` | 0.05 aUSDC | buyer |
| 3 | axfer | buyer → `243X…ENVU` | 0.20 aUSDC | buyer |
| 4 | axfer | buyer → `O7IQ…4XVY` | 2,500 aUSDC | buyer |

**Buyer:** `SH3B4MU5GH5XUQ7PFSYE7NRXUZG6JRNQVCQBHFFOV6Y3F7IAP5GOXH2B2I`

**Reference transaction:**
[CZAHFX4CULI3D7WM4YA6MD2OQAZEC4L4VG4XOEUS2IJQD7VY7F2A](https://lora.algokit.io/testnet/transaction/CZAHFX4CULI3D7WM4YA6MD2OQAZEC4L4VG4XOEUS2IJQD7VY7F2A)

## Two things this transaction proves

### 1. The buyer paid no network fee

Slot 0 is a pay-to-self transaction from the facilitator's fee payer. It arrives
**unsigned** in the group the buyer signs, so the facilitator signs it and covers
every fee in the group. The buyer holds no ALGO for gas and never needs any.

This is x402's fee abstraction working end to end, not described in a diagram.

### 2. The agent decided how much verification to buy

The three verification fees are not equal:

- **0.05** — price check, escalated once to standard tier
- **0.05** — availability check, escalated once to standard tier
- **0.20** — seller verification, escalated twice, to **deep** tier

Each service offers three price points. The agent started every check at the
cheapest tier, read how certain each answer was, and escalated only where a cheap
answer fell below its confidence threshold — within a budget the buyer set.

Those uneven amounts on the explorer are that decision, recorded on chain.

**This behaviour requires per-request payment.** Under a subscription the
marginal cost of the deepest check is zero, so the rational move is always to run
it and there is nothing to reason about. Escalating *because a cheap answer was
uncertain* only makes sense when each request costs money.

## Why the group cannot settle partially

Every transaction in an Algorand atomic group carries the same 32-byte group
identifier. The network accepts all of them or none. There is no ordering in
which three verification fees settle but the order payment does not, and no
partial state to unwind.

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

## Payment asset

[**769239123** — AtomicAgent Demo USD (aUSDC)](https://lora.algokit.io/testnet/asset/769239123), 6 decimals.

A custom ASA is used so the demo does not depend on TestNet USDC faucet
availability. Switching to TestNet USDC (`10458941`) or MainNet USDC
(`31566704`) requires changing one environment variable and no code.

## Verify it yourself

1. Open the [group on Lora](https://lora.algokit.io/testnet/group/Aqy5GZcrjU%2B9ioBiiPZ0a239cRdQSxCJhC%2FJFJQsKxE%3D)
2. Confirm 5 transactions, one block, one group ID
3. Confirm slot 0 is a 0 ALGO pay-to-self from an address that is not the buyer
4. Confirm the buyer's own transactions carry no fee
5. Note that slots 1, 2 and 3 differ in amount — that is the agent's spending
   decision, not a fixed price list