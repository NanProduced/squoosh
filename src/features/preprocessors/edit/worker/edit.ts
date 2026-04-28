/**
 * Image edit worker
 * Handles crop, rotate, flip, and pixel filters using OffscreenCanvas
 */
import { Options, CropState, RotateState, FlipState, FiltersState } from '../shared/meta';

let offscreenCanvas: OffscreenCanvas | null = null;
let offscreenCtx: OffscreenCanvasRenderingContext2D | null = null;

function getOrCreateCanvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
  if (!offscreenCanvas || offscreenCanvas.width < width || offscreenCanvas.height < height) {
    offscreenCanvas = new OffscreenCanvas(width, height);
    offscreenCtx = offscreenCanvas.getContext('2d', { willReadFrequently: true });
    if (!offscreenCtx) {
      throw new Error('Failed to get 2D context for OffscreenCanvas');
    }
  }
  offscreenCanvas.width = width;
  offscreenCanvas.height = height;
  return offscreenCtx!;
}

function applyCrop(imageData: ImageData, crop: CropState): ImageData {
  if (!crop.enabled) return imageData;
  
  const { x, y, width, height } = crop;
  
  if (width <= 0 || height <= 0) return imageData;
  
  const clampedX = Math.max(0, Math.min(x, imageData.width - 1));
  const clampedY = Math.max(0, Math.min(y, imageData.height - 1));
  const clampedWidth = Math.max(1, Math.min(width, imageData.width - clampedX));
  const clampedHeight = Math.max(1, Math.min(height, imageData.height - clampedY));
  
  const ctx = getOrCreateCanvas(imageData.width, imageData.height);
  ctx.clearRect(0, 0, imageData.width, imageData.height);
  ctx.putImageData(imageData, 0, 0);
  
  const resultCtx = getOrCreateCanvas(clampedWidth, clampedHeight);
  resultCtx.clearRect(0, 0, clampedWidth, clampedHeight);
  resultCtx.drawImage(
    ctx.canvas,
    clampedX,
    clampedY,
    clampedWidth,
    clampedHeight,
    0,
    0,
    clampedWidth,
    clampedHeight
  );
  
  return resultCtx.getImageData(0, 0, clampedWidth, clampedHeight);
}

function applyRotate(imageData: ImageData, rotate: RotateState): ImageData {
  const angle = rotate.rotate;
  if (angle === 0) return imageData;
  
  const isOddRotation = angle === 90 || angle === 270;
  const newWidth = isOddRotation ? imageData.height : imageData.width;
  const newHeight = isOddRotation ? imageData.width : imageData.height;
  
  const ctx = getOrCreateCanvas(imageData.width, imageData.height);
  ctx.clearRect(0, 0, imageData.width, imageData.height);
  ctx.putImageData(imageData, 0, 0);
  
  const resultCtx = getOrCreateCanvas(newWidth, newHeight);
  resultCtx.clearRect(0, 0, newWidth, newHeight);
  
  resultCtx.save();
  resultCtx.translate(newWidth / 2, newHeight / 2);
  resultCtx.rotate((angle * Math.PI) / 180);
  
  const drawX = -imageData.width / 2;
  const drawY = -imageData.height / 2;
  
  resultCtx.drawImage(ctx.canvas, drawX, drawY);
  resultCtx.restore();
  
  return resultCtx.getImageData(0, 0, newWidth, newHeight);
}

function applyFlip(imageData: ImageData, flip: FlipState): ImageData {
  if (!flip.horizontal && !flip.vertical) return imageData;
  
  const ctx = getOrCreateCanvas(imageData.width, imageData.height);
  ctx.clearRect(0, 0, imageData.width, imageData.height);
  ctx.putImageData(imageData, 0, 0);
  
  const resultCtx = getOrCreateCanvas(imageData.width, imageData.height);
  resultCtx.clearRect(0, 0, imageData.width, imageData.height);
  
  resultCtx.save();
  
  let scaleX = 1;
  let scaleY = 1;
  let translateX = 0;
  let translateY = 0;
  
  if (flip.horizontal) {
    scaleX = -1;
    translateX = -imageData.width;
  }
  if (flip.vertical) {
    scaleY = -1;
    translateY = -imageData.height;
  }
  
  resultCtx.translate(translateX, translateY);
  resultCtx.scale(scaleX, scaleY);
  resultCtx.drawImage(ctx.canvas, 0, 0);
  resultCtx.restore();
  
  return resultCtx.getImageData(0, 0, imageData.width, imageData.height);
}

function applyFilters(imageData: ImageData, filters: FiltersState): ImageData {
  if (!filters.enabled) return imageData;
  
  const { brightness, contrast, saturation, grayscale } = filters;
  
  if (brightness === 0 && contrast === 0 && saturation === 0 && !grayscale) {
    return imageData;
  }
  
  const ctx = getOrCreateCanvas(imageData.width, imageData.height);
  ctx.clearRect(0, 0, imageData.width, imageData.height);
  ctx.putImageData(imageData, 0, 0);
  
  const resultCtx = getOrCreateCanvas(imageData.width, imageData.height);
  resultCtx.clearRect(0, 0, imageData.width, imageData.height);
  
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
    resultCtx.filter = filterString.trim();
  }
  
  resultCtx.drawImage(ctx.canvas, 0, 0);
  resultCtx.filter = 'none';
  
  return resultCtx.getImageData(0, 0, imageData.width, imageData.height);
}

export default async function edit(
  data: ImageData,
  opts: Options
): Promise<ImageData> {
  let result = data;
  
  result = applyRotate(result, opts.rotate);
  result = applyFlip(result, opts.flip);
  result = applyFilters(result, opts.filters);
  result = applyCrop(result, opts.crop);
  
  return result;
}
