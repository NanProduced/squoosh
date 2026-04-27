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
import Output, { QuadrantIndex } from './Output';
import Options from './Options';
import ResultCache from './result-cache';
import { cleanMerge, cleanSet } from '../util/clean-modify';
import './custom-els/MultiPanel';
import Results from './Results';
import WorkerBridge from '../worker-bridge';
import { resize } from 'features/processors/resize/client';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import { drawableToImageData } from '../util/canvas';
import {
  WorkerPool,
  defaultWorkerPool,
  binarySearchQuality,
  SearchResult,
  BinarySearchParams,
  downloadMarkdown,
  downloadCSV,
  ComparisonResult,
  EncodeFunction,
  EncodeResult,
} from './util';

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

interface SideMetrics {
  ssim: number;
  encodeTime: number;
}

interface Side {
  processed?: ImageData;
  file?: File;
  downloadUrl?: string;
  data?: ImageData;
  latestSettings: SideSettings;
  encodedSettings?: SideSettings;
  loading: boolean;
  metrics?: SideMetrics;
  optimalQuality?: number;
  isOptimizing: boolean;
}

interface Props {
  file: File;
  showSnack: SnackBarElement['showSnackbar'];
  onBack: () => void;
}

interface State {
  source?: SourceImage;
  sides: [Side, Side, Side, Side];
  loading: boolean;
  mobileView: boolean;
  preprocessorState: PreprocessorState;
  encodedPreprocessorState?: PreprocessorState;
  optimizationInProgress: boolean;
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

const DEFAULT_ENCODERS: EncoderType[] = ['mozJPEG', 'webP', 'avif', 'jxl'];
const TARGET_SSIM = 0.95;
const OPTIMIZATION_PARAMS: BinarySearchParams = {
  minQuality: 0,
  maxQuality: 100,
  targetSSIM: TARGET_SSIM,
  maxIterations: 10,
};

function getQualityFromOptions(
  encoderType: EncoderType,
  options: EncoderOptions,
): number {
  switch (encoderType) {
    case 'mozJPEG':
    case 'webP':
    case 'jxl':
      return (options as any).quality ?? 75;
    case 'avif':
      return (options as any).quality ?? 50;
    default:
      return 75;
  }
}

function setQualityInOptions(
  encoderType: EncoderType,
  options: EncoderOptions,
  quality: number,
): EncoderOptions {
  const newOptions = { ...options };
  switch (encoderType) {
    case 'mozJPEG':
    case 'webP':
    case 'jxl':
      (newOptions as any).quality = Math.round(quality);
      break;
    case 'avif':
      (newOptions as any).quality = Math.round(quality);
      break;
  }
  return newOptions;
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

  if (preprocessorState.rotate.rotate !== 0) {
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
    encodeData.options as any,
  );

  const type: ImageMimeTypes = encoder.meta.mimeType;

  return new File(
    [compressedData],
    sourceFilename.replace(/.[^.]*$/, `.${encoder.meta.extension}`),
    { type },
  );
}

function createDefaultSide(encoderType: EncoderType): Side {
  return {
    latestSettings: {
      processorState: { ...defaultProcessorState },
      encoderState: {
        type: encoderType,
        options: { ...encoderMap[encoderType].meta.defaultOptions },
      } as EncoderState,
    },
    loading: false,
    isOptimizing: false,
  };
}

function stateForNewSourceData(state: State): State {
  let newState = { ...state };

  for (const i of [0, 1, 2, 3]) {
    const downloadUrl = state.sides[i].downloadUrl;
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);

    newState = cleanMerge(state, `sides.${i}`, {
      preprocessed: undefined,
      file: undefined,
      downloadUrl: undefined,
      data: undefined,
      encodedSettings: undefined,
      metrics: undefined,
      optimalQuality: undefined,
    });
  }

  return newState;
}

async function processSvg(
  signal: AbortSignal,
  blob: Blob,
): Promise<HTMLImageElement> {
  assertSignal(signal);
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

function processorStateEquivalent(a: ProcessorState, b: ProcessorState) {
  if (a === b) return true;

  for (const key of Object.keys(a) as Array<keyof ProcessorState>) {
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
    sides: [
      createDefaultSide(DEFAULT_ENCODERS[0]),
      createDefaultSide(DEFAULT_ENCODERS[1]),
      createDefaultSide(DEFAULT_ENCODERS[2]),
      createDefaultSide(DEFAULT_ENCODERS[3]),
    ],
    mobileView: this.widthQuery.matches,
    optimizationInProgress: false,
  };

  private readonly encodeCache = new ResultCache();
  private readonly workerBridges = [
    new WorkerBridge(),
    new WorkerBridge(),
    new WorkerBridge(),
    new WorkerBridge(),
  ];
  private readonly workerPool = new WorkerPool({ maxConcurrent: 4 });
  private mainAbortController = new AbortController();
  private sideAbortControllers = [
    new AbortController(),
    new AbortController(),
    new AbortController(),
    new AbortController(),
  ];
  private optimizationAbortController = new AbortController();
  private updateImageTimeout?: number;

  constructor(props: Props) {
    super(props);
    this.widthQuery.addListener(this.onMobileWidthChange);
    this.sourceFile = props.file;
    this.queueUpdateImage({ immediate: true });

    import('../sw-bridge').then(({ mainAppLoaded }) => mainAppLoaded());
  }

  private onMobileWidthChange = () => {
    this.setState({ mobileView: this.widthQuery.matches });
  };

  private onEncoderTypeChange = (
    index: QuadrantIndex,
    newType: OutputType,
  ): void => {
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
    index: QuadrantIndex,
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
    index: QuadrantIndex,
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
    this.optimizationAbortController.abort();
  }

  componentDidUpdate(prevProps: Props, prevState: State): void {
    const wasLoading =
      prevState.loading ||
      prevState.sides.some((s) => s.loading);
    const isLoading =
      this.state.loading ||
      this.state.sides.some((s) => s.loading);
    const sourceChanged = prevState.source !== this.state.source;
    if (wasLoading !== isLoading || sourceChanged) {
      updateDocumentTitle({
        loading: isLoading,
        filename: this.state.source?.file.name,
      });
    }
    this.queueUpdateImage();
  }

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
          }) as [Side, Side, Side, Side]),
    }));
  };

  private queueUpdateImage({ immediate }: { immediate?: boolean } = {}): void {
    const delay = 100;

    clearTimeout(this.updateImageTimeout);
    if (immediate) {
      this.updateImage();
    } else {
      this.updateImageTimeout = setTimeout(() => this.updateImage(), delay);
    }
  }

  private sourceFile: File;
  private activeMainJob?: MainJob;
  private activeSideJobs: [SideJob?, SideJob?, SideJob?, SideJob?] = [
    undefined,
    undefined,
    undefined,
    undefined,
  ];

  private async updateImage() {
    const currentState = this.state;

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

    const mainJobState: MainJob = {
      file: this.sourceFile,
      preprocessorState: currentState.preprocessorState,
    };
    const sideJobStates: SideJob[] = currentState.sides.map((side) => ({
      processorState: side.latestSettings.encoderState
        ? side.latestSettings.processorState
        : defaultProcessorState,
      encoderState: side.latestSettings.encoderState,
    }));

    const needsDecoding = latestMainJobState.file != mainJobState.file;
    const needsPreprocessing =
      needsDecoding ||
      latestMainJobState.preprocessorState !== mainJobState.preprocessorState;
    const sideWorksNeeded = latestSideJobStates.map((latestSideJob, i) => {
      const needsProcessing =
        needsPreprocessing ||
        !latestSideJob.processorState ||
        !!latestSideJob.encoderState !== !!sideJobStates[i].encoderState ||
        !processorStateEquivalent(
          latestSideJob.processorState!,
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

    if (needsDecoding) {
      try {
        assertSignal(mainSignal);
        this.setState({
          source: undefined,
          loading: true,
        });

        if (mainJobState.file.type.startsWith('image/svg+xml')) {
          vectorImage = await processSvg(mainSignal, mainJobState.file);
          decoded = drawableToImageData(vectorImage);
        } else {
          decoded = await decodeImage(
            mainSignal,
            mainJobState.file,
            this.workerBridges[0],
          );
        }

        this.setState((currentState) => {
          if (mainSignal.aborted) return {};
          const sides = currentState.sides.map((side) => {
            const resizeState: Partial<ProcessorState['resize']> = {
              width: decoded.width,
              height: decoded.height,
              method: vectorImage ? 'vector' : 'lanczos3',
              enabled: false,
            };
            return cleanMerge(
              side,
              'latestSettings.processorState.resize',
              resizeState,
            );
          }) as [Side, Side, Side, Side];
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
          this.workerBridges[0],
        );

        source = {
          decoded,
          vectorImage,
          preprocessed,
          file: mainJobState.file,
        };

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
                data: preprocessed,
                processed: undefined,
                encodedSettings: undefined,
              };
              return newSide;
            }) as [Side, Side, Side, Side],
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

    this.activeMainJob = undefined;

    sideWorksNeeded.forEach(async (sideWorkNeeded, sideIndex) => {
      try {
        if (!sideWorkNeeded.encoding) return;

        const signal = sideSignals[sideIndex];
        const jobState = sideJobStates[sideIndex];
        const workerBridge = this.workerBridges[sideIndex];
        let file: File;
        let data: ImageData;
        let processed: ImageData | undefined = undefined;

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

              this.setState((currentState) => {
                if (signal.aborted) return {};
                const currentSide = currentState.sides[sideIndex];
                const side: Side = {
                  ...currentSide,
                  processed,
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

            const encodeStartTime = performance.now();
            file = await compressImage(
              signal,
              processed,
              jobState.encoderState,
              source.file.name,
              workerBridge,
            );
            const encodeTime = performance.now() - encodeStartTime;

            data = await decodeImage(signal, file, workerBridge);

            const ssim = await workerBridge.ssim(
              signal,
              source.preprocessed,
              data,
              true,
            );

            this.encodeCache.add({
              data,
              processed,
              file,
              preprocessed: source.preprocessed,
              encoderState: jobState.encoderState,
              processorState: jobState.processorState,
            });

            this.setState((currentState) => {
              if (signal.aborted) return {};
              const sides = cleanMerge(currentState.sides, sideIndex, {
                metrics: {
                  ssim: ssim.ssim,
                  encodeTime,
                },
              });
              return { sides };
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

  private createEncodeFunction = (
    quadrantIndex: QuadrantIndex,
  ): EncodeFunction => {
    const side = this.state.sides[quadrantIndex];
    const source = this.state.source!;
    const workerBridge = this.workerBridges[quadrantIndex];
    const encoderState = side.latestSettings.encoderState!;

    return async (quality: number): Promise<EncodeResult> => {
      const signal = this.optimizationAbortController.signal;
      assertSignal(signal);

      const optionsWithQuality = setQualityInOptions(
        encoderState.type,
        encoderState.options,
        quality,
      );

      const currentEncoderState: EncoderState = {
        type: encoderState.type,
        options: optionsWithQuality,
      } as EncoderState;

      const cacheResult = this.encodeCache.match(
        source.preprocessed,
        side.latestSettings.processorState,
        currentEncoderState,
      );

      if (cacheResult) {
        const ssim = await workerBridge.ssim(
          signal,
          source.preprocessed,
          cacheResult.data,
          true,
        );
        return {
          quality,
          ssim: ssim.ssim,
          size: cacheResult.file.size,
          encodeTime: 0,
        };
      }

      let processed = side.processed;
      if (!processed) {
        processed = await processImage(
          signal,
          source,
          side.latestSettings.processorState,
          workerBridge,
        );
      }

      const encodeStartTime = performance.now();
      const file = await compressImage(
        signal,
        processed,
        currentEncoderState,
        source.file.name,
        workerBridge,
      );
      const encodeTime = performance.now() - encodeStartTime;

      const data = await decodeImage(signal, file, workerBridge);
      const ssim = await workerBridge.ssim(
        signal,
        source.preprocessed,
        data,
        true,
      );

      this.encodeCache.add({
        data,
        processed,
        file,
        preprocessed: source.preprocessed,
        encoderState: currentEncoderState,
        processorState: side.latestSettings.processorState,
      });

      return {
        quality,
        ssim: ssim.ssim,
        size: file.size,
        encodeTime,
      };
    };
  };

  private onOptimizeAll = async (): Promise<void> => {
    if (!this.state.source) return;

    const sidesWithEncoder = this.state.sides.filter((s) => s.encodedSettings?.encoderState);
    if (sidesWithEncoder.length === 0) {
      await this.props.showSnack('No encoders configured for optimization', {
        timeout: 3000,
        actions: ['dismiss'],
      });
      return;
    }

    this.optimizationAbortController.abort();
    this.optimizationAbortController = new AbortController();
    const signal = this.optimizationAbortController.signal;

    this.setState({ optimizationInProgress: true });

    this.props.showSnack('Optimizing all encoders...', {
      timeout: 0,
    });

    try {
      const optimizationTasks: Promise<void>[] = [];

      for (let i = 0; i < 4; i++) {
        const side = this.state.sides[i];
        if (!side.latestSettings.encoderState) continue;

        this.setState((currentState) => {
          const sides = cleanMerge(currentState.sides, i, {
            isOptimizing: true,
          });
          return { sides };
        });

        const encodeFn = this.createEncodeFunction(i as QuadrantIndex);
        const encoderType = side.latestSettings.encoderState.type;

        const task = (async () => {
          try {
            const result = await binarySearchQuality(
              encodeFn,
              OPTIMIZATION_PARAMS,
            );

            if (signal.aborted) return;

            const newOptions = setQualityInOptions(
              encoderType,
              side.latestSettings.encoderState!.options,
              result.quality,
            );

            this.setState((currentState) => {
              let sides = cleanSet(
                currentState.sides,
                `${i}.latestSettings.encoderState.options`,
                newOptions,
              );
              sides = cleanMerge(sides, i, {
                isOptimizing: false,
                optimalQuality: result.quality,
              });
              return { sides };
            });
          } catch (err) {
            if (err instanceof Error && err.name === 'AbortError') return;
            console.error(`Optimization failed for quadrant ${i}:`, err);
            this.setState((currentState) => {
              const sides = cleanMerge(currentState.sides, i, {
                isOptimizing: false,
              });
              return { sides };
            });
          }
        })();

        optimizationTasks.push(task);
      }

      await Promise.all(optimizationTasks);

      if (!signal.aborted) {
        this.setState({ optimizationInProgress: false });
        await this.props.showSnack('Optimization complete!', {
          timeout: 3000,
          actions: ['dismiss'],
        });
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      this.setState({ optimizationInProgress: false });
      await this.props.showSnack(`Optimization error: ${err}`, {
        timeout: 5000,
        actions: ['dismiss'],
      });
    }
  };

  private onExportMarkdown = (): void => {
    const results: ComparisonResult[] = [];
    const source = this.state.source;

    if (!source) return;

    for (let i = 0; i < 4; i++) {
      const side = this.state.sides[i];
      if (!side.file || !side.latestSettings.encoderState) continue;

      const encoderName = encoderMap[side.latestSettings.encoderState.type].meta.label;
      const quality = getQualityFromOptions(
        side.latestSettings.encoderState.type,
        side.latestSettings.encoderState.options,
      );

      results.push({
        quadrant: i as QuadrantIndex,
        encoderName,
        quality,
        originalSize: source.file.size,
        compressedSize: side.file.size,
        compressionRatio: side.file.size / source.file.size,
        ssim: side.metrics?.ssim ?? 0,
        encodeTime: side.metrics?.encodeTime ?? 0,
        isOptimal: side.optimalQuality !== undefined && side.optimalQuality === quality,
      });
    }

    if (results.length === 0) {
      this.props.showSnack('No encoder results to export', {
        timeout: 3000,
        actions: ['dismiss'],
      });
      return;
    }

    downloadMarkdown(results);
    this.props.showSnack('Markdown report downloaded', {
      timeout: 2000,
      actions: ['dismiss'],
    });
  };

  private onExportCSV = (): void => {
    const results: ComparisonResult[] = [];
    const source = this.state.source;

    if (!source) return;

    for (let i = 0; i < 4; i++) {
      const side = this.state.sides[i];
      if (!side.file || !side.latestSettings.encoderState) continue;

      const encoderName = encoderMap[side.latestSettings.encoderState.type].meta.label;
      const quality = getQualityFromOptions(
        side.latestSettings.encoderState.type,
        side.latestSettings.encoderState.options,
      );

      results.push({
        quadrant: i as QuadrantIndex,
        encoderName,
        quality,
        originalSize: source.file.size,
        compressedSize: side.file.size,
        compressionRatio: side.file.size / source.file.size,
        ssim: side.metrics?.ssim ?? 0,
        encodeTime: side.metrics?.encodeTime ?? 0,
        isOptimal: side.optimalQuality !== undefined && side.optimalQuality === quality,
      });
    }

    if (results.length === 0) {
      this.props.showSnack('No encoder results to export', {
        timeout: 3000,
        actions: ['dismiss'],
      });
      return;
    }

    downloadCSV(results);
    this.props.showSnack('CSV report downloaded', {
      timeout: 2000,
      actions: ['dismiss'],
    });
  };

  render(
    { onBack }: Props,
    { loading, sides, source, mobileView, preprocessorState, optimizationInProgress }: State,
  ) {
    const quadrants = sides.map((side, index) => {
      const displaySettings =
        side.encodedSettings || side.latestSettings;
      const imgContain =
        displaySettings.processorState.resize.enabled &&
        displaySettings.processorState.resize.fitMethod === 'contain';

      return {
        compressed: side.data,
        imgContain,
      };
    });

    const options = sides.map((side, index) => (
      <Options
        key={index}
        index={index as QuadrantIndex}
        source={source}
        mobileView={mobileView}
        processorState={side.latestSettings.processorState}
        encoderState={side.latestSettings.encoderState}
        onEncoderTypeChange={this.onEncoderTypeChange}
        onEncoderOptionsChange={this.onEncoderOptionsChange}
        onProcessorOptionsChange={this.onProcessorOptionsChange}
        onCopyToOtherSideClick={() => {}}
        onSaveSideSettingsClick={() => {}}
        onImportSideSettingsClick={() => {}}
      />
    ));

    const results = sides.map((side, index) => (
      <Results
        key={index}
        downloadUrl={side.downloadUrl}
        imageFile={side.file}
        source={source}
        loading={loading || side.loading || side.isOptimizing}
        flipSide={mobileView || index % 2 === 1}
        typeLabel={
          side.latestSettings.encoderState
            ? encoderMap[side.latestSettings.encoderState.type].meta.label
            : `${side.file ? `${side.file.name}` : 'Original Image'}`
        }
      />
    ));

    return (
      <div class={style.compress}>
        <Output
          source={source}
          mobileView={mobileView}
          quadrants={quadrants as any}
          preprocessorState={preprocessorState}
          onPreprocessorChange={this.onPreprocessorChange}
        />
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

        <div style={{
          position: 'absolute',
          top: '9px',
          right: '9px',
          zIndex: 100,
          display: 'flex',
          gap: '6px',
        }}>
          <button
            onClick={this.onOptimizeAll}
            disabled={optimizationInProgress}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              cursor: optimizationInProgress ? 'not-allowed' : 'pointer',
              background: optimizationInProgress ? '#555' : '#3b82f6',
              color: '#fff',
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            {optimizationInProgress ? '⏳ Optimizing...' : '🎯 Optimize All'}
          </button>
          <button
            onClick={this.onExportMarkdown}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              background: '#10b981',
              color: '#fff',
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            📄 MD
          </button>
          <button
            onClick={this.onExportCSV}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: 'none',
              cursor: 'pointer',
              background: '#f59e0b',
              color: '#fff',
              fontSize: '14px',
              fontWeight: '600',
            }}
          >
            📊 CSV
          </button>
        </div>

        {mobileView ? (
          <div class={style.options}>
            <multi-panel class={style.multiPanel} open-one-only>
              {sides.map((_, i) => (
                <div key={`result-${i}`} class={i % 2 === 0 ? style.options1Theme : style.options2Theme}>
                  {results[i]}
                </div>
              ))}
              {sides.map((_, i) => (
                <div key={`option-${i}`} class={i % 2 === 0 ? style.options1Theme : style.options2Theme}>
                  {options[i]}
                </div>
              ))}
            </multi-panel>
          </div>
        ) : (
          [
            <div class={style.options1} key="options1">
              {options[0]}
              {results[0]}
              {options[2]}
              {results[2]}
            </div>,
            <div class={style.options2} key="options2">
              {options[1]}
              {results[1]}
              {options[3]}
              {results[3]}
            </div>,
          ]
        )}
      </div>
    );
  }
}
