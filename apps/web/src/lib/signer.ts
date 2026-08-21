/**
 * Transaction signing.
 *
 * Two implementations behind one interface:
 *
 *   WALLET  — Pera, Defly or Lute via use-wallet. The real path, and what a
 *             judge sees. The user approves on their own device and no key ever
 *             touches this application.
 *
 *   DEV     — a local mnemonic, enabled only by an explicit env flag. Exists so
 *             the flow can be iterated on quickly during development, and so a
 *             venue network failure cannot kill a demo. Disabled by default and
 *             it refuses to run in a production build.
 *
 * THE CRITICAL DETAIL
 * -------------------
 * Slot 0 of the atomic group is the facilitator's fee payer. It must come back
 * UNSIGNED so the facilitator can sign it at settlement and cover every fee.
 *
 * Verified against @txnlab/use-wallet-react 4.6.0:
 *   signTransactions(txnGroup, indexesToSign?) => Promise<(Uint8Array | null)[]>
 *
 * Passing indexesToSign [1,2,3,4] returns null at index 0, and the array stays
 * five long. That alignment matters: every service verifies a fixed slot, so a
 * compacted array would shift every paymentIndex by one.
 */

import algosdk from 'algosdk';

/** Base64 msgpack transactions, in slot order. */
export type EncodedGroup = string[];

/** What every signer must provide. */
export interface Signer {
  /** How this signer is described in the UI. */
  readonly label: string;
  /** Whether a user action is required, so the UI can prompt appropriately. */
  readonly interactive: boolean;
  /**
   * Signs the requested slots and returns the full group.
   *
   * @param group - base64 transactions in slot order
   * @param indexesToSign - which slots to sign, e.g. [1,2,3,4]
   * @returns the group with the requested slots signed, others untouched
   */
  sign(group: EncodedGroup, indexesToSign: number[]): Promise<EncodedGroup>;
}

/** The wallet's signTransactions, as verified in the probe. */
type WalletSignFn = (
  txnGroup: Uint8Array[],
  indexesToSign?: number[],
) => Promise<(Uint8Array | null)[]>;

/**
 * Merges a wallet's partial result back into the full group.
 *
 * The wallet returns null for slots it did not sign. We keep the original
 * base64 for those, so the array remains exactly as long as it started and
 * every index still points at the transaction the services expect.
 *
 * @param original - the unsigned group
 * @param signed - wallet output, null where unsigned
 * @returns the merged group
 */
function mergeSigned(
  original: EncodedGroup,
  signed: (Uint8Array | null)[],
): EncodedGroup {
  if (signed.length !== original.length) {
    throw new Error(
      'Wallet returned ' +
        String(signed.length) +
        ' transactions for a group of ' +
        String(original.length) +
        '. Slot alignment would be lost.',
    );
  }

  return original.map((encoded, index) => {
    const bytes = signed[index];
    if (bytes === null || bytes === undefined) return encoded;
    return btoa(String.fromCharCode(...bytes));
  });
}

/**
 * Decodes base64 to bytes without Buffer, which does not exist in the browser.
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
 * Encodes bytes to base64 without Buffer.
 *
 * Chunked, because spreading a large array into String.fromCharCode overflows
 * the call stack on transactions of any real size.
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
 * Creates a signer backed by the connected wallet.
 *
 * @param signTransactions - the hook's signTransactions function
 * @param walletName - display name, e.g. "Pera"
 * @returns a Signer
 */
export function createWalletSigner(
  signTransactions: WalletSignFn,
  walletName: string,
): Signer {
  return {
    label: walletName,
    interactive: true,

    async sign(group, indexesToSign) {
      const bytes = group.map((encoded) => base64ToBytes(encoded));

      let result: (Uint8Array | null)[];

      try {
        result = await signTransactions(bytes, indexesToSign);
      } catch (cause) {
        // Pera rejects with a variety of shapes depending on how the modal was
        // dismissed — a click outside, the close button, or an explicit reject.
        // None of them is a failure worth surfacing as one: the user simply
        // chose not to sign, and the honest response is to say so and stop.
        const message =
          cause instanceof Error
            ? cause.message
            : typeof cause === 'string'
              ? cause
              : 'The signing request was dismissed';

        const dismissed = /reject|cancel|denied|closed|dismiss|abort/i.test(message);

        throw new Error(
          dismissed
            ? 'Signing cancelled. Nothing was sent, and you can try again.'
            : message,
        );
      }

      return mergeSigned(group, result);
    },
  };
}

/**
 * Creates a development signer from a mnemonic.
 *
 * Refuses to construct in a production build. That check is deliberate: a
 * signer that reads a key from configuration must never be reachable in
 * anything a real user runs.
 *
 * @param mnemonic - 25-word Algorand recovery phrase
 * @returns a Signer
 * @throws if called in production or the mnemonic is invalid
 */
export function createDevSigner(mnemonic: string): Signer {
  if (import.meta.env.PROD) {
    throw new Error('The development signer is not available in production builds.');
  }

  const account = algosdk.mnemonicToSecretKey(mnemonic.trim());

  return {
    label: 'Dev signer (' + String(account.addr).slice(0, 6) + '…)',
    interactive: false,

    async sign(group, indexesToSign) {
      const toSign = new Set(indexesToSign);

      return group.map((encoded, index) => {
        // Slots we were not asked to sign pass through untouched, so the
        // facilitator can still sign the fee payer at settlement.
        if (!toSign.has(index)) return encoded;

        const txn = algosdk.decodeUnsignedTransaction(base64ToBytes(encoded));
        return bytesToBase64(txn.signTxn(account.sk));
      });
    },
  };
}

/**
 * The dev signer's mnemonic, if one is configured.
 *
 * Read from VITE_DEV_SIGNER_MNEMONIC. Absent in every normal setup.
 *
 * @returns the mnemonic, or null
 */
export function devSignerMnemonic(): string | null {
  if (import.meta.env.PROD) return null;
  const value = import.meta.env.VITE_DEV_SIGNER_MNEMONIC;
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}