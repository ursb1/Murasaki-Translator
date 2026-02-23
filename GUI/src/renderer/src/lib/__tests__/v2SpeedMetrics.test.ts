import { describe, expect, it } from "vitest";
import {
  createV2SpeedSmoothingState,
  smoothV2SpeedMetrics,
} from "../v2SpeedMetrics";

describe("v2SpeedMetrics smoothing", () => {
  it("uses average baseline when realtime speed is sparse", () => {
    let state = createV2SpeedSmoothingState();

    const first = smoothV2SpeedMetrics(state, {
      nowMs: 1_000,
      elapsedSec: 10,
      realtime: {
        chars: 0,
        lines: 0,
        gen: 0,
        eval: 0,
      },
      totals: {
        chars: 1_200,
        lines: 120,
        gen: 800,
        eval: 600,
      },
    });
    state = first.state;

    expect(first.speeds.chars).toBeGreaterThan(0);
    expect(first.speeds.lines).toBeGreaterThan(0);
    expect(first.speeds.gen).toBeGreaterThan(0);
    expect(first.speeds.eval).toBeGreaterThan(0);
  });

  it("damps sudden interval spikes", () => {
    let state = createV2SpeedSmoothingState();

    state = smoothV2SpeedMetrics(state, {
      nowMs: 1_000,
      elapsedSec: 10,
      realtime: {
        chars: 0,
        lines: 0,
      },
      totals: {
        chars: 1_000,
        lines: 100,
      },
    }).state;

    const spiky = smoothV2SpeedMetrics(state, {
      nowMs: 1_500,
      elapsedSec: 10.5,
      realtime: {
        chars: 2_000,
        lines: 120,
      },
      average: {
        chars: 95,
        lines: 9.5,
      },
      totals: {
        chars: 2_200,
        lines: 220,
      },
    });

    expect(spiky.speeds.chars).toBeLessThan(1_000);
    expect(spiky.speeds.lines).toBeLessThan(100);
  });

  it("decays smoothly when no new speed signal arrives", () => {
    let state = createV2SpeedSmoothingState();
    const seeded = smoothV2SpeedMetrics(state, {
      nowMs: 1_000,
      elapsedSec: 8,
      average: {
        chars: 150,
        lines: 12,
      },
      totals: {
        chars: 1_200,
        lines: 96,
      },
    });
    state = seeded.state;

    const decayed = smoothV2SpeedMetrics(state, {
      nowMs: 7_000,
      elapsedSec: 14,
      realtime: {
        chars: 0,
        lines: 0,
      },
      average: {
        chars: 0,
        lines: 0,
      },
    });

    expect(decayed.speeds.chars).toBeGreaterThan(0);
    expect(decayed.speeds.chars).toBeLessThan(seeded.speeds.chars);
    expect(decayed.speeds.lines).toBeGreaterThan(0);
    expect(decayed.speeds.lines).toBeLessThan(seeded.speeds.lines);
  });
});
