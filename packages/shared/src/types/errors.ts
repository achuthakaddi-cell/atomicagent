/**
 * Error taxonomy.
 *
 * Every failure in AtomicAgent carries a stable machine-readable code. The
 * frontend switches on the code to pick the right recovery screen; humans read
 * the message. Never the other way round — message text is for people, codes
 * are for programs.
 */

export const ERROR_CODE = {
    /** Request body, query, or header failed schema validation. */
    VALIDATION_FAILED: 'VALIDATION_FAILED',
  
    /** An upstream service exceeded its timeout budget. Treated as failure. */
    UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  
    /** An upstream service was unreachable or returned a 5xx. */
    UPSTREAM_UNAVAILABLE: 'UPSTREAM_UNAVAILABLE',
  
    /** No X-PAYMENT header. This is the normal 402 path, not a bug. */
    PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  
    /** The facilitator rejected the payment during verify(). */
    PAYMENT_INVALID: 'PAYMENT_INVALID',
  
    /** paymentGroup was absent, empty, or not an array of strings. */
    GROUP_MALFORMED: 'GROUP_MALFORMED',
  
    /** Transactions in the group do not share one group id. */
    GROUP_ID_MISMATCH: 'GROUP_ID_MISMATCH',
  
    /** paymentIndex pointed outside the group. */
    PAYMENT_INDEX_OUT_OF_RANGE: 'PAYMENT_INDEX_OUT_OF_RANGE',
  
    /** The service was paid-verifiable but its business check returned FAIL. */
    CHECK_FAILED: 'CHECK_FAILED',
  
    /** Unknown or expired run id. */
    RUN_NOT_FOUND: 'RUN_NOT_FOUND',
  
    /** Operation attempted in the wrong run phase (e.g. settle before verify). */
    RUN_STATE_INVALID: 'RUN_STATE_INVALID',
  
    /** The facilitator accepted the request but settlement failed on chain. */
    SETTLE_FAILED: 'SETTLE_FAILED',
  
    /** Settlement already happened. Guards against double submission. */
    ALREADY_SETTLED: 'ALREADY_SETTLED',
  
    /** Rate limit exceeded. */
    RATE_LIMITED: 'RATE_LIMITED',
  
    /** Anything unexpected. Details are logged server-side, never returned. */
    INTERNAL: 'INTERNAL',
  } as const;
  
  export type ErrorCode = (typeof ERROR_CODE)[keyof typeof ERROR_CODE];
  
  /** The JSON body every failing endpoint returns. No endpoint invents its own. */
  export interface ErrorBody {
    readonly ok: false;
    readonly code: ErrorCode;
    readonly message: string;
    /** Safe extra context. Never contains stack traces, keys, or internals. */
    readonly detail?: string;
    /** Correlation id, present once a run exists. */
    readonly runId?: string;
  }
  
  /** Default HTTP status per code, so services stay consistent. */
  export const ERROR_HTTP_STATUS: Readonly<Record<ErrorCode, number>> = {
    VALIDATION_FAILED: 400,
    UPSTREAM_TIMEOUT: 504,
    UPSTREAM_UNAVAILABLE: 502,
    PAYMENT_REQUIRED: 402,
    PAYMENT_INVALID: 402,
    GROUP_MALFORMED: 400,
    GROUP_ID_MISMATCH: 400,
    PAYMENT_INDEX_OUT_OF_RANGE: 400,
    CHECK_FAILED: 200, // a FAIL verdict is a valid answer, not an HTTP error
    RUN_NOT_FOUND: 404,
    RUN_STATE_INVALID: 409,
    SETTLE_FAILED: 502,
    ALREADY_SETTLED: 409,
    RATE_LIMITED: 429,
    INTERNAL: 500,
  };
  
  /**
   * The only error type thrown deliberately anywhere in this codebase.
   *
   * Carrying the code and status on the error means the central error handler
   * needs no guesswork, and no route ever hand-rolls an error response.
   */
  export class AppError extends Error {
    readonly code: ErrorCode;
    readonly httpStatus: number;
    readonly detail?: string;
    readonly runId?: string;
  
    /**
     * @param code - stable machine-readable error code
     * @param message - human-readable message, safe to show a user
     * @param options - optional detail, run id, status override, and cause
     */
    constructor(
      code: ErrorCode,
      message: string,
      options?: {
        detail?: string;
        runId?: string;
        httpStatus?: number;
        cause?: unknown;
      },
    ) {
      super(message, options?.cause === undefined ? undefined : { cause: options.cause });
      this.name = 'AppError';
      this.code = code;
      this.httpStatus = options?.httpStatus ?? ERROR_HTTP_STATUS[code];
      this.detail = options?.detail;
      this.runId = options?.runId;
    }
  
    /**
     * Converts to the wire format.
     *
     * @returns the JSON body to send to the client
     */
    toBody(): ErrorBody {
      const body: {
        ok: false;
        code: ErrorCode;
        message: string;
        detail?: string;
        runId?: string;
      } = {
        ok: false,
        code: this.code,
        message: this.message,
      };
      if (this.detail !== undefined) body.detail = this.detail;
      if (this.runId !== undefined) body.runId = this.runId;
      return body;
    }
  }
  
  /**
   * Type guard for AppError.
   *
   * Checks structurally rather than with instanceof, because instanceof breaks
   * across module or realm boundaries in bundled code.
   *
   * @param value - anything caught
   * @returns true if it is an AppError
   */
  export function isAppError(value: unknown): value is AppError {
    return (
      value instanceof Error &&
      'code' in value &&
      'httpStatus' in value &&
      typeof (value as { code: unknown }).code === 'string'
    );
  }