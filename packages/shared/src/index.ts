/**
 * @atomicagent/shared — the contract every app in this monorepo imports.
 *
 * Depends on zod and nothing else, so it is safe to bundle into the browser.
 */

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------
export {
    ALGO_NETWORK,
    ALGORAND_TESTNET_CAIP2,
    ALGORAND_MAINNET_CAIP2,
    X402_NETWORK,
    X402_VERSION,
    ALGOD_TESTNET_URL,
    INDEXER_TESTNET_URL,
    EXPLORER_TESTNET_BASE,
    MAX_ATOMIC_GROUP_SIZE,
    MIN_TXN_FEE,
    USDC_TESTNET_ASA_ID,
    USDC_DECIMALS,
    ALGORAND_ADDRESS_LENGTH,
    ALGORAND_ADDRESS_REGEX,
    isAlgorandAddressShape,
    explorerTxUrl,
    explorerAccountUrl,
  } from './constants/network.js';
  
  export {
    CHECK_IDS,
    GROUP_SLOT,
    ATOMIC_GROUP_SIZE,
    PAYMENT_INDEX_BY_CHECK,
    CHECK_LABELS,
    CHECK_DESCRIPTIONS,
    DEFAULT_CHECK_FEE_ATOMIC,
    TIMEOUTS_MS,
    RETRY,
    formatAtomicAmount,
    sumAtomicAmounts,
    multiplyAtomicAmount,
  } from './constants/pricing.js';
  
  // ---------------------------------------------------------------------------
  // errors
  // ---------------------------------------------------------------------------
  export { ERROR_CODE, ERROR_HTTP_STATUS, AppError, isAppError } from './types/errors.js';
  export type { ErrorCode, ErrorBody } from './types/errors.js';
  
  // ---------------------------------------------------------------------------
  // x402 types
  // ---------------------------------------------------------------------------
  export { isExactAvmPayloadShape } from './types/x402.js';
  export type {
    Caip2Network,
    PaymentRequirements,
    ResourceInfo,
    PaymentPayload,
    ExactAvmPayloadV2,
    VerifyResponse,
    SettleResponse,
  } from './types/x402.js';
  
  // ---------------------------------------------------------------------------
  // domain types
  // ---------------------------------------------------------------------------
  export { ok } from './types/sourcing.js';
  export type {
    CheckId,
    SourcingRequest,
    RunPhase,
    CheckStatus,
    CheckQuote,
    CheckVerdict,
    QuoteResult,
    VerifyResult,
    SettleResult,
    AbortResult,
    SuccessBody,
  } from './types/sourcing.js';
  
  // ---------------------------------------------------------------------------
  // schemas
  // ---------------------------------------------------------------------------
  export {
    atomicAmountSchema,
    algorandAddressSchema,
    checkIdSchema,
    isoDateSchema,
    sourcingRequestSchema,
    quoteRequestSchema,
    verifyRequestSchema,
    settleRequestSchema,
    runIdParamSchema,
  } from './schemas/sourcing.schema.js';
  export type {
    SourcingRequestInput,
    QuoteRequestInput,
    VerifyRequestInput,
    SettleRequestInput,
  } from './schemas/sourcing.schema.js';
  
  export {
    caip2NetworkSchema,
    paymentRequirementsSchema,
    exactAvmPayloadSchema,
    paymentPayloadSchema,
  } from './schemas/x402.schema.js';
  export type {
    PaymentRequirementsInput,
    ExactAvmPayloadInput,
    PaymentPayloadInput,
  } from './schemas/x402.schema.js';
  // ---------------------------------------------------------------------------
// adaptive spend
// ---------------------------------------------------------------------------
export {
  TIERS,
  TIER_SPECS,
  DEFAULT_POLICY,
  decideEscalation,
} from './types/tiers.js';
export type {
  Tier,
  TierSpec,
  Confidence,
  TierResult,
  SpendPolicy,
  SpendDecision,
} from './types/tiers.js';
// ---------------------------------------------------------------------------
// pluggable services
// ---------------------------------------------------------------------------
export {
  MAX_GROUP_SIZE,
  RESERVED_SLOTS,
  FIRST_EXTERNAL_SLOT,
  MAX_EXTERNAL_SERVICES,
  serviceIdFromUrl,
  chooseOption,
} from './types/pluggable.js';
export type {
  ExternalServiceId,
  DiscoveredOption,
  DiscoveredService,
  DiscoveryFailure,
  DiscoveryResult,
} from './types/pluggable.js';