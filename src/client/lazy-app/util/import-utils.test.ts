import {
  isValidUrl,
  serializeMetadata,
  deserializeMetadata,
  getFilenameFromUrl,
  RecentFileMetadata,
} from './import-utils';

describe('import-utils', () => {
  describe('isValidUrl', () => {
    it('should return true for valid http URLs', () => {
      expect(isValidUrl('http://example.com/image.jpg')).toBe(true);
      expect(isValidUrl('http://www.example.com/path/to/image.png')).toBe(true);
    });

    it('should return true for valid https URLs', () => {
      expect(isValidUrl('https://example.com/image.jpg')).toBe(true);
      expect(isValidUrl('https://www.example.com/path/to/image.png')).toBe(true);
    });

    it('should return false for invalid protocols', () => {
      expect(isValidUrl('ftp://example.com/image.jpg')).toBe(false);
      expect(isValidUrl('file:///path/to/image.jpg')).toBe(false);
      expect(isValidUrl('data:image/png;base64,abc123')).toBe(false);
    });

    it('should return false for invalid URL formats', () => {
      expect(isValidUrl('')).toBe(false);
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('example.com/image.jpg')).toBe(false);
      expect(isValidUrl('//example.com/image.jpg')).toBe(false);
    });

    it('should return false for non-string inputs', () => {
      expect(isValidUrl(null as unknown as string)).toBe(false);
      expect(isValidUrl(undefined as unknown as string)).toBe(false);
      expect(isValidUrl(123 as unknown as string)).toBe(false);
      expect(isValidUrl({} as unknown as string)).toBe(false);
    });

    it('should handle URLs with query parameters', () => {
      expect(isValidUrl('https://example.com/image.jpg?width=100&height=100')).toBe(true);
      expect(isValidUrl('http://example.com/api/image?id=123&format=png')).toBe(true);
    });

    it('should handle URLs with ports', () => {
      expect(isValidUrl('http://localhost:3000/image.jpg')).toBe(true);
      expect(isValidUrl('https://example.com:8080/path/image.png')).toBe(true);
    });

    it('should handle URLs with subdomains', () => {
      expect(isValidUrl('https://cdn.example.com/images/photo.jpg')).toBe(true);
      expect(isValidUrl('http://sub.domain.example.org/file.png')).toBe(true);
    });
  });

  describe('serializeMetadata', () => {
    it('should serialize valid metadata correctly', () => {
      const metadata: RecentFileMetadata = {
        url: 'https://example.com/image.jpg',
        filename: 'image.jpg',
        mimeType: 'image/jpeg',
        size: 102400,
        timestamp: Date.now(),
        previewDataUrl: 'data:image/jpeg;base64,abc123',
      };

      const serialized = serializeMetadata(metadata);
      const parsed = JSON.parse(serialized);

      expect(parsed.url).toBe(metadata.url);
      expect(parsed.filename).toBe(metadata.filename);
      expect(parsed.mimeType).toBe(metadata.mimeType);
      expect(parsed.size).toBe(metadata.size);
      expect(parsed.timestamp).toBe(metadata.timestamp);
      expect(parsed.previewDataUrl).toBe(metadata.previewDataUrl);
    });

    it('should serialize metadata without previewDataUrl', () => {
      const metadata: RecentFileMetadata = {
        url: 'https://example.com/image.png',
        filename: 'image.png',
        mimeType: 'image/png',
        size: 204800,
        timestamp: Date.now(),
      };

      const serialized = serializeMetadata(metadata);
      const parsed = JSON.parse(serialized);

      expect(parsed.url).toBe(metadata.url);
      expect(parsed.filename).toBe(metadata.filename);
      expect(parsed.mimeType).toBe(metadata.mimeType);
      expect(parsed.size).toBe(metadata.size);
      expect(parsed.timestamp).toBe(metadata.timestamp);
      expect(parsed.previewDataUrl).toBeUndefined();
    });
  });

  describe('deserializeMetadata', () => {
    it('should deserialize valid metadata correctly', () => {
      const original: RecentFileMetadata = {
        url: 'https://example.com/image.jpg',
        filename: 'image.jpg',
        mimeType: 'image/jpeg',
        size: 102400,
        timestamp: Date.now(),
        previewDataUrl: 'data:image/jpeg;base64,abc123',
      };

      const serialized = JSON.stringify(original);
      const deserialized = deserializeMetadata(serialized);

      expect(deserialized).not.toBeNull();
      expect(deserialized?.url).toBe(original.url);
      expect(deserialized?.filename).toBe(original.filename);
      expect(deserialized?.mimeType).toBe(original.mimeType);
      expect(deserialized?.size).toBe(original.size);
      expect(deserialized?.timestamp).toBe(original.timestamp);
      expect(deserialized?.previewDataUrl).toBe(original.previewDataUrl);
    });

    it('should return null for invalid JSON', () => {
      expect(deserializeMetadata('not valid json')).toBeNull();
      expect(deserializeMetadata('{invalid}')).toBeNull();
      expect(deserializeMetadata('')).toBeNull();
    });

    it('should return null for missing required fields', () => {
      const missingUrl = JSON.stringify({
        filename: 'image.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        timestamp: Date.now(),
      });
      expect(deserializeMetadata(missingUrl)).toBeNull();

      const missingFilename = JSON.stringify({
        url: 'https://example.com/image.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        timestamp: Date.now(),
      });
      expect(deserializeMetadata(missingFilename)).toBeNull();

      const missingMimeType = JSON.stringify({
        url: 'https://example.com/image.jpg',
        filename: 'image.jpg',
        size: 1024,
        timestamp: Date.now(),
      });
      expect(deserializeMetadata(missingMimeType)).toBeNull();

      const missingTimestamp = JSON.stringify({
        url: 'https://example.com/image.jpg',
        filename: 'image.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
      });
      expect(deserializeMetadata(missingTimestamp)).toBeNull();
    });

    it('should handle optional fields correctly', () => {
      const withoutPreview = JSON.stringify({
        url: 'https://example.com/image.jpg',
        filename: 'image.jpg',
        mimeType: 'image/jpeg',
        size: 1024,
        timestamp: Date.now(),
      });
      const result1 = deserializeMetadata(withoutPreview);
      expect(result1).not.toBeNull();
      expect(result1?.previewDataUrl).toBeUndefined();

      const withNullSize = JSON.stringify({
        url: 'https://example.com/image.jpg',
        filename: 'image.jpg',
        mimeType: 'image/jpeg',
        size: null,
        timestamp: Date.now(),
      });
      const result2 = deserializeMetadata(withNullSize);
      expect(result2).not.toBeNull();
      expect(result2?.size).toBe(0);
    });

    it('should round-trip correctly', () => {
      const original: RecentFileMetadata = {
        url: 'https://example.com/path/to/image.png?v=123',
        filename: 'image.png',
        mimeType: 'image/png',
        size: 50000,
        timestamp: 1234567890,
        previewDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      };

      const serialized = serializeMetadata(original);
      const deserialized = deserializeMetadata(serialized);

      expect(deserialized).not.toBeNull();
      expect(deserialized?.url).toBe(original.url);
      expect(deserialized?.filename).toBe(original.filename);
      expect(deserialized?.mimeType).toBe(original.mimeType);
      expect(deserialized?.size).toBe(original.size);
      expect(deserialized?.timestamp).toBe(original.timestamp);
      expect(deserialized?.previewDataUrl).toBe(original.previewDataUrl);
    });
  });

  describe('getFilenameFromUrl', () => {
    it('should extract filename from URL path', () => {
      expect(getFilenameFromUrl('https://example.com/image.jpg')).toBe('image.jpg');
      expect(getFilenameFromUrl('https://example.com/path/to/photo.png')).toBe('photo.png');
      expect(getFilenameFromUrl('http://localhost:3000/assets/image.webp')).toBe('image.webp');
    });

    it('should handle URLs with query parameters', () => {
      expect(getFilenameFromUrl('https://example.com/image.jpg?width=100')).toBe('image.jpg');
      expect(getFilenameFromUrl('https://example.com/path/file.png?v=123&t=456')).toBe('file.png');
    });

    it('should handle URLs with trailing slashes', () => {
      expect(getFilenameFromUrl('https://example.com/images/')).toBe('image.unknown');
      expect(getFilenameFromUrl('https://example.com/path/to/image/')).toBe('image.unknown');
    });

    it('should handle URLs without extension', () => {
      expect(getFilenameFromUrl('https://example.com/api/image')).toBe('image.unknown');
      expect(getFilenameFromUrl('https://example.com/files/12345')).toBe('12345.unknown');
    });

    it('should return default filename for invalid URLs', () => {
      expect(getFilenameFromUrl('not a valid url')).toBe('image.unknown');
      expect(getFilenameFromUrl('')).toBe('image.unknown');
    });

    it('should handle URLs with hash fragments', () => {
      expect(getFilenameFromUrl('https://example.com/image.jpg#section')).toBe('image.jpg');
      expect(getFilenameFromUrl('https://example.com/path/file.png#anchor')).toBe('file.png');
    });

    it('should handle URLs with special characters', () => {
      expect(getFilenameFromUrl('https://example.com/my%20image.jpg')).toBe('my%20image.jpg');
      expect(getFilenameFromUrl('https://example.com/image-with-dashes.png')).toBe('image-with-dashes.png');
      expect(getFilenameFromUrl('https://example.com/image_with_underscores.webp')).toBe('image_with_underscores.webp');
    });
  });
});
