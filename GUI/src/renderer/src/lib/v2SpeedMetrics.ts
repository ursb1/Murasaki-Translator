type MetricKey = "chars" | "lines" | "gen" | "eval";

const METRIC_KEYS: MetricKey[] = ["chars", "lines", "gen", "eval"];

export type SpeedMetrics = Record<MetricKey, number>;

export type V2SpeedSmoothingState = {
  lastUpdateAtMs: number;
  lastCounterAtMs: number;
  lastTotals: SpeedMetrics;
  smoothed: SpeedMetrics;
};

export type V2SpeedSmoothingInput = {
  nowMs?: number;
  elapsedSec?: number | null;
  realtime?: Partial<Record<MetricKey, number | null | undefined>>;
  average?: Partial<Record<MetricKey, number | null | undefined>>;
  totals?: Partial<Record<MetricKey, number | null | undefined>>;
};

const ZERO_SPEED: SpeedMetrics = {
  chars: 0,
  lines: 0,
  gen: 0,
  eval: 0,
};

const sanitizeRate = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
};

const weightedMean = (entries: Array<[number | null, number]>): number => {
  let totalWeight = 0;
  let weightedSum = 0;
  for (const [value, weight] of entries) {
    if (value === null || value <= 0 || weight <= 0) continue;
    totalWeight += weight;
    weightedSum += value * weight;
  }
  if (totalWeight <= 0) return 0;
  return weightedSum / totalWeight;
};

const capIntervalSpike = (
  intervalRate: number | null,
  averageRate: number | null,
): number | null => {
  if (intervalRate === null) return null;
  if (averageRate === null || averageRate <= 0) return intervalRate;
  const cap = Math.max(averageRate * 4, averageRate + 6);
  return Math.min(intervalRate, cap);
};

const readMetric = (
  source: Partial<Record<MetricKey, number | null | undefined>> | undefined,
  key: MetricKey,
): number | null => sanitizeRate(source?.[key]);

export const createV2SpeedSmoothingState = (): V2SpeedSmoothingState => ({
  lastUpdateAtMs: 0,
  lastCounterAtMs: 0,
  lastTotals: { ...ZERO_SPEED },
  smoothed: { ...ZERO_SPEED },
});

export const smoothV2SpeedMetrics = (
  state: V2SpeedSmoothingState,
  input: V2SpeedSmoothingInput,
): { state: V2SpeedSmoothingState; speeds: SpeedMetrics } => {
  const nowMs =
    typeof input.nowMs === "number" && Number.isFinite(input.nowMs)
      ? input.nowMs
      : Date.now();
  const elapsedSec = sanitizeRate(input.elapsedSec);

  const nextTotals: SpeedMetrics = { ...state.lastTotals };
  const incomingTotals: Record<MetricKey, number | null> = {
    chars: null,
    lines: null,
    gen: null,
    eval: null,
  };
  let hasIncomingTotals = false;
  for (const key of METRIC_KEYS) {
    const value = readMetric(input.totals, key);
    incomingTotals[key] = value;
    if (value !== null) {
      hasIncomingTotals = true;
      nextTotals[key] = value;
    }
  }

  const intervalRates: Partial<Record<MetricKey, number | null>> = {};
  if (hasIncomingTotals && state.lastCounterAtMs > 0) {
    const dtSec = Math.max((nowMs - state.lastCounterAtMs) / 1000, 0.001);
    for (const key of METRIC_KEYS) {
      const current = incomingTotals[key];
      const previous = state.lastTotals[key];
      if (current === null || previous < 0 || current < previous) {
        intervalRates[key] = null;
        continue;
      }
      intervalRates[key] = Math.max(0, (current - previous) / dtSec);
    }
  }

  const derivedAverage: Partial<Record<MetricKey, number | null>> = {};
  if (elapsedSec !== null && elapsedSec > 0) {
    for (const key of METRIC_KEYS) {
      derivedAverage[key] = Math.max(0, nextTotals[key] / elapsedSec);
    }
  }

  const dtUpdateSec =
    state.lastUpdateAtMs > 0
      ? Math.max((nowMs - state.lastUpdateAtMs) / 1000, 0.001)
      : 0;
  const alpha = state.lastUpdateAtMs > 0 ? 1 - Math.exp(-dtUpdateSec / 2.2) : 1;

  const nextSmoothed: SpeedMetrics = { ...state.smoothed };
  for (const key of METRIC_KEYS) {
    const realtimeRate = readMetric(input.realtime, key);
    const averageRate =
      readMetric(input.average, key) ?? derivedAverage[key] ?? null;
    const intervalRate = capIntervalSpike(
      readMetric(intervalRates, key),
      averageRate,
    );

    let targetRate = 0;
    if (intervalRate !== null && intervalRate > 0) {
      targetRate = weightedMean([
        [intervalRate, 0.6],
        [realtimeRate, 0.25],
        [averageRate, 0.15],
      ]);
    } else {
      targetRate = weightedMean([
        [averageRate, 0.75],
        [realtimeRate, 0.25],
      ]);
    }

    const previousSmoothed = state.smoothed[key];
    let smoothedRate = previousSmoothed;
    if (targetRate > 0) {
      const effectiveAlpha =
        previousSmoothed <= 0 ? Math.max(alpha, 0.45) : alpha;
      smoothedRate =
        previousSmoothed + (targetRate - previousSmoothed) * effectiveAlpha;
    } else if (dtUpdateSec > 0) {
      smoothedRate = previousSmoothed * Math.exp(-dtUpdateSec / 6);
    } else {
      smoothedRate = 0;
    }

    if (averageRate !== null && averageRate > 0) {
      const baseline = averageRate * 0.25;
      smoothedRate = Math.max(smoothedRate, baseline);
    }

    nextSmoothed[key] =
      smoothedRate >= 0.05 ? Number(smoothedRate.toFixed(2)) : 0;
  }

  return {
    state: {
      lastUpdateAtMs: nowMs,
      lastCounterAtMs: hasIncomingTotals ? nowMs : state.lastCounterAtMs,
      lastTotals: nextTotals,
      smoothed: nextSmoothed,
    },
    speeds: nextSmoothed,
  };
};
