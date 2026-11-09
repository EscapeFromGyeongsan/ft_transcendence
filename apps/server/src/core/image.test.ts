import { describe, expect, test } from "vitest";
import { inspectImage } from "./image.ts";

export function pngHeader(width: number, height: number) {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(13, 8);
  header.write("IHDR", 12, "latin1");
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

// SOI, an APP0 segment to skip, then a baseline frame header (SOF0).
export function jpegHeader(width: number, height: number) {
  const app0 = Buffer.alloc(18);
  app0.writeUInt16BE(0xffe0, 0);
  app0.writeUInt16BE(16, 2);
  const sof0 = Buffer.alloc(19);
  sof0.writeUInt16BE(0xffc0, 0);
  sof0.writeUInt16BE(17, 2);
  sof0[4] = 8;
  sof0.writeUInt16BE(height, 5);
  sof0.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof0]);
}

describe("inspectImage", () => {
  test("reads PNG and JPEG size from the bytes", () => {
    expect(inspectImage(pngHeader(640, 480))).toEqual({
      type: "png",
      width: 640,
      height: 480,
    });
    expect(inspectImage(jpegHeader(320, 200))).toEqual({
      type: "jpg",
      width: 320,
      height: 200,
    });
  });

  test("rejects other formats and truncated headers", () => {
    expect(inspectImage(Buffer.from("<svg></svg>"))).toBeUndefined();
    expect(inspectImage(Buffer.from("GIF89a......"))).toBeUndefined();
    expect(inspectImage(pngHeader(1, 1).subarray(0, 20))).toBeUndefined();
    expect(inspectImage(jpegHeader(1, 1).subarray(0, 22))).toBeUndefined();
    expect(inspectImage(Buffer.from([0xff, 0xd8, 0x00, 0x00]))).toBeUndefined();
  });
});
