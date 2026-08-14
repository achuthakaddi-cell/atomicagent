# AtomicAgent — On-Chain Proof

All artefacts are on **Algorand TestNet** and independently verifiable.

## The settled atomic group

Five transactions, one group ID, one block.

**[PASTE THE GROUP URL FROM YOUR ADDRESS BAR HERE]**

| Slot | Type | From | To | Amount | Note |
|---|---|---|---|---|---|
| 0 | Payment | Facilitator | self | 0 ALGO | `atomicagent:fees` |
| 1 | Asset Transfer | Buyer | Price service | 0.01 aUSDC | `atomicagent:price` |
| 2 | Asset Transfer | Buyer | Availability service | 0.01 aUSDC | `atomicagent:availability` |
| 3 | Asset Transfer | Buyer | Verification service | 0.01 aUSDC | `atomicagent:verification` |
| 4 | Asset Transfer | Buyer | Supplier | **2,500 aUSDC** | `atomicagent:order` |

Group ID: `BzcTQY9A5wMiQ89cw11l75S7crtqad/EkZBys3tHCh4=`

**Buyer network fee: 0 ALGO.** The facilitator's fee-payer transaction at slot 0
covers the entire group, so the MSME signs once and pays no gas.

## Single transaction detail

https://lora.algokit.io/testnet/transaction/7AZWUWLU7AE4L7UBD3ZVKFG5D2ZP22OBVEGPYMOETB5WTOFEMW3Q

Shows `Fee: 0` and the on-chain note decoding to `atomicagent:price:3e758942`.

## The payment asset

https://lora.algokit.io/testnet/asset/769239123

AtomicAgent Demo USD (`aUSDC`), 6 decimals — same precision as USDC.
No manager, reserve, freeze, or clawback address is set, so no party can
freeze or seize a holder's balance.

Switching to real TestNet USDC (`10458941`) is one environment variable;
all project accounts are already opted into both assets.

## First atomic group

Built before any application code existed, to verify the primitive.

https://lora.algokit.io/testnet/transaction/ABKJPUK7PGMLUXFEQZIWK7VIL354GCJOFDY3K66HI6S5C33DIESA

Four payments, one group, round 66267462.

## The rollback path

There is no URL for a failed run, and that is the point.

When any check fails, the signed transaction group is never submitted. No
transaction exists on Algorand for that run, so there is nothing to reverse.
Searching the explorer returns nothing.

Reproduce it:

```bash
node scripts/test-e2e.mjs SKU-4472   # availability fails: only 400 units free
node scripts/test-e2e.mjs SKU-9002   # price fails: quoted 82.00 vs 5.00 ceiling
```

Both abort after signing, before submission.