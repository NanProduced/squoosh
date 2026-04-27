import { calculateSSIM, calculateFastSSIM, SSIMResult } from '../shared/meta';

export { calculateSSIM, calculateFastSSIM };
export type { SSIMResult };

export default async function ssim(
  original: ImageData,
  compressed: ImageData,
  fast: boolean = false,
): Promise<SSIMResult> {
  if (fast) {
    const ssimVal = calculateFastSSIM(original, compressed);
    return { ssim: ssimVal, meanSSIM: ssimVal };
  }
  return calculateSSIM(original, compressed);
}
