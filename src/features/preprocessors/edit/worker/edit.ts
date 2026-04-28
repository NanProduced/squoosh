/**
 * Image edit worker
 * Handles crop, rotate, flip, and pixel filters using OffscreenCanvas
 * Uses reusable canvas buffers to avoid repeated allocations
 */
import { Options, CropState, RotateState, FlipState, FiltersState } from '../shared/meta';

interface CanvasBuffer {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

let bufferA: CanvasBuffer | null = null;
let bufferB: CanvasBuffer | null = null;
let lastMaxWidth = 0;
let lastMaxHeight = 0;

function getOrCreateBuffer(width: number, height: number): CanvasBuffer {
  if (!bufferA || bufferA.canvas.width < width || bufferA.canvas.height < height) {
    bufferA = {
      canvas: new OffscreenCanvas(width, height),
      ctx: null as any,
    };
    bufferA.ctx = bufferA.canvas.getContext('2d', { willReadFrequently: true })!;
    if (!bufferA.ctx) {
      throw new Error('Failed to get 2D context for bufferA');
    }
  }
  bufferA.canvas.width = width;
  bufferA.canvas.height = height;
  return bufferA;
}

function getOrCreateSecondBuffer(width: number, height: number): CanvasBuffer {
  if (!bufferB || bufferB.canvas.width < width || bufferB.canvas.height < height) {
    bufferB = {
      canvas: new OffscreenCanvas(width, height),
      ctx: null as any,
    };
    bufferB.ctx = bufferB.canvas.getContext('2d', { willReadFrequently: true })!;
    if (!bufferB.ctx) {
      throw new Error('Failed to get 2D context for bufferB');
    }
  }
  bufferB.canvas.width = width;
  bufferB.canvas.height = height;
  return bufferB;
}

function initBuffers(maxWidth: number, maxHeight: number): void {
  if (maxWidth <= lastMaxWidth && maxHeight <= lastMaxHeight) {
    return;
  }
  lastMaxWidth = Math.max(lastMaxWidth, maxWidth);
  lastMaxHeight = Math.max(lastMaxHeight, maxHeight);
  getOrCreateBuffer(lastMaxWidth, lastMaxHeight);
  getOrCreateSecondBuffer(lastMaxWidth, lastMaxHeight);
}

function applyCrop(imageData: ImageData, crop: CropState): ImageData {
  if (!crop.enabled) return imageData;

  const { x, y, width, height } = crop;

  if (width <= 0 || height <= 0) return imageData;

  const clampedX = Math.max(0, Math.min(x, imageData.width - 1));
  const clampedY = Math.max(0, Math.min(y, imageData.height - 1));
  const clampedWidth = Math.max(1, Math.min(width, imageData.width - clampedX));
  const clampedHeight = Math.max(1, Math.min(height, imageData.height - clampedY));

  const source = getOrCreateBuffer(imageData.width, imageData.height);
  source.ctx.clearRect(0, 0, imageData.width, imageData.height);
  source.ctx.putImageData(imageData, 0, 0);

  const result = getOrCreateSecondBuffer(clampedWidth, clampedHeight);
  result.ctx.clearRect(0, 0, clampedWidth, clampedHeight);
  result.ctx.drawImage(
    source.canvas,
    clampedX,
    clampedY,
    clampedWidth,
    clampedHeight,
    0,
    0,
    clampedWidth,
    clampedHeight
  );

  return result.ctx.getImageData(0, 0, clampedWidth, clampedHeight);
}

function applyRotate(imageData: ImageData, rotate: RotateState): ImageData {
  const angle = rotate.rotate;
  if (angle === 0) return imageData;

  const isOddRotation = angle === 90 || angle === 270;
  const newWidth = isOddRotation ? imageData.height : imageData.width;
  const newHeight = isOddRotation ? imageData.width : imageData.height;

  const source = getOrCreateBuffer(imageData.width, imageData.height);
  source.ctx.clearRect(0, 0, imageData.width, imageData.height);
  source.ctx.putImageData(imageData, 0, 0);

  const result = getOrCreateSecondBuffer(newWidth, newHeight);
  result.ctx.clearRect(0, 0, newWidth, newHeight);

  result.ctx.save();
  result.ctx.translate(newWidth / 2, newHeight / 2);
  result.ctx.rotate((angle * Math.PI) / 180);

  const drawX = -imageData.width / 2;
  const drawY = -imageData.height / 2;

  result.ctx.drawImage(source.canvas, drawX, drawY);
  result.ctx.restore();

  return result.ctx.getImageData(0, 0, newWidth, newHeight);
}

function applyFlip(imageData: ImageData, flip: FlipState): ImageData {
  if (!flip.horizontal && !flip.vertical) return imageData;

  const source = getOrCreateBuffer(imageData.width, imageData.height);
  source.ctx.clearRect(0, 0, imageData.width, imageData.height);
  source.ctx.putImageData(imageData, 0, 0);

  const result = getOrCreateSecondBuffer(imageData.width, imageData.height);
  result.ctx.clearRect(0, 0, imageData.width, imageData.height);

  result.ctx.save();

  if (flip.horizontal && flip.vertical) {
    result.ctx.translate(imageData.width, imageData.height);
    result.ctx.scale(-1, -1);
  } else if (flip.horizontal) {
    result.ctx.translate(imageData.width, 0);
    result.ctx.scale(-1, 1);
  } else if (flip.vertical) {
    result.ctx.translate(0, imageData.height);
    result.ctx.scale(1, -1);
  }

  result.ctx.drawImage(source.canvas, 0, 0);
  result.ctx.restore();

  return result.ctx.getImageData(0, 0, imageData.width, imageData.height);
}

function applyFilters(imageData: ImageData, filters: FiltersState): ImageData {
  if (!filters.enabled) return imageData;

  const { brightness, contrast, saturation, grayscale } = filters;

  if (brightness === 0 && contrast === 0 && saturation === 0 && !grayscale) {
    return imageData;
  }

  const source = getOrCreateBuffer(imageData.width, imageData.height);
  source.ctx.clearRect(0, 0, imageData.width, imageData.height);
  source.ctx.putImageData(imageData, 0, 0);

  const result = getOrCreateSecondBuffer(imageData.width, imageData.height);
  result.ctx.clearRect(0, 0, imageData.width, imageData.height);

  let filterString = '';

  if (brightness !== 0) {
    const brightnessValue = 1 + brightness / 100;
    filterString += `brightness(${brightnessValue}) `;
  }

  if (contrast !== 0) {
    const contrastValue = 1 + contrast / 100;
    filterString += `contrast(${contrastValue}) `;
  }

  if (saturation !== 0) {
    const saturationValue = 1 + saturation / 100;
    filterString += `saturate(${saturationValue}) `;
  }

  if (grayscale) {
    filterString += `grayscale(100%) `;
  }

  if (filterString) {
    result.ctx.filter = filterString.trim();
  }

  result.ctx.drawImage(source.canvas, 0, 0);
  result.ctx.filter = 'none';

  return result.ctx.getImageData(0, 0, imageData.width, imageData.height);
}

export default async function edit(
  data: ImageData,
  opts: Options
): Promise<ImageData> {
  initBuffers(data.width, data.height);

  let result = data;

  result = applyRotate(result, opts.rotate);
  result = applyFlip(result, opts.flip);
  result = applyFilters(result, opts.filters);
  result = applyCrop(result, opts.crop);

  return result;
}
