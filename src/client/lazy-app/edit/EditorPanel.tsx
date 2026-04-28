/**
 * Image Editor Panel Component
 * Provides crop, rotate, flip, and filter adjustments
 */
import { h, Component } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';

import * as style from './style.css';
import 'add-css:./style.css';

import {
  Options,
  CropState,
  RotateState,
  FlipState,
  FiltersState,
  CropRatio,
  cropRatios,
  defaultOptions,
  EditCommand,
} from 'features/preprocessors/edit/shared/meta';

import {
  UndoIcon,
  RedoIcon,
  RotateLeftIcon,
  RotateRightIcon,
  FlipHorizontalIcon,
  FlipVerticalIcon,
  CropIcon,
  FilterIcon,
  ApplyIcon,
  ResetIcon,
} from 'client/lazy-app/icons';

type EditorTab = 'transform' | 'crop' | 'filters';

interface EditorPanelProps {
  isOpen: boolean;
  options: Options;
  originalImage?: ImageData;
  canUndo: boolean;
  canRedo: boolean;
  onClose: () => void;
  onApply: () => void;
  onReset: () => void;
  onOptionsChange: (options: Partial<Options>) => void;
  onUndo: () => void;
  onRedo: () => void;
}

function EditorPanel({
  isOpen,
  options,
  originalImage,
  canUndo,
  canRedo,
  onClose,
  onApply,
  onReset,
  onOptionsChange,
  onUndo,
  onRedo,
}: EditorPanelProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>('transform');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenCanvasRef = useRef<OffscreenCanvas | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  const renderPreview = useCallback(async () => {
    if (!originalImage || !canvasRef.current) return;

    setIsRendering(true);

    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (!offscreenCanvasRef.current) {
        offscreenCanvasRef.current = new OffscreenCanvas(
          originalImage.width,
          originalImage.height
        );
      }

      const offscreenCtx = offscreenCanvasRef.current.getContext('2d');
      if (!offscreenCtx) return;

      offscreenCtx.clearRect(0, 0, originalImage.width, originalImage.height);
      offscreenCtx.putImageData(originalImage, 0, 0);

      let resultCanvas = offscreenCanvasRef.current;
      let resultCtx = offscreenCtx;

      if (options.rotate.rotate !== 0) {
        const angle = options.rotate.rotate;
        const isOddRotation = angle === 90 || angle === 270;
        const newWidth = isOddRotation ? originalImage.height : originalImage.width;
        const newHeight = isOddRotation ? originalImage.width : originalImage.height;

        const rotatedCanvas = new OffscreenCanvas(newWidth, newHeight);
        const rotatedCtx = rotatedCanvas.getContext('2d')!;

        rotatedCtx.save();
        rotatedCtx.translate(newWidth / 2, newHeight / 2);
        rotatedCtx.rotate((angle * Math.PI) / 180);
        rotatedCtx.drawImage(resultCanvas as any, -originalImage.width / 2, -originalImage.height / 2);
        rotatedCtx.restore();

        resultCanvas = rotatedCanvas;
        resultCtx = rotatedCtx;
      }

      if (options.flip.horizontal || options.flip.vertical) {
        const flippedCanvas = new OffscreenCanvas(resultCanvas.width, resultCanvas.height);
        const flippedCtx = flippedCanvas.getContext('2d')!;

        flippedCtx.save();
        let scaleX = 1;
        let scaleY = 1;
        let translateX = 0;
        let translateY = 0;

        if (options.flip.horizontal) {
          scaleX = -1;
          translateX = -resultCanvas.width;
        }
        if (options.flip.vertical) {
          scaleY = -1;
          translateY = -resultCanvas.height;
        }

        flippedCtx.translate(translateX, translateY);
        flippedCtx.scale(scaleX, scaleY);
        flippedCtx.drawImage(resultCanvas as any, 0, 0);
        flippedCtx.restore();

        resultCanvas = flippedCanvas;
        resultCtx = flippedCtx;
      }

      if (options.filters.enabled) {
        const { brightness, contrast, saturation, grayscale } = options.filters;
        
        if (brightness !== 0 || contrast !== 0 || saturation !== 0 || grayscale) {
          let filterString = '';

          if (brightness !== 0) {
            filterString += `brightness(${1 + brightness / 100}) `;
          }
          if (contrast !== 0) {
            filterString += `contrast(${1 + contrast / 100}) `;
          }
          if (saturation !== 0) {
            filterString += `saturate(${1 + saturation / 100}) `;
          }
          if (grayscale) {
            filterString += `grayscale(100%) `;
          }

          if (filterString) {
            resultCtx.filter = filterString.trim();
            const tempCanvas = new OffscreenCanvas(resultCanvas.width, resultCanvas.height);
            const tempCtx = tempCanvas.getContext('2d')!;
            tempCtx.drawImage(resultCanvas as any, 0, 0);
            
            resultCanvas = tempCanvas;
            resultCtx = tempCtx;
          }
        }
      }

      if (options.crop.enabled && options.crop.width > 0 && options.crop.height > 0) {
        const { x, y, width, height } = options.crop;
        const clampedX = Math.max(0, Math.min(x, resultCanvas.width - 1));
        const clampedY = Math.max(0, Math.min(y, resultCanvas.height - 1));
        const clampedWidth = Math.max(1, Math.min(width, resultCanvas.width - clampedX));
        const clampedHeight = Math.max(1, Math.min(height, resultCanvas.height - clampedY));

        const croppedCanvas = new OffscreenCanvas(clampedWidth, clampedHeight);
        const croppedCtx = croppedCanvas.getContext('2d')!;

        croppedCtx.drawImage(
          resultCanvas as any,
          clampedX,
          clampedY,
          clampedWidth,
          clampedHeight,
          0,
          0,
          clampedWidth,
          clampedHeight
        );

        resultCanvas = croppedCanvas;
      }

      const maxSize = Math.max(window.innerWidth * 0.8, window.innerHeight * 0.6);
      const scale = Math.min(1, maxSize / Math.max(resultCanvas.width, resultCanvas.height));
      const displayWidth = Math.floor(resultCanvas.width * scale);
      const displayHeight = Math.floor(resultCanvas.height * scale);

      canvas.width = displayWidth;
      canvas.height = displayHeight;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, displayWidth, displayHeight);
      ctx.drawImage(resultCanvas as any, 0, 0, displayWidth, displayHeight);
    } catch (err) {
      console.error('Error rendering preview:', err);
    } finally {
      setIsRendering(false);
    }
  }, [originalImage, options]);

  useEffect(() => {
    if (isOpen && originalImage) {
      renderPreview();
    }
  }, [isOpen, originalImage, renderPreview]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      const isMac = navigator.platform.toLowerCase().includes('mac');
      const modifierKey = isMac ? e.metaKey : e.ctrlKey;

      if (modifierKey && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        onUndo();
      }

      if (modifierKey && ((e.key === 'z' && e.shiftKey) || e.key === 'y')) {
        e.preventDefault();
        onRedo();
      }

      if (e.key === 'Escape') {
        onClose();
      }

      if (modifierKey && e.key === 'Enter') {
        e.preventDefault();
        onApply();
      }

      if (e.key === 'r' && modifierKey) {
        e.preventDefault();
        onReset();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onUndo, onRedo, onClose, onApply, onReset]);

  const handleRotateLeft = () => {
    const newRotate = ((options.rotate.rotate - 90 + 360) % 360) as RotateState['rotate'];
    onOptionsChange({
      rotate: { rotate: newRotate },
    });
  };

  const handleRotateRight = () => {
    const newRotate = ((options.rotate.rotate + 90) % 360) as RotateState['rotate'];
    onOptionsChange({
      rotate: { rotate: newRotate },
    });
  };

  const handleFlipHorizontal = () => {
    onOptionsChange({
      flip: {
        ...options.flip,
        horizontal: !options.flip.horizontal,
      },
    });
  };

  const handleFlipVertical = () => {
    onOptionsChange({
      flip: {
        ...options.flip,
        vertical: !options.flip.vertical,
      },
    });
  };

  const handleCropRatioChange = (ratio: CropRatio) => {
    onOptionsChange({
      crop: {
        ...options.crop,
        ratio,
      },
    });
  };

  const handleToggleCrop = () => {
    onOptionsChange({
      crop: {
        ...options.crop,
        enabled: !options.crop.enabled,
        x: 0,
        y: 0,
        width: originalImage?.width || 0,
        height: originalImage?.height || 0,
      },
    });
  };

  const handleFilterChange = (key: keyof Omit<FiltersState, 'enabled'>, value: number | boolean) => {
    onOptionsChange({
      filters: {
        ...options.filters,
        [key]: value,
      },
    });
  };

  const handleToggleFilters = () => {
    onOptionsChange({
      filters: {
        ...options.filters,
        enabled: !options.filters.enabled,
      },
    });
  };

  if (!isOpen) return null;

  return (
    <div class={style.editorOverlay}>
      <div class={style.editorHeader}>
        <h2 class={style.editorTitle}>Edit Image</h2>
        <div class={style.editorHeaderButtons}>
          <div class={style.undoRedoButtons}>
            <button
              class={style.undoButton}
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo (Ctrl+Z)"
            >
              <UndoIcon />
              Undo
            </button>
            <button
              class={style.redoButton}
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo (Ctrl+Shift+Z)"
            >
              <RedoIcon />
              Redo
            </button>
          </div>
        </div>
      </div>

      <div class={style.editorBody}>
        <div class={style.editorPreview}>
          {originalImage ? (
            <canvas
              ref={canvasRef}
              class={style.previewCanvas}
              style={{
                opacity: isRendering ? 0.5 : 1,
                transition: 'opacity 150ms ease',
              }}
            />
          ) : (
            <div style={{ color: '#666' }}>No image loaded</div>
          )}
        </div>

        <div class={style.editorSidebar}>
          <div class={style.sidebarTabs}>
            <button
              class={`${style.tabButton} ${activeTab === 'transform' ? style.active : ''}`}
              onClick={() => setActiveTab('transform')}
            >
              <RotateRightIcon />
              Transform
            </button>
            <button
              class={`${style.tabButton} ${activeTab === 'crop' ? style.active : ''}`}
              onClick={() => setActiveTab('crop')}
            >
              <CropIcon />
              Crop
            </button>
            <button
              class={`${style.tabButton} ${activeTab === 'filters' ? style.active : ''}`}
              onClick={() => setActiveTab('filters')}
            >
              <FilterIcon />
              Filters
            </button>
          </div>

          <div class={style.sidebarContent}>
            {activeTab === 'transform' && (
              <div class={style.slideUp}>
                <h3 class={style.sectionTitle}>Rotation</h3>
                <div class={style.buttonGroup}>
                  <button
                    class={style.rotateButton}
                    onClick={handleRotateLeft}
                    title="Rotate 90° Counter-clockwise"
                  >
                    <RotateLeftIcon />
                    Left
                  </button>
                  <button
                    class={style.rotateButton}
                    onClick={handleRotateRight}
                    title="Rotate 90° Clockwise"
                  >
                    <RotateRightIcon />
                    Right
                  </button>
                </div>

                <h3 class={style.sectionTitle}>Flip</h3>
                <div class={style.buttonGroup}>
                  <button
                    class={`${style.flipButton} ${options.flip.horizontal ? style.active : ''}`}
                    onClick={handleFlipHorizontal}
                    title="Flip Horizontal"
                  >
                    <FlipHorizontalIcon />
                    Horizontal
                  </button>
                  <button
                    class={`${style.flipButton} ${options.flip.vertical ? style.active : ''}`}
                    onClick={handleFlipVertical}
                    title="Flip Vertical"
                  >
                    <FlipVerticalIcon />
                    Vertical
                  </button>
                </div>

                <div style={{ marginTop: '20px', padding: '12px', background: 'var(--off-black)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '8px' }}>
                    Current State
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#999', lineHeight: '1.6' }}>
                    <div>Rotation: {options.rotate.rotate}°</div>
                    <div>Flip H: {options.flip.horizontal ? 'Yes' : 'No'}</div>
                    <div>Flip V: {options.flip.vertical ? 'Yes' : 'No'}</div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'crop' && (
              <div class={`${style.cropSection} ${style.slideUp}`}>
                <div class={style.toggleControl}>
                  <span class={style.toggleLabel}>
                    <CropIcon style={{ width: '18px', height: '18px', marginRight: '8px', display: 'inline-block', verticalAlign: 'middle' }} />
                    Enable Crop
                  </span>
                  <div
                    class={`${style.toggleSwitch} ${options.crop.enabled ? style.active : ''}`}
                    onClick={handleToggleCrop}
                  >
                    <div class={style.toggleThumb} />
                  </div>
                </div>

                {options.crop.enabled && (
                  <div style={{ marginTop: '16px' }}>
                    <h3 class={style.sectionTitle}>Aspect Ratio</h3>
                    <div class={style.cropRatioButtons}>
                      {cropRatios.map((ratio) => (
                        <button
                          key={ratio.value}
                          class={`${style.cropRatioButton} ${
                            options.crop.ratio === ratio.value ? style.active : ''
                          }`}
                          onClick={() => handleCropRatioChange(ratio.value)}
                        >
                          {ratio.label}
                        </button>
                      ))}
                    </div>

                    <div class={style.cropInfo}>
                      Note: Crop is applied after rotation and flip. For precise control, 
                      apply transformations first, then adjust crop.
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'filters' && (
              <div class={style.slideUp}>
                <div class={style.filterSection}>
                  <div class={style.filterToggle}>
                    <span class={style.filterLabel}>
                      <FilterIcon />
                      Adjustments
                    </span>
                    <div
                      class={`${style.toggleSwitch} ${options.filters.enabled ? style.active : ''}`}
                      onClick={handleToggleFilters}
                    >
                      <div class={style.toggleThumb} />
                    </div>
                  </div>

                  {options.filters.enabled && (
                    <div style={{ marginTop: '16px' }}>
                      <div class={style.rangeControl}>
                        <div class={style.rangeLabel}>
                          <span>Brightness</span>
                          <span class={style.rangeValue}>{options.filters.brightness}</span>
                        </div>
                        <input
                          type="range"
                          class={style.rangeInput}
                          min="-100"
                          max="100"
                          value={options.filters.brightness}
                          onInput={(e) =>
                            handleFilterChange('brightness', parseInt((e.target as HTMLInputElement).value))
                          }
                        />
                      </div>

                      <div class={style.rangeControl}>
                        <div class={style.rangeLabel}>
                          <span>Contrast</span>
                          <span class={style.rangeValue}>{options.filters.contrast}</span>
                        </div>
                        <input
                          type="range"
                          class={style.rangeInput}
                          min="-100"
                          max="100"
                          value={options.filters.contrast}
                          onInput={(e) =>
                            handleFilterChange('contrast', parseInt((e.target as HTMLInputElement).value))
                          }
                        />
                      </div>

                      <div class={style.rangeControl}>
                        <div class={style.rangeLabel}>
                          <span>Saturation</span>
                          <span class={style.rangeValue}>{options.filters.saturation}</span>
                        </div>
                        <input
                          type="range"
                          class={style.rangeInput}
                          min="-100"
                          max="100"
                          value={options.filters.saturation}
                          onInput={(e) =>
                            handleFilterChange('saturation', parseInt((e.target as HTMLInputElement).value))
                          }
                        />
                      </div>

                      <div class={style.toggleControl}>
                        <span class={style.toggleLabel}>Grayscale</span>
                        <div
                          class={`${style.toggleSwitch} ${options.filters.grayscale ? style.active : ''}`}
                          onClick={() => handleFilterChange('grayscale', !options.filters.grayscale)}
                        >
                          <div class={style.toggleThumb} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ marginTop: '16px', padding: '12px', background: 'var(--off-black)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '8px' }}>
                    Keyboard Shortcuts
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#999', lineHeight: '1.8' }}>
                    <div><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>Ctrl</kbd> + <kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>Z</kbd>: Undo</div>
                    <div><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>Ctrl</kbd> + <kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>Shift</kbd> + <kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>Z</kbd>: Redo</div>
                    <div><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>Ctrl</kbd> + <kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>Enter</kbd>: Apply</div>
                    <div><kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '3px', fontFamily: 'monospace' }}>Esc</kbd>: Close</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div class={style.editorFooter}>
            <button class={style.closeButton} onClick={onClose}>
              Cancel
            </button>
            <button class={style.resetButton} onClick={onReset}>
              <ResetIcon style={{ width: '16px', height: '16px' }} />
              Reset
            </button>
            <button class={style.applyButton} onClick={onApply}>
              <ApplyIcon style={{ width: '16px', height: '16px' }} />
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditorPanel;
