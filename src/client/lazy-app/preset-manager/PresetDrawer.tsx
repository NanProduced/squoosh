import { h, Component } from 'preact';
import * as style from './style.css';
import 'add-css:./style.css';
import {
  Preset,
  getAllPresets,
  savePreset,
  deletePreset,
  serializePresetForUrl,
  createPresetFromSideSettings,
  PresetData,
  deserializePresetFromUrl,
} from 'client/lazy-app/preset-manager';
import { SaveIcon } from 'client/lazy-app/icons';
import type SnackBarElement from 'shared/custom-els/snack-bar';
import {
  ProcessorState,
  EncoderState,
  PreprocessorState,
} from 'client/lazy-app/feature-meta';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onApplyPreset: (preset: Preset, side: 'left' | 'right' | 'both') => void;
  showSnack: SnackBarElement['showSnackbar'];
  currentLeftProcessor: ProcessorState;
  currentLeftEncoder: EncoderState | undefined;
  currentRightProcessor: ProcessorState;
  currentRightEncoder: EncoderState | undefined;
  currentPreprocessor: PreprocessorState;
}

interface State {
  presets: Preset[];
  editingPreset: Preset | null;
  newPresetName: string;
  saveSide: 'left' | 'right';
  loading: boolean;
  activePresetId: string | null;
  showConfirmDelete: string | null;
}

export default class PresetDrawer extends Component<Props, State> {
  state: State = {
    presets: [],
    editingPreset: null,
    newPresetName: '',
    saveSide: 'left',
    loading: true,
    activePresetId: null,
    showConfirmDelete: null,
  };

  private containerRef?: HTMLDivElement;

  async componentDidMount() {
    await this.loadPresets();
    this.checkUrlPreset();
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.isOpen === false && this.props.isOpen === true) {
      this.loadPresets();
    }
  }

  private checkUrlPreset = async () => {
    const urlParams = new URLSearchParams(location.search);
    const presetParam = urlParams.get('preset');

    if (presetParam) {
      const hydratedData = deserializePresetFromUrl(presetParam);
      if (hydratedData) {
        const urlPreset: Preset = {
          id: 'url-imported',
          name: 'Imported Preset',
          isBuiltIn: false,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          data: hydratedData,
        };

        this.setState({ activePresetId: 'url-imported' });
        this.props.showSnack('Preset imported from URL', {
          timeout: 3000,
          actions: ['Apply to Both', 'Apply Left', 'Apply Right', 'dismiss'],
        }).then((action) => {
          if (action === 'Apply to Both') {
            this.props.onApplyPreset(urlPreset, 'both');
          } else if (action === 'Apply Left') {
            this.props.onApplyPreset(urlPreset, 'left');
          } else if (action === 'Apply Right') {
            this.props.onApplyPreset(urlPreset, 'right');
          }
        });
      } else {
        this.props.showSnack('Failed to import preset from URL', {
          timeout: 3000,
          actions: ['dismiss'],
        });
      }
    }
  };

  private loadPresets = async () => {
    this.setState({ loading: true });
    try {
      const presets = await getAllPresets();
      this.setState({ presets, loading: false });
    } catch (e) {
      console.error('Failed to load presets:', e);
      this.setState({ loading: false });
    }
  };

  private handleApplyPreset = (preset: Preset, side: 'left' | 'right' | 'both') => {
    this.props.onApplyPreset(preset, side);
    this.setState({ activePresetId: preset.id });
    this.props.showSnack(`Preset "${preset.name}" applied to ${side === 'both' ? 'both sides' : side}`, {
      timeout: 2000,
      actions: ['dismiss'],
    });
    this.props.onClose();
  };

  private handleStartSave = () => {
    this.setState({
      editingPreset: null,
      newPresetName: '',
    });
  };

  private handleStartEdit = (preset: Preset) => {
    this.setState({
      editingPreset: preset,
      newPresetName: preset.name,
    });
  };

  private handleCancelEdit = () => {
    this.setState({
      editingPreset: null,
      newPresetName: '',
    });
  };

  private handleSavePreset = async () => {
    const { newPresetName, editingPreset, saveSide } = this.state;

    if (!newPresetName.trim()) {
      this.props.showSnack('Please enter a preset name', {
        timeout: 3000,
        actions: ['dismiss'],
      });
      return;
    }

    let presetData: PresetData;

    if (saveSide === 'left') {
      presetData = createPresetFromSideSettings(
        this.props.currentLeftProcessor,
        this.props.currentLeftEncoder,
        this.props.currentPreprocessor,
      );
    } else {
      presetData = createPresetFromSideSettings(
        this.props.currentRightProcessor,
        this.props.currentRightEncoder,
        this.props.currentPreprocessor,
      );
    }

    try {
      const savedPreset = await savePreset(
        newPresetName.trim(),
        presetData,
        editingPreset || undefined,
      );

      await this.loadPresets();
      this.setState({
        editingPreset: null,
        newPresetName: '',
      });

      this.props.showSnack(
        editingPreset ? 'Preset updated' : 'Preset saved',
        { timeout: 2000, actions: ['dismiss'] },
      );
    } catch (e) {
      console.error('Failed to save preset:', e);
      this.props.showSnack('Failed to save preset', {
        timeout: 3000,
        actions: ['dismiss'],
      });
    }
  };

  private handleDeletePreset = async (presetId: string) => {
    try {
      await deletePreset(presetId);
      await this.loadPresets();
      this.setState({ showConfirmDelete: null });
      this.props.showSnack('Preset deleted', {
        timeout: 2000,
        actions: ['dismiss'],
      });
    } catch (e) {
      console.error('Failed to delete preset:', e);
      this.props.showSnack('Failed to delete preset', {
        timeout: 3000,
        actions: ['dismiss'],
      });
    }
  };

  private handleExportPreset = async (preset: Preset) => {
    const urlData = serializePresetForUrl(preset.data);
    const url = `${location.origin}${location.pathname}?preset=${urlData}`;

    try {
      await navigator.clipboard.writeText(url);
      this.props.showSnack('Preset link copied to clipboard', {
        timeout: 3000,
        actions: ['dismiss'],
      });
    } catch (e) {
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);

      this.props.showSnack('Preset link copied to clipboard', {
        timeout: 3000,
        actions: ['dismiss'],
      });
    }
  };

  private handleBackdropClick = (e: Event) => {
    if (e.target === e.currentTarget) {
      this.props.onClose();
    }
  };

  render(
    { isOpen }: Props,
    {
      presets,
      editingPreset,
      newPresetName,
      saveSide,
      loading,
      activePresetId,
      showConfirmDelete,
    }: State,
  ) {
    const builtInPresets = presets.filter((p) => p.isBuiltIn);
    const customPresets = presets.filter((p) => !p.isBuiltIn);
    const isEditing = editingPreset !== null || newPresetName !== '';

    return (
      <div
        class={`${style.overlay} ${isOpen ? style.open : ''}`}
        onClick={this.handleBackdropClick}
        ref={(ref) => (this.containerRef = ref || undefined)}
      >
        <div class={`${style.drawer} ${isOpen ? style.open : ''}`}>
          <div class={style.header}>
            <h2 class={style.title}>Presets</h2>
            <button class={style.closeButton} onClick={this.props.onClose}>
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
              </svg>
            </button>
          </div>

          <div class={style.content}>
            {loading ? (
              <div class={style.loading}>
                <loading-spinner />
              </div>
            ) : (
              <div>
                {isEditing ? (
                  <div class={style.editSection}>
                    <h3 class={style.sectionTitle}>
                      {editingPreset ? 'Edit Preset' : 'Save Preset'}
                    </h3>
                    <input
                      type="text"
                      class={style.nameInput}
                      placeholder="Preset name"
                      value={newPresetName}
                      onInput={(e) =>
                        this.setState({ newPresetName: (e.target as HTMLInputElement).value })
                      }
                    />
                    {!editingPreset && (
                      <div class={style.sideSelector}>
                        <label class={style.radioLabel}>
                          <input
                            type="radio"
                            name="saveSide"
                            value="left"
                            checked={saveSide === 'left'}
                            onChange={() => this.setState({ saveSide: 'left' })}
                          />
                          <span>Use Left Side Settings</span>
                        </label>
                        <label class={style.radioLabel}>
                          <input
                            type="radio"
                            name="saveSide"
                            value="right"
                            checked={saveSide === 'right'}
                            onChange={() => this.setState({ saveSide: 'right' })}
                          />
                          <span>Use Right Side Settings</span>
                        </label>
                      </div>
                    )}
                    <div class={style.editActions}>
                      <button class={style.cancelButton} onClick={this.handleCancelEdit}>
                        Cancel
                      </button>
                      <button class={style.saveButton} onClick={this.handleSavePreset}>
                        {editingPreset ? 'Update' : 'Save'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    {builtInPresets.length > 0 && (
                      <div class={style.presetSection}>
                        <h3 class={style.sectionTitle}>Built-in Presets</h3>
                        <div class={style.presetList}>
                          {builtInPresets.map((preset) => (
                            <div
                              class={`${style.presetItem} ${
                                activePresetId === preset.id ? style.active : ''
                              }`}
                              key={preset.id}
                            >
                              <div class={style.presetInfo}>
                                <span class={style.presetName}>{preset.name}</span>
                                <span class={style.presetBadge}>Built-in</span>
                              </div>
                              <div class={style.presetActions}>
                                <button
                                  class={style.actionButton}
                                  title="Apply to left"
                                  onClick={() => this.handleApplyPreset(preset, 'left')}
                                >
                                  ←
                                </button>
                                <button
                                  class={style.actionButton}
                                  title="Apply to both"
                                  onClick={() => this.handleApplyPreset(preset, 'both')}
                                >
                                  ↔
                                </button>
                                <button
                                  class={style.actionButton}
                                  title="Apply to right"
                                  onClick={() => this.handleApplyPreset(preset, 'right')}
                                >
                                  →
                                </button>
                                <button
                                  class={style.actionButton}
                                  title="Export link"
                                  onClick={() => this.handleExportPreset(preset)}
                                >
                                  🔗
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div class={style.presetSection}>
                      <div class={style.sectionHeader}>
                        <h3 class={style.sectionTitle}>My Presets</h3>
                        <button
                          class={style.addPresetButton}
                          onClick={this.handleStartSave}
                          title="Save current settings"
                        >
                          <SaveIcon />
                        </button>
                      </div>
                      <div class={style.presetList}>
                        {customPresets.length === 0 ? (
                          <div class={style.emptyState}>
                            <p>No custom presets yet.</p>
                            <p>
                              Click the{' '}
                              <SaveIcon />{' '}
                              button to save your current settings.
                            </p>
                          </div>
                        ) : (
                          customPresets.map((preset) => (
                            <div
                              class={`${style.presetItem} ${
                                activePresetId === preset.id ? style.active : ''
                              }`}
                              key={preset.id}
                            >
                              {showConfirmDelete === preset.id ? (
                                <div class={style.confirmDelete}>
                                  <span class={style.confirmText}>Delete "{preset.name}"?</span>
                                  <div class={style.confirmActions}>
                                    <button
                                      class={style.confirmNo}
                                      onClick={() => this.setState({ showConfirmDelete: null })}
                                    >
                                      No
                                    </button>
                                    <button
                                      class={style.confirmYes}
                                      onClick={() => this.handleDeletePreset(preset.id)}
                                    >
                                      Yes
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div class={style.presetInfo}>
                                    <span class={style.presetName}>{preset.name}</span>
                                  </div>
                                  <div class={style.presetActions}>
                                    <button
                                      class={style.actionButton}
                                      title="Apply to left"
                                      onClick={() => this.handleApplyPreset(preset, 'left')}
                                    >
                                      ←
                                    </button>
                                    <button
                                      class={style.actionButton}
                                      title="Apply to both"
                                      onClick={() => this.handleApplyPreset(preset, 'both')}
                                    >
                                      ↔
                                    </button>
                                    <button
                                      class={style.actionButton}
                                      title="Apply to right"
                                      onClick={() => this.handleApplyPreset(preset, 'right')}
                                    >
                                      →
                                    </button>
                                    <button
                                      class={style.actionButton}
                                      title="Edit"
                                      onClick={() => this.handleStartEdit(preset)}
                                    >
                                      ✏️
                                    </button>
                                    <button
                                      class={style.actionButton}
                                      title="Export link"
                                      onClick={() => this.handleExportPreset(preset)}
                                    >
                                      🔗
                                    </button>
                                    <button
                                      class={style.actionButton}
                                      title="Delete"
                                      onClick={() =>
                                        this.setState({ showConfirmDelete: preset.id })
                                      }
                                    >
                                      🗑️
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
}
