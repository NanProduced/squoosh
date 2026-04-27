/**
 * Structural Similarity Index (SSIM) calculation.
 * SSIM measures the perceived quality of a compressed image compared to the original.
 * Values range from -1 to 1, where 1 means identical images.
 * A value >= 0.95 is generally considered "visually lossless".
 */

export interface SSIMResult {
  ssim: number;
  meanSSIM: number;
}

const K1 = 0.01;
const K2 = 0.03;
const L = 255;

const C1 = (K1 * L) ** 2;
const C2 = (K2 * L) ** 2;

function createGaussianKernel(size: number, sigma: number): Float64Array {
  const kernel = new Float64Array(size);
  const halfSize = Math.floor(size / 2);
  const twoSigmaSq = 2 * sigma * sigma;
  let sum = 0;

  for (let i = 0; i < size; i++) {
    const x = i - halfSize;
    kernel[i] = Math.exp(-(x * x) / twoSigmaSq);
    sum += kernel[i];
  }

  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }

  return kernel;
}

function convolve1D(
  data: Float64Array,
  width: number,
  height: number,
  kernel: Float64Array,
  horizontal: boolean,
): Float64Array {
  const result = new Float64Array(width * height);
  const halfKernel = Math.floor(kernel.length / 2);

  if (horizontal) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k++) {
          const xk = x + k - halfKernel;
          if (xk >= 0 && xk < width) {
            sum += data[y * width + xk] * kernel[k];
          }
        }
        result[y * width + x] = sum;
      }
    }
  } else {
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        let sum = 0;
        for (let k = 0; k < kernel.length; k++) {
          const yk = y + k - halfKernel;
          if (yk >= 0 && yk < height) {
            sum += data[yk * width + x] * kernel[k];
          }
        }
        result[y * width + x] = sum;
      }
    }
  }

  return result;
}

function convolve2D(
  data: Float64Array,
  width: number,
  height: number,
  kernel: Float64Array,
): Float64Array {
  const horizontal = convolve1D(data, width, height, kernel, true);
  return convolve1D(horizontal, width, height, kernel, false);
}

function extractLuminance(imageData: ImageData): Float64Array {
  const data = imageData.data;
  const luminance = new Float64Array(data.length / 4);

  for (let i = 0; i < luminance.length; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    luminance[i] = 0.299 * r + 0.587 * g + 0.114 * b;
  }

  return luminance;
}

/**
 * Calculate SSIM between two images.
 * Uses a Gaussian window for local SSIM calculation.
 * @param original - Original image data
 * @param compressed - Compressed image data
 * @returns SSIM result with per-pixel SSIM map and mean SSIM
 */
export function calculateSSIM(
  original: ImageData,
  compressed: ImageData,
): SSIMResult {
  if (
    original.width !== compressed.width ||
    original.height !== compressed.height
  ) {
    throw new Error('Images must have the same dimensions for SSIM calculation');
  }

  const width = original.width;
  const height = original.height;
  const pixelCount = width * height;

  const x = extractLuminance(original);
  const y = extractLuminance(compressed);

  const windowSize = 11;
  const sigma = 1.5;
  const kernel = createGaussianKernel(windowSize, sigma);

  const muX = convolve2D(x, width, height, kernel);
  const muY = convolve2D(y, width, height, kernel);

  const muX2 = new Float64Array(pixelCount);
  const muY2 = new Float64Array(pixelCount);
  const muXY = new Float64Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    muX2[i] = muX[i] * muX[i];
    muY2[i] = muY[i] * muY[i];
    muXY[i] = muX[i] * muY[i];
  }

  const sigmaX2 = new Float64Array(pixelCount);
  const sigmaY2 = new Float64Array(pixelCount);
  const sigmaXY = new Float64Array(pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    sigmaX2[i] = x[i] * x[i];
    sigmaY2[i] = y[i] * y[i];
    sigmaXY[i] = x[i] * y[i];
  }

  const convSigmaX2 = convolve2D(sigmaX2, width, height, kernel);
  const convSigmaY2 = convolve2D(sigmaY2, width, height, kernel);
  const convSigmaXY = convolve2D(sigmaXY, width, height, kernel);

  const ssimMap = new Float64Array(pixelCount);
  let meanSSIM = 0;

  for (let i = 0; i < pixelCount; i++) {
    const sigmaX = convSigmaX2[i] - muX2[i];
    const sigmaY = convSigmaY2[i] - muY2[i];
    const sigmaCovar = convSigmaXY[i] - muXY[i];

    const numerator1 = 2 * muXY[i] + C1;
    const numerator2 = 2 * sigmaCovar + C2;
    const denominator1 = muX2[i] + muY2[i] + C1;
    const denominator2 = sigmaX + sigmaY + C2;

    ssimMap[i] = (numerator1 * numerator2) / (denominator1 * denominator2);
    meanSSIM += ssimMap[i];
  }

  meanSSIM /= pixelCount;

  return {
    ssim: meanSSIM,
    meanSSIM,
  };
}

/**
 * Fast SSIM calculation using a simplified approach.
 * Good enough for most use cases and faster than the full Gaussian version.
 * @param original - Original image data
 * @param compressed - Compressed image data
 * @returns Mean SSIM value
 */
export function calculateFastSSIM(
  original: ImageData,
  compressed: ImageData,
): number {
  if (
    original.width !== compressed.width ||
    original.height !== compressed.height
  ) {
    throw new Error('Images must have the same dimensions for SSIM calculation');
  }

  const data1 = original.data;
  const data2 = compressed.data;
  const pixelCount = data1.length / 4;

  let sumX = 0;
  let sumY = 0;
  let sumX2 = 0;
  let sumY2 = 0;
  let sumXY = 0;

  for (let i = 0; i < pixelCount; i++) {
    const idx = i * 4;
    const x = 0.299 * data1[idx] + 0.587 * data1[idx + 1] + 0.114 * data1[idx + 2];
    const y = 0.299 * data2[idx] + 0.587 * data2[idx + 1] + 0.114 * data2[idx + 2];

    sumX += x;
    sumY += y;
    sumX2 += x * x;
    sumY2 += y * y;
    sumXY += x * y;
  }

  const n = pixelCount;
  const meanX = sumX / n;
  const meanY = sumY / n;

  const varX = (sumX2 / n - meanX * meanX) * (n / (n - 1));
  const varY = (sumY2 / n - meanY * meanY) * (n / (n - 1));
  const covarXY = (sumXY / n - meanX * meanY) * (n / (n - 1));

  const numerator1 = 2 * meanX * meanY + C1;
  const numerator2 = 2 * covarXY + C2;
  const denominator1 = meanX * meanX + meanY * meanY + C1;
  const denominator2 = varX + varY + C2;

  return (numerator1 * numerator2) / (denominator1 * denominator2);
}
