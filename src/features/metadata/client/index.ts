/**
 * Client-side metadata utilities.
 * These run in the main thread for binary parsing.
 *
 * Key optimizations:
 * 1. JPEG APP2 multi-segment ICC profile handling: ICC profiles can be split into
 *    multiple APP2 segments with sequence numbers. We collect all segments and
 *    concatenate them in the correct order.
 * 2. Memory efficiency: Use views instead of copying data where possible.
 *    The caller should use file.slice(0, 128 * 1024) for header-only scanning.
 */

import { ImageMetadata, MetadataPresence, MetadataOptions, getMetadataSupport } from '../shared/types';

const SOI = 0xffd8;
const APP0 = 0xffe0;
const APP1 = 0xffe1;
const APP2 = 0xffe2;
const APP13 = 0xffed;

const EXIF_IDENTIFIER = 'Exif\0\0';
const XMP_IDENTIFIER = 'http://ns.adobe.com/xap/1.0/\x00';
const ICC_IDENTIFIER = 'ICC_PROFILE\0';

const RIFF = 0x46464952;
const WEBP = 0x50424557;
const EXIF_FOURCC = 0x46495845;
const XMP_FOURCC = 0x504d5820;
const ICCP_FOURCC = 0x50434349;

const MAX_APP2_SEGMENT_SIZE = 65500;

export function isJpeg(buffer: ArrayBuffer): boolean {
  const view = new DataView(buffer);
  return buffer.byteLength >= 2 && view.getUint16(0, false) === SOI;
}

export function isWebP(buffer: ArrayBuffer): boolean {
  const view = new DataView(buffer);
  return buffer.byteLength >= 12 &&
    view.getUint32(0, true) === RIFF &&
    view.getUint32(8, true) === WEBP;
}

export function detectMetadataPresence(buffer: ArrayBuffer, mimeType: string): MetadataPresence {
  if (mimeType === 'image/jpeg' || isJpeg(buffer)) {
    return detectJpegMetadataPresence(buffer);
  } else if (mimeType === 'image/webp' || isWebP(buffer)) {
    return detectWebPMetadataPresence(buffer);
  }
  return { hasExif: false, hasIcc: false, hasXmp: false };
}

function detectJpegMetadataPresence(buffer: ArrayBuffer): MetadataPresence {
  const presence: MetadataPresence = { hasExif: false, hasIcc: false, hasXmp: false };
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 2;

  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
      if (offset >= bytes.length) break;
    }

    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker >= 0xffd0 && marker <= 0xffd9) {
      if (marker === 0xffd9) break;
      continue;
    }

    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset, false);
    const segmentEnd = offset + length;

    if (segmentEnd > bytes.length) break;

    if (marker === APP1) {
      const segmentData = new Uint8Array(buffer, offset + 2, Math.min(length - 2, 14));
      if (matchesIdentifier(segmentData, EXIF_IDENTIFIER)) {
        presence.hasExif = true;
      } else if (segmentData.length >= XMP_IDENTIFIER.length && matchesIdentifier(segmentData, XMP_IDENTIFIER)) {
        presence.hasXmp = true;
      }
    } else if (marker === APP2) {
      const segmentData = new Uint8Array(buffer, offset + 2, Math.min(length - 2, 14));
      if (matchesIdentifier(segmentData, ICC_IDENTIFIER)) {
        presence.hasIcc = true;
      }
    } else if (marker === APP13) {
      if (length > 14) {
        const segmentData = new Uint8Array(buffer, offset + 2, 12);
        const photoshopId = String.fromCharCode(...Array.from(segmentData));
        if (photoshopId === 'Photoshop 3.0') {
          if (!presence.hasXmp) presence.hasXmp = true;
        }
      }
    }

    if (presence.hasExif && presence.hasIcc && presence.hasXmp) {
      break;
    }

    offset = segmentEnd;
  }

  return presence;
}

function detectWebPMetadataPresence(buffer: ArrayBuffer): MetadataPresence {
  const presence: MetadataPresence = { hasExif: false, hasIcc: false, hasXmp: false };
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 12;

  while (offset < bytes.length - 8) {
    const fourCC = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    const paddedSize = (size + 1) & ~1;

    if (offset + 8 + paddedSize > bytes.length) break;

    if (fourCC === EXIF_FOURCC) {
      presence.hasExif = true;
    } else if (fourCC === ICCP_FOURCC) {
      presence.hasIcc = true;
    } else if (fourCC === XMP_FOURCC) {
      presence.hasXmp = true;
    }

    if (presence.hasExif && presence.hasIcc && presence.hasXmp) {
      break;
    }

    offset += 8 + paddedSize;
  }

  return presence;
}

export function parseMetadataFromBuffer(buffer: ArrayBuffer, mimeType: string): ImageMetadata {
  if (mimeType === 'image/jpeg' || isJpeg(buffer)) {
    return parseJpegMetadata(buffer);
  } else if (mimeType === 'image/webp' || isWebP(buffer)) {
    return parseWebPMetadata(buffer);
  }
  return {};
}

interface IccSegment {
  seqNum: number;
  totalSegments: number;
  data: Uint8Array;
  rawSegment: Uint8Array;
}

function parseJpegMetadata(buffer: ArrayBuffer): ImageMetadata {
  const metadata: ImageMetadata = {};
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 2;

  const iccSegments: IccSegment[] = [];

  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
      if (offset >= bytes.length) break;
    }

    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker >= 0xffd0 && marker <= 0xffd9) {
      if (marker === 0xffd9) break;
      continue;
    }

    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset, false);
    const segmentEnd = offset + length;

    if (segmentEnd > bytes.length) break;

    if (marker === APP1) {
      const headerData = new Uint8Array(buffer, offset + 2, Math.min(length - 2, 14));
      if (matchesIdentifier(headerData, EXIF_IDENTIFIER)) {
        metadata.exif = buffer.slice(offset - 2, segmentEnd);
      } else if (headerData.length >= XMP_IDENTIFIER.length && matchesIdentifier(headerData, XMP_IDENTIFIER)) {
        metadata.xmp = buffer.slice(offset - 2, segmentEnd);
      }
    } else if (marker === APP2) {
      const headerData = new Uint8Array(buffer, offset + 2, Math.min(length - 2, 14));
      if (matchesIdentifier(headerData, ICC_IDENTIFIER)) {
        const seqNum = bytes[offset + 2 + ICC_IDENTIFIER.length];
        const totalSegments = bytes[offset + 2 + ICC_IDENTIFIER.length + 1];

        const iccDataStart = offset + 2 + ICC_IDENTIFIER.length + 2;
        const iccDataEnd = segmentEnd;

        if (iccDataStart < iccDataEnd) {
          iccSegments.push({
            seqNum,
            totalSegments,
            data: bytes.slice(iccDataStart, iccDataEnd),
            rawSegment: bytes.slice(offset - 2, segmentEnd),
          });
        }
      }
    } else if (marker === APP13) {
      if (length > 14) {
        const segmentData = new Uint8Array(buffer, offset + 2, 12);
        const photoshopId = String.fromCharCode(...Array.from(segmentData));
        if (photoshopId === 'Photoshop 3.0') {
          if (!metadata.xmp) {
            metadata.xmp = buffer.slice(offset - 2, segmentEnd);
          }
        }
      }
    }

    offset = segmentEnd;
  }

  if (iccSegments.length > 0) {
    metadata.icc = reconstructIccProfile(iccSegments);
  }

  return metadata;
}

function reconstructIccProfile(segments: IccSegment[]): ArrayBuffer | undefined {
  if (segments.length === 0) return undefined;

  const maxSeq = Math.max(...segments.map(s => s.totalSegments));

  if (segments.length === 1 && maxSeq === 1) {
    return segments[0].rawSegment.buffer.slice(
      segments[0].rawSegment.byteOffset,
      segments[0].rawSegment.byteOffset + segments[0].rawSegment.length
    );
  }

  const sorted = segments.slice().sort((a, b) => a.seqNum - b.seqNum);

  const expectedSegments = sorted[0]?.totalSegments || maxSeq;

  if (sorted.length < expectedSegments) {
    console.warn(`Missing ICC segments: expected ${expectedSegments}, got ${sorted.length}`);
  }

  const expectedHeaderSize = 2 + 12 + 2;
  let totalIccDataSize = 0;
  for (const seg of sorted) {
    totalIccDataSize += seg.data.length;
  }

  if (sorted.length === 1) {
    return sorted[0].rawSegment.buffer.slice(
      sorted[0].rawSegment.byteOffset,
      sorted[0].rawSegment.byteOffset + sorted[0].rawSegment.length
    );
  }

  const newSegments = splitIccIntoApp2Segments(sorted);
  return mergeApp2Segments(newSegments);
}

function splitIccIntoApp2Segments(segments: IccSegment[]): IccSegment[] {
  let totalIccData = new Uint8Array(0);
  for (const seg of segments.sort((a, b) => a.seqNum - b.seqNum)) {
    const newData = new Uint8Array(totalIccData.length + seg.data.length);
    newData.set(totalIccData, 0);
    newData.set(seg.data, totalIccData.length);
    totalIccData = newData;
  }

  const headerSize = 2 + ICC_IDENTIFIER.length + 2;
  const maxDataPerSegment = MAX_APP2_SEGMENT_SIZE - headerSize;

  const result: IccSegment[] = [];
  let offset = 0;
  let seqNum = 1;

  while (offset < totalIccData.length) {
    const chunkSize = Math.min(maxDataPerSegment, totalIccData.length - offset);
    const chunk = totalIccData.slice(offset, offset + chunkSize);

    const segmentSize = headerSize + chunkSize;
    const rawSegment = new Uint8Array(segmentSize);
    const view = new DataView(rawSegment.buffer);

    view.setUint16(0, APP2, false);
    view.setUint16(2, segmentSize - 2, false);

    for (let i = 0; i < ICC_IDENTIFIER.length; i++) {
      rawSegment[4 + i] = ICC_IDENTIFIER.charCodeAt(i);
    }

    rawSegment[4 + ICC_IDENTIFIER.length] = seqNum;
    rawSegment[5 + ICC_IDENTIFIER.length] = 0;

    rawSegment.set(chunk, 6 + ICC_IDENTIFIER.length);

    result.push({
      seqNum,
      totalSegments: 0,
      data: chunk,
      rawSegment,
    });

    offset += chunkSize;
    seqNum++;
  }

  const totalSegments = result.length;
  for (const seg of result) {
    seg.totalSegments = totalSegments;
    seg.rawSegment[5 + ICC_IDENTIFIER.length] = totalSegments;
  }

  return result;
}

function mergeApp2Segments(segments: IccSegment[]): ArrayBuffer {
  if (segments.length === 1) {
    return segments[0].rawSegment.buffer.slice(
      segments[0].rawSegment.byteOffset,
      segments[0].rawSegment.byteOffset + segments[0].rawSegment.length
    );
  }

  let totalSize = 0;
  for (const seg of segments) {
    totalSize += seg.rawSegment.length;
  }

  const result = new Uint8Array(totalSize);
  let offset = 0;

  for (const seg of segments.sort((a, b) => a.seqNum - b.seqNum)) {
    result.set(seg.rawSegment, offset);
    offset += seg.rawSegment.length;
  }

  return result.buffer;
}

function parseWebPMetadata(buffer: ArrayBuffer): ImageMetadata {
  const metadata: ImageMetadata = {};
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  let offset = 12;

  while (offset < bytes.length - 8) {
    const fourCC = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    const paddedSize = (size + 1) & ~1;

    if (offset + 8 + paddedSize > bytes.length) break;

    if (fourCC === EXIF_FOURCC) {
      metadata.exif = buffer.slice(offset, offset + 8 + size);
    } else if (fourCC === ICCP_FOURCC) {
      metadata.icc = buffer.slice(offset, offset + 8 + size);
    } else if (fourCC === XMP_FOURCC) {
      metadata.xmp = buffer.slice(offset, offset + 8 + size);
    }

    offset += 8 + paddedSize;
  }

  return metadata;
}

function matchesIdentifier(data: Uint8Array, identifier: string): boolean {
  if (data.length < identifier.length) return false;
  for (let i = 0; i < identifier.length; i++) {
    if (data[i] !== identifier.charCodeAt(i)) return false;
  }
  return true;
}

export function injectMetadataIntoBuffer(
  compressedBuffer: ArrayBuffer,
  metadata: ImageMetadata,
  options: MetadataOptions,
  targetMimeType: string,
): ArrayBuffer {
  const support = getMetadataSupport(targetMimeType);

  if (targetMimeType === 'image/jpeg' || isJpeg(compressedBuffer)) {
    return injectJpegMetadata(compressedBuffer, metadata, {
      keepExif: options.keepExif && support.supportsExif,
      keepIcc: options.keepIcc && support.supportsIcc,
      keepXmp: options.keepXmp && support.supportsXmp,
    });
  } else if (targetMimeType === 'image/webp' || isWebP(compressedBuffer)) {
    return injectWebPMetadata(compressedBuffer, metadata, {
      keepExif: options.keepExif && support.supportsExif,
      keepIcc: options.keepIcc && support.supportsIcc,
      keepXmp: options.keepXmp && support.supportsXmp,
    });
  }
  return compressedBuffer;
}

function injectJpegMetadata(
  compressedBuffer: ArrayBuffer,
  metadata: ImageMetadata,
  options: MetadataOptions,
): ArrayBuffer {
  const view = new DataView(compressedBuffer);
  const bytes = new Uint8Array(compressedBuffer);

  const segments: { marker: number; data: Uint8Array; raw: Uint8Array }[] = [];
  let offset = 2;
  let app0Found = false;

  while (offset < bytes.length - 2) {
    if (bytes[offset] !== 0xff) {
      while (offset < bytes.length && bytes[offset] !== 0xff) offset++;
      if (offset >= bytes.length) break;
    }

    const marker = view.getUint16(offset, false);
    offset += 2;

    if (marker === 0xffd9) {
      segments.push({ marker, data: new Uint8Array(), raw: new Uint8Array([0xff, 0xd9]) });
      break;
    }

    if (marker >= 0xffd0 && marker <= 0xffd8) {
      segments.push({ marker, data: new Uint8Array(), raw: bytes.slice(offset - 2, offset) });
      continue;
    }

    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset, false);
    const segmentEnd = offset + length;

    if (segmentEnd > bytes.length) break;

    const rawData = bytes.slice(offset - 2, segmentEnd);
    const segmentData = bytes.slice(offset + 2, segmentEnd);

    if (marker === APP0) {
      app0Found = true;
      segments.push({ marker, data: segmentData, raw: rawData });
    } else if (marker === 0xffda) {
      let eoiOffset = segmentEnd;
      while (eoiOffset < bytes.length - 1) {
        if (bytes[eoiOffset] === 0xff && bytes[eoiOffset + 1] === 0xd9) {
          break;
        }
        eoiOffset++;
      }
      segments.push({
        marker,
        data: bytes.slice(offset, eoiOffset),
        raw: bytes.slice(offset - 2, eoiOffset)
      });
      if (eoiOffset < bytes.length) {
        segments.push({ marker: 0xffd9, data: new Uint8Array(), raw: bytes.slice(eoiOffset, eoiOffset + 2) });
      }
      break;
    } else if (marker >= APP0 && marker <= 0xffef) {
      continue;
    } else {
      segments.push({ marker, data: segmentData, raw: rawData });
    }

    offset = segmentEnd;
  }

  const newSegments: typeof segments = [];
  let inserted = false;

  for (const seg of segments) {
    if (!inserted && seg.marker >= 0xffc0) {
      const metadataSegments = createJpegMetadataSegments(metadata, options);
      newSegments.push(...metadataSegments);
      inserted = true;
    }
    newSegments.push(seg);
  }

  if (!inserted) {
    const metadataSegments = createJpegMetadataSegments(metadata, options);
    const insertIdx = app0Found ? 1 : 0;
    newSegments.splice(insertIdx, 0, ...metadataSegments);
  }

  let totalLength = 0;
  for (const seg of newSegments) {
    totalLength += seg.raw.length;
  }

  const result = new Uint8Array(totalLength);
  result[0] = 0xff;
  result[1] = 0xd8;
  offset = 2;

  for (const seg of newSegments) {
    if (seg.marker === SOI) continue;
    result.set(seg.raw, offset);
    offset += seg.raw.length;
  }

  return result.buffer;
}

function createJpegMetadataSegments(
  metadata: ImageMetadata,
  options: MetadataOptions,
): { marker: number; data: Uint8Array; raw: Uint8Array }[] {
  const segments: { marker: number; data: Uint8Array; raw: Uint8Array }[] = [];

  if (options.keepExif && metadata.exif) {
    const raw = new Uint8Array(metadata.exif);
    const view = new DataView(raw.buffer, raw.byteOffset);
    segments.push({
      marker: view.getUint16(0, false),
      data: raw.slice(4),
      raw: raw
    });
  }

  if (options.keepXmp && metadata.xmp) {
    const raw = new Uint8Array(metadata.xmp);
    const view = new DataView(raw.buffer, raw.byteOffset);
    segments.push({
      marker: view.getUint16(0, false),
      data: raw.slice(4),
      raw: raw
    });
  }

  if (options.keepIcc && metadata.icc) {
    const raw = new Uint8Array(metadata.icc);
    let offset = 0;

    while (offset < raw.length) {
      if (offset + 2 > raw.length) break;
      const marker = (raw[offset] << 8) | raw[offset + 1];
      if (marker !== APP2) break;

      if (offset + 4 > raw.length) break;
      const length = (raw[offset + 2] << 8) | raw[offset + 3];
      const segmentEnd = offset + 2 + length;

      if (segmentEnd > raw.length) break;

      segments.push({
        marker: APP2,
        data: raw.slice(offset + 4, segmentEnd),
        raw: raw.slice(offset, segmentEnd)
      });

      offset = segmentEnd;
    }
  }

  return segments;
}

function injectWebPMetadata(
  compressedBuffer: ArrayBuffer,
  metadata: ImageMetadata,
  options: MetadataOptions,
): ArrayBuffer {
  const view = new DataView(compressedBuffer);
  const bytes = new Uint8Array(compressedBuffer);

  const chunks: { fourCC: number; size: number; data: Uint8Array }[] = [];
  let offset = 12;

  while (offset < bytes.length - 8) {
    const fourCC = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    const paddedSize = (size + 1) & ~1;

    if (offset + 8 + paddedSize > bytes.length) break;

    const chunkData = bytes.slice(offset + 8, offset + 8 + size);

    if (fourCC === EXIF_FOURCC || fourCC === XMP_FOURCC || fourCC === ICCP_FOURCC) {
      offset += 8 + paddedSize;
      continue;
    }

    chunks.push({ fourCC, size, data: chunkData });
    offset += 8 + paddedSize;
  }

  const newChunks: typeof chunks = [];
  let inserted = false;
  let hasVp8x = false;

  for (const chunk of chunks) {
    if (!inserted && (chunk.fourCC === 0x20385056 || chunk.fourCC === 0x4c385056)) {
      const metadataChunks = createWebPMetadataChunks(metadata, options);
      if (metadataChunks.length > 0) {
        const vp8xChunk = chunks.find(c => c.fourCC === 0x58385056);
        if (!vp8xChunk) {
          const width = getWebPWidth(compressedBuffer);
          const height = getWebPHeight(compressedBuffer);
          if (width > 0 && height > 0) {
            const flags = (options.keepExif && metadata.exif ? 0x08 : 0) |
                         (options.keepXmp && metadata.xmp ? 0x04 : 0);
            newChunks.push(createVp8xChunk(width, height, flags));
            hasVp8x = true;
          }
        }
        newChunks.push(...metadataChunks);
        inserted = true;
      }
    }
    newChunks.push(chunk);
  }

  if (!inserted) {
    const metadataChunks = createWebPMetadataChunks(metadata, options);
    if (metadataChunks.length > 0) {
      const insertIdx = newChunks.findIndex(c => c.fourCC === 0x58385056);
      if (insertIdx >= 0) {
        newChunks.splice(insertIdx + 1, 0, ...metadataChunks);
      } else {
        newChunks.unshift(...metadataChunks);
      }
    }
  }

  let totalSize = 12;
  for (const chunk of newChunks) {
    totalSize += 8 + ((chunk.size + 1) & ~1);
  }

  const result = new Uint8Array(totalSize);
  const resultView = new DataView(result.buffer);

  resultView.setUint32(0, RIFF, true);
  resultView.setUint32(4, totalSize - 8, true);
  resultView.setUint32(8, WEBP, true);

  offset = 12;

  for (const chunk of newChunks) {
    resultView.setUint32(offset, chunk.fourCC, true);
    resultView.setUint32(offset + 4, chunk.size, true);
    result.set(chunk.data, offset + 8);
    offset += 8 + ((chunk.size + 1) & ~1);
  }

  return result.buffer;
}

function createWebPMetadataChunks(
  metadata: ImageMetadata,
  options: MetadataOptions,
): { fourCC: number; size: number; data: Uint8Array }[] {
  const chunks: { fourCC: number; size: number; data: Uint8Array }[] = [];

  if (options.keepExif && metadata.exif) {
    const raw = new Uint8Array(metadata.exif);
    chunks.push({
      fourCC: EXIF_FOURCC,
      size: raw.length - 8,
      data: raw.slice(8)
    });
  }

  if (options.keepXmp && metadata.xmp) {
    const raw = new Uint8Array(metadata.xmp);
    chunks.push({
      fourCC: XMP_FOURCC,
      size: raw.length - 8,
      data: raw.slice(8)
    });
  }

  if (options.keepIcc && metadata.icc) {
    const raw = new Uint8Array(metadata.icc);
    chunks.push({
      fourCC: ICCP_FOURCC,
      size: raw.length - 8,
      data: raw.slice(8)
    });
  }

  return chunks;
}

function getWebPWidth(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 12;

  while (offset < bytes.length - 8) {
    const fourCC = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    const paddedSize = (size + 1) & ~1;

    if (offset + 8 + paddedSize > bytes.length) break;

    if (fourCC === 0x58385056) {
      const widthMinusOne = view.getUint24(offset + 8, true);
      return widthMinusOne + 1;
    } else if (fourCC === 0x20385056) {
      const widthMinusOne = view.getUint24(offset + 8 + 3, true);
      return widthMinusOne + 1;
    } else if (fourCC === 0x4c385056) {
      const widthMinusOne = view.getUint16(offset + 8 + 1, true) & 0x3fff;
      return widthMinusOne + 1;
    }

    offset += 8 + paddedSize;
  }
  return 0;
}

function getWebPHeight(buffer: ArrayBuffer): number {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 12;

  while (offset < bytes.length - 8) {
    const fourCC = view.getUint32(offset, true);
    const size = view.getUint32(offset + 4, true);
    const paddedSize = (size + 1) & ~1;

    if (offset + 8 + paddedSize > bytes.length) break;

    if (fourCC === 0x58385056) {
      const heightMinusOne = view.getUint24(offset + 8 + 3, true);
      return heightMinusOne + 1;
    } else if (fourCC === 0x20385056) {
      const heightMinusOne = view.getUint24(offset + 8 + 6, true);
      return heightMinusOne + 1;
    } else if (fourCC === 0x4c385056) {
      const heightMinusOne = view.getUint16(offset + 8 + 3, true) & 0x3fff;
      return heightMinusOne + 1;
    }

    offset += 8 + paddedSize;
  }
  return 0;
}

function createVp8xChunk(
  width: number,
  height: number,
  flags: number,
): { fourCC: number; size: number; data: Uint8Array } {
  const data = new Uint8Array(10);
  const view = new DataView(data.buffer);

  view.setUint8(0, flags);

  const reservedBytes = new Uint8Array(3);
  view.setUint8(1, reservedBytes[0]);
  view.setUint8(2, reservedBytes[1]);
  view.setUint8(3, reservedBytes[2]);

  view.setUint24(4, width - 1, true);
  view.setUint24(7, height - 1, true);

  return {
    fourCC: 0x58385056,
    size: 10,
    data: data
  };
}

export function clearOrientationFromExif(exifBuffer: ArrayBuffer): ArrayBuffer {
  const view = new DataView(exifBuffer);
  const bytes = new Uint8Array(exifBuffer);

  if (view.getUint16(0, false) !== APP1) {
    return exifBuffer;
  }

  const headerData = new Uint8Array(exifBuffer, 4, Math.min(6, exifBuffer.byteLength - 4));
  if (!matchesIdentifier(headerData, 'Exif\0')) {
    return exifBuffer;
  }

  const tiffOffset = 4 + 6;
  if (tiffOffset + 8 > exifBuffer.byteLength) {
    return exifBuffer;
  }

  const byteOrder = view.getUint16(tiffOffset, false);
  const isLittleEndian = byteOrder === 0x4949;

  const numDirEntries = view.getUint16(tiffOffset + 8, isLittleEndian);
  let dirOffset = tiffOffset + 10;

  for (let i = 0; i < numDirEntries; i++) {
    if (dirOffset + 12 > exifBuffer.byteLength) break;

    const tag = view.getUint16(dirOffset, isLittleEndian);

    if (tag === 0x0112) {
      const type = view.getUint16(dirOffset + 2, isLittleEndian);
      const count = view.getUint32(dirOffset + 4, isLittleEndian);

      if (type === 3 && count === 1) {
        view.setUint16(dirOffset + 8, 1, isLittleEndian);
      }
      break;
    }

    dirOffset += 12;
  }

  return exifBuffer;
}
