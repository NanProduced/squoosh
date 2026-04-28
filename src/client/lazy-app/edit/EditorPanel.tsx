/**
 * Image Editor Panel Component
 * Provides crop, rotate, flip, and filter adjustments
 */
import { h } from 'preact';
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
type CropHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move' | null;

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

interface CanvasBuffer {
  canvas: OffscreenCanvas;
  ctx: OffscreenCanvasRenderingContext2D;
}

function getOrCreateBuffer(
  ref: { current: CanvasBuffer | null },
  width: number,
  height: number
): CanvasBuffer {
  if (!ref.current || ref.current.canvas.width < width || ref.current.canvas.height < height) {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ref.current = { canvas, ctx };
  }
  ref.current.canvas.width = width;
  ref.current.canvas.height = height;
  return ref.current;
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
  const bufferARef = useRef<CanvasBuffer | null>(null);
  const bufferBRef = useRef<CanvasBuffer | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  
  const [displayScale, setDisplayScale] = useState(1);
  const [displayOffsetX, setDisplayOffsetX] = useState(0);
  const [displayOffsetY, setDisplayOffsetY] = useState(0);
  
  const [isDragging, setIsDragging] = useState(false);
  const [dragHandle, setDragHandle] = useState<CropHandle>(null);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartY, setDragStartY] = useState(0);
  const [dragStartCrop, setDragStartCrop] = useState<CropState | null>(null);

  const getTransformedDimensions = useCallback(() => {
    if (!originalImage) return { width: 0, height: 0 };
    const isOddRotation = options.rotate.rotate === 90 || options.rotate.rotate === 270;
    return {
      width: isOddRotation ? originalImage.height : originalImage.width,
      height: isOddRotation ? originalImage.width : originalImage.height,
    };
  }, [originalImage, options.rotate.rotate]);

  const imageToDisplay = useCallback((imgX: number, imgY: number) => {
    return {
      x: displayOffsetX + imgX * displayScale,
      y: displayOffsetY + imgY * displayScale,
    };
  }, [displayOffsetX, displayOffsetY, displayScale]);

  const displayToImage = useCallback((dispX: number, dispY: number) => {
    return {
      x: Math.round((dispX - displayOffsetX) / displayScale),
      y: Math.round((dispY - displayOffsetY) / displayScale),
    };
  }, [displayOffsetX, displayOffsetY, displayScale]);

  const renderPreview = useCallback(async () => {
    if (!originalImage || !canvasRef.current) return;

    setIsRendering(true);

    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dims = getTransformedDimensions();
      const maxSize = Math.max(window.innerWidth * 0.8, window.innerHeight * 0.6);
      const newDisplayScale = Math.min(1, maxSize / Math.max(dims.width, dims.height));
      const displayWidth = Math.floor(dims.width * newDisplayScale);
      const displayHeight = Math.floor(dims.height * newDisplayScale);

      setDisplayScale(newDisplayScale);
      setDisplayOffsetX((canvas.width - displayWidth) / 2);
      setDisplayOffsetY((canvas.height - displayHeight) / 2);

      const bufferA = getOrCreateBuffer(bufferARef, originalImage.width, originalImage.height);
      const bufferB = getOrCreateBuffer(bufferBRef, dims.width, dims.height);
      
      bufferA.ctx.clearRect(0, 0, originalImage.width, originalImage.height);
      bufferA.ctx.putImageData(originalImage, 0, 0);

      let sourceCanvas = bufferA.canvas;
      let sourceCtx = bufferA.ctx;
      let resultCanvas: OffscreenCanvas = bufferB.canvas;
      let resultCtx: OffscreenCanvasRenderingContext2D = bufferB.ctx;

      if (options.rotate.rotate !== 0) {
        const angle = options.rotate.rotate;
        const newWidth = dims.width;
        const newHeight = dims.height;

        resultCtx.clearRect(0, 0, newWidth, newHeight);
        resultCtx.save();
        resultCtx.translate(newWidth / 2, newHeight / 2);
        resultCtx.rotate((angle * Math.PI) / 180);
        resultCtx.drawImage(sourceCanvas as any, -originalImage.width / 2, -originalImage.height / 2);
        resultCtx.restore();

        [sourceCanvas, resultCanvas] = [resultCanvas, sourceCanvas];
        [sourceCtx, resultCtx] = [resultCtx, sourceCtx];
      }

      if (options.flip.horizontal || options.flip.vertical) {
        resultCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
        resultCtx.save();

        if (options.flip.horizontal && options.flip.vertical) {
          resultCtx.translate(sourceCanvas.width, sourceCanvas.height);
          resultCtx.scale(-1, -1);
        } else if (options.flip.horizontal) {
          resultCtx.translate(sourceCanvas.width, 0);
          resultCtx.scale(-1, 1);
        } else if (options.flip.vertical) {
          resultCtx.translate(0, sourceCanvas.height);
          resultCtx.scale(1, -1);
        }

        resultCtx.drawImage(sourceCanvas as any, 0, 0);
        resultCtx.restore();

        [sourceCanvas, resultCanvas] = [resultCanvas, sourceCanvas];
        [sourceCtx, resultCtx] = [resultCtx, sourceCtx];
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
            resultCtx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
            resultCtx.filter = filterString.trim();
            resultCtx.drawImage(sourceCanvas as any, 0, 0);
            resultCtx.filter = 'none';

            [sourceCanvas, resultCanvas] = [resultCanvas, sourceCanvas];
            [sourceCtx, resultCtx] = [resultCtx, sourceCtx];
          }
        }
      }

      canvas.width = displayWidth + 40;
      canvas.height = displayHeight + 40;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const drawOffsetX = (canvas.width - displayWidth) / 2;
      const drawOffsetY = (canvas.height - displayHeight) / 2;
      
      setDisplayOffsetX(drawOffsetX);
      setDisplayOffsetY(drawOffsetY);

      if (options.crop.enabled && options.crop.width > 0 && options.crop.height > 0) {
        const { x, y, width, height } = options.crop;
        const clampedX = Math.max(0, Math.min(x, sourceCanvas.width - 1));
        const clampedY = Math.max(0, Math.min(y, sourceCanvas.height - 1));
        const clampedWidth = Math.max(1, Math.min(width, sourceCanvas.width - clampedX));
        const clampedHeight = Math.max(1, Math.min(height, sourceCanvas.height - clampedY));

        const tempCanvas = new OffscreenCanvas(clampedWidth, clampedHeight);
        const tempCtx = tempCanvas.getContext('2d')!;
        
        tempCtx.drawImage(
          sourceCanvas as any,
          clampedX,
          clampedY,
          clampedWidth,
          clampedHeight,
          0,
          0,
          clampedWidth,
          clampedHeight
        );

        const croppedDisplayWidth = Math.floor(clampedWidth * newDisplayScale);
        const croppedDisplayHeight = Math.floor(clampedHeight * newDisplayScale);
        const croppedOffsetX = (canvas.width - croppedDisplayWidth) / 2;
        const croppedOffsetY = (canvas.height - croppedDisplayHeight) / 2;

        ctx.drawImage(tempCanvas as any, croppedOffsetX, croppedOffsetY, croppedDisplayWidth, croppedDisplayHeight);
      } else {
        ctx.drawImage(sourceCanvas as any, drawOffsetX, drawOffsetY, displayWidth, displayHeight);

        if (options.crop.enabled && activeTab === 'crop') {
          const dims = getTransformedDimensions();
          const crop = options.crop;
          
          let cropX = crop.x;
          let cropY = crop.y;
          let cropW = crop.width > 0 ? crop.width : dims.width;
          let cropH = crop.height > 0 ? crop.height : dims.height;

          if (cropW === 0 || cropH === 0) {
            cropX = 0;
            cropY = 0;
            cropW = dims.width;
            cropH = dims.height;
          }

          const topLeft = imageToDisplay(cropX, cropY);
          const bottomRight = imageToDisplay(cropX + cropW, cropY + cropH);
          const rectW = bottomRight.x - topLeft.x;
          const rectH = bottomRight.y - topLeft.y;

          ctx.save();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 2;
          ctx.strokeRect(topLeft.x, topLeft.y, rectW, rectH);

          ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
          ctx.fillRect(drawOffsetX, drawOffsetY, displayWidth, topLeft.y - drawOffsetY);
          ctx.fillRect(drawOffsetX, bottomRight.y, displayWidth, drawOffsetY + displayHeight - bottomRight.y);
          ctx.fillRect(drawOffsetX, topLeft.y, topLeft.x - drawOffsetX, rectH);
          ctx.fillRect(bottomRight.x, topLeft.y, drawOffsetX + displayWidth - bottomRight.x, rectH);

          const handleSize = 10;
          const handlePositions = [
            { x: topLeft.x, y: topLeft.y, handle: 'nw' as CropHandle },
            { x: topLeft.x + rectW / 2, y: topLeft.y, handle: 'n' as CropHandle },
            { x: bottomRight.x, y: topLeft.y, handle: 'ne' as CropHandle },
            { x: bottomRight.x, y: topLeft.y + rectH / 2, handle: 'e' as CropHandle },
            { x: bottomRight.x, y: bottomRight.y, handle: 'se' as CropHandle },
            { x: topLeft.x + rectW / 2, y: bottomRight.y, handle: 's' as CropHandle },
            { x: topLeft.x, y: bottomRight.y, handle: 'sw' as CropHandle },
            { x: topLeft.x, y: topLeft.y + rectH / 2, handle: 'w' as CropHandle },
          ];

          ctx.fillStyle = '#fff';
          ctx.strokeStyle = '#333';
          ctx.lineWidth = 1;

          for (const pos of handlePositions) {
            ctx.fillRect(
              pos.x - handleSize / 2,
              pos.y - handleSize / 2,
              handleSize,
              handleSize
            );
            ctx.strokeRect(
              pos.x - handleSize / 2,
              pos.y - handleSize / 2,
              handleSize,
              handleSize
            );
          }

          ctx.restore();
        }
      }
    } catch (err) {
      console.error('Error rendering preview:', err);
    } finally {
      setIsRendering(false);
    }
  }, [originalImage, options, activeTab, getTransformedDimensions, imageToDisplay]);

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if (!canvasRef.current || !options.crop.enabled || activeTab !== 'crop') return;

    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const dims = getTransformedDimensions();
    const crop = options.crop;
    
    let cropX = crop.x;
    let cropY = crop.y;
    let cropW = crop.width > 0 ? crop.width : dims.width;
    let cropH = crop.height > 0 ? crop.height : dims.height;

    if (cropW === 0 || cropH === 0) {
      cropX = 0;
      cropY = 0;
      cropW = dims.width;
      cropH = dims.height;
    }

    const topLeft = imageToDisplay(cropX, cropY);
    const bottomRight = imageToDisplay(cropX + cropW, cropY + cropH);
    const handleSize = 15;

    const handleAreas = [
      { x: topLeft.x, y: topLeft.y, handle: 'nw' as CropHandle },
      { x: topLeft.x + (bottomRight.x - topLeft.x) / 2, y: topLeft.y, handle: 'n' as CropHandle },
      { x: bottomRight.x, y: topLeft.y, handle: 'ne' as CropHandle },
      { x: bottomRight.x, y: topLeft.y + (bottomRight.y - topLeft.y) / 2, handle: 'e' as CropHandle },
      { x: bottomRight.x, y: bottomRight.y, handle: 'se' as CropHandle },
      { x: topLeft.x + (bottomRight.x - topLeft.x) / 2, y: bottomRight.y, handle: 's' as CropHandle },
      { x: topLeft.x, y: bottomRight.y, handle: 'sw' as CropHandle },
      { x: topLeft.x, y: topLeft.y + (bottomRight.y - topLeft.y) / 2, handle: 'w' as CropHandle },
    ];

    for (const area of handleAreas) {
      if (
        mouseX >= area.x - handleSize &&
        mouseX <= area.x + handleSize &&
        mouseY >= area.y - handleSize &&
        mouseY <= area.y + handleSize
      ) {
        setIsDragging(true);
        setDragHandle(area.handle);
        setDragStartX(mouseX);
        setDragStartY(mouseY);
        setDragStartCrop({ ...crop, x: cropX, y: cropY, width: cropW, height: cropH });
        return;
      }
    }

    if (
      mouseX >= topLeft.x &&
      mouseX <= bottomRight.x &&
      mouseY >= topLeft.y &&
      mouseY <= bottomRight.y
    ) {
      setIsDragging(true);
      setDragHandle('move');
      setDragStartX(mouseX);
      setDragStartY(mouseY);
      setDragStartCrop({ ...crop, x: cropX, y: cropY, width: cropW, height: cropH });
    }
  }, [options.crop, activeTab, getTransformedDimensions, imageToDisplay]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !dragHandle || !dragStartCrop || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const deltaX = (mouseX - dragStartX) / displayScale;
    const deltaY = (mouseY - dragStartY) / displayScale;

    const dims = getTransformedDimensions();
    const imgWidth = dims.width;
    const imgHeight = dims.height;

    let newX = dragStartCrop.x;
    let newY = dragStartCrop.y;
    let newW = dragStartCrop.width;
    let newH = dragStartCrop.height;

    switch (dragHandle) {
      case 'move':
        newX = Math.max(0, Math.min(imgWidth - newW, dragStartCrop.x + deltaX));
        newY = Math.max(0, Math.min(imgHeight - newH, dragStartCrop.y + deltaY));
        break;
      case 'nw':
        newX = Math.max(0, dragStartCrop.x + deltaX);
        newY = Math.max(0, dragStartCrop.y + deltaY);
        newW = Math.max(50, dragStartCrop.width - deltaX);
        newH = Math.max(50, dragStartCrop.height - deltaY);
        break;
      case 'n':
        newY = Math.max(0, dragStartCrop.y + deltaY);
        newH = Math.max(50, dragStartCrop.height - deltaY);
        break;
      case 'ne':
        newY = Math.max(0, dragStartCrop.y + deltaY);
        newW = Math.max(50, Math.min(imgWidth - dragStartCrop.x, dragStartCrop.width + deltaX));
        newH = Math.max(50, dragStartCrop.height - deltaY);
        break;
      case 'e':
        newW = Math.max(50, Math.min(imgWidth - dragStartCrop.x, dragStartCrop.width + deltaX));
        break;
      case 'se':
        newW = Math.max(50, Math.min(imgWidth - dragStartCrop.x, dragStartCrop.width + deltaX));
        newH = Math.max(50, Math.min(imgHeight - dragStartCrop.y, dragStartCrop.height + deltaY));
        break;
      case 's':
        newH = Math.max(50, Math.min(imgHeight - dragStartCrop.y, dragStartCrop.height + deltaY));
        break;
      case 'sw':
        newX = Math.max(0, dragStartCrop.x + deltaX);
        newW = Math.max(50, dragStartCrop.width - deltaX);
        newH = Math.max(50, Math.min(imgHeight - dragStartCrop.y, dragStartCrop.height + deltaY));
        break;
      case 'w':
        newX = Math.max(0, dragStartCrop.x + deltaX);
        newW = Math.max(50, dragStartCrop.width - deltaX);
        break;
    }

    if (options.crop.ratio !== 'free') {
      const ratioInfo = cropRatios.find(r => r.value === options.crop.ratio);
      if (ratioInfo && ratioInfo.width && ratioInfo.height) {
        const targetRatio = ratioInfo.width / ratioInfo.height;
        if (dragHandle === 'move' || dragHandle === 'n' || dragHandle === 's') {
          newW = Math.round(newH * targetRatio);
        } else {
          newH = Math.round(newW / targetRatio);
        }
        newX = Math.max(0, Math.min(imgWidth - newW, newX));
        newY = Math.max(0, Math.min(imgHeight - newH, newY));
      }
    }

    onOptionsChange({
      crop: {
        ...options.crop,
        x: Math.round(newX),
        y: Math.round(newY),
        width: Math.round(newW),
        height: Math.round(newH),
      },
    });
  }, [isDragging, dragHandle, dragStartX, dragStartY, dragStartCrop, displayScale, getTransformedDimensions, options.crop, onOptionsChange]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    setDragHandle(null);
    setDragStartCrop(null);
  }, []);

  useEffect(() => {
    if (isOpen && originalImage) {
      renderPreview();
    }
  }, [isOpen, originalImage, renderPreview]);

  useEffect(() => {
    if (!isOpen) return;

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isOpen, handleMouseMove, handleMouseUp]);

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
    if (!originalImage) {
      onOptionsChange({
        crop: {
          ...options.crop,
          ratio,
        },
      });
      return;
    }

    const isOddRotation = options.rotate.rotate === 90 || options.rotate.rotate === 270;
    const imageWidth = isOddRotation ? originalImage.height : originalImage.width;
    const imageHeight = isOddRotation ? originalImage.width : originalImage.height;

    const ratioInfo = cropRatios.find(r => r.value === ratio);
    
    if (ratio === 'free' || !ratioInfo || !ratioInfo.width || !ratioInfo.height) {
      onOptionsChange({
        crop: {
          ...options.crop,
          ratio,
        },
      });
      return;
    }

    const targetRatio = ratioInfo.width / ratioInfo.height;
    const currentRatio = imageWidth / imageHeight;

    let newWidth: number;
    let newHeight: number;

    if (currentRatio > targetRatio) {
      newHeight = imageHeight;
      newWidth = Math.round(imageHeight * targetRatio);
    } else {
      newWidth = imageWidth;
      newHeight = Math.round(imageWidth / targetRatio);
    }

    const newX = Math.round((imageWidth - newWidth) / 2);
    const newY = Math.round((imageHeight - newHeight) / 2);

    onOptionsChange({
      crop: {
        ...options.crop,
        ratio,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
      },
    });
  };

  const handleToggleCrop = () => {
    const dims = getTransformedDimensions();
    onOptionsChange({
      crop: {
        ...options.crop,
        enabled: !options.crop.enabled,
        x: 0,
        y: 0,
        width: dims.width || originalImage?.width || 0,
        height: dims.height || originalImage?.height || 0,
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
                cursor: options.crop.enabled && activeTab === 'crop' ? 'crosshair' : 'default',
              }}
              onMouseDown={handleMouseDown}
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
                      Drag the crop box or handles to adjust. Use aspect ratio buttons for
                      fixed proportions.
                    </div>

                    {options.crop.width > 0 && (
                      <div style={{ marginTop: '16px', padding: '12px', background: 'var(--off-black)', borderRadius: '8px' }}>
                        <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: '8px' }}>
                          Crop Dimensions
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#999', lineHeight: '1.6' }}>
                          <div>Position: ({options.crop.x}, {options.crop.y})</div>
                          <div>Size: {options.crop.width} × {options.crop.height}</div>
                          <div>Ratio: {options.crop.ratio}</div>
                        </div>
                      </div>
                    )}
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
