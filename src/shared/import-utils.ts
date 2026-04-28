/**
 * 图片导入相关的工具函数
 * 包含URL校验、元数据序列化、带超时和大小限制的fetch函数
 */

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const FETCH_TIMEOUT = 30000; // 30秒超时

function assertSignal(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('AbortError', 'AbortError');
}

async function abortable<T>(
  signal: AbortSignal,
  promise: Promise<T>,
): Promise<T> {
  assertSignal(signal);
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      signal.addEventListener('abort', () =>
        reject(new DOMException('AbortError', 'AbortError')),
      );
    }),
  ]);
}

/**
 * 校验URL是否有效
 * @param url 要校验的URL
 * @returns 是否为有效的URL
 */
export function isValidUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;

  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 最近文件的元数据接口
 */
export interface RecentFileMetadata {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  timestamp: number;
  previewDataUrl?: string;
}

/**
 * 序列化元数据
 * @param metadata 元数据对象
 * @returns 序列化后的字符串
 */
export function serializeMetadata(metadata: RecentFileMetadata): string {
  return JSON.stringify(metadata);
}

/**
 * 反序列化元数据
 * @param serialized 序列化后的字符串
 * @returns 元数据对象，如果解析失败则返回null
 */
export function deserializeMetadata(serialized: string): RecentFileMetadata | null {
  try {
    const parsed = JSON.parse(serialized);

    if (!parsed.url || !parsed.filename || !parsed.mimeType || !parsed.timestamp) {
      return null;
    }

    return {
      url: parsed.url,
      filename: parsed.filename,
      mimeType: parsed.mimeType,
      size: typeof parsed.size === 'number' ? parsed.size : 0,
      timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now(),
      previewDataUrl: typeof parsed.previewDataUrl === 'string' ? parsed.previewDataUrl : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * 从URL获取文件名
 * @param url URL
 * @returns 文件名
 */
export function getFilenameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop() || 'image';

    if (filename && filename.includes('.')) {
      return filename;
    }

    return `${filename}.unknown`;
  } catch {
    return 'image.unknown';
  }
}

/**
 * 带超时和大小限制的fetch函数
 * @param url 要获取的URL
 * @param options 选项
 * @returns Blob对象
 */
export async function fetchWithLimits(
  url: string,
  options: {
    maxSize?: number;
    timeout?: number;
    signal?: AbortSignal;
  } = {}
): Promise<Blob> {
  const {
    maxSize = MAX_FILE_SIZE,
    timeout = FETCH_TIMEOUT,
    signal: externalSignal,
  } = options;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    if (externalSignal) {
      externalSignal.addEventListener('abort', () => controller.abort());
    }

    const response = await abortable(
      controller.signal,
      fetch(url, {
        signal: controller.signal,
        mode: 'cors',
        credentials: 'omit',
      })
    );

    if (!response.ok) {
      throw new Error(`HTTP error, status = ${response.status}`);
    }

    const contentLength = response.headers.get('Content-Length');
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      if (!isNaN(size) && size > maxSize) {
        throw new Error(`File too large (${(size / 1024 / 1024).toFixed(2)}MB), maximum allowed is ${maxSize / 1024 / 1024}MB`);
      }
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    while (true) {
      assertSignal(controller.signal);
      const { done, value } = await reader.read();

      if (done) break;

      if (value) {
        totalSize += value.length;
        if (totalSize > maxSize) {
          throw new Error(`File too large (${(totalSize / 1024 / 1024).toFixed(2)}MB), maximum allowed is ${maxSize / 1024 / 1024}MB`);
        }
        chunks.push(value);
      }
    }

    const blob = new Blob(chunks, {
      type: response.headers.get('Content-Type') || 'application/octet-stream',
    });

    return blob;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 从DataURL创建预览图
 * @param blob 图片Blob
 * @param maxWidth 最大宽度
 * @param maxHeight 最大高度
 * @returns 预览图的DataURL
 */
export async function createPreview(
  blob: Blob,
  maxWidth: number = 200,
  maxHeight: number = 200
): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);

    img.onload = () => {
      URL.revokeObjectURL(url);

      const canvas = document.createElement('canvas');
      let { width, height } = img;

      if (width > maxWidth || height > maxHeight) {
        const ratio = Math.min(maxWidth / width, maxHeight / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };

    img.src = url;
  });
}

/**
 * 从剪贴板事件中提取图片
 * @param event ClipboardEvent
 * @returns Blob对象，如果没有图片则返回null
 */
export async function extractImageFromClipboardEvent(
  event: ClipboardEvent
): Promise<Blob | null> {
  const items = event.clipboardData?.items;
  if (!items) return null;

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      return item.getAsFile();
    }

    if (item.type === 'text/plain') {
      const text = await new Promise<string>((resolve) => {
        item.getAsString(resolve);
      });

      if (isValidUrl(text)) {
        try {
          const blob = await fetchWithLimits(text);
          if (blob.type.startsWith('image/')) {
            return blob;
          }
        } catch {
          // 忽略错误，继续检查其他项
        }
      }
    }
  }

  return null;
}

/**
 * 从拖放事件中提取图片URL
 * @param event DragEvent
 * @returns URL数组
 */
export function extractUrlsFromDragEvent(event: DragEvent): string[] {
  const urls: string[] = [];

  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) return urls;

  const uriList = dataTransfer.getData('text/uri-list');
  if (uriList) {
    const lines = uriList.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && isValidUrl(trimmed)) {
        urls.push(trimmed);
      }
    }
  }

  const textPlain = dataTransfer.getData('text/plain');
  if (textPlain && isValidUrl(textPlain) && !urls.includes(textPlain)) {
    urls.push(textPlain);
  }

  return urls;
}

/**
 * 从拖放事件中提取文件
 * @param event DragEvent
 * @returns File数组
 */
export function extractFilesFromDragEvent(event: DragEvent): File[] {
  const files: File[] = [];

  const dataTransfer = event.dataTransfer;
  if (!dataTransfer || !dataTransfer.files) return files;

  for (const file of dataTransfer.files) {
    if (file.type.startsWith('image/')) {
      files.push(file);
    }
  }

  return files;
}
