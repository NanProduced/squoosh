import { get, set, del, keys } from 'idb-keyval';
import {
  ProcessorState,
  EncoderState,
  PreprocessorState,
  defaultProcessorState,
  defaultPreprocessorState,
  encoderMap,
  EncoderType,
} from '../feature-meta';

export const IDB_PRESET_PREFIX = 'squoosh-preset-';

export interface PresetData {
  preprocessorState?: Partial<PreprocessorState>;
  processorState?: Partial<ProcessorState>;
  encoderState?: Partial<EncoderState>;
}

export interface Preset {
  id: string;
  name: string;
  isBuiltIn: boolean;
  createdAt: number;
  updatedAt: number;
  data: PresetData;
}

function getDefaultEncoderOptions(type: EncoderType) {
  return encoderMap[type].meta.defaultOptions;
}

export const builtInPresets: Preset[] = [
  {
    id: 'built-in-web-optimized',
    name: 'Web Optimized',
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    data: {
      encoderState: {
        type: 'mozJPEG',
        options: {
          quality: 75,
          progressive: true,
        } as any,
      },
    },
  },
  {
    id: 'built-in-high-quality',
    name: 'High Quality',
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    data: {
      encoderState: {
        type: 'mozJPEG',
        options: {
          quality: 90,
          progressive: true,
        } as any,
      },
    },
  },
  {
    id: 'built-in-smallest-size',
    name: 'Smallest Size',
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    data: {
      encoderState: {
        type: 'webP',
        options: {
          quality: 60,
        } as any,
      },
    },
  },
  {
    id: 'built-in-transparent',
    name: 'Transparent Optimized',
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    data: {
      encoderState: {
        type: 'oxiPNG',
        options: {
          level: 2,
          interlace: false,
        } as any,
      },
    },
  },
  {
    id: 'built-in-modern',
    name: 'Modern Format (AVIF)',
    isBuiltIn: true,
    createdAt: 0,
    updatedAt: 0,
    data: {
      encoderState: {
        type: 'avif',
        options: {
          cqLevel: 33,
          speed: 6,
        } as any,
      },
    },
  },
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

export function deepMergeDefaults(
  target: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...defaults };

  for (const key in target) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      const targetValue = target[key];
      const defaultValue = result[key];

      if (
        isPlainObject(targetValue) &&
        isPlainObject(defaultValue)
      ) {
        result[key] = deepMergeDefaults(targetValue, defaultValue);
      } else if (targetValue !== undefined) {
        result[key] = targetValue;
      }
    }
  }

  return result;
}

export function computeDelta(
  value: Record<string, unknown>,
  defaults: Record<string, unknown>,
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};

  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const valuePart = value[key];
      const defaultPart = defaults[key];

      if (
        isPlainObject(valuePart) &&
        isPlainObject(defaultPart)
      ) {
        const nestedDelta = computeDelta(valuePart, defaultPart);
        if (Object.keys(nestedDelta).length > 0) {
          delta[key] = nestedDelta;
        }
      } else if (JSON.stringify(valuePart) !== JSON.stringify(defaultPart)) {
        delta[key] = valuePart;
      }
    }
  }

  return delta;
}

export function computePresetDelta(data: PresetData): PresetData {
  const delta: PresetData = {};

  if (data.processorState) {
    const processorDelta = computeDelta(
      data.processorState as Record<string, unknown>,
      defaultProcessorState as unknown as Record<string, unknown>,
    );
    if (Object.keys(processorDelta).length > 0) {
      delta.processorState = processorDelta as Partial<ProcessorState>;
    }
  }

  if (data.preprocessorState) {
    const preprocessorDelta = computeDelta(
      data.preprocessorState as Record<string, unknown>,
      defaultPreprocessorState as unknown as Record<string, unknown>,
    );
    if (Object.keys(preprocessorDelta).length > 0) {
      delta.preprocessorState = preprocessorDelta as Partial<PreprocessorState>;
    }
  }

  if (data.encoderState?.type) {
    const encoderType = data.encoderState.type;
    const defaultEncoderOptions = getDefaultEncoderOptions(encoderType);

    if (data.encoderState.options) {
      const encoderDelta = computeDelta(
        data.encoderState.options as Record<string, unknown>,
        defaultEncoderOptions as Record<string, unknown>,
      );

      delta.encoderState = {
        type: encoderType,
        options: encoderDelta as any,
      };
    } else {
      delta.encoderState = {
        type: encoderType,
        options: {} as any,
      };
    }
  }

  return delta;
}

export function hydratePresetData(delta: PresetData): PresetData {
  const result: PresetData = {};

  if (delta.processorState) {
    result.processorState = deepMergeDefaults(
      delta.processorState as Record<string, unknown>,
      defaultProcessorState as unknown as Record<string, unknown>,
    ) as unknown as ProcessorState;
  }

  if (delta.preprocessorState) {
    result.preprocessorState = deepMergeDefaults(
      delta.preprocessorState as Record<string, unknown>,
      defaultPreprocessorState as unknown as Record<string, unknown>,
    ) as unknown as PreprocessorState;
  }

  if (delta.encoderState?.type) {
    const encoderType = delta.encoderState.type;
    const defaultEncoderOptions = getDefaultEncoderOptions(encoderType);

    result.encoderState = {
      type: encoderType,
      options: deepMergeDefaults(
        (delta.encoderState.options || {}) as Record<string, unknown>,
        defaultEncoderOptions as Record<string, unknown>,
      ) as any,
    };
  }

  return result;
}

export function serializePresetForUrl(data: PresetData): string {
  const delta = computePresetDelta(data);
  const jsonString = JSON.stringify(delta);
  const base64 = btoa(unescape(encodeURIComponent(jsonString)));
  return base64;
}

export function deserializePresetFromUrl(encoded: string): PresetData | null {
  try {
    const jsonString = decodeURIComponent(escape(atob(encoded)));
    const delta = JSON.parse(jsonString) as PresetData;
    return hydratePresetData(delta);
  } catch (e) {
    console.error('Failed to deserialize preset from URL:', e);
    return null;
  }
}

function generatePresetId(): string {
  return `custom-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export async function getAllPresets(): Promise<Preset[]> {
  const allKeys = await keys();
  const presetKeys = allKeys.filter((key) =>
    String(key).startsWith(IDB_PRESET_PREFIX),
  );

  const customPresets: Preset[] = [];

  for (const key of presetKeys) {
    try {
      const preset = await get<Preset>(key);
      if (preset) {
        customPresets.push(preset);
      }
    } catch (e) {
      console.error('Failed to load preset:', key, e);
    }
  }

  customPresets.sort((a, b) => b.updatedAt - a.updatedAt);

  return [...builtInPresets, ...customPresets];
}

export async function savePreset(
  name: string,
  data: PresetData,
  existingPreset?: Preset,
): Promise<Preset> {
  const now = Date.now();
  const preset: Preset = existingPreset
    ? {
        ...existingPreset,
        name,
        data,
        updatedAt: now,
      }
    : {
        id: generatePresetId(),
        name,
        isBuiltIn: false,
        createdAt: now,
        updatedAt: now,
        data,
      };

  const key = IDB_PRESET_PREFIX + preset.id;
  await set(key, preset);
  return preset;
}

export async function deletePreset(presetId: string): Promise<void> {
  if (presetId.startsWith('built-in-')) {
    throw new Error('Cannot delete built-in preset');
  }
  const key = IDB_PRESET_PREFIX + presetId;
  await del(key);
}

export interface SideSettings {
  processorState: ProcessorState;
  encoderState?: EncoderState;
}

export function applyPresetToSideSettings(
  preset: Preset,
  currentSettings: SideSettings,
): SideSettings {
  const hydratedData = hydratePresetData(preset.data);
  const newSettings: SideSettings = {
    processorState: currentSettings.processorState,
    encoderState: currentSettings.encoderState,
  };

  if (hydratedData.processorState) {
    newSettings.processorState = deepMergeDefaults(
      hydratedData.processorState as Record<string, unknown>,
      currentSettings.processorState as unknown as Record<string, unknown>,
    ) as unknown as ProcessorState;
  }

  if (hydratedData.encoderState && hydratedData.encoderState.type) {
    newSettings.encoderState = {
      type: hydratedData.encoderState.type,
      options: hydratedData.encoderState.options,
    } as EncoderState;
  }

  return newSettings;
}

export function createPresetFromSideSettings(
  processorState: ProcessorState,
  encoderState: EncoderState | undefined,
  preprocessorState: PreprocessorState,
): PresetData {
  const data: PresetData = {};

  if (processorState && JSON.stringify(processorState) !== JSON.stringify(defaultProcessorState)) {
    data.processorState = { ...processorState } as Partial<ProcessorState>;
  }

  if (preprocessorState && JSON.stringify(preprocessorState) !== JSON.stringify(defaultPreprocessorState)) {
    data.preprocessorState = { ...preprocessorState } as Partial<PreprocessorState>;
  }

  if (encoderState) {
    data.encoderState = { ...encoderState } as Partial<EncoderState>;
  }

  return data;
}

export interface PresetSummary {
  formatLabel: string;
  formatShort: string;
  quality: number | null;
  resizeWidth: number | null;
  resizeHeight: number | null;
  isResized: boolean;
  isQuantized: boolean;
}

export function getPresetSummary(data: PresetData): PresetSummary {
  const hydrated = hydratePresetData(data);

  let formatLabel = 'Original';
  let formatShort = 'ORIG';
  let quality: number | null = null;

  if (hydrated.encoderState?.type) {
    const encoderType = hydrated.encoderState.type;
    const encoderMeta = encoderMap[encoderType].meta;
    formatLabel = encoderMeta.label;
    formatShort = encoderMeta.label.toUpperCase();

    const options = hydrated.encoderState.options as Record<string, unknown>;

    if (options.quality !== undefined) {
      quality = options.quality as number;
    } else if (options.cqLevel !== undefined) {
      quality = options.cqLevel as number;
    } else if (options.level !== undefined) {
      quality = options.level as number;
    }
  }

  let resizeWidth: number | null = null;
  let resizeHeight: number | null = null;
  let isResized = false;

  if (hydrated.processorState?.resize?.enabled) {
    isResized = true;
    resizeWidth = hydrated.processorState.resize.width;
    resizeHeight = hydrated.processorState.resize.height;
  }

  const isQuantized = hydrated.processorState?.quantize?.enabled || false;

  return {
    formatLabel,
    formatShort,
    quality,
    resizeWidth,
    resizeHeight,
    isResized,
    isQuantized,
  };
}

const encoderColorMap: Record<string, string> = {
  mozJPEG: '#FF6B35',
  browserJPEG: '#FF9500',
  webP: '#4CAF50',
  avif: '#00BCD4',
  oxiPNG: '#9C27B0',
  browserPNG: '#673AB7',
  wp2: '#E91E63',
  jxl: '#3F51B5',
  qoi: '#FFEB3B',
  browserGIF: '#FF5722',
};

export function getEncoderColor(type?: string): string {
  if (!type) return '#666666';
  return encoderColorMap[type] || '#666666';
}
