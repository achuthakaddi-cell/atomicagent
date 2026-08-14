/**
 * Frontend configuration.
 *
 * Only VITE_ prefixed variables reach the browser bundle. Nothing secret is
 * ever placed here: the frontend needs the orchestrator URL and an explorer
 * link, and nothing else.
 */

const orchestratorUrl = import.meta.env.VITE_ORCHESTRATOR_URL;
const explorerBaseUrl = import.meta.env.VITE_EXPLORER_BASE_URL;
const network = import.meta.env.VITE_ALGO_NETWORK;

if (!orchestratorUrl) {
  throw new Error(
    'VITE_ORCHESTRATOR_URL is missing. Check .env at the repository root.',
  );
}

export const env = {
  orchestratorUrl: String(orchestratorUrl),
  explorerBaseUrl: String(explorerBaseUrl ?? 'https://lora.algokit.io/testnet'),
  network: String(network ?? 'testnet'),
} as const;

/**
 * Builds an explorer link for a transaction.
 *
 * @param txId - Algorand transaction id
 * @returns full url
 */
export function explorerTx(txId: string): string {
  return env.explorerBaseUrl + '/transaction/' + txId;
}

/**
 * Builds an explorer link for a transaction group.
 *
 * Group ids contain characters that must be percent-encoded, or the explorer
 * link silently resolves to the wrong page.
 *
 * @param groupId - base64 group id
 * @returns full url
 */
export function explorerGroup(groupId: string): string {
  return env.explorerBaseUrl + '/group/' + encodeURIComponent(groupId);
}