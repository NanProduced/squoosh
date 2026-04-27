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
  getPresetSummary,
  getEncoderColor,
  PresetSummary,
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

function PresetCard({
  preset,
  summary,
  isActive,
  isBuiltIn,
  showConfirmDelete,
  onApplyLeft,
  onApplyRight,
  onApplyBoth,
  onEdit,
  onExport,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  preset: Preset;
  summary: PresetSummary;
  isActive: boolean;
  isBuiltIn: boolean;
  showConfirmDelete: boolean;
  onApplyLeft: () => void;
  onApplyRight: () => void;
  onApplyBoth: () => void;
  onEdit?: () => void;
  onExport: () => void;
  onDelete?: () => void;
  onConfirmDelete?: () => void;
  onCancelDelete?: () => void;
}) {
  const formatColor = getEncoderColor(preset.data.encoderState?.type);

  return (
    <div
      class={`${style.presetCard} ${isActive ? style.presetCardActive : ''}`}
    >
      {showConfirmDelete ? (
        <div class={style.presetCardDeleteConfirm}>
          <span class={style.deleteConfirmText}>
            Delete "{preset.name}"?
          </span>
          <div class={style.deleteConfirmButtons}>
            <button
              class={style.deleteConfirmNo}
              onClick={onCancelDelete}
            >
              Cancel
            </button>
            <button
              class={style.deleteConfirmYes}
              onClick={onConfirmDelete}
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div class={style.presetCardHeader}>
            <div
              class={style.formatIcon}
              style={{ background: formatColor }}
            >
              <span class={style.formatShort}>{summary.formatShort.slice(0, 3)}</span>
            </div>
            <div class={style.presetCardInfo}>
              <span class={style.presetCardName}>{preset.name}</span>
              <div class={style.presetCardMeta}>
                <span class={style.formatLabel}>{summary.formatLabel}</span>
                {summary.quality !== null && (
                  <span class={style.qualityBadge}>
                    Q{summary.quality}
                  </span>
                )}
                {summary.isResized && (
                  <span class={style.resizeBadge}>
                    {summary.resizeWidth}×{summary.resizeHeight}
                  </span>
                )}
                {summary.isQuantized && (
                  <span class={style.quantizeBadge}>Palette</span>
                )}
              </div>
            </div>
            {isBuiltIn && (
              <span class={style.builtInBadge}>Built-in</span>
            )}
          </div>
          <div class={style.presetCardActions}>
            <button
              class={`${style.applyButton} ${style.applyLeft}`}
              onClick={onApplyLeft}
              title="Apply to left side"
            >
              <span class={style.applyButtonText}>Left</span>
              <span class={style.applyButtonIcon}>◀</span>
            </button>
            <button
              class={`${style.applyButton} ${style.applyBoth}`}
              onClick={onApplyBoth}
              title="Apply to both sides"
            >
              <span class={style.applyButtonText}>Both</span>
              <span class={style.applyButtonIcon}>◀▶</span>
            </button>
            <button
              class={`${style.applyButton} ${style.applyRight}`}
              onClick={onApplyRight}
              title="Apply to right side"
            >
              <span class={style.applyButtonText}>Right</span>
              <span class={style.applyButtonIcon}>▶</span>
            </button>
            <div class={style.moreActions}>
              <button
                class={style.actionIconButton}
                onClick={onExport}
                title="Copy share link"
              >
                🔗
              </button>
              {!isBuiltIn && onEdit && (
                <button
                  class={style.actionIconButton}
                  onClick={onEdit}
                  title="Edit preset"
                >
                  ✏️
                </button>
              )}
              {!isBuiltIn && onDelete && (
                <button
                  class={style.actionIconButton}
                  onClick={onDelete}
                  title="Delete preset"
                >
                  🗑️
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
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
          timeout: 4000,
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
    const sideText = side === 'both' ? 'both sides' : side === 'left' ? 'left side' : 'right side';
    this.props.showSnack(`Applied "${preset.name}" to ${sideText}`, {
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
        editingPreset ? 'Preset updated successfully' : 'Preset saved successfully',
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
            <div class={style.headerContent}>
              <div class={style.headerIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                </svg>
              </div>
              <div>
                <h2 class={style.title}>Presets</h2>
                <p class={style.subtitle}>Quick settings for your images</p>
              </div>
            </div>
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
                    <div class={style.editHeader}>
                      <h3 class={style.editTitle}>
                        {editingPreset ? 'Edit Preset' : 'Create New Preset'}
                      </h3>
                      <p class={style.editSubtitle}>
                        Save your current settings as a preset
                      </p>
                    </div>
                    <div class={style.formGroup}>
                      <label class={style.formLabel}>Preset Name</label>
                      <input
                        type="text"
                        class={style.nameInput}
                        placeholder="e.g., Social Media Post"
                        value={newPresetName}
                        onInput={(e) =>
                          this.setState({ newPresetName: (e.target as HTMLInputElement).value })
                        }
                      />
                    </div>
                    {!editingPreset && (
                      <div class={style.formGroup}>
                        <label class={style.formLabel}>Use Settings From</label>
                        <div class={style.sideSelector}>
                          <label
                            class={`${style.optionCard} ${
                              saveSide === 'left' ? style.optionCardActive : ''
                            }`}
                          >
                            <input
                              type="radio"
                              name="saveSide"
                              value="left"
                              checked={saveSide === 'left'}
                              onChange={() => this.setState({ saveSide: 'left' })}
                              class={style.optionCardRadio}
                            />
                            <span class={style.optionCardIcon}>◀</span>
                            <span class={style.optionCardLabel}>Left Side</span>
                          </label>
                          <label
                            class={`${style.optionCard} ${
                              saveSide === 'right' ? style.optionCardActive : ''
                            }`}
                          >
                            <input
                              type="radio"
                              name="saveSide"
                              value="right"
                              checked={saveSide === 'right'}
                              onChange={() => this.setState({ saveSide: 'right' })}
                              class={style.optionCardRadio}
                            />
                            <span class={style.optionCardIcon}>▶</span>
                            <span class={style.optionCardLabel}>Right Side</span>
                          </label>
                        </div>
                      </div>
                    )}
                    <div class={style.editActions}>
                      <button class={style.cancelButton} onClick={this.handleCancelEdit}>
                        Cancel
                      </button>
                      <button class={style.saveButton} onClick={this.handleSavePreset}>
                        {editingPreset ? 'Update Preset' : 'Save Preset'}
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
                            <PresetCard
                              key={preset.id}
                              preset={preset}
                              summary={getPresetSummary(preset.data)}
                              isActive={activePresetId === preset.id}
                              isBuiltIn={true}
                              showConfirmDelete={false}
                              onApplyLeft={() => this.handleApplyPreset(preset, 'left')}
                              onApplyRight={() => this.handleApplyPreset(preset, 'right')}
                              onApplyBoth={() => this.handleApplyPreset(preset, 'both')}
                              onExport={() => this.handleExportPreset(preset)}
                            />
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
                        >
                          <SaveIcon />
                          <span>New Preset</span>
                        </button>
                      </div>
                      <div class={style.presetList}>
                        {customPresets.length === 0 ? (
                          <div class={style.emptyState}>
                            <div class={style.emptyStateIcon}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </div>
                            <p class={style.emptyStateTitle}>No custom presets yet</p>
                            <p class={style.emptyStateText}>
                              Click "New Preset" to save your current settings
                            </p>
                          </div>
                        ) : (
                          customPresets.map((preset) => (
                            <PresetCard
                              key={preset.id}
                              preset={preset}
                              summary={getPresetSummary(preset.data)}
                              isActive={activePresetId === preset.id}
                              isBuiltIn={false}
                              showConfirmDelete={showConfirmDelete === preset.id}
                              onApplyLeft={() => this.handleApplyPreset(preset, 'left')}
                              onApplyRight={() => this.handleApplyPreset(preset, 'right')}
                              onApplyBoth={() => this.handleApplyPreset(preset, 'both')}
                              onEdit={() => this.handleStartEdit(preset)}
                              onExport={() => this.handleExportPreset(preset)}
                              onDelete={() => this.setState({ showConfirmDelete: preset.id })}
                              onConfirmDelete={() => this.handleDeletePreset(preset.id)}
                              onCancelDelete={() => this.setState({ showConfirmDelete: null })}
                            />
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
