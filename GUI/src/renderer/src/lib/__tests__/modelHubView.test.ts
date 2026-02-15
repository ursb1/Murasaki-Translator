import { describe, it, expect } from "vitest";
import { translations } from "../i18n";

const requiredPaths: Array<string[]> = [
  ["modelHubView", "title"],
  ["modelHubView", "subtitle"],
  ["modelHubView", "steps", "select"],
  ["modelHubView", "steps", "local"],
  ["modelHubView", "steps", "api"],
  ["modelHubView", "steps", "compose"],
  ["modelHubView", "chooseTitle"],
  ["modelHubView", "chooseDesc"],
  ["modelHubView", "localCard", "title"],
  ["modelHubView", "localCard", "desc"],
  ["modelHubView", "localCard", "hint"],
  ["modelHubView", "apiCard", "title"],
  ["modelHubView", "apiCard", "desc"],
  ["modelHubView", "apiCard", "hint"],
  ["modelHubView", "selectAction"],
  ["modelHubView", "selectedAction"],
  ["modelHubView", "localActionsTitle"],
  ["modelHubView", "localActionsDesc"],
  ["modelHubView", "localActionsPrimary"],
  ["modelHubView", "localActionsSecondary"],
  ["modelHubView", "quickTitle"],
  ["modelHubView", "quickDesc"],
  ["modelHubView", "quickBadge"],
  ["modelHubView", "form", "idLabel"],
  ["modelHubView", "form", "nameLabel"],
  ["modelHubView", "form", "baseUrlLabel"],
  ["modelHubView", "form", "apiKeyLabel"],
  ["modelHubView", "form", "modelLabel"],
  ["modelHubView", "form", "timeoutLabel"],
  ["modelHubView", "placeholders", "id"],
  ["modelHubView", "placeholders", "name"],
  ["modelHubView", "placeholders", "baseUrl"],
  ["modelHubView", "placeholders", "apiKey"],
  ["modelHubView", "placeholders", "model"],
  ["modelHubView", "placeholders", "timeout"],
  ["modelHubView", "help", "id"],
  ["modelHubView", "help", "apiKey"],
  ["modelHubView", "help", "timeout"],
  ["modelHubView", "save"],
  ["modelHubView", "saveAndOpen"],
  ["modelHubView", "reset"],
  ["modelHubView", "saveOk"],
  ["modelHubView", "saveFail"],
  ["modelHubView", "missingRequired"],
  ["modelHubView", "advancedTitle"],
  ["modelHubView", "advancedDesc"],
  ["modelHubView", "advancedAction"],
];

const getValue = (obj: any, path: string[]) =>
  path.reduce((acc, key) => (acc ? acc[key] : undefined), obj);

describe("modelHubView i18n", () => {
  it("includes all required model hub view strings", () => {
    for (const lang of Object.values(translations)) {
      for (const path of requiredPaths) {
        const value = getValue(lang, path);
        expect(value).toBeTruthy();
        expect(typeof value).toBe("string");
      }
    }
  });
});
