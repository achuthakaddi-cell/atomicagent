/**
 * Shipment carbon estimation.
 *
 * WHY THIS DOMAIN
 * ---------------
 * Price, stock and seller status are things a buyer could in principle look up
 * themselves. Carbon is not: it needs route distances, modal emissions factors,
 * and load assumptions that only a specialist holds. That makes it a plausible
 * thing to actually pay for, which matters — a demonstration service that
 * nobody would ever buy proves less than one they might.
 *
 * It is also becoming a compliance requirement rather than a nicety. Indian
 * exporters shipping into the EU face CBAM reporting, and an MSME sourcing
 * agent that surfaces embedded emissions at quote time is solving a real
 * problem rather than an invented one.
 *
 * ABOUT THE NUMBERS
 * -----------------
 * The emissions factors below are published sector averages, not measurements.
 * A production service would use route-specific data, actual load factors and
 * fuel mix. Stated plainly here rather than implied to be more than they are.
 */

/** Grams of CO2 equivalent per tonne-kilometre, by transport mode. */
const EMISSIONS_FACTORS = {
    road: 62,
    rail: 22,
    sea: 8,
    air: 602,
  } as const;
  
  export type TransportMode = keyof typeof EMISSIONS_FACTORS;
  
  /** Approximate road distances between Indian industrial centres, in km. */
  const DISTANCES: Record<string, number> = {
    'bengaluru-chennai': 350,
    'bengaluru-pune': 840,
    'bengaluru-hyderabad': 570,
    'bengaluru-delhi': 2150,
    'bengaluru-mumbai': 980,
    'chennai-pune': 1180,
    'chennai-hyderabad': 630,
    'chennai-delhi': 2180,
    'pune-hyderabad': 560,
    'pune-delhi': 1430,
    'hyderabad-delhi': 1580,
  };
  
  /**
   * EU CBAM reporting threshold, in kilograms of CO2 equivalent per shipment.
   *
   * Above this, an exporter must report embedded emissions. Surfacing it at quote
   * time is the point of buying this check rather than computing it later.
   */
  const CBAM_THRESHOLD_KG = 1000;
  
  /** What the carbon check returns. */
  export interface CarbonEstimate {
    /** Kilograms of CO2 equivalent for the whole shipment. */
    totalKgCo2e: number;
    /** Per unit shipped. */
    perUnitKgCo2e: number;
    /** Distance used, in kilometres. */
    distanceKm: number;
    /** Mode assumed. */
    mode: TransportMode;
    /** Grams per tonne-kilometre applied. */
    factorGramsPerTonneKm: number;
    /** Shipment weight in tonnes. */
    weightTonnes: number;
    /** Whether this shipment crosses the CBAM reporting threshold. */
    cbamReportable: boolean;
    /** What a lower-carbon mode would save, when one applies. */
    alternative: {
      mode: TransportMode;
      totalKgCo2e: number;
      savingKgCo2e: number;
      savingPercent: number;
    } | null;
    /** Plain-language summary. */
    summary: string;
    /** Named so the estimate can be judged rather than taken on trust. */
    methodology: string;
  }
  
  /**
   * Normalises a city pair into a lookup key, order-independent.
   *
   * @param from - origin city
   * @param to - destination city
   * @returns the key, alphabetically ordered
   */
  function routeKey(from: string, to: string): string {
    const a = from.trim().toLowerCase();
    const b = to.trim().toLowerCase();
    return a < b ? a + '-' + b : b + '-' + a;
  }
  
  /**
   * Estimates the carbon footprint of a shipment.
   *
   * Every input is optional. A generic x402 caller cannot know what fields this
   * service wants, so it must produce something useful from an empty body —
   * falling back to a representative domestic road shipment and saying so.
   *
   * @param input - whatever the caller supplied
   * @returns the estimate
   */
  export function estimateCarbon(input: {
    origin?: string;
    destination?: string;
    weightKg?: number;
    units?: number;
    mode?: string;
  }): CarbonEstimate {
    const origin = input.origin ?? 'Bengaluru';
    const destination = input.destination ?? 'Chennai';
    const units = input.units && input.units > 0 ? input.units : 500;
  
    // A steel sheet order is the default assumption: 8 kg per unit is a
    // reasonable figure for 1.2mm cold-rolled sheet at standard dimensions.
    const weightKg = input.weightKg && input.weightKg > 0 ? input.weightKg : units * 8;
  
    const mode: TransportMode =
      input.mode && input.mode in EMISSIONS_FACTORS
        ? (input.mode as TransportMode)
        : 'road';
  
    const distanceKm = DISTANCES[routeKey(origin, destination)] ?? 500;
    const weightTonnes = weightKg / 1000;
    const factor = EMISSIONS_FACTORS[mode];
  
    const totalKgCo2e = (weightTonnes * distanceKm * factor) / 1000;
    const perUnitKgCo2e = totalKgCo2e / units;
  
    // Rail is materially cleaner than road over any meaningful distance, so it is
    // worth naming when the shipment is going far enough for it to be practical.
    let alternative: CarbonEstimate['alternative'] = null;
  
    if (mode === 'road' && distanceKm > 400) {
      const railTotal = (weightTonnes * distanceKm * EMISSIONS_FACTORS.rail) / 1000;
      const saving = totalKgCo2e - railTotal;
  
      alternative = {
        mode: 'rail',
        totalKgCo2e: Math.round(railTotal * 100) / 100,
        savingKgCo2e: Math.round(saving * 100) / 100,
        savingPercent: Math.round((saving / totalKgCo2e) * 1000) / 10,
      };
    }
  
    const cbamReportable = totalKgCo2e > CBAM_THRESHOLD_KG;
  
    const summary =
      Math.round(totalKgCo2e) + ' kg CO2e for ' + units + ' units over ' +
      distanceKm + ' km by ' + mode + '.' +
      (cbamReportable
        ? ' Above the ' + CBAM_THRESHOLD_KG + ' kg CBAM reporting threshold.'
        : ' Below the CBAM reporting threshold.') +
      (alternative
        ? ' Rail would save ' + alternative.savingKgCo2e + ' kg, ' +
          alternative.savingPercent + '%.'
        : '');
  
    return {
      totalKgCo2e: Math.round(totalKgCo2e * 100) / 100,
      perUnitKgCo2e: Math.round(perUnitKgCo2e * 1000) / 1000,
      distanceKm,
      mode,
      factorGramsPerTonneKm: factor,
      weightTonnes: Math.round(weightTonnes * 1000) / 1000,
      cbamReportable,
      alternative,
      summary,
      methodology:
        'Sector-average emissions factors in grams CO2e per tonne-kilometre, ' +
        'applied to a road distance estimate. Not a measurement: a production ' +
        'service would use route-specific data, actual load factors and fuel mix.',
    };
  }