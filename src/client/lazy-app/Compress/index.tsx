import { h, Component } from 'preact';

import * as style from './style.css';
import 'add-css:./style.css';
import {
  blobToImg,
  blobToText,
  builtinDecode,
  sniffMimeType,
  canDecodeImageType,
  abortable,
  assertSignal,
  ImageMimeTypes,
} from '../util';
import {
  PreprocessorState,
  ProcessorState,
  EncoderState,
  encoderMap,
  defaultPreprocessorState,
  defaultProcessorState,
  EncoderType,
  EncoderOptions,
} from '../feature-meta';
import Output from './Output';
import Options from './Options';
import ResultCache from './result-cache';
import { cleanMerge, cleanSet } from '../util/clean-modify';
import './custom-els/MultiPanel';
import Results from './Results';
import WorkerBridge from '../worker-bridge';
import { resize } from 'features/processors/resize/client';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import { drawableToImageData } from '../util/canvas';

import EditorPanel from '../edit/EditorPanel';
import { CommandStack, createCommand, isSignificantChange } from '../edit/command-stack';
import {
  saveEditState,
  loadEditState,
  clearEditState,
  hasEdits,
} from '../edit/persistence';
import {
  Options as EditOptions,
  defaultOptions as defaultEditOptions,
  EditCommand,
} from 'features/preprocessors/edit/shared/meta';

export type OutputType = EncoderType | 'identity';

export interface SourceImage {
  file: File;
  decoded: ImageData;
  preprocessed: ImageData;
  vectorImage?: HTMLImageElement;
}

interface SideSettings {
  processorState: ProcessorState;
  encoderState?: EncoderState;
}

interface Side {
  processed?: ImageData;
  file?: File;
  downloadUrl?: string;
  data?: ImageData;
  latestSettings: SideSettings;
  encodedSettings?: SideSettings;
  loading: boolean;
}

interface Props {
  file: File;
  showSnack: SnackBarElement['showSnackbar'];
  onBack: () => void;
}

interface State {
  source?: SourceImage;
  sides: [Side, Side];
  /** Source image load */
  loading: boolean;
  mobileView: boolean;
  preprocessorState: PreprocessorState;
  encodedPreprocessorState?: PreprocessorState;
  /** Edit panel state */
  isEditorOpen: boolean;
  editOptions: EditOptions;
  canUndo: boolean;
  canRedo: boolean;
}

interface MainJob {
  file: File;
  preprocessorState: PreprocessorState;
}

interface SideJob {
  processorState: ProcessorState;
  encoderState?: EncoderState;
}

interface LoadingFileInfo {
  loading: boolean;
  filename?: string;
}

async function decodeImage(
  signal: AbortSignal,
  blob: Blob,
  workerBridge: WorkerBridge,
): Promise<ImageData> {
  assertSignal(signal);
  const mimeType = await abortable(signal, sniffMimeType(blob));
  const canDecode = await abortable(signal, canDecodeImageType(mimeType));

  try {
    if (!canDecode) {
      if (mimeType === 'image/avif') {
        return await workerBridge.avifDecode(signal, blob);
      }
      if (mimeType === 'image/webp') {
        return await workerBridge.webpDecode(signal, blob);
      }
      if (mimeType === 'image/jxl') {
        return await workerBridge.jxlDecode(signal, blob);
      }
      if (mimeType === 'image/webp2') {
        return await workerBridge.wp2Decode(signal, blob);
      }
      if (mimeType === 'image/qoi') {
        return await workerBridge.qoiDecode(signal, blob);
      }
    }
    // Otherwise fall through and try built-in decoding for a laugh.
    return await builtinDecode(signal, blob);
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    console.log(err);
    throw Error("Couldn't decode image");
  }
}

async function preprocessImage(
  signal: AbortSignal,
  data: ImageData,
  preprocessorState: PreprocessorState,
  workerBridge: WorkerBridge,
): Promise<ImageData> {
  assertSignal(signal);
  let processedData = data;

  if (preprocessorState.edit && hasEdits(preprocessorState.edit)) {
    processedData = await workerBridge.edit(
      signal,
      processedData,
      preprocessorState.edit,
    );
  } else if (preprocessorState.rotate.rotate !== 0) {
    processedData = await workerBridge.rotate(
      signal,
      processedData,
      preprocessorState.rotate,
    );
  }

  return processedData;
}

async function processImage(
  signal: AbortSignal,
  source: SourceImage,
  processorState: ProcessorState,
  workerBridge: WorkerBridge,
): Promise<ImageData> {
  assertSignal(signal);
  let result = source.preprocessed;

  if (processorState.resize.enabled) {
    result = await resize(signal, source, processorState.resize, workerBridge);
  }
  if (processorState.quantize.enabled) {
    result = await workerBridge.quantize(
      signal,
      result,
      processorState.quantize,
    );
  }
  return result;
}

async function compressImage(
  signal: AbortSignal,
  image: ImageData,
  encodeData: EncoderState,
  sourceFilename: string,
  workerBridge: WorkerBridge,
): Promise<File> {
  assertSignal(signal);

  const encoder = encoderMap[encodeData.type];
  const compressedData = await encoder.encode(
    signal,
    workerBridge,
    image,
    // The type of encodeData.options is enforced via the previous line
    encodeData.options as any,
  );

  // This type ensures the image mimetype is consistent with our mimetype sniffer
  const type: ImageMimeTypes = encoder.meta.mimeType;

  return new File(
    [compressedData],
    sourceFilename.replace(/.[^.]*$/, `.${encoder.meta.extension}`),
    { type },
  );
}

function stateForNewSourceData(state: State): State {
  let newState = { ...state };

  for (const i of [0, 1]) {
    // Ditch previous encodings
    const downloadUrl = state.sides[i].downloadUrl;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);

    newState = cleanMerge(state, `sides.${i}`, {
      preprocessed: undefined,
      file: undefined,
      downloadUrl: undefined,
      data: undefined,
      encodedSettings: undefined,
    });
  }

  return newState;
}

async function processSvg(
  signal: AbortSignal,
  blob: Blob,
): Promise<HTMLImageElement> {
  assertSignal(signal);
  // Firefox throws if you try to draw an SVG to canvas that doesn't have width/height.
  // In Chrome it loads, but drawImage behaves weirdly.
  // This function sets width/height if it isn't already set.
  const parser = new DOMParser();
  const text = await abortable(signal, blobToText(blob));
  const document = parser.parseFromString(text, 'image/svg+xml');
  const svg = document.documentElement!;

  if (svg.hasAttribute('width') && svg.hasAttribute('height')) {
    return blobToImg(blob);
  }

  const viewBox = svg.getAttribute('viewBox');
  if (viewBox === null) throw Error('SVG must have width/height or viewBox');

  const viewboxParts = viewBox.split(/\s+/);
  svg.setAttribute('width', viewboxParts[2]);
  svg.setAttribute('height', viewboxParts[3]);

  const serializer = new XMLSerializer();
  const newSource = serializer.serializeToString(document);
  return abortable(
    signal,
    blobToImg(new Blob([newSource], { type: 'image/svg+xml' })),
  );
}

/**
 * If two processors are disabled, they're considered equivalent, otherwise
 * equivalence is based on ===
 */
function processorStateEquivalent(a: ProcessorState, b: ProcessorState) {
  // Quick exit
  if (a === b) return true;

  // All processors have the same keys
  for (const key of Object.keys(a) as Array<keyof ProcessorState>) {
    // If both processors are disabled, they're the same.
    if (!a[key].enabled && !b[key].enabled) continue;
    if (a !== b) return false;
  }

  return true;
}

const loadingIndicator = '⏳ ';

const originalDocumentTitle = document.title;

function updateDocumentTitle(loadingFileInfo: LoadingFileInfo): void {
  const { loading, filename } = loadingFileInfo;
  let title = '';
  if (loading) title += loadingIndicator;
  if (filename) title += filename + ' - ';
  title += originalDocumentTitle;
  document.title = title;
}

export default class Compress extends Component<Props, State> {
  widthQuery = window.matchMedia('(max-width: 599px)');

  state: State = {
    source: undefined,
    loading: false,
    preprocessorState: defaultPreprocessorState,
    // Tasking catched side settings if available otherwise taking default settings
    sides: [
      localStorage.getItem('leftSideSettings')
        ? {
            ...JSON.parse(localStorage.getItem('leftSideSettings') as string),
            loading: false,
          }
        : {
            latestSettings: {
              processorState: defaultProcessorState,
              encoderState: undefined,
            },
            loading: false,
          },
      localStorage.getItem('rightSideSettings')
        ? {
            ...JSON.parse(localStorage.getItem('rightSideSettings') as string),
            loading: false,
          }
        : {
            latestSettings: {
              processorState: defaultProcessorState,
              encoderState: {
                type: 'mozJPEG',
                options: encoderMap.mozJPEG.meta.defaultOptions,
              },
            },
            loading: false,
          },
    ],
    mobileView: this.widthQuery.matches,
    isEditorOpen: false,
    editOptions: JSON.parse(JSON.stringify(defaultEditOptions)),
    canUndo: false,
    canRedo: false,
  };

  private readonly encodeCache = new ResultCache();
  // One for each side
  private readonly workerBridges = [new WorkerBridge(), new WorkerBridge()];
  /** Abort controller for actions that impact both sites, like source image decoding and preprocessing */
  private mainAbortController = new AbortController();
  // And again one for each side
  private sideAbortControllers = [new AbortController(), new AbortController()];
  /** For debouncing calls to updateImage for each side. */
  private updateImageTimeout?: number;
  /** Command stack for undo/redo */
  private readonly commandStack = new CommandStack();

  constructor(props: Props) {
    super(props);
    this.widthQuery.addListener(this.onMobileWidthChange);
    this.sourceFile = props.file;
    this.queueUpdateImage({ immediate: true });

    import('../sw-bridge').then(({ mainAppLoaded }) => mainAppLoaded());
  }

  componentDidMount(): void {
    this.loadEditHistory();
  }

  private async loadEditHistory(): Promise<void> {
    try {
      const savedState = await loadEditState(this.props.file.name);
      if (savedState) {
        this.commandStack.restore(savedState.commandStack);
        this.setState({
          editOptions: savedState.options,
          canUndo: this.commandStack.canUndo,
          canRedo: this.commandStack.canRedo,
        });
      }
    } catch (err) {
      console.log('Failed to load edit history:', err);
    }
  }

  private onMobileWidthChange = () => {
    this.setState({ mobileView: this.widthQuery.matches });
  };

  private onEncoderTypeChange = (index: 0 | 1, newType: OutputType): void => {
    this.setState({
      sides: cleanSet(
        this.state.sides,
        `${index}.latestSettings.encoderState`,
        newType === 'identity'
          ? undefined
          : {
              type: newType,
              options: encoderMap[newType].meta.defaultOptions,
            },
      ),
    });
  };

  private onProcessorOptionsChange = (
    index: 0 | 1,
    options: ProcessorState,
  ): void => {
    this.setState({
      sides: cleanSet(
        this.state.sides,
        `${index}.latestSettings.processorState`,
        options,
      ),
    });
  };

  private onEncoderOptionsChange = (
    index: 0 | 1,
    options: EncoderOptions,
  ): void => {
    this.setState({
      sides: cleanSet(
        this.state.sides,
        `${index}.latestSettings.encoderState.options`,
        options,
      ),
    });
  };

  componentWillReceiveProps(nextProps: Props): void {
    if (nextProps.file !== this.props.file) {
      this.sourceFile = nextProps.file;
      this.queueUpdateImage({ immediate: true });
    }
  }

  componentWillUnmount(): void {
    updateDocumentTitle({ loading: false });
    this.widthQuery.removeListener(this.onMobileWidthChange);
    this.mainAbortController.abort();
    for (const controller of this.sideAbortControllers) {
      controller.abort();
    }
  }

  componentDidUpdate(prevProps: Props, prevState: State): void {
    const wasLoading =
      prevState.loading ||
      prevState.sides[0].loading ||
      prevState.sides[1].loading;
    const isLoading =
      this.state.loading ||
      this.state.sides[0].loading ||
      this.state.sides[1].loading;
    const sourceChanged = prevState.source !== this.state.source;
    if (wasLoading !== isLoading || sourceChanged) {
      updateDocumentTitle({
        loading: isLoading,
        filename: this.state.source?.file.name,
      });
    }
    this.queueUpdateImage();
  }

  private onCopyToOtherClick = async (index: 0 | 1) => {
    const otherIndex = index ? 0 : 1;
    const oldSettings = this.state.sides[otherIndex];
    const newSettings = { ...this.state.sides[index] };

    // Create a new object URL for the new settings. This avoids both sides sharing a URL, which
    // means it can be safely revoked without impacting the other side.
    if (newSettings.file) {
      newSettings.downloadUrl = URL.createObjectURL(newSettings.file);
    }

    this.setState({
      sides: cleanSet(this.state.sides, otherIndex, newSettings),
    });

    const result = await this.props.showSnack('Settings copied across', {
      timeout: 5000,
      actions: ['undo', 'dismiss'],
    });

    if (result !== 'undo') return;

    this.setState({
      sides: cleanSet(this.state.sides, otherIndex, oldSettings),
    });
  };
  /**
   * This function saves encodedSettings and latestSettings of
   * particular side in browser local storage
   * @param index : (0|1)
   * @returns
   */
  private onSaveSideSettingsClick = async (index: 0 | 1) => {
    if (index === 0) {
      const leftSideSettings = JSON.stringify({
        encodedSettings: this.state.sides[index].encodedSettings,
        latestSettings: this.state.sides[index].latestSettings,
      });
      localStorage.setItem('leftSideSettings', leftSideSettings);
      // Firing an event when we save side settings in localstorage
      window.dispatchEvent(new CustomEvent('leftSideSettings'));
      await this.props.showSnack('Left side settings saved', {
        timeout: 1500,
        actions: ['dismiss'],
      });
      return;
    }

    if (index === 1) {
      const rightSideSettings = JSON.stringify({
        encodedSettings: this.state.sides[index].encodedSettings,
        latestSettings: this.state.sides[index].latestSettings,
      });
      localStorage.setItem('rightSideSettings', rightSideSettings);
      // Firing an event when we save side settings in localstorage
      window.dispatchEvent(new CustomEvent('rightSideSettings'));
      await this.props.showSnack('Right side settings saved', {
        timeout: 1500,
        actions: ['dismiss'],
      });
      return;
    }
  };

  /**
   * This function sets the side state with catched localstorage
   * value as per side index provided
   * @param index : (0|1)
   * @returns
   */
  private onImportSideSettingsClick = async (index: 0 | 1) => {
    const leftSideSettingsString = localStorage.getItem('leftSideSettings');
    const rightSideSettingsString = localStorage.getItem('rightSideSettings');

    if (index === 0 && leftSideSettingsString) {
      const oldLeftSideSettings = this.state.sides[index];
      const newLeftSideSettings = {
        ...this.state.sides[index],
        ...JSON.parse(leftSideSettingsString),
      };
      this.setState({
        sides: cleanSet(this.state.sides, index, newLeftSideSettings),
      });
      const result = await this.props.showSnack('Left side settings imported', {
        timeout: 3000,
        actions: ['undo', 'dismiss'],
      });
      if (result === 'undo') {
        this.setState({
          sides: cleanSet(this.state.sides, index, oldLeftSideSettings),
        });
      }
      return;
    }

    if (index === 1 && rightSideSettingsString) {
      const oldRightSideSettings = this.state.sides[index];
      const newRightSideSettings = {
        ...this.state.sides[index],
        ...JSON.parse(rightSideSettingsString),
      };
      this.setState({
        sides: cleanSet(this.state.sides, index, newRightSideSettings),
      });
      const result = await this.props.showSnack(
        'Right side settings imported',
        {
          timeout: 3000,
          actions: ['undo', 'dismiss'],
        },
      );
      if (result === 'undo') {
        this.setState({
          sides: cleanSet(this.state.sides, index, oldRightSideSettings),
        });
      }
      return;
    }
  };

  private onPreprocessorChange = async (
    preprocessorState: PreprocessorState,
  ): Promise<void> => {
    const source = this.state.source;
    if (!source) return;

    const oldRotate = this.state.preprocessorState.rotate.rotate;
    const newRotate = preprocessorState.rotate.rotate;
    const orientationChanged = oldRotate % 180 !== newRotate % 180;

    this.setState((state) => ({
      loading: true,
      preprocessorState,
      // Flip resize values if orientation has changed
      sides: !orientationChanged
        ? state.sides
        : (state.sides.map((side) => {
            const currentResizeSettings =
              side.latestSettings.processorState.resize;
            const resizeSettings: Partial<ProcessorState['resize']> = {
              width: currentResizeSettings.height,
              height: currentResizeSettings.width,
            };
            return cleanMerge(
              side,
              'latestSettings.processorState.resize',
              resizeSettings,
            );
          }) as [Side, Side]),
    }));
  };

  private onOpenEditor = (): void => {
    if (!this.state.source) return;

    if (this.state.editOptions.crop.width === 0 && this.state.source) {
      this.setState((state) => ({
        isEditorOpen: true,
        editOptions: {
          ...state.editOptions,
          crop: {
            ...state.editOptions.crop,
            x: 0,
            y: 0,
            width: state.source!.preprocessed.width,
            height: state.source!.preprocessed.height,
          },
        },
      }));
    } else {
      this.setState({ isEditorOpen: true });
    }
  };

  private onCloseEditor = (): void => {
    this.setState({ isEditorOpen: false });
  };

  private onEditOptionsChange = (changes: Partial<EditOptions>): void => {
    const previousOptions = JSON.parse(JSON.stringify(this.state.editOptions));

    this.setState((state) => {
      const newOptions = {
        ...state.editOptions,
        ...changes,
        crop: changes.crop
          ? { ...state.editOptions.crop, ...changes.crop }
          : state.editOptions.crop,
        rotate: changes.rotate
          ? { ...state.editOptions.rotate, ...changes.rotate }
          : state.editOptions.rotate,
        flip: changes.flip
          ? { ...state.editOptions.flip, ...changes.flip }
          : state.editOptions.flip,
        filters: changes.filters
          ? { ...state.editOptions.filters, ...changes.filters }
          : state.editOptions.filters,
      };

      let commandType: EditCommand['type'] | null = null;
      let previousState: any = {};
      let newState: any = {};

      if (changes.rotate && previousOptions.rotate.rotate !== newOptions.rotate.rotate) {
        commandType = 'rotate';
        previousState = { rotate: previousOptions.rotate };
        newState = { rotate: newOptions.rotate };
      } else if (changes.flip) {
        if (
          previousOptions.flip.horizontal !== newOptions.flip.horizontal ||
          previousOptions.flip.vertical !== newOptions.flip.vertical
        ) {
          commandType = 'flip';
          previousState = { flip: previousOptions.flip };
          newState = { flip: newOptions.flip };
        }
      } else if (changes.filters) {
        commandType = 'filters';
        previousState = { filters: previousOptions.filters };
        newState = { filters: newOptions.filters };
      } else if (changes.crop) {
        commandType = 'crop';
        previousState = { crop: previousOptions.crop };
        newState = { crop: newOptions.crop };
      }

      if (commandType && isSignificantChange(previousState, newState, commandType)) {
        const command = createCommand(commandType, previousState, newState);
        this.commandStack.push(command);

        saveEditState(newOptions, this.commandStack.getState(), this.props.file.name).catch(
          (err) => console.log('Failed to save edit state:', err)
        );
      }

      return {
        editOptions: newOptions,
        canUndo: this.commandStack.canUndo,
        canRedo: this.commandStack.canRedo,
      };
    });
  };

  private onUndo = (): void => {
    if (!this.commandStack.canUndo) return;

    const newOptions = this.commandStack.undo(this.state.editOptions);
    if (newOptions) {
      this.setState({
        editOptions: newOptions,
        canUndo: this.commandStack.canUndo,
        canRedo: this.commandStack.canRedo,
      });

      saveEditState(newOptions, this.commandStack.getState(), this.props.file.name).catch(
        (err) => console.log('Failed to save edit state:', err)
      );
    }
  };

  private onRedo = (): void => {
    if (!this.commandStack.canRedo) return;

    const newOptions = this.commandStack.redo(this.state.editOptions);
    if (newOptions) {
      this.setState({
        editOptions: newOptions,
        canUndo: this.commandStack.canUndo,
        canRedo: this.commandStack.canRedo,
      });

      saveEditState(newOptions, this.commandStack.getState(), this.props.file.name).catch(
        (err) => console.log('Failed to save edit state:', err)
      );
    }
  };

  private onApplyEdits = async (): Promise<void> => {
    if (!this.state.source) return;

    try {
      this.setState({ loading: true, isEditorOpen: false });

      const newPreprocessorState = cleanMerge(
        this.state.preprocessorState,
        'edit',
        JSON.parse(JSON.stringify(this.state.editOptions))
      );

      if (this.state.editOptions.rotate.rotate !== this.state.preprocessorState.rotate.rotate) {
        newPreprocessorState.rotate = {
          rotate: this.state.editOptions.rotate.rotate as 0 | 90 | 180 | 270,
        };
      }

      const oldRotate = this.state.preprocessorState.rotate.rotate;
      const newRotate = newPreprocessorState.edit.rotate.rotate;
      const orientationChanged = oldRotate % 180 !== newRotate % 180;

      this.setState((state) => ({
        loading: true,
        preprocessorState: newPreprocessorState,
        sides: !orientationChanged
          ? state.sides
          : (state.sides.map((side) => {
              const currentResizeSettings =
                side.latestSettings.processorState.resize;
              const resizeSettings: Partial<ProcessorState['resize']> = {
                width: currentResizeSettings.height,
                height: currentResizeSettings.width,
              };
              return cleanMerge(
                side,
                'latestSettings.processorState.resize',
                resizeSettings,
              );
            }) as [Side, Side]),
      }));

      await this.props.showSnack('Edits applied', { timeout: 2000 });
    } catch (err) {
      this.props.showSnack(`Failed to apply edits: ${err}`);
      this.setState({ loading: false });
    }
  };

  private onResetEdits = (): void => {
    const defaultOpts = JSON.parse(JSON.stringify(defaultEditOptions));
    if (this.state.source) {
      defaultOpts.crop.x = 0;
      defaultOpts.crop.y = 0;
      defaultOpts.crop.width = this.state.source.preprocessed.width;
      defaultOpts.crop.height = this.state.source.preprocessed.height;
    }

    this.commandStack.clear();

    this.setState({
      editOptions: defaultOpts,
      canUndo: false,
      canRedo: false,
    });

    clearEditState().catch((err) => console.log('Failed to clear edit state:', err));
  };

  /**
   * Debounce the heavy lifting of updateImage.
   * Otherwise, the thrashing causes jank, and sometimes crashes iOS Safari.
   */
  private queueUpdateImage({ immediate }: { immediate?: boolean } = {}): void {
    // Call updateImage after this delay, unless queueUpdateImage is called
    // again, in which case the timeout is reset.
    const delay = 100;

    clearTimeout(this.updateImageTimeout);
    if (immediate) {
      this.updateImage();
    } else {
      this.updateImageTimeout = setTimeout(() => this.updateImage(), delay);
    }
  }

  private sourceFile: File;
  /** The in-progress job for decoding and preprocessing */
  private activeMainJob?: MainJob;
  /** The in-progress job for each side (processing and encoding) */
  private activeSideJobs: [SideJob?, SideJob?] = [undefined, undefined];

  /**
   * Perform image processing.
   *
   * This function is a monster, but I didn't want to break it up, because it
   * never gets partially called. Instead, it looks at the current state, and
   * decides which steps can be skipped, and which can be cached.
   */
  private async updateImage() {
    const currentState = this.state;

    // State of the last completed job, or ongoing job
    const latestMainJobState: Partial<MainJob> = this.activeMainJob || {
      file: currentState.source && currentState.source.file,
      preprocessorState: currentState.encodedPreprocessorState,
    };
    const latestSideJobStates: Partial<SideJob>[] = currentState.sides.map(
      (side, i) =>
        this.activeSideJobs[i] || {
          processorState:
            side.encodedSettings && side.encodedSettings.processorState,
          encoderState:
            side.encodedSettings && side.encodedSettings.encoderState,
        },
    );

    // State for this job
    const mainJobState: MainJob = {
      file: this.sourceFile,
      preprocessorState: currentState.preprocessorState,
    };
    const sideJobStates: SideJob[] = currentState.sides.map((side) => ({
      // If there isn't an encoder selected, we don't process either
      processorState: side.latestSettings.encoderState
        ? side.latestSettings.processorState
        : defaultProcessorState,
      encoderState: side.latestSettings.encoderState,
    }));

    // Figure out what needs doing:
    const needsDecoding = latestMainJobState.file != mainJobState.file;
    const needsPreprocessing =
      needsDecoding ||
      latestMainJobState.preprocessorState !== mainJobState.preprocessorState;
    const sideWorksNeeded = latestSideJobStates.map((latestSideJob, i) => {
      const needsProcessing =
        needsPreprocessing ||
        !latestSideJob.processorState ||
        // If we're going to or from 'original image' we should reprocess
        !!latestSideJob.encoderState !== !!sideJobStates[i].encoderState ||
        !processorStateEquivalent(
          latestSideJob.processorState,
          sideJobStates[i].processorState,
        );

      return {
        processing: needsProcessing,
        encoding:
          needsProcessing ||
          latestSideJob.encoderState !== sideJobStates[i].encoderState,
      };
    });

    let jobNeeded = false;

    // Abort running tasks & cycle the controllers
    if (needsDecoding || needsPreprocessing) {
      this.mainAbortController.abort();
      this.mainAbortController = new AbortController();
      jobNeeded = true;
      this.activeMainJob = mainJobState;
    }
    for (const [i, sideWorkNeeded] of sideWorksNeeded.entries()) {
      if (sideWorkNeeded.processing || sideWorkNeeded.encoding) {
        this.sideAbortControllers[i].abort();
        this.sideAbortControllers[i] = new AbortController();
        jobNeeded = true;
        this.activeSideJobs[i] = sideJobStates[i];
      }
    }

    if (!jobNeeded) return;

    const mainSignal = this.mainAbortController.signal;
    const sideSignals = this.sideAbortControllers.map((ac) => ac.signal);

    let decoded: ImageData;
    let vectorImage: HTMLImageElement | undefined;

    // Handle decoding
    if (needsDecoding) {
      try {
        assertSignal(mainSignal);
        this.setState({
          source: undefined,
          loading: true,
        });

        // Special-case SVG. We need to avoid createImageBitmap because of
        // https://bugs.chromium.org/p/chromium/issues/detail?id=606319.
        // Also, we cache the HTMLImageElement so we can perform vector resizing later.
        if (mainJobState.file.type.startsWith('image/svg+xml')) {
          vectorImage = await processSvg(mainSignal, mainJobState.file);
          decoded = drawableToImageData(vectorImage);
        } else {
          decoded = await decodeImage(
            mainSignal,
            mainJobState.file,
            // Either worker is good enough here.
            this.workerBridges[0],
          );
        }

        // Set default resize values
        this.setState((currentState) => {
          if (mainSignal.aborted) return {};
          const sides = currentState.sides.map((side) => {
            const resizeState: Partial<ProcessorState['resize']> = {
              width: decoded.width,
              height: decoded.height,
              method: vectorImage ? 'vector' : 'lanczos3',
              // Disable resizing, to make it clearer to the user that something changed here
              enabled: false,
            };
            return cleanMerge(
              side,
              'latestSettings.processorState.resize',
              resizeState,
            );
          }) as [Side, Side];
          return { sides };
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        this.props.showSnack(`Source decoding error: ${err}`);
        throw err;
      }
    } else {
      ({ decoded, vectorImage } = currentState.source!);
    }

    let source: SourceImage;

    // Handle preprocessing
    if (needsPreprocessing) {
      try {
        assertSignal(mainSignal);
        this.setState({
          loading: true,
        });

        const preprocessed = await preprocessImage(
          mainSignal,
          decoded,
          mainJobState.preprocessorState,
          // Either worker is good enough here.
          this.workerBridges[0],
        );

        source = {
          decoded,
          vectorImage,
          preprocessed,
          file: mainJobState.file,
        };

        // Update state for process completion, including intermediate render
        this.setState((currentState) => {
          if (mainSignal.aborted) return {};
          let newState: State = {
            ...currentState,
            loading: false,
            source,
            encodedPreprocessorState: mainJobState.preprocessorState,
            sides: currentState.sides.map((side) => {
              if (side.downloadUrl) URL.revokeObjectURL(side.downloadUrl);

              const newSide: Side = {
                ...side,
                // Intermediate render
                data: preprocessed,
                processed: undefined,
                encodedSettings: undefined,
              };
              return newSide;
            }) as [Side, Side],
          };
          newState = stateForNewSourceData(newState);
          return newState;
        });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        this.setState({ loading: false });
        this.props.showSnack(`Preprocessing error: ${err}`);
        throw err;
      }
    } else {
      source = currentState.source!;
    }

    // That's the main part of the job done.
    this.activeMainJob = undefined;

    // Allow side jobs to happen in parallel
    sideWorksNeeded.forEach(async (sideWorkNeeded, sideIndex) => {
      try {
        // If processing is true, encoding is always true.
        if (!sideWorkNeeded.encoding) return;

        const signal = sideSignals[sideIndex];
        const jobState = sideJobStates[sideIndex];
        const workerBridge = this.workerBridges[sideIndex];
        let file: File;
        let data: ImageData;
        let processed: ImageData | undefined = undefined;

        // If there's no encoder state, this is "original image", which also
        // doesn't allow processing.
        if (!jobState.encoderState) {
          file = source.file;
          data = source.preprocessed;
        } else {
          const cacheResult = this.encodeCache.match(
            source.preprocessed,
            jobState.processorState,
            jobState.encoderState,
          );

          if (cacheResult) {
            ({ file, processed, data } = cacheResult);
          } else {
            // Set loading state for this side
            this.setState((currentState) => {
              if (signal.aborted) return {};
              const sides = cleanMerge(currentState.sides, sideIndex, {
                loading: true,
              });
              return { sides };
            });

            if (sideWorkNeeded.processing) {
              processed = await processImage(
                signal,
                source,
                jobState.processorState,
                workerBridge,
              );

              // Update state for process completion, including intermediate render
              this.setState((currentState) => {
                if (signal.aborted) return {};
                const currentSide = currentState.sides[sideIndex];
                const side: Side = {
                  ...currentSide,
                  processed,
                  // Intermediate render
                  data: processed,
                  encodedSettings: {
                    ...currentSide.encodedSettings,
                    processorState: jobState.processorState,
                  },
                };
                const sides = cleanSet(currentState.sides, sideIndex, side);
                return { sides };
              });
            } else {
              processed = currentState.sides[sideIndex].processed!;
            }

            file = await compressImage(
              signal,
              processed,
              jobState.encoderState,
              source.file.name,
              workerBridge,
            );
            data = await decodeImage(signal, file, workerBridge);

            this.encodeCache.add({
              data,
              processed,
              file,
              preprocessed: source.preprocessed,
              encoderState: jobState.encoderState,
              processorState: jobState.processorState,
            });
          }
        }

        this.setState((currentState) => {
          if (signal.aborted) return {};
          const currentSide = currentState.sides[sideIndex];

          if (currentSide.downloadUrl) {
            URL.revokeObjectURL(currentSide.downloadUrl);
          }

          const side: Side = {
            ...currentSide,
            data,
            file,
            downloadUrl: URL.createObjectURL(file),
            loading: false,
            processed,
            encodedSettings: {
              processorState: jobState.processorState,
              encoderState: jobState.encoderState,
            },
          };
          const sides = cleanSet(currentState.sides, sideIndex, side);
          return { sides };
        });

        this.activeSideJobs[sideIndex] = undefined;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        this.setState((currentState) => {
          const sides = cleanMerge(currentState.sides, sideIndex, {
            loading: false,
          });
          return { sides };
        });
        this.props.showSnack(`Processing error: ${err}`);
        throw err;
      }
    });
  }

  render(
    { onBack }: Props,
    { loading, sides, source, mobileView, preprocessorState, isEditorOpen, editOptions, canUndo, canRedo }: State,
  ) {
    const [leftSide, rightSide] = sides;
    const [leftImageData, rightImageData] = sides.map((i) => i.data);

    const options = sides.map((side, index) => (
      <Options
        index={index as 0 | 1}
        source={source}
        mobileView={mobileView}
        processorState={side.latestSettings.processorState}
        encoderState={side.latestSettings.encoderState}
        onEncoderTypeChange={this.onEncoderTypeChange}
        onEncoderOptionsChange={this.onEncoderOptionsChange}
        onProcessorOptionsChange={this.onProcessorOptionsChange}
        onCopyToOtherSideClick={this.onCopyToOtherClick}
        onSaveSideSettingsClick={this.onSaveSideSettingsClick}
        onImportSideSettingsClick={this.onImportSideSettingsClick}
      />
    ));

    const results = sides.map((side, index) => (
      <Results
        downloadUrl={side.downloadUrl}
        imageFile={side.file}
        source={source}
        loading={loading || side.loading}
        flipSide={mobileView || index === 1}
        typeLabel={
          side.latestSettings.encoderState
            ? encoderMap[side.latestSettings.encoderState.type].meta.label
            : `${side.file ? `${side.file.name}` : 'Original Image'}`
        }
      />
    ));

    // For rendering, we ideally want the settings that were used to create the
    // data, not the latest settings.
    const leftDisplaySettings =
      leftSide.encodedSettings || leftSide.latestSettings;
    const rightDisplaySettings =
      rightSide.encodedSettings || rightSide.latestSettings;
    const leftImgContain =
      leftDisplaySettings.processorState.resize.enabled &&
      leftDisplaySettings.processorState.resize.fitMethod === 'contain';
    const rightImgContain =
      rightDisplaySettings.processorState.resize.enabled &&
      rightDisplaySettings.processorState.resize.fitMethod === 'contain';

    return (
      <div class={style.compress}>
        <Output
          source={source}
          mobileView={mobileView}
          leftCompressed={leftImageData}
          rightCompressed={rightImageData}
          leftImgContain={leftImgContain}
          rightImgContain={rightImgContain}
          preprocessorState={preprocessorState}
          onPreprocessorChange={this.onPreprocessorChange}
          onEditClick={source ? this.onOpenEditor : undefined}
        />
        {isEditorOpen && (
          <EditorPanel
            isOpen={isEditorOpen}
            options={editOptions}
            originalImage={source?.decoded}
            canUndo={canUndo}
            canRedo={canRedo}
            onClose={this.onCloseEditor}
            onApply={this.onApplyEdits}
            onReset={this.onResetEdits}
            onOptionsChange={this.onEditOptionsChange}
            onUndo={this.onUndo}
            onRedo={this.onRedo}
          />
        )}
        <button class={style.back} onClick={onBack}>
          <svg viewBox="0 0 61 53.3">
            <title>Back</title>
            <path
              class={style.backBlob}
              d="M0 25.6c-.5-7.1 4.1-14.5 10-19.1S23.4.1 32.2 0c8.8 0 19 1.6 24.4 8s5.6 17.8 1.7 27a29.7 29.7 0 01-20.5 18c-8.4 1.5-17.3-2.6-24.5-8S.5 32.6.1 25.6z"
            />
            <path
              class={style.backX}
              d="M41.6 17.1l-2-2.1-8.3 8.2-8.2-8.2-2 2 8.2 8.3-8.3 8.2 2.1 2 8.2-8.1 8.3 8.2 2-2-8.2-8.3z"
            />
          </svg>
        </button>
        {mobileView ? (
          <div class={style.options}>
            <multi-panel class={style.multiPanel} open-one-only>
              <div class={style.options1Theme}>{results[0]}</div>
              <div class={style.options1Theme}>{options[0]}</div>
              <div class={style.options2Theme}>{results[1]}</div>
              <div class={style.options2Theme}>{options[1]}</div>
            </multi-panel>
          </div>
        ) : (
          [
            <div class={style.options1} key="options1">
              {options[0]}
              {results[0]}
            </div>,
            <div class={style.options2} key="options2">
              {options[1]}
              {results[1]}
            </div>,
          ]
        )}
      </div>
    );
  }
}
