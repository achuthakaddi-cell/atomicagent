/**
 * ASA opt-in.
 *
 * An Algorand account cannot receive an asset it has not opted into, and
 * opting in permanently raises that account's minimum balance by 0.1 ALGO.
 *
 * Both facts have to reach the UI as distinct states:
 *
 *   not-opted-in       offer the transaction
 *   insufficient-algo  offer the dispenser, never a button that must fail
 *
 * Signing goes through the same Signer interface as settlement, so the dev
 * signer works here too and a venue network failure cannot block the demo.
 */

import algosdk from 'algosdk';
import type { Signer } from './signer';

/** Minimum balance increase per ASA held, in microALGO. Protocol constant. */
export const ASA_MIN_BALANCE_INCREASE = 100_000n;

/** Flat transaction fee, in microALGO. */
export const MIN_TXN_FEE = 1_000n;

export const TESTNET_DISPENSER_URL = 'https://lora.algokit.io/testnet/fund';

export type OptInBlocker = 'none' | 'not-opted-in' | 'insufficient-algo';

export interface OptInStatus {
  address: string;
  assetId: number;
  /** The account already holds the asset. */
  optedIn: boolean;
  /** Asset balance in base units. Zero when opted in but unfunded. */
  assetBalance: bigint;
  /** Spendable ALGO above the current minimum balance, in microALGO. */
  availableAlgo: bigint;
  /** microALGO required to opt in: minimum balance increase plus one fee. */
  optInCost: bigint;
  canAffordOptIn: boolean;
  /** What stands between this wallet and settling, if anything. */
  blocker: OptInBlocker;
  /** Shown to the user verbatim. */
  message: string;
}

export interface OptInResult {
  ok: boolean;
  txId?: string;
  error?: string;
}

/**
 * Formats microALGO for display.
 *
 * @param microAlgo - amount in microALGO
 * @returns a short decimal string, for example "0.101"
 */
export function formatAlgo(microAlgo: bigint): string {
  const whole = microAlgo / 1_000_000n;
  const fraction = (microAlgo % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '');
  return fraction ? String(whole) + '.' + fraction : String(whole);
}

/**
 * Encodes bytes to base64 without Buffer, chunked to avoid a stack overflow.
 *
 * @param bytes - the bytes
 * @returns base64 string
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/**
 * Decodes base64 to bytes without Buffer.
 *
 * @param value - base64 string
 * @returns the bytes
 */
function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Everything the UI needs, in one algod call.
 *
 * @param algod - algod client
 * @param address - the account to inspect
 * @param assetId - the payment asset
 * @returns the opt-in status
 */
export async function getOptInStatus(
  algod: algosdk.Algodv2,
  address: string,
  assetId: number,
): Promise<OptInStatus> {
  const info = await algod.accountInformation(address).do();

  const total = info.amount;
  const minBalance = info.minBalance;
  const availableAlgo = total > minBalance ? total - minBalance : 0n;

  const assets = info.assets ?? [];
  const holding = assets.find((entry) => entry.assetId === BigInt(assetId));

  const optedIn = holding !== undefined;
  const assetBalance = holding ? holding.amount : 0n;

  const optInCost = ASA_MIN_BALANCE_INCREASE + MIN_TXN_FEE;
  const canAffordOptIn = availableAlgo >= optInCost;

  let blocker: OptInBlocker = 'none';
  let message = 'This wallet is ready to receive the payment asset.';

  if (!optedIn && !canAffordOptIn) {
    blocker = 'insufficient-algo';
    message =
      'Opting in costs ' +
      formatAlgo(optInCost) +
      ' ALGO, a 0.1 ALGO minimum-balance increase plus the network fee. ' +
      'This wallet has ' +
      formatAlgo(availableAlgo) +
      ' ALGO spendable. Fund it from the TestNet dispenser, then opt in.';
  } else if (!optedIn) {
    blocker = 'not-opted-in';
    message =
      'This wallet has not opted into asset ' +
      String(assetId) +
      '. Algorand accounts cannot receive an asset until they opt in. ' +
      'This is a one-time transaction costing ' +
      formatAlgo(optInCost) +
      ' ALGO.';
  }

  return {
    address,
    assetId,
    optedIn,
    assetBalance,
    availableAlgo,
    optInCost,
    canAffordOptIn,
    blocker,
    message,
  };
}

/**
 * Builds the opt-in: a zero-amount transfer of the asset to self.
 *
 * @param algod - algod client
 * @param address - the opting-in account
 * @param assetId - the payment asset
 * @returns base64 msgpack of the unsigned transaction
 */
export async function buildOptInTxn(
  algod: algosdk.Algodv2,
  address: string,
  assetId: number,
): Promise<string> {
  const suggestedParams = await algod.getTransactionParams().do();

  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    amount: 0,
    assetIndex: assetId,
    suggestedParams,
  });

  return bytesToBase64(algosdk.encodeUnsignedTransaction(txn));
}

/**
 * Builds, signs, submits and confirms the opt-in.
 *
 * Never throws. Errors come back as plain English a user can act on, because
 * "balance 0 below min 100000" teaches a judge nothing.
 *
 * @param algod - algod client
 * @param address - the opting-in account
 * @param assetId - the payment asset
 * @param signer - the same signer used for settlement
 * @returns the outcome
 */
export async function submitOptIn(
  algod: algosdk.Algodv2,
  address: string,
  assetId: number,
  signer: Signer,
): Promise<OptInResult> {
  try {
    const unsigned = await buildOptInTxn(algod, address, assetId);
    const [signed] = await signer.sign([unsigned], [0]);

    if (!signed) throw new Error('The signer returned nothing to submit.');

    const bytes = base64ToBytes(signed);
    const sent = await algod.sendRawTransaction(bytes).do();
    const txId = sent.txid;

    await algosdk.waitForConfirmation(algod, txId, 4);

    return { ok: true, txId };
  } catch (cause) {
    return { ok: false, error: describeOptInError(cause) };
  }
}

/**
 * Translates algod and wallet errors into something actionable.
 *
 * @param cause - the thrown value
 * @returns a message for the user
 */
export function describeOptInError(cause: unknown): string {
  const raw =
    cause instanceof Error
      ? cause.message
      : typeof cause === 'string'
        ? cause
        : 'The opt-in did not complete.';

  const text = raw.toLowerCase();

  if (text.includes('below min') || (text.includes('balance') && text.includes('min'))) {
    return (
      'Not enough ALGO. Opting in raises this account minimum balance by ' +
      '0.1 ALGO. Fund the wallet at the TestNet dispenser and try again.'
    );
  }
  if (/reject|cancel|denied|dismiss/i.test(raw)) {
    return 'Signing cancelled. Nothing was sent, and you can try again.';
  }
  if (text.includes('overspend')) {
    return 'This account cannot cover the network fee.';
  }
  if (text.includes('asset') && text.includes('missing')) {
    return 'That asset does not exist on this network. Check you are on TestNet.';
  }
  return raw;
}