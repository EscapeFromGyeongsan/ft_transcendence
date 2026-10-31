export type ImageInfo = { type: "png" | "jpg"; width: number; height: number };

const pngSignature = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// Reads the real format and size from the file bytes. The file name and the
// client's Content-Type are never trusted. Returns undefined for anything that
// is not a well-formed PNG or JPEG header.
export function inspectImage(data: Buffer): ImageInfo | undefined {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(pngSignature) &&
    data.toString("latin1", 12, 16) === "IHDR"
  ) {
    return {
      type: "png",
      width: data.readUInt32BE(16),
      height: data.readUInt32BE(20),
    };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    return inspectJpeg(data);
  }
  return undefined;
}

// Walks the JPEG segments until the frame header (SOFn), which holds the size.
function inspectJpeg(data: Buffer): ImageInfo | undefined {
  let offset = 2;
  while (offset + 4 <= data.length) {
    if (data[offset] !== 0xff) return undefined;
    const marker = data[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2; // markers without a length
      continue;
    }
    const length = data.readUInt16BE(offset + 2);
    if (length < 2) return undefined;
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) {
      if (offset + 9 > data.length) return undefined;
      return {
        type: "jpg",
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return undefined;
}
