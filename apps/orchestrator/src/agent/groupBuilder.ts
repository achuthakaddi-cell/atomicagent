/**
 * Atomic group construction. The centre of the whole project.
 *
 * THE LAYOUT
 * ----------
 *   index 0   pay     feePayer -> feePayer     UNSIGNED, facilitator signs
 *   index 1   axfer   buyer    -> price svc    check fee
 *   index 2   axfer   buyer    -> availability check fee
 *   index 3   axfer   buyer    -> verification check fee
 *   index 4   axfer   buyer    -> supplier     THE ORDER PAYMENT
 *
 * WHY SLOT 0 IS UNSIGNED
 * ----------------------
 * The facilitator advertises a fee payer address and signs that transaction
 * itself at settlement, covering the network fee for every transaction in the
 * group. The buyer pays zero ALGO in fees. Verified live: the /supported
 * endpoint returns extra.feePayer for Algorand and Solana, but NOT for the EVM
 * networks it also serves. Fee abstraction of this kind is not available there.
 *
 * WHY SLOT 4 EXISTS
 * -----------------
 * Without it, an atomic group of three API fees is a modest convenience. With
 * it, the order payment is bound by the same group id as the verification it
 * depends on. Money and proof become one indivisible event, which is precisely
 * the gap the x402 research literature identifies.
 *
 * WHY THE FEE TRANSACTIONS CARRY ZERO FEE
 * ---------------------------------------
 * In an Algorand group the total fee must cover every transaction, but any one
 * transaction may pay more than its share. Slot 0 pays the whole amount and the
 * other four pay nothing, so the buyer's signature never authorises an ALGO
 * spend of any kind.
 */

import algosdk from 'algosdk';
import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { GROUP_SLOT } from '@atomicagent/shared';
import { ATOMIC_GROUP_SIZE } from '@atomicagent/shared';
import { MIN_TXN_FEE } from '@atomicagent/shared';
import { sumAtomicAmounts } from '@atomicagent/shared';
import type { CheckQuote } from '@atomicagent/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { getSuggestedParams } from '../clients/algodClient.js';
import { buildAssetTransfer } from '../clients/algodClient.js';
import { buildPayment } from '../clients/algodClient.js';
import { assignAndVerifyGroup } from '../clients/algodClient.js';
import { encodeTxn } from '../clients/algodClient.js';
import { checkAssetHolding } from '../clients/algodClient.js';
import type { NormalisedParams } from '../clients/algodClient.js';

/** What the caller must supply to build a group. */
export interface BuildGroupInput {
  /** Wallet that will sign slots 1 to 4. */
  buyerAddress: string;
  /** Facilitator address that will sign slot 0. */
  feePayer: string;
  /** Quotes harvested from the three 402 challenges. */
  quotes: CheckQuote[];
  /** Order payment for slot 4, in atomic units. */
  orderTotalAtomic: string;
  /** Human-readable run reference, written into the transaction notes. */
  runId: string;
}

/** The assembled, unsigned group. */
export interface BuiltGroup {
  /** Base64 msgpack transactions, in slot order. */
  unsignedGroup: string[];
  /** Base64 group id shared by all five transactions. */
  groupId: string;
  /** Sum of the three check fees, atomic units. */
  totalFeesAtomic: string;
  /** Order payment, atomic units. */
  orderTotalAtomic: string;
  /** Everything the buyer's signature authorises, atomic units. */
  grandTotalAtomic: string;
  /** Network fee the buyer pays. Always zero: the facilitator covers it. */
  buyerNetworkFeeMicroAlgos: string;
  /** Round after which the signed group can no longer be submitted. */
  lastValidRound: string;
}

/**
 * Total network fee for the group, paid entirely by slot 0.
 *
 * Five transactions at the minimum fee each. Slot 0 pays this whole amount and
 * the other four are set to zero, which is legal in Algorand as long as the
 * group total is covered.
 */
const GROUP_TOTAL_FEE = BigInt(MIN_TXN_FEE) * BigInt(ATOMIC_GROUP_SIZE);

/**
 * Finds one quote by check id.
 *
 * @param quotes - all harvested quotes
 * @param checkId - which one to find
 * @returns the matching quote
 * @throws AppError if it is missing
 */
function requireQuote(quotes: CheckQuote[], checkId: string): CheckQuote {
  const quote = quotes.find((entry) => entry.checkId === checkId);

  if (!quote) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'Missing the ' + checkId + ' quote, cannot build the payment group',
    );
  }

  return quote;
}

/**
 * Builds a short note for a transaction.
 *
 * Notes are visible on the block explorer, so a judge inspecting the settled
 * group can read what each slot was for rather than seeing five anonymous
 * transfers.
 *
 * @param runId - the run this transaction belongs to
 * @param label - what this slot is for
 * @returns UTF-8 note bytes
 */
function buildNote(runId: string, label: string): Uint8Array {
  const text = 'atomicagent:' + label + ':' + runId.slice(0, 8);
  return new TextEncoder().encode(text);
}

/**
 * Clones suggested params with a specific fee.
 *
 * algosdk reads the fee off the params object, so each slot needs its own copy.
 * Sharing one object would give every transaction the same fee.
 *
 * @param params - base params from algod
 * @param fee - fee in microAlgos for this transaction
 * @returns a new params object
 */
function paramsWithFee(params: NormalisedParams, fee: bigint): NormalisedParams {
  return {
    fee,
    firstValid: params.firstValid,
    lastValid: params.lastValid,
    genesisID: params.genesisID,
    genesisHash: params.genesisHash,
    minFee: params.minFee,
    flatFee: true,
  };
}

/**
 * Builds the five-transaction atomic group.
 *
 * Every transaction is unsigned when it leaves this function. Slots 1 to 4 go
 * to the browser for the wallet to sign; slot 0 is signed by the facilitator at
 * settlement. This service never holds a key and never signs anything.
 *
 * @param input - buyer, fee payer, quotes and order total
 * @returns the encoded group, its group id, and the amounts involved
 * @throws AppError if the buyer cannot pay or the group fails validation
 */
export async function buildAtomicGroup(
  input: BuildGroupInput,
): Promise<BuiltGroup> {
  const priceQuote = requireQuote(input.quotes, 'price');
  const availabilityQuote = requireQuote(input.quotes, 'availability');
  const verificationQuote = requireQuote(input.quotes, 'verification');

  const totalFeesAtomic = sumAtomicAmounts([
    priceQuote.feeAtomic,
    availabilityQuote.feeAtomic,
    verificationQuote.feeAtomic,
  ]);

  const grandTotalAtomic = sumAtomicAmounts([
    totalFeesAtomic,
    input.orderTotalAtomic,
  ]);

  // ---- Pre-flight: can the buyer actually pay? ----
  //
  // Checked BEFORE building anything. On Algorand an account cannot receive an
  // ASA it has not opted into, and a group that fails at settlement fails after
  // the user has already signed. Catching it here produces a clear message at
  // the right moment.
  const holding = await checkAssetHolding(
    input.buyerAddress,
    env.asset.id,
    grandTotalAtomic,
  );

  if (!holding.optedIn) {
    throw new AppError(
      ERROR_CODE.VALIDATION_FAILED,
      'Your wallet has not opted into ' + env.asset.symbol,
      {
        detail:
          'Opt into asset ' +
          env.asset.id +
          ' in your wallet, then try again.',
      },
    );
  }

  if (!holding.sufficient) {
    throw new AppError(
      ERROR_CODE.VALIDATION_FAILED,
      'Not enough ' + env.asset.symbol + ' to cover this order',
      {
        detail:
          'needs ' +
          grandTotalAtomic +
          ' atomic units, wallet holds ' +
          holding.balanceAtomic,
      },
    );
  }

  const params = await getSuggestedParams();

  // ---- Slot 0: the facilitator's fee payer ----
  //
  // Sends zero ALGO to itself. Its only job is to carry the fee for the whole
  // group. Left unsigned; the facilitator signs it during settlement.
  const feePayerTxn = buildPayment({
    sender: input.feePayer,
    receiver: input.feePayer,
    amountMicroAlgos: 0n,
    params: paramsWithFee(params, GROUP_TOTAL_FEE),
    note: buildNote(input.runId, 'fees'),
  });

  // ---- Slots 1 to 3: the three check fees ----
  //
  // Fee set to zero on each. Slot 0 already covers the group total.
  const zeroFeeParams = paramsWithFee(params, 0n);

  const priceTxn = buildAssetTransfer({
    sender: input.buyerAddress,
    receiver: priceQuote.payTo,
    amountAtomic: priceQuote.feeAtomic,
    assetId: priceQuote.asset,
    params: zeroFeeParams,
    note: buildNote(input.runId, 'price'),
  });

  const availabilityTxn = buildAssetTransfer({
    sender: input.buyerAddress,
    receiver: availabilityQuote.payTo,
    amountAtomic: availabilityQuote.feeAtomic,
    assetId: availabilityQuote.asset,
    params: zeroFeeParams,
    note: buildNote(input.runId, 'availability'),
  });

  const verificationTxn = buildAssetTransfer({
    sender: input.buyerAddress,
    receiver: verificationQuote.payTo,
    amountAtomic: verificationQuote.feeAtomic,
    assetId: verificationQuote.asset,
    params: zeroFeeParams,
    note: buildNote(input.runId, 'verification'),
  });

  // ---- Slot 4: the order payment ----
  //
  // The transaction that makes the pitch true. It shares a group id with the
  // three checks above, so it cannot commit unless they all do.
  const orderTxn = buildAssetTransfer({
    sender: input.buyerAddress,
    receiver: env.supplierAddress,
    amountAtomic: input.orderTotalAtomic,
    assetId: env.asset.id,
    params: zeroFeeParams,
    note: buildNote(input.runId, 'order'),
  });

  // ---- Assemble in slot order ----
  //
  // The array index IS the payment index each service verifies against. Order
  // here must match GROUP_SLOT exactly, or every service rejects its payment.
  const txns: algosdk.Transaction[] = [];
  txns[GROUP_SLOT.FEE_PAYER] = feePayerTxn;
  txns[GROUP_SLOT.PRICE] = priceTxn;
  txns[GROUP_SLOT.AVAILABILITY] = availabilityTxn;
  txns[GROUP_SLOT.VERIFICATION] = verificationTxn;
  txns[GROUP_SLOT.ORDER] = orderTxn;

  if (txns.length !== ATOMIC_GROUP_SIZE) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'Built ' + String(txns.length) + ' transactions, expected ' + String(ATOMIC_GROUP_SIZE),
    );
  }

  for (let index = 0; index < txns.length; index += 1) {
    if (!txns[index]) {
      throw new AppError(
        ERROR_CODE.GROUP_MALFORMED,
        'Slot ' + String(index) + ' of the atomic group is empty',
      );
    }
  }

  // ---- Assign one group id, then prove it took ----
  //
  // assignAndVerifyGroup reads the ids back and compares them rather than
  // trusting the call. If the ids did not match, the transactions would settle
  // independently with no error raised anywhere, and the guarantee would be
  // silently false.
  assignAndVerifyGroup(txns);

  const first = txns[0];
  if (!first?.group) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'Group id missing after assignment',
    );
  }

  const groupId = Buffer.from(first.group).toString('base64');

  // ---- Encode for transport ----
  //
  // Verified lossless in the algosdk probe: decode then re-encode yields
  // identical bytes, so the group id survives the trip to the browser.
  const unsignedGroup = txns.map((txn) => encodeTxn(txn));

  logger.info(
    {
      runId: input.runId,
      groupId,
      size: unsignedGroup.length,
      totalFeesAtomic,
      orderTotalAtomic: input.orderTotalAtomic,
      grandTotalAtomic,
      lastValid: params.lastValid.toString(),
    },
    'atomic group built, unsigned',
  );

  return {
    unsignedGroup,
    groupId,
    totalFeesAtomic,
    orderTotalAtomic: input.orderTotalAtomic,
    grandTotalAtomic,
    buyerNetworkFeeMicroAlgos: '0',
    lastValidRound: params.lastValid.toString(),
  };
}

/** Outcome of validating a signed group returned from the wallet. */
export interface GroupValidation {
  valid: boolean;
  reason: string | null;
}

/**
 * Validates the signed group the wallet sends back.
 *
 * The browser could return anything: a different group, a reordered one, or a
 * group with a slot swapped for something cheaper. We check the shape and the
 * count here; the facilitator independently re-checks every signature and
 * amount during verify, so this is a fast first gate rather than the only one.
 *
 * @param signedGroup - base64 signed transactions from the wallet
 * @param expectedSize - how many transactions the group should contain
 * @returns whether the group is acceptable, and why not if it is not
 */
export function validateSignedGroup(
  signedGroup: unknown,
  expectedSize: number,
): GroupValidation {
  if (!Array.isArray(signedGroup)) {
    return { valid: false, reason: 'Signed group is not an array' };
  }

  if (signedGroup.length !== expectedSize) {
    return {
      valid: false,
      reason:
        'Signed group has ' +
        String(signedGroup.length) +
        ' transactions, expected ' +
        String(expectedSize),
    };
  }

  for (let index = 0; index < signedGroup.length; index += 1) {
    const entry: unknown = signedGroup[index];

    if (typeof entry !== 'string' || entry.length === 0) {
      return {
        valid: false,
        reason: 'Slot ' + String(index) + ' is not a base64 string',
      };
    }
  }

  return { valid: true, reason: null };
}