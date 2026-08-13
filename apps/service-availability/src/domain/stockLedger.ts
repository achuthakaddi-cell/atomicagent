/**
 * The business logic behind the availability check.
 *
 * Two conditions must BOTH hold for a pass:
 *   1. free stock (on hand minus already reserved) covers the order
 *   2. the supplier's lead time still meets the buyer's required-by date
 *
 * A real warehouse check is exactly this shape. Checking only quantity would
 * be the naive version — plenty of orders fail on timing, not stock.
 *
 * The ledger is deterministic and in-memory, deliberately:
 *   1. A live demo must never depend on a third-party API being up.
 *   2. Judges need to trigger BOTH pass and fail paths on demand.
 *
 * SKU coverage is aligned with the price catalogue so the three services agree
 * on which products exist:
 *   SKU-4471  passes price, passes availability   -> full success path
 *   SKU-4472  passes price, FAILS availability    -> rollback via low stock
 *   SKU-9002  FAILS price,  passes availability   -> rollback via price
 *   SKU-3310  passes everything                   -> second success path
 */

/** One warehouse line. */
interface StockRecord {
    sku: string;
    supplierId: string;
    /** Physical units in the warehouse. */
    onHandUnits: number;
    /** Units already promised to other orders. */
    reservedUnits: number;
    /** Working days from order to dispatch. */
    leadTimeDays: number;
    /** Where the stock physically sits. */
    warehouse: string;
    /** When this line was last counted. */
    countedAt: string;
  }
  
  const LEDGER: readonly StockRecord[] = [
    {
      sku: 'SKU-4471',
      supplierId: 'SUP-BLR-011',
      onHandUnits: 12_000,
      reservedUnits: 1_500,
      leadTimeDays: 3,
      warehouse: 'Peenya Industrial Area, Bengaluru',
      countedAt: '2026-08-12T06:00:00Z',
    },
    {
      sku: 'SKU-4472',
      supplierId: 'SUP-BLR-011',
      // Deliberately thin: 400 free units. A 500-unit order fails here while
      // passing the price check, which is how a judge sees a rollback caused by
      // availability rather than price.
      onHandUnits: 900,
      reservedUnits: 500,
      leadTimeDays: 5,
      warehouse: 'Peenya Industrial Area, Bengaluru',
      countedAt: '2026-08-12T06:00:00Z',
    },
    {
      sku: 'SKU-9002',
      supplierId: 'SUP-PUN-004',
      onHandUnits: 4_000,
      reservedUnits: 200,
      leadTimeDays: 7,
      warehouse: 'Chakan MIDC, Pune',
      countedAt: '2026-08-12T06:00:00Z',
    },
    {
      sku: 'SKU-3310',
      supplierId: 'SUP-BLR-011',
      onHandUnits: 250_000,
      reservedUnits: 12_000,
      leadTimeDays: 2,
      warehouse: 'Peenya Industrial Area, Bengaluru',
      countedAt: '2026-08-12T06:00:00Z',
    },
  ];
  
  /** What the availability check returns. */
  export interface AvailabilityCheckResult {
    passed: boolean;
    reason: string;
    detail: {
      sku: string;
      supplierId: string;
      requestedUnits: number;
      onHandUnits: number;
      reservedUnits: number;
      freeUnits: number;
      leadTimeDays: number;
      earliestDispatch: string;
      requiredBy: string;
      warehouse: string;
      countedAt: string;
      stockSufficient: boolean;
      timingSufficient: boolean;
    } | null;
  }
  
  /**
   * Adds working days to a date, skipping Saturdays and Sundays.
   *
   * Lead times in manufacturing are quoted in working days, not calendar days.
   * Treating them as calendar days would make our answers optimistic — and an
   * optimistic answer here gates a real payment.
   *
   * @param from - starting date
   * @param workingDays - number of working days to add
   * @returns the resulting date
   */
  function addWorkingDays(from: Date, workingDays: number): Date {
    const result = new Date(from.getTime());
    let remaining = workingDays;
  
    while (remaining > 0) {
      result.setUTCDate(result.getUTCDate() + 1);
      const day = result.getUTCDay();
      // 0 = Sunday, 6 = Saturday
      if (day !== 0 && day !== 6) remaining -= 1;
    }
  
    return result;
  }
  
  /**
   * Formats a date as YYYY-MM-DD.
   *
   * @param date - the date to format
   * @returns an ISO calendar date string
   */
  function toIsoDate(date: Date): string {
    const iso = date.toISOString();
    return iso.slice(0, 10);
  }
  
  /**
   * Runs the availability check.
   *
   * @param input - the sourcing request fields this check needs
   * @param input.sku - product code to look up
   * @param input.quantity - units required
   * @param input.requiredBy - delivery deadline, YYYY-MM-DD
   * @param input.supplierId - supplier the buyer intends to order from
   * @param input.now - injectable clock, so tests and demos are reproducible
   * @returns pass/fail plus the full detail, which is withheld until settlement
   */
  export function runAvailabilityCheck(input: {
    sku: string;
    quantity: number;
    requiredBy: string;
    supplierId: string;
    now?: Date;
  }): AvailabilityCheckResult {
    const record = LEDGER.find(
      (candidate) =>
        candidate.sku === input.sku && candidate.supplierId === input.supplierId,
    );
  
    if (!record) {
      return {
        passed: false,
        reason: `No stock record for ${input.sku} at supplier ${input.supplierId}.`,
        detail: null,
      };
    }
  
    const freeUnits = record.onHandUnits - record.reservedUnits;
    const stockSufficient = freeUnits >= input.quantity;
  
    const now = input.now ?? new Date();
    const earliestDispatchDate = addWorkingDays(now, record.leadTimeDays);
    const earliestDispatch = toIsoDate(earliestDispatchDate);
  
    // Compare calendar dates, not timestamps. A dispatch at 23:00 on the required
    // day still meets a deadline expressed as a date.
    const requiredByDate = new Date(`${input.requiredBy}T23:59:59Z`);
    const timingSufficient = earliestDispatchDate.getTime() <= requiredByDate.getTime();
  
    const passed = stockSufficient && timingSufficient;
  
    let reason: string;
    if (!stockSufficient && !timingSufficient) {
      reason = `Only ${freeUnits} units free, and earliest dispatch ${earliestDispatch} misses your deadline.`;
    } else if (!stockSufficient) {
      reason = `Only ${freeUnits} units free against ${input.quantity} required.`;
    } else if (!timingSufficient) {
      reason = `Stock is available but earliest dispatch is ${earliestDispatch}, after your ${input.requiredBy} deadline.`;
    } else {
      reason = `${freeUnits} units free, dispatch by ${earliestDispatch}.`;
    }
  
    return {
      passed,
      reason,
      detail: {
        sku: record.sku,
        supplierId: record.supplierId,
        requestedUnits: input.quantity,
        onHandUnits: record.onHandUnits,
        reservedUnits: record.reservedUnits,
        freeUnits,
        leadTimeDays: record.leadTimeDays,
        earliestDispatch,
        requiredBy: input.requiredBy,
        warehouse: record.warehouse,
        countedAt: record.countedAt,
        stockSufficient,
        timingSufficient,
      },
    };
  }
  
  /**
   * Exposes the ledger for the demo UI.
   *
   * @returns every stock line, so the frontend can show real numbers
   */
  export function listStock(): readonly StockRecord[] {
    return LEDGER;
  }