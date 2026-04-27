import { h, Component } from 'preact';

import * as style from './style.css';
import 'add-css:./style.css';
import { cleanSet, cleanMerge } from '../../util/clean-modify';
import linkState from 'linkstate';

import type { SourceImage, OutputType } from '..';
import {
  EncoderOptions,
  EncoderState,
  ProcessorState,
  ProcessorOptions,
  encoderMap,
} from '../../feature-meta';
import Expander from './Expander';
import Toggle from './Toggle';
import Select from './Select';
import { Options as QuantOptionsComponent } from 'features/processors/quantize/client';
import { Options as ResizeOptionsComponent } from 'features/processors/resize/client';
import { ImportIcon, SaveIcon, SwapIcon } from 'client/lazy-app/icons';
import { MetadataOptions, getMetadataSupport, defaultMetadataOptions } from 'features/metadata/shared/types';
import Checkbox from './Checkbox';
import Revealer from './Revealer';

interface Props {
  index: 0 | 1;
  mobileView: boolean;
  source?: SourceImage;
  encoderState?: EncoderState;
  processorState: ProcessorState;
  metadataOptions: MetadataOptions;
  onEncoderTypeChange(index: 0 | 1, newType: OutputType): void;
  onEncoderOptionsChange(index: 0 | 1, newOptions: EncoderOptions): void;
  onProcessorOptionsChange(index: 0 | 1, newOptions: ProcessorState): void;
  onMetadataOptionsChange(index: 0 | 1, newOptions: MetadataOptions): void;
  onCopyToOtherSideClick(index: 0 | 1): void;
  onSaveSideSettingsClick(index: 0 | 1): void;
  onImportSideSettingsClick(index: 0 | 1): void;
}

interface State {
  supportedEncoderMap?: PartialButNotUndefined<typeof encoderMap>;
  leftSideSettings?: string | null;
  rightSideSettings?: string | null;
  showAdvancedMetadata: boolean;
}

type PartialButNotUndefined<T> = {
  [P in keyof T]: T[P];
};

const supportedEncoderMapP: Promise<PartialButNotUndefined<typeof encoderMap>> =
  (async () => {
    const supportedEncoderMap: PartialButNotUndefined<typeof encoderMap> = {
      ...encoderMap,
    };

    // Filter out entries where the feature test fails
    await Promise.all(
      Object.entries(encoderMap).map(async ([encoderName, details]) => {
        if ('featureTest' in details && !(await details.featureTest())) {
          delete supportedEncoderMap[encoderName as keyof typeof encoderMap];
        }
      }),
    );

    return supportedEncoderMap;
  })();

export default class Options extends Component<Props, State> {
  state: State = {
    supportedEncoderMap: undefined,
    leftSideSettings: localStorage.getItem('leftSideSettings'),
    rightSideSettings: localStorage.getItem('rightSideSettings'),
    showAdvancedMetadata: true,
  };

  constructor() {
    super();
    supportedEncoderMapP.then((supportedEncoderMap) =>
      this.setState({ supportedEncoderMap }),
    );
  }

  private setLeftSideSettings = () => {
    this.setState({
      leftSideSettings: localStorage.getItem('leftSideSettings'),
    });
  };

  private setRightSideSettings = () => {
    this.setState({
      rightSideSettings: localStorage.getItem('rightSideSettings'),
    });
  };

  componentDidMount(): void {
    window.addEventListener('leftSideSettings', this.setLeftSideSettings);
    window.addEventListener('rightSideSettings', this.setRightSideSettings);
  }

  componentWillUnmount(): void {
    window.removeEventListener('leftSideSettings', this.setLeftSideSettings);
    window.removeEventListener('removeSideSettings', this.setRightSideSettings);
  }

  private onEncoderTypeChange = (event: Event) => {
    const el = event.currentTarget as HTMLSelectElement;
    const type = el.value as OutputType;
    this.props.onEncoderTypeChange(this.props.index, type);
  };

  private onProcessorEnabledChange = (event: Event) => {
    const el = event.currentTarget as HTMLInputElement;
    const processor = el.name.split('.')[0] as keyof ProcessorState;

    this.props.onProcessorOptionsChange(
      this.props.index,
      cleanSet(this.props.processorState, `${processor}.enabled`, el.checked),
    );
  };

  private onQuantizerOptionsChange = (opts: ProcessorOptions['quantize']) => {
    this.props.onProcessorOptionsChange(
      this.props.index,
      cleanMerge(this.props.processorState, 'quantize', opts),
    );
  };

  private onResizeOptionsChange = (opts: ProcessorOptions['resize']) => {
    this.props.onProcessorOptionsChange(
      this.props.index,
      cleanMerge(this.props.processorState, 'resize', opts),
    );
  };

  private onEncoderOptionsChange = (newOptions: EncoderOptions) => {
    this.props.onEncoderOptionsChange(this.props.index, newOptions);
  };

  private onMetadataOptionChange = (event: Event) => {
    const el = event.currentTarget as HTMLInputElement;
    const option = el.name as keyof MetadataOptions;
    const newOptions: MetadataOptions = {
      ...this.props.metadataOptions,
      [option]: el.checked,
    };
    this.props.onMetadataOptionsChange(this.props.index, newOptions);
  };

  private onCopyToOtherSideClick = () => {
    this.props.onCopyToOtherSideClick(this.props.index);
  };

  private onSaveSideSettingClick = () => {
    this.props.onSaveSideSettingsClick(this.props.index);
  };

  private onImportSideSettingsClick = () => {
    this.props.onImportSideSettingsClick(this.props.index);
  };

  render(
    { source, encoderState, processorState, metadataOptions }: Props,
    { supportedEncoderMap, showAdvancedMetadata }: State,
  ) {
    const encoder = encoderState && encoderMap[encoderState.type];
    const EncoderOptionComponent =
      encoder && 'Options' in encoder ? encoder.Options : undefined;

    const targetMimeType = encoder ? encoder.meta.mimeType : source?.sourceMimeType || '';
    const metadataSupport = getMetadataSupport(targetMimeType);
    const hasSourceMetadata = source?.metadata && (source.metadata.exif || source.metadata.icc || source.metadata.xmp);

    return (
      <div
        class={
          style.optionsScroller +
          ' ' +
          (encoderState ? '' : style.originalImage)
        }
      >
        <Expander>
          {!encoderState ? null : (
            <div>
              <h3 class={style.optionsTitle}>
                <div class={style.titleAndButtons}>
                  Edit
                  <button
                    class={style.copyOverButton}
                    title="Copy settings to other side"
                    onClick={this.onCopyToOtherSideClick}
                  >
                    <SwapIcon />
                  </button>
                  <button
                    class={style.saveButton}
                    title="Save side settings"
                    onClick={this.onSaveSideSettingClick}
                  >
                    <SaveIcon />
                  </button>
                  <button
                    class={
                      style.importButton +
                      ' ' +
                      (!this.state.leftSideSettings && this.props.index === 0
                        ? style.buttonOpacity
                        : '') +
                      ' ' +
                      (!this.state.rightSideSettings && this.props.index === 1
                        ? style.buttonOpacity
                        : '')
                    }
                    title="Import saved side settings"
                    onClick={this.onImportSideSettingsClick}
                    disabled={
                      (!this.state.leftSideSettings &&
                        this.props.index === 0) ||
                      (!this.state.rightSideSettings && this.props.index === 1)
                    }
                  >
                    <ImportIcon />
                  </button>
                </div>
              </h3>
              <label class={style.sectionEnabler}>
                Resize
                <Toggle
                  name="resize.enable"
                  checked={!!processorState.resize.enabled}
                  onChange={this.onProcessorEnabledChange}
                />
              </label>
              <Expander>
                {processorState.resize.enabled ? (
                  <ResizeOptionsComponent
                    isVector={Boolean(source && source.vectorImage)}
                    inputWidth={source ? source.preprocessed.width : 1}
                    inputHeight={source ? source.preprocessed.height : 1}
                    options={processorState.resize}
                    onChange={this.onResizeOptionsChange}
                  />
                ) : null}
              </Expander>

              <label class={style.sectionEnabler}>
                Reduce palette
                <Toggle
                  name="quantize.enable"
                  checked={!!processorState.quantize.enabled}
                  onChange={this.onProcessorEnabledChange}
                />
              </label>
              <Expander>
                {processorState.quantize.enabled ? (
                  <QuantOptionsComponent
                    options={processorState.quantize}
                    onChange={this.onQuantizerOptionsChange}
                  />
                ) : null}
              </Expander>
            </div>
          )}
        </Expander>

        <h3 class={style.optionsTitle}>Compress</h3>

        <section class={`${style.optionOneCell} ${style.optionsSection}`}>
          {supportedEncoderMap ? (
            <Select
              value={encoderState ? encoderState.type : 'identity'}
              onChange={this.onEncoderTypeChange}
              large
            >
              <option value="identity">{`Original Image ${
                this.props.source ? `(${this.props.source.file.name})` : ''
              }`}</option>
              {Object.entries(supportedEncoderMap).map(([type, encoder]) => (
                <option value={type}>{encoder.meta.label}</option>
              ))}
            </Select>
          ) : (
            <Select large>
              <option>Loading…</option>
            </Select>
          )}
        </section>

        <Expander>
          {EncoderOptionComponent && (
            <EncoderOptionComponent
              options={
                encoderState!.options as any
              }
              onChange={this.onEncoderOptionsChange}
            />
          )}
        </Expander>

        {encoderState ? (
          <section class={style.optionsSection}>
            <label class={style.optionReveal}>
              <Revealer
                checked={showAdvancedMetadata}
                onChange={linkState(this, 'showAdvancedMetadata')}
              />
              Keep metadata
              {hasSourceMetadata ? (
                <span title="Source image contains metadata">
                  (Has EXIF/ICC/XMP)
                </span>
              ) : null}
            </label>
            <Expander>
              {showAdvancedMetadata ? (
                <div>
                  <div class={style.optionToggle}>
                    <span
                      title={
                        metadataSupport.supportsExif
                          ? 'Keep EXIF metadata (camera info, orientation, etc.)'
                          : `EXIF not supported by ${encoder?.meta.label || 'this format'}`
                      }
                    >
                      Keep EXIF
                    </span>
                    <Checkbox
                      name="keepExif"
                      checked={metadataOptions.keepExif && metadataSupport.supportsExif}
                      disabled={!metadataSupport.supportsExif}
                      onChange={this.onMetadataOptionChange}
                    />
                  </div>
                  <div class={style.optionToggle}>
                    <span
                      title={
                        metadataSupport.supportsIcc
                          ? 'Keep ICC color profile'
                          : `ICC profile not supported by ${encoder?.meta.label || 'this format'}`
                      }
                    >
                      Keep ICC Profile
                    </span>
                    <Checkbox
                      name="keepIcc"
                      checked={metadataOptions.keepIcc && metadataSupport.supportsIcc}
                      disabled={!metadataSupport.supportsIcc}
                      onChange={this.onMetadataOptionChange}
                    />
                  </div>
                  <div class={style.optionToggle}>
                    <span
                      title={
                        metadataSupport.supportsXmp
                          ? 'Keep XMP metadata (extended metadata)'
                          : `XMP not supported by ${encoder?.meta.label || 'this format'}`
                      }
                    >
                      Keep XMP
                    </span>
                    <Checkbox
                      name="keepXmp"
                      checked={metadataOptions.keepXmp && metadataSupport.supportsXmp}
                      disabled={!metadataSupport.supportsXmp}
                      onChange={this.onMetadataOptionChange}
                    />
                  </div>
                  {!(metadataSupport.supportsExif && metadataSupport.supportsIcc && metadataSupport.supportsXmp) ? (
                    <div class={style.optionOneCell} style={{ paddingTop: 0, color: '#888', fontSize: '0.85em' }}>
                      Note: {encoder?.meta.label || 'This format'} does not support some metadata types.
                      Disabled options will be ignored during compression.
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Expander>
          </section>
        ) : null}
      </div>
    );
  }
}
