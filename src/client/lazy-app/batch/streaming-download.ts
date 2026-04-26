import { makeZip } from 'client-zip';
import { BatchItem } from './types';
import { BatchStore } from './batch-store';

export interface DownloadProgress {
  current: number;
  total: number;
  filename: string;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

async function* createZipEntries(
  items: BatchItem[],
  onProgress?: ProgressCallback,
): AsyncGenerator<{ name: string; input: Blob; lastModified: Date }> {
  const completedItems = items.filter((item) => item.status === 'completed' && item.compressedFile);
  const total = completedItems.length;
  let current = 0;

  for (const item of completedItems) {
    if (!item.compressedFile) continue;

    current++;
    onProgress?.({
      current,
      total,
      filename: item.compressedFile.name,
    });

    yield {
      name: item.compressedFile.name,
      input: item.compressedFile,
      lastModified: new Date(),
    };

    await 0;
  }
}

export async function createZipStream(
  items: BatchItem[],
  onProgress?: ProgressCallback,
): Promise<ReadableStream<Uint8Array>> {
  const entries = createZipEntries(items, onProgress);
  return makeZip(entries);
}

declare global {
  interface FileSystemWritableFileStream {
    write(chunk: Uint8Array): Promise<void>;
    close(): Promise<void>;
  }

  interface FileSystemFileHandle {
    createWritable(): Promise<FileSystemWritableFileStream>;
  }

  interface Window {
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<FileSystemFileHandle>;
  }
}

async function streamViaFileHandle(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  showSnack?: (message: string, options?: any) => void,
): Promise<void> {
  if (!window.showSaveFilePicker) {
    throw new Error('File System Access API not supported');
  }

  const handle = await window.showSaveFilePicker({
    suggestedName: filename,
    types: [
      {
        description: 'ZIP Archive',
        accept: {
          'application/zip': ['.zip'],
        },
      },
    ],
  });

  const writable = await handle.createWritable();
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await writable.write(value);
      }
    }
  } finally {
    await writable.close();
  }
}

async function streamViaBlob(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  showSnack?: (message: string, options?: any) => void,
): Promise<void> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
    }
  }

  const blob = new Blob(chunks, { type: 'application/zip' });
  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadAllAsZip(
  items: BatchItem[],
  filename: string = 'compressed-images.zip',
  onProgress?: ProgressCallback,
  showSnack?: (message: string, options?: any) => void,
): Promise<void> {
  const stream = await createZipStream(items, onProgress);

  try {
    if (window.showSaveFilePicker) {
      await streamViaFileHandle(stream, filename, showSnack);
    } else {
      if (showSnack) {
        showSnack('Preparing download... (large files may cause memory issues)', {
          timeout: 5000,
        });
      }
      await streamViaBlob(stream, filename, showSnack);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return;
    }
    throw error;
  }
}

export function streamZipToDownload(
  items: BatchItem[],
  filename: string = 'compressed-images.zip',
  onProgress?: ProgressCallback,
  showSnack?: (message: string, options?: any) => void,
): Promise<void> {
  return downloadAllAsZip(items, filename, onProgress, showSnack);
}

export async function createStreamingZipDownload(
  store: BatchStore,
  filename: string = 'compressed-images.zip',
  onProgress?: ProgressCallback,
  showSnack?: (message: string, options?: any) => void,
): Promise<void> {
  const items = store.getItems();
  return downloadAllAsZip(items, filename, onProgress, showSnack);
}

export function getCompletedItems(items: BatchItem[]): BatchItem[] {
  return items.filter((item) => item.status === 'completed' && item.compressedFile);
}

export function hasCompressedItems(items: BatchItem[]): boolean {
  return getCompletedItems(items).length > 0;
}
