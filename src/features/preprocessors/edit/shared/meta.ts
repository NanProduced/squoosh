/**
 * Image edit preprocessor meta
 * Supports crop, rotate, flip, and pixel filters
 */
export type CropRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16' | '3:4' | '2:3';

export interface CropState {
  x: number;
  y: number;
  width: number;
  height: number;
  ratio: CropRatio;
  enabled: boolean;
}

export interface RotateState {
  rotate: 0 | 90 | 180 | 270;
}

export interface FlipState {
  horizontal: boolean;
  vertical: boolean;
}

export interface FiltersState {
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: boolean;
  enabled: boolean;
}

export interface Options {
  crop: CropState;
  rotate: RotateState;
  flip: FlipState;
  filters: FiltersState;
}

export const defaultCrop: CropState = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  ratio: 'free',
  enabled: false,
};

export const defaultRotate: RotateState = {
  rotate: 0,
};

export const defaultFlip: FlipState = {
  horizontal: false,
  vertical: false,
};

export const defaultFilters: FiltersState = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  grayscale: false,
  enabled: false,
};

export const defaultOptions: Options = {
  crop: defaultCrop,
  rotate: defaultRotate,
  flip: defaultFlip,
  filters: defaultFilters,
};

export interface EditCommand {
  type: 'crop' | 'rotate' | 'flip' | 'filters';
  previousState: any;
  newState: any;
  timestamp: number;
}

export const cropRatios: { label: string; value: CropRatio; width?: number; height?: number }[] = [
  { label: 'Free', value: 'free' },
  { label: '1:1', value: '1:1', width: 1, height: 1 },
  { label: '4:3', value: '4:3', width: 4, height: 3 },
  { label: '3:2', value: '3:2', width: 3, height: 2 },
  { label: '16:9', value: '16:9', width: 16, height: 9 },
  { label: '9:16', value: '9:16', width: 9, height: 16 },
  { label: '3:4', value: '3:4', width: 3, height: 4 },
  { label: '2:3', value: '2:3', width: 2, height: 3 },
];
