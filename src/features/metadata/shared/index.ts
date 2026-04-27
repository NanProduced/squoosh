export interface ImageMetadata {
  exif?: ArrayBuffer;
  icc?: ArrayBuffer;
  xmp?: ArrayBuffer;
  orientation?: number;
  cameraMake?: string;
  cameraModel?: string;
  dateTime?: string;
  colorSpace?: string;
}

export interface MetadataOptions {
  keepExif: boolean;
  keepIcc: boolean;
  keepXmp: boolean;
  autoRotate: boolean;
}

export const defaultMetadataOptions: MetadataOptions = {
  keepExif: false,
  keepIcc: false,
  keepXmp: false,
  autoRotate: false,
};

function concatBuffers(...buffers: ArrayBuffer[]): ArrayBuffer {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result.buffer;
}

function readUint16(view: DataView, offset: number, bigEndian: boolean): number {
  return view.getUint16(offset, !bigEndian);
}

function readUint32(view: DataView, offset: number, bigEndian: boolean): number {
  return view.getUint32(offset, !bigEndian);
}

export function parseJpegMetadata(data: ArrayBuffer): ImageMetadata {
  const result: ImageMetadata = {};
  const view = new DataView(data);
  const uint8 = new Uint8Array(data);

  if (uint8[0] !== 0xff || uint8[1] !== 0xd8) {
    return result;
  }

  let offset = 2;

  while (offset < data.byteLength) {
    if (uint8[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = uint8[offset + 1];
    offset += 2;

    if (marker >= 0xd0 && marker <= 0xd9) {
      continue;
    }

    if (marker === 0xda) {
      break;
    }

    const length = view.getUint16(offset, false);
    const segmentData = data.slice(offset + 2, offset + length);

    if (marker === 0xe1) {
      const segmentView = new DataView(segmentData);
      const segmentUint8 = new Uint8Array(segmentData);

      const isExif =
        segmentUint8[0] === 0x45 &&
        segmentUint8[1] === 0x78 &&
        segmentUint8[2] === 0x69 &&
        segmentUint8[3] === 0x66 &&
        segmentUint8[4] === 0x00 &&
        segmentUint8[5] === 0x00;

      if (isExif) {
        result.exif = segmentData;
        parseExifInfo(segmentData, result);
      }
    }

    if (marker === 0xe2) {
      const segmentUint8 = new Uint8Array(segmentData);
      const isIcc =
        segmentUint8[0] === 0x49 &&
        segmentUint8[1] === 0x43 &&
        segmentUint8[2] === 0x43 &&
        segmentUint8[3] === 0x5f &&
        segmentUint8[4] === 0x50 &&
        segmentUint8[5] === 0x52 &&
        segmentUint8[6] === 0x4f &&
        segmentUint8[7] === 0x46 &&
        segmentUint8[8] === 0x49 &&
        segmentUint8[9] === 0x4c &&
        segmentUint8[10] === 0x45 &&
        segmentUint8[11] === 0x00;

      if (isIcc) {
        result.icc = segmentData.slice(12);
        result.colorSpace = 'ICC Profile';
      }
    }

    if (marker === 0xe1) {
      const segmentUint8 = new Uint8Array(segmentData);
      const isXmp =
        segmentUint8[0] === 0x68 &&
        segmentUint8[1] === 0x74 &&
        segmentUint8[2] === 0x74 &&
        segmentUint8[3] === 0x70 &&
        segmentUint8[4] === 0x3a &&
        segmentUint8[5] === 0x2f &&
        segmentUint8[6] === 0x2f &&
        segmentUint8[7] === 0x6e &&
        segmentUint8[8] === 0x73 &&
        segmentUint8[9] === 0x2e &&
        segmentUint8[10] === 0x61 &&
        segmentUint8[11] === 0x64 &&
        segmentUint8[12] === 0x6f &&
        segmentUint8[13] === 0x62 &&
        segmentUint8[14] === 0x65 &&
        segmentUint8[15] === 0x2e &&
        segmentUint8[16] === 0x6f &&
        segmentUint8[17] === 0x72 &&
        segmentUint8[18] === 0x67 &&
        segmentUint8[19] === 0x2f &&
        segmentUint8[20] === 0x78 &&
        segmentUint8[21] === 0x6d &&
        segmentUint8[22] === 0x70 &&
        segmentUint8[23] === 0x00;

      if (isXmp) {
        result.xmp = segmentData.slice(24);
      }
    }

    offset += length;
  }

  return result;
}

function parseExifInfo(exifData: ArrayBuffer, result: ImageMetadata): void {
  const view = new DataView(exifData);
  const tiffOffset = 6;

  if (tiffOffset + 8 > exifData.byteLength) return;

  const byteOrder = view.getUint16(tiffOffset, false);
  const isBigEndian = byteOrder === 0x4d4d;

  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return;

  const ifdOffset = readUint32(view, tiffOffset + 4, isBigEndian);
  const ifdPointer = tiffOffset + ifdOffset;

  if (ifdPointer + 2 > exifData.byteLength) return;

  const numEntries = readUint16(view, ifdPointer, isBigEndian);

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdPointer + 2 + i * 12;
    if (entryOffset + 12 > exifData.byteLength) break;

    const tag = readUint16(view, entryOffset, isBigEndian);
    const type = readUint16(view, entryOffset + 2, isBigEndian);
    const count = readUint32(view, entryOffset + 4, isBigEndian);
    const valueOffset = readUint32(view, entryOffset + 8, isBigEndian);

    if (tag === 0x0112) {
      result.orientation = readUint16(view, entryOffset + 8, isBigEndian);
    }

    if (tag === 0x010f && type === 2) {
      result.cameraMake = readString(view, tiffOffset + valueOffset, count);
    }

    if (tag === 0x0110 && type === 2) {
      result.cameraModel = readString(view, tiffOffset + valueOffset, count);
    }

    if (tag === 0x0132 && type === 2) {
      result.dateTime = readString(view, tiffOffset + valueOffset, count);
    }

    if (tag === 0xa001) {
      const colorSpaceValue = readUint16(view, entryOffset + 8, isBigEndian);
      result.colorSpace = colorSpaceValue === 1 ? 'sRGB' : 'Uncalibrated';
    }
  }
}

function readString(view: DataView, offset: number, count: number): string {
  let result = '';
  for (let i = 0; i < count - 1; i++) {
    if (offset + i >= view.byteLength) break;
    const char = view.getUint8(offset + i);
    if (char === 0) break;
    result += String.fromCharCode(char);
  }
  return result;
}

export function parseWebPMetadata(data: ArrayBuffer): ImageMetadata {
  const result: ImageMetadata = {};
  const view = new DataView(data);
  const uint8 = new Uint8Array(data);

  if (
    uint8[0] !== 0x52 ||
    uint8[1] !== 0x49 ||
    uint8[2] !== 0x46 ||
    uint8[3] !== 0x46 ||
    uint8[8] !== 0x57 ||
    uint8[9] !== 0x45 ||
    uint8[10] !== 0x42 ||
    uint8[11] !== 0x50
  ) {
    return result;
  }

  let offset = 12;

  while (offset < data.byteLength - 8) {
    const chunkId =
      String.fromCharCode(uint8[offset]) +
      String.fromCharCode(uint8[offset + 1]) +
      String.fromCharCode(uint8[offset + 2]) +
      String.fromCharCode(uint8[offset + 3]);

    const chunkSize = view.getUint32(offset + 4, true);
    const chunkData = data.slice(offset + 8, offset + 8 + chunkSize);

    if (chunkId === 'EXIF') {
      result.exif = chunkData;
      parseExifInfo(chunkData, result);
    }

    if (chunkId === 'ICCP') {
      result.icc = chunkData;
      result.colorSpace = 'ICC Profile';
    }

    if (chunkId === 'XMP ') {
      result.xmp = chunkData;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset += 8 + paddedSize;
  }

  return result;
}

export function injectJpegMetadata(
  compressedData: ArrayBuffer,
  metadata: ImageMetadata,
  options: MetadataOptions,
): ArrayBuffer {
  const compressedUint8 = new Uint8Array(compressedData);
  const chunks: ArrayBuffer[] = [];

  chunks.push(new Uint8Array([0xff, 0xd8]).buffer);

  if (options.keepExif && metadata.exif) {
    const exifChunk = createJpegApp1ExifChunk(metadata.exif);
    chunks.push(exifChunk);
  }

  if (options.keepIcc && metadata.icc) {
    const iccChunks = createJpegApp2IccChunks(metadata.icc);
    chunks.push(...iccChunks);
  }

  if (options.keepXmp && metadata.xmp) {
    const xmpChunk = createJpegApp1XmpChunk(metadata.xmp);
    chunks.push(xmpChunk);
  }

  let offset = 2;
  const view = new DataView(compressedData);

  while (offset < compressedData.byteLength) {
    if (compressedUint8[offset] !== 0xff) {
      offset++;
      continue;
    }

    const marker = compressedUint8[offset + 1];

    if (marker >= 0xd0 && marker <= 0xd9) {
      chunks.push(compressedData.slice(offset));
      break;
    }

    if (marker === 0xda) {
      chunks.push(compressedData.slice(offset));
      break;
    }

    const length = view.getUint16(offset + 2, false);

    if (
      (marker >= 0xe0 && marker <= 0xef) ||
      marker === 0xfe ||
      marker === 0xc4 ||
      marker === 0xdb
    ) {
      chunks.push(compressedData.slice(offset, offset + 2 + length));
    }

    offset += 2 + length;
  }

  return concatBuffers(...chunks);
}

function createJpegApp1ExifChunk(exifData: ArrayBuffer): ArrayBuffer {
  const exifHeader = new Uint8Array([
    0xff, 0xe1,
    0x00, 0x00,
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00,
  ]);

  const totalLength = exifHeader.length + exifData.byteLength;
  const view = new DataView(exifHeader.buffer);
  view.setUint16(2, totalLength - 2, false);

  return concatBuffers(exifHeader.buffer, exifData);
}

function createJpegApp2IccChunks(iccData: ArrayBuffer): ArrayBuffer[] {
  const chunks: ArrayBuffer[] = [];
  const maxChunkSize = 65533 - 14;
  const totalChunks = Math.ceil(iccData.byteLength / maxChunkSize);

  for (let i = 0; i < totalChunks; i++) {
    const start = i * maxChunkSize;
    const end = Math.min(start + maxChunkSize, iccData.byteLength);
    const chunkData = iccData.slice(start, end);

    const iccHeader = new Uint8Array([
      0xff, 0xe2,
      0x00, 0x00,
      0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00,
      i + 1,
      totalChunks,
    ]);

    const totalLength = iccHeader.length + chunkData.byteLength;
    const view = new DataView(iccHeader.buffer);
    view.setUint16(2, totalLength - 2, false);

    chunks.push(concatBuffers(iccHeader.buffer, chunkData));
  }

  return chunks;
}

function createJpegApp1XmpChunk(xmpData: ArrayBuffer): ArrayBuffer {
  const xmpNamespace = 'http://ns.adobe.com/xap/1.0/\x00';
  const namespaceBytes = new TextEncoder().encode(xmpNamespace);

  const xmpHeader = new Uint8Array([
    0xff, 0xe1,
    0x00, 0x00,
  ]);

  const totalLength = xmpHeader.length + namespaceBytes.length + xmpData.byteLength;
  const view = new DataView(xmpHeader.buffer);
  view.setUint16(2, totalLength - 2, false);

  return concatBuffers(xmpHeader.buffer, namespaceBytes.buffer, xmpData);
}

export function injectWebPMetadata(
  compressedData: ArrayBuffer,
  metadata: ImageMetadata,
  options: MetadataOptions,
): ArrayBuffer {
  const compressedUint8 = new Uint8Array(compressedData);
  const view = new DataView(compressedData);

  if (
    compressedUint8[0] !== 0x52 ||
    compressedUint8[1] !== 0x49 ||
    compressedUint8[2] !== 0x46 ||
    compressedUint8[3] !== 0x46 ||
    compressedUint8[8] !== 0x57 ||
    compressedUint8[9] !== 0x45 ||
    compressedUint8[10] !== 0x42 ||
    compressedUint8[11] !== 0x50
  ) {
    return compressedData;
  }

  const hasVp8x = compressedUint8[12] === 0x56 &&
    compressedUint8[13] === 0x50 &&
    compressedUint8[14] === 0x38 &&
    compressedUint8[15] === 0x58;

  const chunks: ArrayBuffer[] = [];
  const vp8xFlags = {
    hasIcc: options.keepIcc && !!metadata.icc,
    hasAlpha: false,
    hasExif: options.keepExif && !!metadata.exif,
    hasXmp: options.keepXmp && !!metadata.xmp,
    hasAnimation: false,
  };

  if (!hasVp8x && (vp8xFlags.hasIcc || vp8xFlags.hasExif || vp8xFlags.hasXmp)) {
    const vp8xChunk = createVp8xChunk(compressedData, vp8xFlags);
    chunks.push(vp8xChunk);
  }

  let offset = 12;

  while (offset < compressedData.byteLength - 8) {
    const chunkId =
      String.fromCharCode(compressedUint8[offset]) +
      String.fromCharCode(compressedUint8[offset + 1]) +
      String.fromCharCode(compressedUint8[offset + 2]) +
      String.fromCharCode(compressedUint8[offset + 3]);

    const chunkSize = view.getUint32(offset + 4, true);
    const paddedSize = chunkSize + (chunkSize % 2);

    if (chunkId === 'VP8X') {
      const vp8xData = updateVp8xFlags(
        compressedData.slice(offset + 8, offset + 8 + chunkSize),
        vp8xFlags,
      );
      const vp8xHeader = createWebPChunk('VP8X', vp8xData);
      chunks.push(vp8xHeader);
    } else if (
      chunkId === 'EXIF' ||
      chunkId === 'ICCP' ||
      chunkId === 'XMP '
    ) {
    } else {
      chunks.push(compressedData.slice(offset, offset + 8 + paddedSize));
    }

    offset += 8 + paddedSize;
  }

  const resultChunks: ArrayBuffer[] = [];
  const riffHeader = new Uint8Array(12);
  riffHeader.set(new Uint8Array([0x52, 0x49, 0x46, 0x46]), 0);
  riffHeader.set(new Uint8Array([0x57, 0x45, 0x42, 0x50]), 8);

  const bodyChunks: ArrayBuffer[] = [];

  for (const chunk of chunks) {
    bodyChunks.push(chunk);
  }

  if (options.keepExif && metadata.exif) {
    bodyChunks.push(createWebPChunk('EXIF', metadata.exif));
  }

  if (options.keepIcc && metadata.icc) {
    bodyChunks.push(createWebPChunk('ICCP', metadata.icc));
  }

  if (options.keepXmp && metadata.xmp) {
    bodyChunks.push(createWebPChunk('XMP ', metadata.xmp));
  }

  const body = concatBuffers(...bodyChunks);
  const bodySize = body.byteLength;

  const riffView = new DataView(riffHeader.buffer);
  riffView.setUint32(4, bodySize + 4, true);

  resultChunks.push(riffHeader.buffer);
  resultChunks.push(body);

  return concatBuffers(...resultChunks);
}

function createVp8xChunk(
  originalData: ArrayBuffer,
  flags: { hasIcc: boolean; hasAlpha: boolean; hasExif: boolean; hasXmp: boolean; hasAnimation: boolean },
): ArrayBuffer {
  const uint8 = new Uint8Array(originalData);
  const view = new DataView(originalData);

  let width = 0;
  let height = 0;

  let offset = 12;
  while (offset < originalData.byteLength - 8) {
    const chunkId =
      String.fromCharCode(uint8[offset]) +
      String.fromCharCode(uint8[offset + 1]) +
      String.fromCharCode(uint8[offset + 2]) +
      String.fromCharCode(uint8[offset + 3]);

    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'VP8 ') {
      const vp8View = new DataView(originalData, offset + 8);
      const keyFrame = (vp8View.getUint8(0) & 0x01) === 0;
      if (keyFrame) {
        width = vp8View.getUint16(7, true) & 0x3fff;
        height = vp8View.getUint16(9, true) & 0x3fff;
      }
      break;
    }

    if (chunkId === 'VP8L') {
      const vp8lView = new DataView(originalData, offset + 8);
      const b1 = vp8lView.getUint8(1);
      const b2 = vp8lView.getUint8(2);
      const b3 = vp8lView.getUint8(3);
      const b4 = vp8lView.getUint8(4);
      width = ((b2 & 0x3f) << 8) | b1;
      height = (b4 << 8) | b3;
      width += 1;
      height += 1;
      break;
    }

    if (chunkId === 'VP8X') {
      const vp8xView = new DataView(originalData, offset + 8);
      width = vp8xView.getUint8(4) | (vp8xView.getUint8(5) << 8) | (vp8xView.getUint8(6) << 16);
      height = vp8xView.getUint8(7) | (vp8xView.getUint8(8) << 8) | (vp8xView.getUint8(9) << 16);
      break;
    }

    const paddedSize = chunkSize + (chunkSize % 2);
    offset += 8 + paddedSize;
  }

  const vp8xData = new Uint8Array(10);
  let flagByte = 0;
  if (flags.hasIcc) flagByte |= 0x20;
  if (flags.hasAlpha) flagByte |= 0x10;
  if (flags.hasExif) flagByte |= 0x08;
  if (flags.hasXmp) flagByte |= 0x04;
  if (flags.hasAnimation) flagByte |= 0x02;

  vp8xData[0] = flagByte;
  vp8xData[4] = (width - 1) & 0xff;
  vp8xData[5] = ((width - 1) >> 8) & 0xff;
  vp8xData[6] = ((width - 1) >> 16) & 0xff;
  vp8xData[7] = (height - 1) & 0xff;
  vp8xData[8] = ((height - 1) >> 8) & 0xff;
  vp8xData[9] = ((height - 1) >> 16) & 0xff;

  return createWebPChunk('VP8X', vp8xData.buffer);
}

function updateVp8xFlags(
  vp8xData: ArrayBuffer,
  flags: { hasIcc: boolean; hasAlpha: boolean; hasExif: boolean; hasXmp: boolean; hasAnimation: boolean },
): ArrayBuffer {
  const uint8 = new Uint8Array(vp8xData);
  const result = new Uint8Array(vp8xData);

  let flagByte = uint8[0];
  if (flags.hasIcc) flagByte |= 0x20;
  if (flags.hasExif) flagByte |= 0x08;
  if (flags.hasXmp) flagByte |= 0x04;

  result[0] = flagByte;

  return result.buffer;
}

function createWebPChunk(chunkId: string, data: ArrayBuffer): ArrayBuffer {
  const header = new Uint8Array(8);
  header.set(new TextEncoder().encode(chunkId), 0);

  const view = new DataView(header.buffer);
  view.setUint32(4, data.byteLength, true);

  const paddedSize = data.byteLength + (data.byteLength % 2);
  const padding = new Uint8Array(paddedSize - data.byteLength);

  return concatBuffers(header.buffer, data, padding.buffer);
}

export function clearExifOrientation(exifData: ArrayBuffer): ArrayBuffer {
  const view = new DataView(exifData);
  const uint8 = new Uint8Array(exifData);
  const result = new Uint8Array(exifData);
  const resultView = new DataView(result.buffer);

  const tiffOffset = 6;
  if (tiffOffset + 8 > exifData.byteLength) return exifData;

  const byteOrder = view.getUint16(tiffOffset, false);
  const isBigEndian = byteOrder === 0x4d4d;

  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return exifData;

  const ifdOffset = readUint32(view, tiffOffset + 4, isBigEndian);
  const ifdPointer = tiffOffset + ifdOffset;

  if (ifdPointer + 2 > exifData.byteLength) return exifData;

  const numEntries = readUint16(view, ifdPointer, isBigEndian);

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdPointer + 2 + i * 12;
    if (entryOffset + 12 > exifData.byteLength) break;

    const tag = readUint16(view, entryOffset, isBigEndian);

    if (tag === 0x0112) {
      resultView.setUint16(entryOffset + 8, 1, !isBigEndian);
    }
  }

  return result.buffer;
}

export function getOrientationDegrees(orientation: number): 0 | 90 | 180 | 270 {
  switch (orientation) {
    case 5:
    case 6:
      return 90;
    case 3:
    case 4:
      return 180;
    case 7:
    case 8:
      return 270;
    default:
      return 0;
  }
}

export function needsFlip(orientation: number): boolean {
  return orientation === 2 || orientation === 4 || orientation === 5 || orientation === 7;
}
