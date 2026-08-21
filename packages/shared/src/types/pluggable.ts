/**
 * Externally registered x402 services.
 *
 * WHAT THIS EXISTS FOR
 * --------------------
 * The three built-in checks are hardcoded: their slots, their payees and their
 * request bodies are known at compile time. That is fine for a demo and wrong
 * as a claim about the protocol.
 *
 * This type describes a service the orchestrator has never seen before, learned
 * entirely from its 402 challenge. Given a URL, we read what it charges, who it
 * pays, and on which network — then build a payment slot for it in the same
 * atomic group as everything else.
 *
 * WHY AN ARBITRARY SERVICE CAN JOIN AT ALL
 * ----------------------------------------
 * The AVM exact scheme defines the payload as
 * `{ paymentGroup: string[]; paymentIndex: number }`. The CLIENT chooses the
 * index and tells the server which slot to verify. A standard x402-avm resource
 * server checks the transaction at that index against its own requirements and
 * has no opinion about what else is in the group.
 *
 * That is the whole mechanism. Nothing about it is specific to services we
 * wrote, which is exactly the point being demonstrated.
 *
 * WHAT DISQUALIFIES A SERVICE
 * ---------------------------
 * A group can only contain transactions on one network, in one asset. A service
 * wanting USDC on Base cannot be a slot in an Algorand group — not because of
 * anything we chose, but because the chain does not work that way. We check and
 * say so plainly rather than failing later with something cryptic.
 */

/** How a discovered service is identified. Not one of the three built-ins. */
export type ExternalServiceId = string;

/** One payment option read from a service's 402 response. */
export interface DiscoveredOption {
  scheme: string;
  network: string;
  asset: string;
  /** Fee in atomic units of the asset. */
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** Whatever the service put in `extra`. Free-form by design. */
  extra: Record<string, unknown> | undefined;
}

/** A service the orchestrator learned about from its 402 challenge alone. */
export interface DiscoveredService {
  /** Stable id derived from the URL, so the UI can key on it. */
  id: ExternalServiceId;
  /** The endpoint that was probed. */
  url: string;
  /** Description from the 402 body, when the service provided one. */
  description: string | null;
  /** Every payment option the service advertised, in the order given. */
  options: DiscoveredOption[];
  /** The option we selected — cheapest compatible one. */
  chosen: DiscoveredOption;
  /** Slot this service will occupy in the group. Assigned by the orchestrator. */
  paymentIndex: number;
  /** When this was discovered, so a stale quote can be re-fetched. */
  discoveredAt: number;
}

/** Why a service could not be registered. */
export type DiscoveryFailure =
  | 'unreachable'
  | 'not_x402'
  | 'no_accepts'
  | 'wrong_network'
  | 'wrong_asset'
  | 'unsupported_scheme'
  | 'group_full'
  | 'malformed';

/** The result of probing a URL. */
export interface DiscoveryResult {
  ok: boolean;
  service: DiscoveredService | null;
  failure: DiscoveryFailure | null;
  /** Human-readable explanation, shown directly in the UI. */
  message: string;
}

/**
 * Algorand's hard limit on transactions in one atomic group.
 *
 * Not a design choice — it is a protocol constant, and exceeding it means the
 * network rejects the group outright.
 */
export const MAX_GROUP_SIZE = 16;

/**
 * Where external services start in the group.
 *
 * Slots 0 to 3 are the fee payer and the three built-in checks. External
 * services occupy slot 4 onward, and the order payment is pushed to the end —
 * so registering a service never renumbers anything that already exists.
 *
 * Counting the order payment here was a bug: it made the first external service
 * land on the order's slot, and it was paid the order amount instead of its
 * own fee.
 */
export const FIRST_EXTERNAL_SLOT = 4;

/** Kept for compatibility with existing callers. */
export const RESERVED_SLOTS = FIRST_EXTERNAL_SLOT;

/**
 * How many external services can join.
 *
 * Sixteen slots total, four reserved at the front, one for the order payment
 * at the end.
 */
export const MAX_EXTERNAL_SERVICES = MAX_GROUP_SIZE - FIRST_EXTERNAL_SLOT - 1;
/**
 * Derives a stable id from a URL.
 *
 * Used as a React key and as a map key, so it must be deterministic — the same
 * URL registered twice has to produce the same id, or the UI will render
 * duplicates.
 *
 * @param url - the service endpoint
 * @returns a slug safe to use as an identifier
 */
export function serviceIdFromUrl(url: string): ExternalServiceId {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/[^a-z0-9]+/gi, '-');
    const path = parsed.pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
    return path.length > 0 ? host + '-' + path : host;
  } catch {
    return url.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
  }
}

/**
 * Picks the cheapest option compatible with our group.
 *
 * Cheapest rather than first, because a service listing tiers should not cost
 * more simply because it put its expensive option at the top. The agent buys
 * the least it can and escalates only if it must — the same principle the
 * built-in checks follow.
 *
 * @param options - everything the service advertised
 * @param network - the network our group is on
 * @param asset - the asset our group pays in
 * @returns the chosen option, or null if none can join
 */
export function chooseOption(
  options: DiscoveredOption[],
  network: string,
  asset: string,
): DiscoveredOption | null {
  const compatible = options.filter(
    (option) =>
      option.scheme === 'exact' &&
      option.network === network &&
      option.asset === asset,
  );

  if (compatible.length === 0) return null;

  return compatible.reduce((cheapest, option) =>
    BigInt(option.amount) < BigInt(cheapest.amount) ? option : cheapest,
  );
}