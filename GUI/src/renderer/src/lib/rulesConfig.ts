import type { FileConfig } from "../types/common";

type RuleMode = "pre" | "post";

type StorageReader = Pick<Storage, "getItem">;

const readJsonArray = (storage: StorageReader, key: string): any[] => {
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const resolveRulesFromProfile = (
  storage: StorageReader,
  mode: RuleMode,
  profileId?: string | null,
): any[] | undefined => {
  const id = String(profileId || "").trim();
  if (!id) return undefined;
  const profiles = readJsonArray(storage, `config_rules_${mode}_profiles`);
  const matched = profiles.find((profile: any) => profile?.id === id);
  if (!matched || !Array.isArray(matched.rules)) return undefined;
  return matched.rules;
};

export const resolveRuleListForRun = (
  mode: RuleMode,
  fileConfig?: FileConfig,
  storage: StorageReader = localStorage,
): any[] => {
  const customProfileId =
    mode === "pre" ? fileConfig?.rulesPreProfileId : fileConfig?.rulesPostProfileId;
  const activeProfileId = storage.getItem(`config_rules_${mode}_active_profile`);
  const directRules = readJsonArray(storage, `config_rules_${mode}`);
  return (
    resolveRulesFromProfile(storage, mode, customProfileId) ??
    resolveRulesFromProfile(storage, mode, activeProfileId) ??
    directRules
  );
};
