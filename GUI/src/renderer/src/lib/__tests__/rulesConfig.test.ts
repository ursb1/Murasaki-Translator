import { describe, expect, it } from "vitest";

import { resolveRuleListForRun } from "../rulesConfig";
import type { FileConfig } from "../../types/common";

const createStorage = (entries: Record<string, string | null>) => ({
  getItem: (key: string) => entries[key] ?? null,
});

describe("rulesConfig", () => {
  it("prefers file-level profile rules when profile id is provided", () => {
    const storage = createStorage({
      config_rules_pre_profiles: JSON.stringify([
        { id: "profile-a", rules: [{ pattern: "A", replacement: "B" }] },
      ]),
      config_rules_pre: JSON.stringify([{ pattern: "X", replacement: "Y" }]),
    });
    const fileConfig: FileConfig = { rulesPreProfileId: "profile-a" };

    expect(
      resolveRuleListForRun("pre", fileConfig, storage as Pick<Storage, "getItem">),
    ).toEqual([{ pattern: "A", replacement: "B" }]);
  });

  it("falls back to active profile rules when file-level profile is missing", () => {
    const storage = createStorage({
      config_rules_post_active_profile: "profile-b",
      config_rules_post_profiles: JSON.stringify([
        { id: "profile-b", rules: [{ pattern: "post", replacement: "ok" }] },
      ]),
      config_rules_post: JSON.stringify([{ pattern: "raw", replacement: "raw" }]),
    });

    expect(
      resolveRuleListForRun("post", undefined, storage as Pick<Storage, "getItem">),
    ).toEqual([{ pattern: "post", replacement: "ok" }]);
  });

  it("falls back to direct rules list when profile rules are unavailable", () => {
    const storage = createStorage({
      config_rules_pre_profiles: "not-json",
      config_rules_pre: JSON.stringify([{ pattern: "k", replacement: "v" }]),
    });

    expect(
      resolveRuleListForRun("pre", undefined, storage as Pick<Storage, "getItem">),
    ).toEqual([{ pattern: "k", replacement: "v" }]);
  });
});
