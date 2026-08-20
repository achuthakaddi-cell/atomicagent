/**
 * Atomic group construction. The centre of the whole project.
 *
 * THE LAYOUT
 * ----------
 *   index 0        pay     feePayer -> feePayer     UNSIGNED, facilitator signs
 *   index 1        axfer   buyer    -> price svc    check fee
 *   index 2        axfer   buyer    -> availability check fee
 *   index 3        axfer   buyer    -> verification check fee
 *   index 4..n-2   axfer   buyer    -> external     registered at runtime
 *   index n-1      axfer   buyer    -> supplier     THE ORDER PAYMENT
 *
 * The order payment is ALWAYS LAST. That is not cosmetic: an external service
 * registered at runtime has to be given a slot, and taking one from the middle
 * would renumber the order payment on every registration. Anchoring it at the
 * end means external services occupy the space between the built-in checks and
 * the order, and nothing that already exists has to move.
 *
 * WHY EXTERNAL SERVICES CAN JOIN AT ALL
 * -------------------------------------
 * The AVM exact scheme defines its payload as
 * `{ paymentGroup: string[]; paymentIndex: number }`. Each service verifies the
 * transaction at ITS index against ITS own requirements and has no opinion
 * about the rest of the group. Nothing in that mechanism is specific to
 * services we wrote — which is the claim this feature exists to demonstrate.
 *
 * WHY SLOT 0 IS UNSIGNED
 * ----------------------
 * The facilitator advertises a fee payer address and signs that transaction
 * itself at settlement, covering the network fee for every transaction in the
 * group. The buyer pays zero ALGO in fees. Verified live: the /supported
 * endpoint returns extra.feePayer for Algorand and Solana, but NOT for the EVM
 * networks it also serves. Fee abstraction of this kind is not available there.
 *
 * WHY SLOT 0 CARRIES THE WHOLE FEE
 * --------------------------------
 * In an Algorand group the total fee must cover every transaction, but any one
 * transaction may pay more than its share. Slot 0 pays the lot and every other
 * slot pays nothing, so the buyer's signature never authorises an ALGO spend of
 * any kind. The total scales with group size, so registering a service raises
 * what slot 0 pays and leaves the buyer's cost at zero.
 */

import algosdk from 'algosdk';
import { AppError } from '@atomicagent/shared';
import { ERROR_CODE } from '@atomicagent/shared';
import { GROUP_SLOT } from '@atomicagent/shared';
import { MIN_TXN_FEE } from '@atomicagent/shared';
import { MAX_GROUP_SIZE } from '@atomicagent/shared';
import { sumAtomicAmounts } from '@atomicagent/shared';
import type { CheckQuote, DiscoveredService } from '@atomicagent/shared';
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
  /** Wallet that will sign every slot except 0. */
  buyerAddress: string;
  /** Facilitator address that will sign slot 0. */
  feePayer: string;
  /** Quotes harvested from the three built-in 402 challenges. */
  quotes: CheckQuote[];
  /** Order payment for the final slot, in atomic units. */
  orderTotalAtomic: string;
  /** Human-readable run reference, written into the transaction notes. */
  runId: string;
  /**
   * What each built-in check is owed this round, in atomic units.
   *
   * Exactly the current tier's fee, never a running total. A service identifies
   * which tier a client paid for by matching the amount against its price list,
   * and a cumulative figure matches no tier and is rejected outright.
   */
  cumulativeFees?: Partial<Record<'price' | 'availability' | 'verification', string>>;
  /**
   * Services registered at runtime from their own 402 challenges.
   *
   * Each occupies one slot between the built-in checks and the order payment.
   * The orchestrator has no compile-time knowledge of any of them.
   */
  externalServices?: DiscoveredService[];
}

/** The assembled, unsigned group. */
export interface BuiltGroup {
  /** Base64 msgpack transactions, in slot order. */
  unsignedGroup: string[];
  /** Base64 group id shared by every transaction. */
  groupId: string;
  /** Sum of the three built-in check fees, atomic units. */
  totalFeesAtomic: string;
  /** Sum of the external service fees, atomic units. */
  externalFeesAtomic: string;
  /** Order payment, atomic units. */
  orderTotalAtomic: string;
  /** Everything the buyer's signature authorises, atomic units. */
  grandTotalAtomic: string;
  /** Network fee the buyer pays. Always zero: the facilitator covers it. */
  buyerNetworkFeeMicroAlgos: string;
  /** Round after which the signed group can no longer be submitted. */
  lastValidRound: string;
  /** How many transactions the group actually contains. */
  groupSize: number;
  /** Which slot the order payment ended up in. */
  orderSlot: number;
  /** Slot assignments for the external services, so the UI can label them. */
  externalSlots: Array<{ id: string; url: string; slot: number; feeAtomic: string }>;
}

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
 * group can read what each slot was for rather than seeing anonymous transfers.
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
 * Builds the atomic group.
 *
 * Every transaction is unsigned when it leaves this function. Slot 0 is signed
 * by the facilitator at settlement; everything else goes to the browser for the
 * wallet. This service never holds a key and never signs anything.
 *
 * @param input - buyer, fee payer, quotes, order total and any external services
 * @returns the encoded group, its group id, and the amounts involved
 * @throws AppError if the buyer cannot pay or the group fails validation
 */
export async function buildAtomicGroup(
  input: BuildGroupInput,
): Promise<BuiltGroup> {
  const priceQuote = requireQuote(input.quotes, 'price');
  const availabilityQuote = requireQuote(input.quotes, 'availability');
  const verificationQuote = requireQuote(input.quotes, 'verification');

  const external = input.externalServices ?? [];

  // ---- Group size, computed rather than assumed ----
  //
  // Four built-in slots, one per external service, and the order payment last.
  const groupSize = 4 + external.length + 1;
  const orderSlot = groupSize - 1;

  if (groupSize > MAX_GROUP_SIZE) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'Too many services for one atomic group',
      {
        detail:
          'Algorand allows at most ' + String(MAX_GROUP_SIZE) +
          ' transactions in a group. This run needs ' + String(groupSize) + '.',
      },
    );
  }

  // The fee scales with the group. Slot 0 pays all of it; the buyer pays none.
  const groupTotalFee = BigInt(MIN_TXN_FEE) * BigInt(groupSize);

  // Exactly the current tier's fee per built-in check.
  const priceFee = input.cumulativeFees?.price ?? priceQuote.feeAtomic;
  const availabilityFee =
    input.cumulativeFees?.availability ?? availabilityQuote.feeAtomic;
  const verificationFee =
    input.cumulativeFees?.verification ?? verificationQuote.feeAtomic;

  const totalFeesAtomic = sumAtomicAmounts([
    priceFee,
    availabilityFee,
    verificationFee,
  ]);

  const externalFeesAtomic =
    external.length > 0
      ? sumAtomicAmounts(external.map((service) => service.chosen.amount))
      : '0';

  const grandTotalAtomic = sumAtomicAmounts([
    totalFeesAtomic,
    externalFeesAtomic,
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
          'Opt into asset ' + env.asset.id + ' in your wallet, then try again.',
      },
    );
  }

  if (!holding.sufficient) {
    throw new AppError(
      ERROR_CODE.VALIDATION_FAILED,
      'Not enough ' + env.asset.symbol + ' to cover this order',
      {
        detail:
          'needs ' + grandTotalAtomic + ' atomic units, wallet holds ' +
          holding.balanceAtomic,
      },
    );
  }

  const params = await getSuggestedParams();
  const zeroFeeParams = paramsWithFee(params, 0n);

  // ---- Slot 0: the facilitator's fee payer ----
  //
  // Sends zero ALGO to itself. Its only job is to carry the fee for the whole
  // group. Left unsigned; the facilitator signs it during settlement.
  const feePayerTxn = buildPayment({
    sender: input.feePayer,
    receiver: input.feePayer,
    amountMicroAlgos: 0n,
    params: paramsWithFee(params, groupTotalFee),
    note: buildNote(input.runId, 'fees'),
  });

  // ---- Slots 1 to 3: the built-in checks ----
  const priceTxn = buildAssetTransfer({
    sender: input.buyerAddress,
    receiver: priceQuote.payTo,
    amountAtomic: priceFee,
    assetId: priceQuote.asset,
    params: zeroFeeParams,
    note: buildNote(input.runId, 'price'),
  });

  const availabilityTxn = buildAssetTransfer({
    sender: input.buyerAddress,
    receiver: availabilityQuote.payTo,
    amountAtomic: availabilityFee,
    assetId: availabilityQuote.asset,
    params: zeroFeeParams,
    note: buildNote(input.runId, 'availability'),
  });

  const verificationTxn = buildAssetTransfer({
    sender: input.buyerAddress,
    receiver: verificationQuote.payTo,
    amountAtomic: verificationFee,
    assetId: verificationQuote.asset,
    params: zeroFeeParams,
    note: buildNote(input.runId, 'verification'),
  });

  // ---- Slot 4 onward: services registered at runtime ----
  //
  // Every value here — the payee, the amount, the asset — came out of that
  // service's own 402 challenge. Nothing about it was known at compile time.
  const externalTxns = external.map((service, index) =>
    buildAssetTransfer({
      sender: input.buyerAddress,
      receiver: service.chosen.payTo,
      amountAtomic: service.chosen.amount,
      assetId: service.chosen.asset,
      params: zeroFeeParams,
      note: buildNote(input.runId, 'ext' + String(index)),
    }),
  );

  // ---- Final slot: the order payment ----
  //
  // The transaction that makes the pitch true. It shares a group id with every
  // check above, so it cannot commit unless they all do.
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
  // here must match what every service was told, or verification fails.
  const txns: algosdk.Transaction[] = [];
  txns[GROUP_SLOT.FEE_PAYER] = feePayerTxn;
  txns[GROUP_SLOT.PRICE] = priceTxn;
  txns[GROUP_SLOT.AVAILABILITY] = availabilityTxn;
  txns[GROUP_SLOT.VERIFICATION] = verificationTxn;

  externalTxns.forEach((txn, index) => {
    txns[4 + index] = txn;
  });

  txns[orderSlot] = orderTxn;

  if (txns.length !== groupSize) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'Built ' + String(txns.length) + ' transactions, expected ' + String(groupSize),
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

  const externalSlots = external.map((service) => ({
    id: service.id,
    url: service.url,
    slot: service.paymentIndex,
    feeAtomic: service.chosen.amount,
  }));

  logger.info(
    {
      runId: input.runId,
      groupId,
      size: unsignedGroup.length,
      orderSlot,
      externalCount: external.length,
      totalFeesAtomic,
      externalFeesAtomic,
      orderTotalAtomic: input.orderTotalAtomic,
      grandTotalAtomic,
      lastValid: params.lastValid.toString(),
    },
    external.length > 0
      ? 'atomic group built with externally registered services'
      : 'atomic group built, unsigned',
  );

  return {
    unsignedGroup,
    groupId,
    totalFeesAtomic,
    externalFeesAtomic,
    orderTotalAtomic: input.orderTotalAtomic,
    grandTotalAtomic,
    buyerNetworkFeeMicroAlgos: '0',
    lastValidRound: params.lastValid.toString(),
    groupSize,
    orderSlot,
    externalSlots,
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