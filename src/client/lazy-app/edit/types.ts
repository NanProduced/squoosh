/**
 * Edit panel types
 */
import { Options, EditCommand } from 'features/preprocessors/edit/shared/meta';

export interface EditorState {
  isOpen: boolean;
  options: Options;
  canUndo: boolean;
  canRedo: boolean;
}

export type EditorAction =
  | { type: 'OPEN_EDITOR' }
  | { type: 'CLOSE_EDITOR' }
  | { type: 'APPLY_EDIT' }
  | { type: 'RESET_EDIT' }
  | { type: 'UPDATE_OPTIONS'; payload: Partial<Options> }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'PUSH_COMMAND'; payload: EditCommand }
  | { type: 'RESTORE_HISTORY'; payload: { options: Options; commands: EditCommand[]; currentIndex: number } };

export interface CommandStackState {
  commands: EditCommand[];
  currentIndex: number;
}

export interface EditorPanelProps {
  isOpen: boolean;
  options: Options;
  originalImage?: ImageData;
  currentImage?: ImageData;
  canUndo: boolean;
  canRedo: boolean;
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
  onOptionsChange: (options: Partial<Options>) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export const EDIT_HISTORY_KEY = 'squoosh_edit_history';
export const EDIT_OPTIONS_KEY = 'squoosh_edit_options';
