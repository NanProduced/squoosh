/**
 * Client-side metadata utilities.
 * These run in the main thread for binary parsing.
 */

import { ImageMetadata, MetadataOptions, getMetadataSupport } from '../shared/types';

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

export function parseMetadataFromBuffer(buffer: ArrayBuffer, mimeType: string): ImageMetadata {
  if (mimeType === 'image/jpeg' || isJpeg(buffer)) {
    return parseJpegMetadata(buffer);
  } else if (mimeType === 'image/webp' || isWebP(buffer)) {
    return parseWebPMetadata(buffer);
  }
  return {};
}

function parseJpegMetadata(buffer: ArrayBuffer): ImageMetadata {
  const metadata: ImageMetadata = {};
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

    const segmentData = bytes.slice(offset + 2, segmentEnd);

    if (marker === APP1) {
      if (matchesIdentifier(segmentData, EXIF_IDENTIFIER)) {
        const app1Data = bytes.slice(offset - 2, segmentEnd);
        metadata.exif = app1Data.buffer.slice(app1Data.byteOffset, app1Data.byteOffset + app1Data.length);
      } else if (matchesIdentifier(segmentData, XMP_IDENTIFIER)) {
        const app1Data = bytes.slice(offset - 2, segmentEnd);
        metadata.xmp = app1Data.buffer.slice(app1Data.byteOffset, app1Data.byteOffset + app1Data.length);
      }
    } else if (marker === APP2) {
      if (matchesIdentifier(segmentData, ICC_IDENTIFIER)) {
        const app2Data = bytes.slice(offset - 2, segmentEnd);
        metadata.icc = app2Data.buffer.slice(app2Data.byteOffset, app2Data.byteOffset + app2Data.length);
      }
    } else if (marker === APP13) {
      if (segmentData.length > 12) {
        const photoshopId = String.fromCharCode(...Array.from(segmentData.slice(0, 12)));
        if (photoshopId === 'Photoshop 3.0') {
          const app13Data = bytes.slice(offset - 2, segmentEnd);
          if (!metadata.xmp) {
            metadata.xmp = app13Data.buffer.slice(app13Data.byteOffset, app13Data.byteOffset + app13Data.length);
          }
        }
      }
    }

    offset = segmentEnd;
  }

  return metadata;
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

    const chunkData = bytes.slice(offset, offset + 8 + size);

    if (fourCC === EXIF_FOURCC) {
      metadata.exif = chunkData.buffer.slice(chunkData.byteOffset, chunkData.byteOffset + chunkData.length);
    } else if (fourCC === ICCP_FOURCC) {
      metadata.icc = chunkData.buffer.slice(chunkData.byteOffset, chunkData.byteOffset + chunkData.length);
    } else if (fourCC === XMP_FOURCC) {
      metadata.xmp = chunkData.buffer.slice(chunkData.byteOffset, chunkData.byteOffset + chunkData.length);
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
    const view = new DataView(raw.buffer, raw.byteOffset);
    segments.push({
      marker: view.getUint16(0, false),
      data: raw.slice(4),
      raw: raw
    });
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
    const view = new DataView(raw.buffer, raw.byteOffset);
    chunks.push({
      fourCC: view.getUint32(0, true),
      size: view.getUint32(4, true),
      data: raw.slice(8)
    });
  }

  if (options.keepIcc && metadata.icc) {
    const raw = new Uint8Array(metadata.icc);
    const view = new DataView(raw.buffer, raw.byteOffset);
    chunks.push({
      fourCC: view.getUint32(0, true),
      size: view.getUint32(4, true),
      data: raw.slice(8)
    });
  }

  if (options.keepXmp && metadata.xmp) {
    const raw = new Uint8Array(metadata.xmp);
    const view = new DataView(raw.buffer, raw.byteOffset);
    chunks.push({
      fourCC: view.getUint32(0, true),
      size: view.getUint32(4, true),
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

    if (fourCC === 0x20385056 && size >= 10) {
      const keyFrame = (bytes[offset + 11] & 1) === 0;
      if (keyFrame) {
        return view.getUint16(offset + 14, true) & 0x3fff;
      }
    } else if (fourCC === 0x4c385056 && size >= 5) {
      const info = view.getUint32(offset + 9, true);
      return (info & 0x3fff) + 1;
    }

    offset += 8 + ((size + 1) & ~1);
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

    if (fourCC === 0x20385056 && size >= 10) {
      const keyFrame = (bytes[offset + 11] & 1) === 0;
      if (keyFrame) {
        return view.getUint16(offset + 16, true) & 0x3fff;
      }
    } else if (fourCC === 0x4c385056 && size >= 5) {
      const info = view.getUint32(offset + 9, true);
      return ((info >> 14) & 0x3fff) + 1;
    }

    offset += 8 + ((size + 1) & ~1);
  }
  return 0;
}

function createVp8xChunk(
  width: number,
  height: number,
  flags: number
): { fourCC: number; size: number; data: Uint8Array } {
  const data = new Uint8Array(10);
  const view = new DataView(data.buffer);

  data[0] = flags;
  view.setUint32(1, (width - 1) & 0xffffff, true);
  view.setUint32(4, ((height - 1) << 8) | (((width - 1) >> 24) & 0xff), true);

  return {
    fourCC: 0x58385056,
    size: 10,
    data
  };
}

export function clearOrientationFromExif(exifBuffer: ArrayBuffer): ArrayBuffer {
  const data = new Uint8Array(exifBuffer);
  const view = new DataView(exifBuffer);
  
  if (data[0] !== 0xff || data[1] !== 0xe1) {
    return exifBuffer;
  }

  const tiffOffset = 10;
  if (tiffOffset + 8 > data.length) return exifBuffer;

  const byteOrder = data[tiffOffset];
  const isLittleEndian = byteOrder === 0x49;

  const ifdOffset = isLittleEndian
    ? view.getUint32(tiffOffset + 4, true)
    : view.getUint32(tiffOffset + 4, false);

  const ifdAbsOffset = tiffOffset + ifdOffset;
  if (ifdAbsOffset + 2 > data.length) return exifBuffer;

  const numEntries = isLittleEndian
    ? view.getUint16(ifdAbsOffset, true)
    : view.getUint16(ifdAbsOffset, false);

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdAbsOffset + 2 + i * 12;
    if (entryOffset + 12 > data.length) break;

    const tag = isLittleEndian
      ? view.getUint16(entryOffset, true)
      : view.getUint16(entryOffset, false);

    if (tag === 0x0112) {
      const type = isLittleEndian
        ? view.getUint16(entryOffset + 2, true)
        : view.getUint16(entryOffset + 2, false);
      const count = isLittleEndian
        ? view.getUint32(entryOffset + 4, true)
        : view.getUint32(entryOffset + 4, false);

      if (type === 3 && count === 1) {
        const result = new Uint8Array(exifBuffer);
        const resultView = new DataView(result.buffer);
        if (isLittleEndian) {
          resultView.setUint16(entryOffset + 8, 1, true);
        } else {
          resultView.setUint16(entryOffset + 8, 1, false);
        }
        return result.buffer;
      }
      break;
    }
  }

  return exifBuffer;
}
