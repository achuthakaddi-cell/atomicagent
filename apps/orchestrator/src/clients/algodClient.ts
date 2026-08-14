/**
 * Algod access, with every algosdk 3.6.0 quirk handled in one place.
 *
 * VERIFIED BEHAVIOUR (probe-algosdk.mjs, algosdk 3.6.0):
 *
 *   1. Transaction builders take `sender` and `receiver`, NOT `from` and `to`.
 *      The v2 names are gone. Passing them yields undefined fields and a
 *      transaction the network rejects with an unhelpful message.
 *
 *   2. getTransactionParams() returns BigInt for fee, firstValid, lastValid
 *      and minFee. Mixing those with Number throws
 *      "TypeError: Cannot mix BigInt and other types".
 *
 *   3. txn.sender is an Address OBJECT that prints as the address string.
 *      Comparing it to a string with === is always false. Use String(txn.sender).
 *
 *   4. assignGroupID MUTATES the array in place and also returns it.
 *      This matters more than anything else here: if it only returned copies,
 *      calling it and ignoring the result would leave the originals ungrouped,
 *      and three transactions would settle INDEPENDENTLY with no error raised.
 *      The demo would look correct while the core guarantee silently failed.
 *
 *   5. get_obj_for_encoding() was removed. Use encodeUnsignedTransaction().
 */

import algosdk from 'algosdk';
import { AppError, ERROR_CODE } from '@atomicagent/shared';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/** Shared algod client. Public AlgoNode needs no token. */
export const algod = new algosdk.Algodv2(
  env.algod.token,
  env.algod.server,
  env.algod.port,
);

/**
 * Suggested params, normalised for our use.
 *
 * Two deliberate changes to what algod returns:
 *
 *   flatFee = true with fee = minFee
 *     Fixes the fee per transaction instead of letting it scale with size.
 *     Predictable cost, and it stops a large group from quietly costing more.
 *
 *   lastValid tightened to ~50 rounds (about 2.5 minutes)
 *     Algod's default window is 1000 rounds. A signed-but-unsettled group
 *     would stay submittable for roughly an hour. Since our whole guarantee is
 *     that an aborted run can never settle, we shrink that window hard. After
 *     ~2.5 minutes the transactions are dead even if someone recovers them.
 */
export interface NormalisedParams {
  fee: bigint;
  firstValid: bigint;
  lastValid: bigint;
  genesisID: string;
  genesisHash: Uint8Array;
  minFee: bigint;
  flatFee: boolean;
}

/** How many rounds a signed group stays submittable. ~2.5 minutes. */
export const VALIDITY_WINDOW_ROUNDS = 50n;

/**
 * Fetches and normalises suggested transaction parameters.
 *
 * @returns params ready to hand to algosdk transaction builders
 * @throws AppError if algod cannot be reached
 */
export async function getSuggestedParams(): Promise<NormalisedParams> {
  let raw: Awaited<ReturnType<typeof algod.getTransactionParams.prototype.do>>;

  try {
    raw = await algod.getTransactionParams().do();
  } catch (cause) {
    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'Could not reach the Algorand node',
      {
        detail: cause instanceof Error ? cause.message : 'unknown error',
        cause,
      },
    );
  }

  // Everything numeric arrives as BigInt in v3. Keep it that way.
  const firstValid = BigInt(raw.firstValid);
  const minFee = BigInt(raw.minFee);

  const params: NormalisedParams = {
    fee: minFee,
    firstValid,
    lastValid: firstValid + VALIDITY_WINDOW_ROUNDS,
    genesisID: raw.genesisID,
    genesisHash: raw.genesisHash,
    minFee,
    flatFee: true,
  };

  logger.debug(
    {
      firstValid: params.firstValid.toString(),
      lastValid: params.lastValid.toString(),
      fee: params.fee.toString(),
    },
    'fetched suggested params',
  );

  return params;
}

/**
 * Builds an ASA transfer transaction.
 *
 * Wrapped so the v3 field names live in exactly one place. If algosdk ever
 * renames them again, this is the only function that changes.
 *
 * @param options - transfer details
 * @param options.sender - address paying
 * @param options.receiver - address being paid
 * @param options.amountAtomic - amount in the asset's smallest unit, as a digit string
 * @param options.assetId - ASA id as a digit string
 * @param options.params - suggested params from getSuggestedParams
 * @param options.note - optional note bytes
 * @returns an unsigned Transaction
 */
export function buildAssetTransfer(options: {
  sender: string;
  receiver: string;
  amountAtomic: string;
  assetId: string;
  params: NormalisedParams;
  note?: Uint8Array;
}): algosdk.Transaction {
  return algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: options.sender,
    receiver: options.receiver,
    amount: BigInt(options.amountAtomic),
    assetIndex: BigInt(options.assetId),
    suggestedParams: options.params,
    ...(options.note ? { note: options.note } : {}),
  });
}

/**
 * Builds an ALGO payment transaction.
 *
 * Used for slot 0, the facilitator's fee-payer transaction.
 *
 * @param options - payment details
 * @param options.sender - address paying
 * @param options.receiver - address being paid
 * @param options.amountMicroAlgos - amount in microAlgos
 * @param options.params - suggested params from getSuggestedParams
 * @param options.note - optional note bytes
 * @returns an unsigned Transaction
 */
export function buildPayment(options: {
  sender: string;
  receiver: string;
  amountMicroAlgos: bigint;
  params: NormalisedParams;
  note?: Uint8Array;
}): algosdk.Transaction {
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: options.sender,
    receiver: options.receiver,
    amount: options.amountMicroAlgos,
    suggestedParams: options.params,
    ...(options.note ? { note: options.note } : {}),
  });
}

/**
 * Assigns one group id across a set of transactions, then proves it worked.
 *
 * This is the most important function in the project. Everything AtomicAgent
 * claims rests on these transactions sharing a single group id, so we do not
 * take algosdk's word for it — we read the ids back and compare them.
 *
 * @param txns - transactions to group. Mutated in place.
 * @returns the same array, now carrying group ids
 * @throws AppError if any transaction lacks a group id or the ids differ
 */
export function assignAndVerifyGroup(
  txns: algosdk.Transaction[],
): algosdk.Transaction[] {
  if (txns.length < 2) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'An atomic group needs at least two transactions',
    );
  }

  // Verified: mutates in place AND returns the same array.
  algosdk.assignGroupID(txns);

  const first = txns[0];
  if (!first?.group) {
    throw new AppError(
      ERROR_CODE.GROUP_MALFORMED,
      'assignGroupID did not set a group id',
    );
  }

  const expected = Buffer.from(first.group).toString('base64');

  for (let index = 0; index < txns.length; index += 1) {
    const txn = txns[index];

    if (!txn?.group) {
      throw new AppError(
        ERROR_CODE.GROUP_ID_MISMATCH,
        `Transaction ${index} has no group id`,
      );
    }

    const actual = Buffer.from(txn.group).toString('base64');
    if (actual !== expected) {
      throw new AppError(
        ERROR_CODE.GROUP_ID_MISMATCH,
        `Transaction ${index} has a different group id`,
        { detail: `expected ${expected}, found ${actual}` },
      );
    }
  }

  logger.info(
    { size: txns.length, groupId: expected },
    'atomic group assembled and verified',
  );

  return txns;
}

/**
 * Encodes an unsigned transaction as base64 for transport over HTTP.
 *
 * Verified lossless: decode then re-encode yields identical bytes, so the
 * group id survives the round trip to the browser and back.
 *
 * @param txn - the transaction to encode
 * @returns base64 msgpack
 */
export function encodeTxn(txn: algosdk.Transaction): string {
  return Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64');
}

/**
 * Decodes a base64 unsigned transaction.
 *
 * @param encoded - base64 msgpack
 * @returns the transaction
 * @throws AppError if the bytes are not a valid transaction
 */
export function decodeTxn(encoded: string): algosdk.Transaction {
  try {
    return algosdk.decodeUnsignedTransaction(Buffer.from(encoded, 'base64'));
  } catch (cause) {
    throw new AppError(ERROR_CODE.GROUP_MALFORMED, 'Could not decode transaction', {
      detail: cause instanceof Error ? cause.message : 'unknown error',
      cause,
    });
  }
}

/**
 * Reads an address as a plain string.
 *
 * txn.sender is an Address object, not a string. Comparing it directly to a
 * string with === always returns false, which would silently break any
 * ownership check.
 *
 * @param value - an Address object or string
 * @returns the 58-character address
 */
export function addressToString(value: unknown): string {
  return String(value);
}

/**
 * Confirms the buyer has opted into the payment asset and holds enough of it.
 *
 * On Algorand an account cannot receive an ASA it has not opted into. Catching
 * that here produces a clear message instead of an opaque failure at
 * settlement, after the user has already signed.
 *
 * @param address - the buyer's address
 * @param assetId - ASA id as a digit string
 * @param requiredAtomic - minimum balance needed, in atomic units
 * @returns opt-in status and current balance
 */
export async function checkAssetHolding(
  address: string,
  assetId: string,
  requiredAtomic: string,
): Promise<{ optedIn: boolean; balanceAtomic: string; sufficient: boolean }> {
  try {
    const info = await algod.accountAssetInformation(address, Number(assetId)).do();
    const balance = BigInt(info.assetHolding?.amount ?? 0n);

    return {
      optedIn: true,
      balanceAtomic: balance.toString(),
      sufficient: balance >= BigInt(requiredAtomic),
    };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);

    // Algod returns 404 when the account has not opted into the asset.
    if (message.includes('404') || message.toLowerCase().includes('not found')) {
      return { optedIn: false, balanceAtomic: '0', sufficient: false };
    }

    throw new AppError(
      ERROR_CODE.UPSTREAM_UNAVAILABLE,
      'Could not read the asset holding',
      { detail: message, cause },
    );
  }
}