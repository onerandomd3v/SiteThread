import { describe, expect, it } from "vitest";
import { validateReferenceMedia } from "./preflight";

const valid = { durationSeconds: 90, streams: [{ codecType: "video", codecName: "h264" }, { codecType: "audio", codecName: "aac" }], byteSize: 10_000, sha256: "a".repeat(64) };

describe("live reference media preflight", () => {
  it("accepts the approved MP4 envelope", () => {
    expect(validateReferenceMedia(valid)).toEqual(valid);
  });

  it.each([
    ["short", { durationSeconds: 59 }],
    ["long", { durationSeconds: 121 }],
    ["non-finite", { durationSeconds: Number.NaN }],
    ["silent", { streams: [{ codecType: "video", codecName: "h264" }] }],
    ["unsupported video", { streams: [{ codecType: "video", codecName: "vp9" }, { codecType: "audio", codecName: "aac" }] }],
  ])("rejects %s reference media", (_label, override) => {
    expect(() => validateReferenceMedia({ ...valid, ...override })).toThrow();
  });
});
