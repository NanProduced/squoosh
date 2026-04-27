import {
  computeDelta,
  deepMergeDefaults,
  computePresetDelta,
  hydratePresetData,
  serializePresetForUrl,
  deserializePresetFromUrl,
  PresetData,
} from './index';
import {
  defaultProcessorState,
  defaultPreprocessorState,
  encoderMap,
} from '../feature-meta';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `Assertion failed: ${message}\nExpected: ${expectedJson}\nActual: ${actualJson}`,
    );
  }
}

export function runTests(): void {
  console.log('=== Running preset manager tests ===\n');

  let passed = 0;
  let failed = 0;

  function test(name: string, fn: () => void): void {
    try {
      fn();
      console.log(`✓ ${name}`);
      passed++;
    } catch (e) {
      console.log(`✗ ${name}`);
      console.log(`  Error: ${(e as Error).message}`);
      failed++;
    }
  }

  test('computeDelta: identical objects return empty delta', () => {
    const obj = { a: 1, b: { c: 2 } };
    const delta = computeDelta(obj, obj);
    assertEqual(delta, {}, 'Delta should be empty for identical objects');
  });

  test('computeDelta: different top-level properties', () => {
    const obj = { a: 1, b: 2 };
    const defaults = { a: 1, b: 3 };
    const delta = computeDelta(obj, defaults);
    assertEqual(delta, { b: 2 }, 'Should only include differing properties');
  });

  test('computeDelta: nested objects', () => {
    const obj = { a: 1, nested: { b: 2, c: 3 } };
    const defaults = { a: 1, nested: { b: 5, c: 3 } };
    const delta = computeDelta(obj, defaults);
    assertEqual(delta, { nested: { b: 2 } }, 'Should only include differing nested properties');
  });

  test('deepMergeDefaults: basic merge', () => {
    const target = { a: 1 };
    const defaults = { a: 0, b: 2 };
    const result = deepMergeDefaults(target, defaults);
    assertEqual(result, { a: 1, b: 2 }, 'Should merge target with defaults');
  });

  test('deepMergeDefaults: nested merge', () => {
    const target = { nested: { a: 1 } };
    const defaults = { nested: { a: 0, b: 2 }, c: 3 };
    const result = deepMergeDefaults(target, defaults);
    assertEqual(result, { nested: { a: 1, b: 2 }, c: 3 }, 'Should deep merge nested objects');
  });

  test('serialization idempotency: serialize -> deserialize -> hydrate', () => {
    const originalData: PresetData = {
      processorState: {
        resize: {
          width: 800,
          height: 600,
          method: 'lanczos3' as const,
          fitMethod: 'contain' as const,
          premultiply: true,
          linearRGB: false,
        } as any,
        quantize: {
          enabled: true,
          numColors: 128,
          dither: 0.8,
        } as any,
      },
      encoderState: {
        type: 'mozJPEG',
        options: {
          quality: 85,
          progressive: true,
        } as any,
      },
    };

    const serialized = serializePresetForUrl(originalData);
    assert(typeof serialized === 'string' && serialized.length > 0, 'Should produce non-empty string');

    const deserialized = deserializePresetFromUrl(serialized);
    assert(deserialized !== null, 'Should successfully deserialize');

    assert(
      deserialized!.processorState !== undefined,
      'Should preserve processorState',
    );
    assert(
      deserialized!.encoderState !== undefined,
      'Should preserve encoderState',
    );
  });

  test('delta compression: only includes differences from defaults', () => {
    const fullData: PresetData = {
      processorState: {
        ...defaultProcessorState,
        resize: {
          ...defaultProcessorState.resize,
          width: 1024,
        } as any,
      } as any,
      encoderState: {
        type: 'mozJPEG',
        options: {
          ...encoderMap.mozJPEG.meta.defaultOptions,
          quality: 90,
        } as any,
      },
    };

    const delta = computePresetDelta(fullData);
    const deltaStr = JSON.stringify(delta);
    const fullStr = JSON.stringify(fullData);

    assert(
      deltaStr.length < fullStr.length,
      'Delta should be smaller than full data',
    );

    const hydrated = hydratePresetData(delta);
    assert(
      hydrated.processorState?.resize?.width === 1024,
      'Should preserve custom width',
    );
    assert(
      (hydrated.encoderState?.options as any)?.quality === 90,
      'Should preserve custom quality',
    );
  });

  test('default values fallback: handle corrupted/missing data', () => {
    const corruptedDelta: PresetData = {
      processorState: {
        resize: {
          width: 800,
        } as any,
      } as any,
    };

    const hydrated = hydratePresetData(corruptedDelta);
    
    assert(
      hydrated.processorState?.resize?.width === 800,
      'Should preserve provided value',
    );
    assert(
      hydrated.processorState?.resize?.method !== undefined,
      'Should provide default for missing method',
    );
    assert(
      hydrated.processorState?.quantize !== undefined,
      'Should provide default for missing quantize',
    );
  });

  test('deserialize invalid data returns null', () => {
    const result = deserializePresetFromUrl('invalid-base64-data!!!');
    assert(result === null, 'Should return null for invalid data');
  });

  test('empty preset data round-trip', () => {
    const emptyData: PresetData = {};
    const serialized = serializePresetForUrl(emptyData);
    const deserialized = deserializePresetFromUrl(serialized);
    
    assert(deserialized !== null, 'Should deserialize empty data');
  });

  test('idempotency: multiple serialize/deserialize cycles', () => {
    const originalData: PresetData = {
      processorState: {
        resize: {
          width: 1920,
          height: 1080,
        } as any,
      } as any,
      encoderState: {
        type: 'webP',
        options: {
          quality: 75,
        } as any,
      },
    };

    let currentData = originalData;
    for (let i = 0; i < 3; i++) {
      const serialized = serializePresetForUrl(currentData);
      const deserialized = deserializePresetFromUrl(serialized);
      assert(deserialized !== null, `Cycle ${i + 1}: Should deserialize`);
      
      const delta = computePresetDelta(deserialized!);
      currentData = hydratePresetData(delta);
      
      assert(
        (currentData.processorState?.resize as any)?.width === 1920,
        `Cycle ${i + 1}: Should preserve width`,
      );
      assert(
        currentData.encoderState?.type === 'webP',
        `Cycle ${i + 1}: Should preserve encoder type`,
      );
    }
  });

  console.log(`\n=== Test Results: ${passed} passed, ${failed} failed ===`);

  if (failed > 0) {
    throw new Error(`${failed} test(s) failed`);
  }
}

if (typeof window === 'undefined') {
  runTests();
}
