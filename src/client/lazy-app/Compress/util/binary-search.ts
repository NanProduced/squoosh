/**
 * Binary search algorithm for finding optimal quality parameter.
 * Searches for the minimum quality value that satisfies SSIM >= targetSSIM.
 * Assumption: higher quality => higher SSIM, higher quality => larger file size
 * Goal: find the smallest quality (thus smallest size) where SSIM >= target
 */

export interface BinarySearchParams {
  minQuality: number;
  maxQuality: number;
  targetSSIM: number;
  maxIterations: number;
}

export interface SearchResult {
  quality: number;
  ssim: number;
  size: number;
  encodeTime: number;
  iterations: number;
  converged: boolean;
}

export interface EncodeResult {
  quality: number;
  ssim: number;
  size: number;
  encodeTime: number;
}

export type EncodeFunction = (quality: number) => Promise<EncodeResult>;

const DEFAULT_PARAMS: BinarySearchParams = {
  minQuality: 0,
  maxQuality: 100,
  targetSSIM: 0.95,
  maxIterations: 12,
};

export class QualityBinarySearch {
  private params: BinarySearchParams;

  constructor(params: Partial<BinarySearchParams> = {}) {
    this.params = { ...DEFAULT_PARAMS, ...params };
  }

  async search(
    encodeFn: EncodeFunction,
    onProgress?: (iteration: number, total: number) => void,
  ): Promise<SearchResult> {
    const { minQuality, maxQuality, targetSSIM, maxIterations } = this.params;

    let low = minQuality;
    let high = maxQuality;
    let bestValidResult: EncodeResult | null = null;
    let bestInvalidResult: EncodeResult | null = null;
    let iteration = 0;

    const epsilon = (maxQuality - minQuality) / (2 ** maxIterations);

    while (high - low > epsilon && iteration < maxIterations) {
      const mid = (low + high) / 2;
      iteration++;

      if (onProgress) {
        onProgress(iteration, maxIterations);
      }

      const result = await encodeFn(mid);

      if (result.ssim >= targetSSIM) {
        if (!bestValidResult || result.quality < bestValidResult.quality) {
          bestValidResult = result;
        }
        high = mid;
      } else {
        if (!bestInvalidResult || result.quality > bestInvalidResult.quality) {
          bestInvalidResult = result;
        }
        low = mid;
      }
    }

    const finalCheckQuality = (low + high) / 2;
    const finalResult = await encodeFn(finalCheckQuality);
    iteration++;

    if (finalResult.ssim >= targetSSIM) {
      if (!bestValidResult || finalResult.quality < bestValidResult.quality) {
        bestValidResult = finalResult;
      }
    } else {
      if (!bestInvalidResult || finalResult.quality > bestInvalidResult.quality) {
        bestInvalidResult = finalResult;
      }
    }

    if (bestValidResult) {
      return {
        quality: bestValidResult.quality,
        ssim: bestValidResult.ssim,
        size: bestValidResult.size,
        encodeTime: bestValidResult.encodeTime,
        iterations: iteration,
        converged: high - low <= epsilon,
      };
    }

    const fallbackResult = bestInvalidResult || finalResult;
    return {
      quality: fallbackResult.quality,
      ssim: fallbackResult.ssim,
      size: fallbackResult.size,
      encodeTime: fallbackResult.encodeTime,
      iterations: iteration,
      converged: false,
    };
  }

  async linearSearch(
    encodeFn: EncodeFunction,
    steps: number = 10,
    onProgress?: (iteration: number, total: number) => void,
  ): Promise<SearchResult> {
    const { minQuality, maxQuality, targetSSIM } = this.params;
    const stepSize = (maxQuality - minQuality) / (steps - 1);

    let bestValidResult: EncodeResult | null = null;
    let bestInvalidResult: EncodeResult | null = null;

    for (let i = 0; i < steps; i++) {
      if (onProgress) {
        onProgress(i + 1, steps);
      }

      const quality = minQuality + stepSize * i;
      const result = await encodeFn(quality);

      if (result.ssim >= targetSSIM) {
        if (!bestValidResult || result.quality < bestValidResult.quality) {
          bestValidResult = result;
        }
      } else {
        if (!bestInvalidResult || result.quality > bestInvalidResult.quality) {
          bestInvalidResult = result;
        }
      }
    }

    if (bestValidResult) {
      return {
        quality: bestValidResult.quality,
        ssim: bestValidResult.ssim,
        size: bestValidResult.size,
        encodeTime: bestValidResult.encodeTime,
        iterations: steps,
        converged: true,
      };
    }

    const fallbackResult = bestInvalidResult || await encodeFn((minQuality + maxQuality) / 2);
    return {
      quality: fallbackResult.quality,
      ssim: fallbackResult.ssim,
      size: fallbackResult.size,
      encodeTime: fallbackResult.encodeTime,
      iterations: steps,
      converged: false,
    };
  }
}

export async function binarySearchQuality(
  encodeFn: EncodeFunction,
  params: Partial<BinarySearchParams> = {},
  onProgress?: (iteration: number, total: number) => void,
): Promise<SearchResult> {
  const searcher = new QualityBinarySearch(params);
  return searcher.search(encodeFn, onProgress);
}
