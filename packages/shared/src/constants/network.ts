/**
 * Network constants for AtomicAgent.
 *
 * Every value here was read out of @x402-avm/avm 2.6.1 during the probe phase
 * and copied deliberately rather than imported. Reason: this package is bundled
 * into the browser, and importing @x402-avm/avm would pull in
 * @algorandfoundation/algokit-utils and viem — hundreds of kilobytes of
 * server-only code the frontend never runs.
 *
 * The backend asserts these values against the real SDK constants at startup,
 * so drift is caught immediately instead of silently.
 */

/** We build on TestNet only. MainNet is never a runtime option in this project. */
export const ALGO_NETWORK = 'testnet' as const;

/** CAIP-2 identifier. Mirrors ALGORAND_TESTNET_CAIP2. */
export const ALGORAND_TESTNET_CAIP2 =
  'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=';

/** Present for completeness and for the startup guard. Never used at runtime. */
export const ALGORAND_MAINNET_CAIP2 =
  'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=';

/** The network every payment requirement in this project declares. */
export const X402_NETWORK = ALGORAND_TESTNET_CAIP2;

/** x402 protocol version. Confirmed: @x402-avm/core exports x402Version = 2. */
export const X402_VERSION = 2;

/** Public AlgoNode endpoints. No API key required. */
export const ALGOD_TESTNET_URL = 'https://testnet-api.algonode.cloud';
export const INDEXER_TESTNET_URL = 'https://testnet-idx.algonode.cloud';

/** Lora block explorer — where judges verify our claims. */
export const EXPLORER_TESTNET_BASE = 'https://lora.algokit.io/testnet';

/**
 * Algorand's hard protocol limit on atomic group size.
 * Mirrors MAX_ATOMIC_GROUP_SIZE. We use 5 of the 16.
 */
export const MAX_ATOMIC_GROUP_SIZE = 16;

/** Minimum transaction fee in microAlgos. Mirrors MIN_TXN_FEE. */
export const MIN_TXN_FEE = 1000;

/** USDC on Algorand TestNet. Mirrors USDC_TESTNET_ASA_ID / USDC_DECIMALS. */
export const USDC_TESTNET_ASA_ID = '10458941';
export const USDC_DECIMALS = 6;

/** Algorand addresses: 58 chars, base32 alphabet (A–Z and 2–7). */
export const ALGORAND_ADDRESS_LENGTH = 58;
export const ALGORAND_ADDRESS_REGEX = /^[A-Z2-7]{58}$/;

/**
 * Checks an Algorand address shape.
 *
 * This is a FORMAT check only — it does not verify the trailing checksum.
 * Cheap enough to run on every request; the SDK does full validation deeper in.
 *
 * @param value - candidate address
 * @returns true if the value looks like an Algorand address
 */
export function isAlgorandAddressShape(value: string): boolean {
  return (
    value.length === ALGORAND_ADDRESS_LENGTH && ALGORAND_ADDRESS_REGEX.test(value)
  );
}

/**
 * Builds an explorer link for a transaction.
 *
 * @param txId - Algorand transaction id
 * @param base - explorer base url, defaults to Lora TestNet
 * @returns full url
 */
export function explorerTxUrl(
  txId: string,
  base: string = EXPLORER_TESTNET_BASE,
): string {
  return `${base}/transaction/${txId}`;
}

/**
 * Builds an explorer link for an account.
 *
 * @param address - Algorand address
 * @param base - explorer base url, defaults to Lora TestNet
 * @returns full url
 */
export function explorerAccountUrl(
  address: string,
  base: string = EXPLORER_TESTNET_BASE,
): string {
  return `${base}/account/${address}`;
}