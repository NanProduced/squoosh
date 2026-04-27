import { calculateSSIM, calculateFastSSIM, SSIMResult } from '../shared/meta';

export { calculateSSIM, calculateFastSSIM };
export type { SSIMResult };

export default function ssimCalculate(
  original: ImageData,
  compressed: ImageData,
  fast: boolean = false,
): SSIMResult {
  if (fast) {
    const ssim = calculateFastSSIM(original, compressed);
    return { ssim, meanSSIM: ssim };
  }
  return calculateSSIM(original, compressed);
}
