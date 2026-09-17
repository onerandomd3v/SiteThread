import { describe, expect, it } from "vitest";
import { hasMp4Ftyp } from "./r2";

describe("R2 upload signature verification", () => {
  it("accepts an ISO Base Media ftyp header", () => {
    const header = new Uint8Array([0, 0, 0, 16, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0]);
    expect(hasMp4Ftyp(header)).toBe(true);
  });

  it("rejects arbitrary bytes", () => {
    expect(hasMp4Ftyp(new Uint8Array(64))).toBe(false);
  });
});
