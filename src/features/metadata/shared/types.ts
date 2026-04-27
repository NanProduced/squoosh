/**
 * Metadata types for image metadata preservation.
 * Supports EXIF, ICC (color profile), and XMP.
 */

export interface ImageMetadata {
  exif?: ArrayBuffer;
  icc?: ArrayBuffer;
  xmp?: ArrayBuffer;
}

export interface MetadataInfo {
  type: 'exif' | 'icc' | 'xmp';
  size: number;
  description?: string;
}

export interface ImageMetadataSummary {
  source: MetadataInfo[];
  compressed: MetadataInfo[];
  orientation?: number;
  cameraMake?: string;
  cameraModel?: string;
  colorSpace?: string;
}

export interface MetadataOptions {
  keepExif: boolean;
  keepIcc: boolean;
  keepXmp: boolean;
}

export const defaultMetadataOptions: MetadataOptions = {
  keepExif: true,
  keepIcc: true,
  keepXmp: true,
};

export interface FormatMetadataSupport {
  supportsExif: boolean;
  supportsIcc: boolean;
  supportsXmp: boolean;
}

export const formatMetadataSupport: Record<string, FormatMetadataSupport> = {
  'image/jpeg': { supportsExif: true, supportsIcc: true, supportsXmp: true },
  'image/webp': { supportsExif: true, supportsIcc: true, supportsXmp: true },
  'image/png': { supportsExif: true, supportsIcc: true, supportsXmp: true },
  'image/avif': { supportsExif: true, supportsIcc: true, supportsXmp: true },
  'image/webp2': { supportsExif: true, supportsIcc: true, supportsXmp: true },
  'image/jxl': { supportsExif: true, supportsIcc: true, supportsXmp: true },
  'image/gif': { supportsExif: false, supportsIcc: false, supportsXmp: false },
  'image/qoi': { supportsExif: false, supportsIcc: false, supportsXmp: false },
  'image/bmp': { supportsExif: false, supportsIcc: true, supportsXmp: false },
  'image/tiff': { supportsExif: true, supportsIcc: true, supportsXmp: true },
};

export function getMetadataSupport(mimeType: string): FormatMetadataSupport {
  return formatMetadataSupport[mimeType] || {
    supportsExif: false,
    supportsIcc: false,
    supportsXmp: false,
  };
}
