/**
 * Command stack for undo/redo functionality
 */
import { Options, EditCommand, defaultOptions } from 'features/preprocessors/edit/shared/meta';
import { CommandStackState } from './types';

const MAX_HISTORY = 50;

export class CommandStack {
  private state: CommandStackState;

  constructor(initialState?: CommandStackState) {
    this.state = initialState || {
      commands: [],
      currentIndex: -1,
    };
  }

  get canUndo(): boolean {
    return this.state.currentIndex >= 0;
  }

  get canRedo(): boolean {
    return this.state.currentIndex < this.state.commands.length - 1;
  }

  get commands(): EditCommand[] {
    return [...this.state.commands];
  }

  get currentIndex(): number {
    return this.state.currentIndex;
  }

  getState(): CommandStackState {
    return { ...this.state };
  }

  push(command: EditCommand): void {
    const { commands, currentIndex } = this.state;
    
    if (currentIndex < commands.length - 1) {
      commands.splice(currentIndex + 1);
    }
    
    commands.push(command);
    
    if (commands.length > MAX_HISTORY) {
      commands.shift();
    } else {
      this.state.currentIndex++;
    }
  }

  undo(currentOptions: Options): Options | null {
    if (!this.canUndo) return null;
    
    const command = this.state.commands[this.state.currentIndex];
    this.state.currentIndex--;
    
    return this.applyState(currentOptions, command.previousState);
  }

  redo(currentOptions: Options): Options | null {
    if (!this.canRedo) return null;
    
    this.state.currentIndex++;
    const command = this.state.commands[this.state.currentIndex];
    
    return this.applyState(currentOptions, command.newState);
  }

  private applyState(baseOptions: Options, state: Partial<Options>): Options {
    return {
      ...baseOptions,
      crop: state.crop ? { ...baseOptions.crop, ...state.crop } : baseOptions.crop,
      rotate: state.rotate ? { ...baseOptions.rotate, ...state.rotate } : baseOptions.rotate,
      flip: state.flip ? { ...baseOptions.flip, ...state.flip } : baseOptions.flip,
      filters: state.filters ? { ...baseOptions.filters, ...state.filters } : baseOptions.filters,
    };
  }

  clear(): void {
    this.state = {
      commands: [],
      currentIndex: -1,
    };
  }

  restore(state: CommandStackState): void {
    this.state = { ...state };
  }
}

export function createCommand(
  type: EditCommand['type'],
  previousState: any,
  newState: any
): EditCommand {
  return {
    type,
    previousState,
    newState,
    timestamp: Date.now(),
  };
}

export function isSignificantChange(
  prev: Partial<Options>,
  current: Partial<Options>,
  type: EditCommand['type']
): boolean {
  switch (type) {
    case 'rotate':
      return (prev.rotate?.rotate ?? 0) !== (current.rotate?.rotate ?? 0);
    case 'flip':
      return (
        (prev.flip?.horizontal ?? false) !== (current.flip?.horizontal ?? false) ||
        (prev.flip?.vertical ?? false) !== (current.flip?.vertical ?? false)
      );
    case 'filters':
      return (
        (prev.filters?.brightness ?? 0) !== (current.filters?.brightness ?? 0) ||
        (prev.filters?.contrast ?? 0) !== (current.filters?.contrast ?? 0) ||
        (prev.filters?.saturation ?? 0) !== (current.filters?.saturation ?? 0) ||
        (prev.filters?.grayscale ?? false) !== (current.filters?.grayscale ?? false)
      );
    case 'crop':
      return (
        (prev.crop?.x ?? 0) !== (current.crop?.x ?? 0) ||
        (prev.crop?.y ?? 0) !== (current.crop?.y ?? 0) ||
        (prev.crop?.width ?? 0) !== (current.crop?.width ?? 0) ||
        (prev.crop?.height ?? 0) !== (current.crop?.height ?? 0) ||
        (prev.crop?.ratio ?? 'free') !== (current.crop?.ratio ?? 'free')
      );
    default:
      return true;
  }
}
