import { h, Component, Fragment } from 'preact';
import type PinchZoom from './custom-els/PinchZoom';
import type { ScaleToOpts } from './custom-els/PinchZoom';
import './custom-els/PinchZoom';
import './custom-els/FourUp';
import * as style from './style.css';
import 'add-css:./style.css';
import { shallowEqual, isSafari } from '../../util';
import {
  ToggleAliasingIcon,
  ToggleAliasingActiveIcon,
  ToggleBackgroundIcon,
  AddIcon,
  RemoveIcon,
  ToggleBackgroundActiveIcon,
  RotateIcon,
} from '../../icons';
import { fourUpHorizontalHandle, fourUpVerticalHandle, fourUpCenterHandle } from './custom-els/FourUp/styles.css';
import type { PreprocessorState } from '../../feature-meta';
import { cleanSet } from '../../util/clean-modify';
import type { SourceImage } from '../../Compress';
import { linkRef } from 'shared/prerendered-app/util';
import { drawDataToCanvas } from 'client/lazy-app/util/canvas';

export type QuadrantIndex = 0 | 1 | 2 | 3;

interface QuadrantProps {
  compressed?: ImageData;
  imgContain: boolean;
}

interface Props {
  source?: SourceImage;
  preprocessorState?: PreprocessorState;
  mobileView: boolean;
  quadrants: [QuadrantProps, QuadrantProps, QuadrantProps, QuadrantProps];
  onPreprocessorChange: (newState: PreprocessorState) => void;
}

interface State {
  scale: number;
  editingScale: boolean;
  altBackground: boolean;
  aliasing: boolean;
}

const scaleToOpts: ScaleToOpts = {
  originX: '50%',
  originY: '50%',
  relativeTo: 'container',
  allowChangeEvent: true,
};

export default class Output extends Component<Props, State> {
  state: State = {
    scale: 1,
    editingScale: false,
    altBackground: false,
    aliasing: false,
  };

  canvases: (HTMLCanvasElement | undefined)[] = [
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  pinchZooms: (PinchZoom | undefined)[] = [
    undefined,
    undefined,
    undefined,
    undefined,
  ];
  scaleInput?: HTMLInputElement;
  retargetedEvents = new WeakSet<Event>();

  componentDidMount() {
    const quadrantIndices: QuadrantIndex[] = [0, 1, 2, 3];
    for (const i of quadrantIndices) {
      const drawable = this.drawable(i);
      if (this.canvases[i] && drawable) {
        drawDataToCanvas(this.canvases[i]!, drawable);
      }
    }

    if (this.pinchZooms[0]) {
      this.pinchZooms[0]!.setTransform({
        allowChangeEvent: true,
        x: 0,
        y: 0,
        scale: 1,
      });
    }
  }

  componentDidUpdate(prevProps: Props, prevState: State) {
    const sourceFileChanged =
      !!this.props.source !== !!prevProps.source ||
      (this.props.source &&
        prevProps.source &&
        this.props.source.file !== prevProps.source.file);

    const oldSourceData = prevProps.source && prevProps.source.preprocessed;
    const newSourceData = this.props.source && this.props.source.preprocessed;
    const pinchZoom = this.pinchZooms[0];

    if (sourceFileChanged && pinchZoom) {
      pinchZoom.setTransform({
        allowChangeEvent: true,
        x: 0,
        y: 0,
        scale: 1,
      });
    } else if (
      oldSourceData &&
      newSourceData &&
      oldSourceData !== newSourceData &&
      pinchZoom
    ) {
      const scaleChange = 1 - pinchZoom.scale;
      const oldXScaleOffset = (oldSourceData.width / 2) * scaleChange;
      const oldYScaleOffset = (oldSourceData.height / 2) * scaleChange;

      pinchZoom.setTransform({
        allowChangeEvent: true,
        x: pinchZoom.x - oldXScaleOffset + oldYScaleOffset,
        y: pinchZoom.y - oldYScaleOffset + oldXScaleOffset,
      });
    }

    const quadrantIndices: QuadrantIndex[] = [0, 1, 2, 3];
    for (const i of quadrantIndices) {
      const prevDrawable = this.drawable(i, prevProps);
      const drawable = this.drawable(i);
      if (drawable && drawable !== prevDrawable && this.canvases[i]) {
        drawDataToCanvas(this.canvases[i]!, drawable);
      }
    }
  }

  shouldComponentUpdate(nextProps: Props, nextState: State) {
    return (
      !shallowEqual(this.props, nextProps) ||
      !shallowEqual(this.state, nextState)
    );
  }

  private drawable(
    index: QuadrantIndex,
    props: Props = this.props,
  ): ImageData | undefined {
    return (
      props.quadrants[index].compressed ||
      (props.source && props.source.preprocessed)
    );
  }

  private toggleAliasing = () => {
    this.setState((state) => ({
      aliasing: !state.aliasing,
    }));
  };

  private toggleBackground = () => {
    this.setState({
      altBackground: !this.state.altBackground,
    });
  };

  private zoomIn = () => {
    if (!this.pinchZooms[0]) throw Error('Missing pinch-zoom element');
    this.pinchZooms[0].scaleTo(this.state.scale * 1.25, scaleToOpts);
  };

  private zoomOut = () => {
    if (!this.pinchZooms[0]) throw Error('Missing pinch-zoom element');
    this.pinchZooms[0].scaleTo(this.state.scale / 1.25, scaleToOpts);
  };

  private onRotateClick = () => {
    const { preprocessorState: inputProcessorState } = this.props;
    if (!inputProcessorState) return;

    const newState = cleanSet(
      inputProcessorState,
      'rotate.rotate',
      (inputProcessorState.rotate.rotate + 90) % 360,
    );

    this.props.onPreprocessorChange(newState);
  };

  private onScaleValueFocus = () => {
    this.setState({ editingScale: true }, () => {
      if (this.scaleInput) {
        getComputedStyle(this.scaleInput).transform;
        this.scaleInput.focus();
      }
    });
  };

  private onScaleInputBlur = () => {
    this.setState({ editingScale: false });
  };

  private onScaleInputChanged = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const percent = parseFloat(target.value);
    if (isNaN(percent)) return;
    if (!this.pinchZooms[0]) throw Error('Missing pinch-zoom element');

    this.pinchZooms[0].scaleTo(percent / 100, scaleToOpts);
  };

  private onPinchZoomChange = (event: Event) => {
    const mainPinchZoom = this.pinchZooms[0];
    if (!mainPinchZoom) {
      throw Error('Missing pinch-zoom element');
    }
    this.setState({
      scale: mainPinchZoom.scale,
    });
    for (let i = 1; i < 4; i++) {
      if (this.pinchZooms[i]) {
        this.pinchZooms[i]!.setTransform({
          scale: mainPinchZoom.scale,
          x: mainPinchZoom.x,
          y: mainPinchZoom.y,
        });
      }
    }
  };

  private isFourUpHandle(targetEl: HTMLElement): boolean {
    return !!(
      targetEl.closest(`.${fourUpHorizontalHandle}`) ||
      targetEl.closest(`.${fourUpVerticalHandle}`) ||
      targetEl.closest(`.${fourUpCenterHandle}`)
    );
  }

  private onRetargetableEvent = (event: Event) => {
    const targetEl = event.target as HTMLElement;
    if (!this.pinchZooms[0]) throw Error('Missing pinch-zoom element');
    if (event.type !== 'wheel' && this.isFourUpHandle(targetEl)) return;
    if (this.retargetedEvents.has(event)) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const clonedEvent = new (event.constructor as typeof Event)(
      event.type,
      event,
    );
    this.retargetedEvents.add(clonedEvent);
    this.pinchZooms[0].dispatchEvent(clonedEvent);

    if (
      event.type === 'touchend' &&
      document.activeElement &&
      document.activeElement instanceof HTMLElement
    ) {
      document.activeElement.blur();
    }
  };

  render(
    { mobileView, source, quadrants }: Props,
    { scale, editingScale, altBackground, aliasing }: State,
  ) {
    const drawables = quadrants.map((_, i) => this.drawable(i as QuadrantIndex));
    const originalImage = source && source.preprocessed;

    return (
      <Fragment>
        <div
          class={`${style.output} ${altBackground ? style.altBackground : ''}`}
        >
          <four-up
            legacy-clip-compat
            class={style.fourUp}
            onTouchStartCapture={this.onRetargetableEvent}
            onTouchEndCapture={this.onRetargetableEvent}
            onTouchMoveCapture={this.onRetargetableEvent}
            onPointerDownCapture={
              isSafari ? undefined : this.onRetargetableEvent
            }
            onMouseDownCapture={this.onRetargetableEvent}
            onWheelCapture={this.onRetargetableEvent}
          >
            {[0, 1, 2, 3].map((i) => (
              <pinch-zoom
                key={i}
                class={style.pinchZoom}
                onChange={i === 0 ? this.onPinchZoomChange : undefined}
                ref={linkRef(this, `pinchZooms.${i}`)}
              >
                <canvas
                  class={`${style.pinchTarget} ${
                    aliasing ? style.pixelated : ''
                  }`}
                  ref={linkRef(this, `canvases.${i}`)}
                  width={drawables[i] && drawables[i]!.width}
                  height={drawables[i] && drawables[i]!.height}
                  style={{
                    width: originalImage ? originalImage.width : '',
                    height: originalImage ? originalImage.height : '',
                    objectFit: quadrants[i].imgContain ? 'contain' : '',
                  }}
                />
              </pinch-zoom>
            ))}
          </four-up>
        </div>
        <div class={style.controls}>
          <div class={style.buttonGroup}>
            <button class={style.firstButton} onClick={this.zoomOut}>
              <RemoveIcon />
            </button>
            {editingScale ? (
              <input
                type="number"
                step="1"
                min="1"
                max="1000000"
                ref={linkRef(this, 'scaleInput')}
                class={style.zoom}
                value={Math.round(scale * 100)}
                onInput={this.onScaleInputChanged}
                onBlur={this.onScaleInputBlur}
              />
            ) : (
              <span
                class={style.zoom}
                tabIndex={0}
                onFocus={this.onScaleValueFocus}
              >
                <span class={style.zoomValue}>{Math.round(scale * 100)}</span>%
              </span>
            )}
            <button class={style.lastButton} onClick={this.zoomIn}>
              <AddIcon />
            </button>
          </div>
          <div class={style.buttonGroup}>
            <button
              class={style.firstButton}
              onClick={this.onRotateClick}
              title="Rotate"
            >
              <RotateIcon />
            </button>
            {!isSafari && (
              <button
                class={style.button}
                onClick={this.toggleAliasing}
                title="Toggle smoothing"
              >
                {aliasing ? (
                  <ToggleAliasingActiveIcon />
                ) : (
                  <ToggleAliasingIcon />
                )}
              </button>
            )}
            <button
              class={style.lastButton}
              onClick={this.toggleBackground}
              title="Toggle background"
            >
              {altBackground ? (
                <ToggleBackgroundActiveIcon />
              ) : (
                <ToggleBackgroundIcon />
              )}
            </button>
          </div>
        </div>
      </Fragment>
    );
  }
}
