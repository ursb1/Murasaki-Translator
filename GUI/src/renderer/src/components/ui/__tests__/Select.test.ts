import React from "react";
import { describe, expect, it } from "vitest";
import { normalizeSelectChildren } from "../Select";

describe("normalizeSelectChildren", () => {
  it("parses plain option nodes", () => {
    const items = normalizeSelectChildren([
      React.createElement("option", { value: "a", key: "a" }, "Option A"),
      React.createElement("option", { value: "b", key: "b" }, "Option B"),
    ]);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      type: "option",
      value: "a",
      disabled: false,
    });
    expect(items[1]).toMatchObject({
      type: "option",
      value: "b",
      disabled: false,
    });
  });

  it("supports optgroup and disabled options", () => {
    const items = normalizeSelectChildren(
      React.createElement("optgroup", { label: "Group A", key: "group-a" }, [
        React.createElement("option", { value: "g1-a", key: "g1-a" }, "G1-A"),
        React.createElement(
          "option",
          { value: "g1-b", disabled: true, key: "g1-b" },
          "G1-B",
        ),
      ]),
    );

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      type: "group",
      label: "Group A",
    });
    expect(items[1]).toMatchObject({
      type: "option",
      value: "g1-a",
      disabled: false,
    });
    expect(items[2]).toMatchObject({
      type: "option",
      value: "g1-b",
      disabled: true,
    });
  });

  it("falls back to option text when value is omitted", () => {
    const items = normalizeSelectChildren(
      React.createElement("option", { key: "plain" }, "Plain Label"),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "option",
      value: "Plain Label",
    });
  });
});
