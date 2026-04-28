/**
 * IndexedDB persistence for edit history
 * Uses idb-keyval library
 */
import { get, set, del } from 'idb-keyval';
import { Options, EditCommand, defaultOptions } from 'features/preprocessors/edit/shared/meta';
import { CommandStackState, EDIT_HISTORY_KEY, EDIT_OPTIONS_KEY } from './types';

export interface SavedEditState {
  options: Options;
  commandStack: CommandStackState;
  timestamp: number;
  sourceFileName?: string;
}

export async function saveEditState(
  options: Options,
  commandStack: CommandStackState,
  sourceFileName?: string
): Promise<void> {
  const state: SavedEditState = {
    options: JSON.parse(JSON.stringify(options)),
    commandStack: JSON.parse(JSON.stringify(commandStack)),
    timestamp: Date.now(),
    sourceFileName,
  };
  
  await set(EDIT_OPTIONS_KEY, state);
}

export async function loadEditState(sourceFileName?: string): Promise<SavedEditState | null> {
  const state = await get<SavedEditState>(EDIT_OPTIONS_KEY);
  
  if (!state) return null;
  
  if (sourceFileName && state.sourceFileName !== sourceFileName) {
    return null;
  }
  
  const oneDay = 24 * 60 * 60 * 1000;
  if (Date.now() - state.timestamp > oneDay) {
    await clearEditState();
    return null;
  }
  
  return state;
}

export async function clearEditState(): Promise<void> {
  await del(EDIT_OPTIONS_KEY);
  await del(EDIT_HISTORY_KEY);
}

export function hasEdits(options: Options): boolean {
  const hasCrop = options.crop.enabled && (options.crop.width > 0 || options.crop.height > 0);
  const hasRotate = options.rotate.rotate !== 0;
  const hasFlip = options.flip.horizontal || options.flip.vertical;
  const hasFilters = options.filters.enabled && (
    options.filters.brightness !== 0 ||
    options.filters.contrast !== 0 ||
    options.filters.saturation !== 0 ||
    options.filters.grayscale
  );
  
  return hasCrop || hasRotate || hasFlip || hasFilters;
}

export function getOptionsForPreprocessor(options: Options): Partial<Options> {
  return {
    crop: JSON.parse(JSON.stringify(options.crop)),
    rotate: JSON.parse(JSON.stringify(options.rotate)),
    flip: JSON.parse(JSON.stringify(options.flip)),
    filters: JSON.parse(JSON.stringify(options.filters)),
  };
}
