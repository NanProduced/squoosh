import { QualityBinarySearch, binarySearchQuality, EncodeResult } from '../binary-search';

describe('QualityBinarySearch', () => {
  const createMockEncodeFn = (
    qualityToSSIM: (quality: number) => number,
    baseSize: number = 1000,
  ) => {
    return async (quality: number): Promise<EncodeResult> => {
      const ssim = qualityToSSIM(quality);
      const size = Math.round(baseSize * (0.1 + 0.9 * (quality / 100)));
      return {
        quality,
        ssim,
        size,
        encodeTime: 10,
      };
    };
  };

  describe('search() - binary search', () => {
    it('should find minimal quality that meets target SSIM', async () => {
      const ssimCurve = (quality: number) => {
        if (quality < 50) return 0.8;
        if (quality < 70) return 0.92;
        if (quality < 75) return 0.94;
        if (quality < 80) return 0.949;
        return 0.98;
      };

      const searcher = new QualityBinarySearch({
        minQuality: 0,
        maxQuality: 100,
        targetSSIM: 0.95,
        maxIterations: 10,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));

      expect(result.ssim).toBeGreaterThanOrEqual(0.95);
      expect(result.quality).toBeLessThanOrEqual(85);
      expect(result.quality).toBeGreaterThanOrEqual(80);
    });

    it('should handle case where minQuality already meets target', async () => {
      const ssimCurve = () => 0.99;
      const searcher = new QualityBinarySearch({
        minQuality: 10,
        maxQuality: 90,
        targetSSIM: 0.95,
        maxIterations: 8,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));
      expect(result.ssim).toBeGreaterThanOrEqual(0.95);
      expect(result.quality).toBeLessThan(50);
    });

    it('should handle case where high quality is needed to meet target', async () => {
      const ssimCurve = (quality: number) => {
        if (quality >= 90) return 0.96;
        if (quality >= 80) return 0.94;
        return 0.8;
      };

      const searcher = new QualityBinarySearch({
        minQuality: 0,
        maxQuality: 100,
        targetSSIM: 0.95,
        maxIterations: 10,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));
      expect(result.ssim).toBeGreaterThanOrEqual(0.95);
      expect(result.quality).toBeGreaterThanOrEqual(90);
    });

    it('should return best result even if target is not met', async () => {
      const ssimCurve = () => 0.90;
      const searcher = new QualityBinarySearch({
        targetSSIM: 0.95,
        maxIterations: 5,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));
      expect(result.ssim).toBe(0.90);
      expect(result.converged).toBe(false);
    });

    it('should call progress callback with correct iteration counts', async () => {
      const progressCalls: { iteration: number; total: number }[] = [];
      const ssimCurve = (q: number) => Math.min(q / 100, 0.99);

      const maxIterations = 5;
      const searcher = new QualityBinarySearch({
        targetSSIM: 0.95,
        maxIterations,
      });

      await searcher.search(
        createMockEncodeFn(ssimCurve),
        (iteration, total) => {
          progressCalls.push({ iteration, total });
        },
      );

      expect(progressCalls.length).toBeGreaterThan(0);
      progressCalls.forEach((call, idx) => {
        expect(call.iteration).toBeGreaterThanOrEqual(idx + 1);
        expect(call.total).toBe(maxIterations);
      });
    });

    it('should respect maxIterations limit', async () => {
      const ssimCurve = (quality: number) => {
        return Math.min(quality / 100, 0.99);
      };

      const maxIterations = 4;
      const searcher = new QualityBinarySearch({
        targetSSIM: 0.95,
        maxIterations,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));
      expect(result.iterations).toBeLessThanOrEqual(maxIterations + 1);
    });
  });

  describe('linearSearch()', () => {
    it('should perform linear search across steps', async () => {
      const ssimCurve = (quality: number) => {
        if (quality >= 70) return 0.96;
        if (quality >= 60) return 0.93;
        return 0.8;
      };

      const searcher = new QualityBinarySearch({
        targetSSIM: 0.95,
      });

      const result = await searcher.linearSearch(createMockEncodeFn(ssimCurve), 11);

      expect(result.ssim).toBeGreaterThanOrEqual(0.95);
      expect(result.quality).toBe(70);
    });

    it('should call progress callback for linear search', async () => {
      const progressCalls: { iteration: number; total: number }[] = [];
      const ssimCurve = (q: number) => q / 100;
      const steps = 5;

      const searcher = new QualityBinarySearch({
        targetSSIM: 0.95,
      });

      await searcher.linearSearch(
        createMockEncodeFn(ssimCurve),
        steps,
        (iteration, total) => {
          progressCalls.push({ iteration, total });
        },
      );

      expect(progressCalls.length).toBe(steps);
      progressCalls.forEach((call, idx) => {
        expect(call.iteration).toBe(idx + 1);
        expect(call.total).toBe(steps);
      });
    });

    it('should return fallback when no quality meets target', async () => {
      const ssimCurve = () => 0.90;
      const searcher = new QualityBinarySearch({
        targetSSIM: 0.95,
      });

      const result = await searcher.linearSearch(createMockEncodeFn(ssimCurve), 5);
      expect(result.ssim).toBe(0.90);
      expect(result.converged).toBe(false);
    });
  });

  describe('binarySearchQuality() - standalone function', () => {
    it('should work as standalone function', async () => {
      const ssimCurve = (quality: number) => {
        if (quality >= 80) return 0.97;
        if (quality >= 70) return 0.94;
        return 0.8;
      };

      const result = await binarySearchQuality(
        createMockEncodeFn(ssimCurve),
        { targetSSIM: 0.95, maxIterations: 10 },
      );

      expect(result.ssim).toBeGreaterThanOrEqual(0.95);
      expect(result.quality).toBeGreaterThanOrEqual(80);
    });
  });

  describe('edge cases', () => {
    it('should handle flat SSIM curve', async () => {
      const ssimCurve = () => 0.96;

      const searcher = new QualityBinarySearch({
        targetSSIM: 0.95,
        maxIterations: 8,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));
      expect(result.ssim).toBeGreaterThanOrEqual(0.95);
    });

    it('should handle exact SSIM threshold boundary', async () => {
      const ssimCurve = (quality: number) => {
        if (quality >= 75) return 0.95;
        return 0.94;
      };

      const searcher = new QualityBinarySearch({
        targetSSIM: 0.95,
        maxIterations: 10,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));
      expect(result.ssim).toBeGreaterThanOrEqual(0.95);
      expect(result.quality).toBeGreaterThanOrEqual(75);
    });

    it('should handle smooth monotonic SSIM curve', async () => {
      const ssimCurve = (quality: number) => {
        return 0.5 + (quality / 100) * 0.49;
      };

      const searcher = new QualityBinarySearch({
        targetSSIM: 0.95,
        maxIterations: 12,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));
      expect(result.ssim).toBeGreaterThanOrEqual(0.95);
      expect(result.quality).toBeGreaterThanOrEqual(90);
    });

    it('should handle very low target SSIM', async () => {
      const ssimCurve = (quality: number) => quality / 100;

      const searcher = new QualityBinarySearch({
        targetSSIM: 0.1,
        maxIterations: 8,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));
      expect(result.ssim).toBeGreaterThanOrEqual(0.1);
      expect(result.quality).toBeLessThan(50);
    });
  });

  describe('SearchResult structure', () => {
    it('should return all required fields in SearchResult', async () => {
      const ssimCurve = () => 0.96;
      const searcher = new QualityBinarySearch({ targetSSIM: 0.95 });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));

      expect(typeof result.quality).toBe('number');
      expect(typeof result.ssim).toBe('number');
      expect(typeof result.size).toBe('number');
      expect(typeof result.encodeTime).toBe('number');
      expect(typeof result.iterations).toBe('number');
      expect(typeof result.converged).toBe('boolean');
    });
  });

  describe('convergence behavior', () => {
    it('should converge to precise value with sufficient iterations', async () => {
      const targetSSIM = 0.95;
      const optimalQuality = 75;
      
      const ssimCurve = (quality: number) => {
        if (quality >= optimalQuality) return targetSSIM + 0.01;
        return targetSSIM - 0.05;
      };

      const searcher = new QualityBinarySearch({
        targetSSIM,
        maxIterations: 12,
      });

      const result = await searcher.search(createMockEncodeFn(ssimCurve));
      expect(result.ssim).toBeGreaterThanOrEqual(targetSSIM);
      expect(result.quality).toBeGreaterThanOrEqual(optimalQuality);
      expect(result.quality).toBeLessThan(optimalQuality + 5);
    });
  });
});
