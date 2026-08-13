/**
 * Structural mirrors of the x402 types.
 *
 * Every shape below was copied from the real .d.ts files of @x402-avm/core and
 * @x402-avm/avm 2.6.1 during the probe phase. We mirror rather than import so
 * this package stays browser-safe (see the note at the top of constants/network.ts).
 *
 * Because the shapes are structural, a value typed with ours is assignable to
 * the SDK's and vice versa. If the SDK changes, the backend adapter breaks at
 * compile time — which is exactly the alarm we want.
 */

/**
 * CAIP-2 network identifier, e.g.
 * "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI="
 *
 * The SDK types this as a template literal string. We keep it wide enough to
 * remain assignable while still rejecting a bare unprefixed string.
 */
export type Caip2Network = `${string}:${string}`;

/**
 * What a resource server demands in its 402 response.
 * Verified against @x402-avm/core: PaymentRequirements.
 */
export interface PaymentRequirements {
  /** Always "exact" for this project. */
  scheme: string;
  /** CAIP-2 network identifier. */
  network: Caip2Network;
  /** ASA id as a string, e.g. "10458941" for TestNet USDC. */
  asset: string;
  /** Amount in the asset's smallest unit, as a digit string. */
  amount: string;
  /** 58-character Algorand address that receives the payment. */
  payTo: string;
  /** How long the requirement stays valid. */
  maxTimeoutSeconds: number;
  /** AVM-specific extras: feePayer address, asset decimals. */
  extra: Record<string, unknown>;
}

/** Resource descriptor carried inside a PaymentPayload. */
export interface ResourceInfo {
  [key: string]: unknown;
}

/**
 * The decoded X-PAYMENT header.
 * Verified against @x402-avm/core: PaymentPayload.
 *
 * Note that `accepted` carries THIS server's requirements while `payload`
 * carries the shared transaction group. That separation is what lets one signed
 * group satisfy three different services at once.
 */
export interface PaymentPayload {
  x402Version: number;
  resource?: ResourceInfo;
  /** The requirements this payment claims to satisfy. */
  accepted: PaymentRequirements;
  /** For AVM this holds an ExactAvmPayloadV2. */
  payload: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

/**
 * The AVM exact-scheme payload. The heart of AtomicAgent.
 * Verified against @x402-avm/avm: ExactAvmPayloadV2.
 */
export interface ExactAvmPayloadV2 {
  /**
   * Base64 msgpack transactions forming one atomic group.
   * May include unsigned transactions for the facilitator to sign.
   */
  paymentGroup: string[];
  /** Zero-based index of THIS server's payment inside paymentGroup. */
  paymentIndex: number;
}

/** Facilitator verify() result. Verified against @x402-avm/core: VerifyResponse. */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
  extensions?: Record<string, unknown>;
}

/** Facilitator settle() result. Verified against @x402-avm/core: SettleResponse. */
export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  /** The Algorand transaction id. This becomes our explorer link. */
  transaction: string;
  network: Caip2Network;
  extensions?: Record<string, unknown>;
}

/**
 * Runtime check that an unknown value is an ExactAvmPayloadV2.
 *
 * The SDK ships its own isExactAvmPayload, but this package cannot import it.
 * The logic is deliberately strict: every element must be a non-empty string
 * and the index must land inside the array.
 *
 * @param value - anything, typically PaymentPayload.payload
 * @returns true if the value is a usable AVM payload
 */
export function isExactAvmPayloadShape(
  value: unknown,
): value is ExactAvmPayloadV2 {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as { paymentGroup?: unknown; paymentIndex?: unknown };

  if (!Array.isArray(candidate.paymentGroup)) return false;
  if (candidate.paymentGroup.length === 0) return false;
  if (
    !candidate.paymentGroup.every(
      (entry) => typeof entry === 'string' && entry.length > 0,
    )
  ) {
    return false;
  }

  if (typeof candidate.paymentIndex !== 'number') return false;
  if (!Number.isInteger(candidate.paymentIndex)) return false;
  if (candidate.paymentIndex < 0) return false;
  if (candidate.paymentIndex >= candidate.paymentGroup.length) return false;

  return true;
}