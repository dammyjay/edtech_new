// services/pitchDecks/imageDimensions.js
//
// pptxgenjs's `sizing: { type: 'cover' }` crops an image to fill a frame
// without distorting it — but it computes that crop from whatever width/
// height you pass as the image's own `w`/`h` options, treating those as
// the image's *natural* size. It never fetches the image itself to find
// the real dimensions. Passing the same numbers for both the "natural
// size" and the target frame (an easy mistake) makes the crop math
// collapse to zero — the image just gets squashed to fit, i.e. stretched.
// This fetches just enough of each image to read its real pixel
// dimensions from the file header, so the crop math has something real
// to work with.

const https = require("https");

function fetchHeaderBytes(url, maxBytes = 65536) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { Range: `bytes=0-${maxBytes - 1}` } }, (res) => {
      if (res.statusCode >= 400) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching image header`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.setTimeout(8000, () => req.destroy(new Error("Image header fetch timed out")));
  });
}

// Scans JPEG markers for a Start-Of-Frame segment, which carries the
// image's real width/height. Handles baseline and progressive JPEGs
// (SOF0-SOF2 are the common cases); returns null for anything else
// (including non-JPEG bytes) so the caller can fall back gracefully.
function parseJpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 8 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];

    // Standalone markers with no length-prefixed payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2;
      if (marker === 0xd9) break; // EOI
      continue;
    }

    const segLen = buf.readUInt16BE(offset + 2);
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;

    if (isStartOfFrame) {
      if (offset + 9 > buf.length) return null; // header was truncated by our byte cap
      return {
        height: buf.readUInt16BE(offset + 5),
        width: buf.readUInt16BE(offset + 7),
      };
    }

    offset += 2 + segLen;
  }

  return null;
}

// PNG's IHDR chunk (always the first chunk, at a fixed offset) carries
// width/height directly — needed for school logos, which are requested
// from Cloudinary as PNG (see deckTheme.js's resolveLogo) to preserve
// transparency rather than flattening onto a JPEG background.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function parsePngDimensions(buf) {
  if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const DEFAULT_ASPECT = { width: 4, height: 3 };

// Never throws — a photo the deck can't measure just falls back to a
// plausible landscape aspect ratio rather than blocking generation.
async function getImageDimensions(url, fallback = DEFAULT_ASPECT) {
  if (!url) return fallback;
  try {
    const bytes = await fetchHeaderBytes(url);
    return parseJpegDimensions(bytes) || parsePngDimensions(bytes) || fallback;
  } catch (err) {
    console.error(`Could not determine dimensions for ${url}:`, err.message);
    return fallback;
  }
}

module.exports = { getImageDimensions, parseJpegDimensions, parsePngDimensions };
