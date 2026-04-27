import PointerTracker, { Pointer } from 'pointer-tracker';
import * as styles from './styles.css';
import 'add-css:./styles.css';

const legacyClipCompatAttr = 'legacy-clip-compat';

/**
 * A 4-quadrant split view that the user can adjust with crosshairs.
 * Quadrants:
 *   0: top-left (MozJPEG)
 *   1: top-right (WebP)
 *   2: bottom-left (AVIF)
 *   3: bottom-right (JXL)
 */
export default class FourUp extends HTMLElement {
  private readonly _horizontalHandle = document.createElement('div');
  private readonly _verticalHandle = document.createElement('div');
  private readonly _centerHandle = document.createElement('div');

  private _horizontalPosition = 0;
  private _verticalPosition = 0;
  private _horizontalRelativePosition = 0.5;
  private _verticalRelativePosition = 0.5;

  private _horizontalPositionOnPointerStart = 0;
  private _verticalPositionOnPointerStart = 0;

  private _everConnected = false;
  private _resizeObserver?: ResizeObserver;
  private _activeHandle?: 'horizontal' | 'vertical' | 'center';
  private _mutationObserver?: MutationObserver;
  private _isUpdatingHandles = false;

  constructor() {
    super();
    this._horizontalHandle.className = styles.fourUpHorizontalHandle;
    this._verticalHandle.className = styles.fourUpVerticalHandle;
    this._centerHandle.className = styles.fourUpCenterHandle;

    this._mutationObserver = new MutationObserver(() => this._childrenChange());
    this._mutationObserver.observe(this, { childList: true });

    this._setupPointerTracking();
  }

  private _setupPointerTracking() {
    const horizontalTracker = new PointerTracker(this._horizontalHandle, {
      start: (_, event) => {
        if (this._getActivePointerCount() > 0) return false;
        event.preventDefault();
        this._horizontalPositionOnPointerStart = this._horizontalPosition;
        this._activeHandle = 'horizontal';
        return true;
      },
      move: (startPointers, currentPointers) => {
        this._horizontalPointerChange(
          startPointers[0],
          currentPointers[0],
        );
      },
      end: () => {
        this._activeHandle = undefined;
      },
    });

    const verticalTracker = new PointerTracker(this._verticalHandle, {
      start: (_, event) => {
        if (this._getActivePointerCount() > 0) return false;
        event.preventDefault();
        this._verticalPositionOnPointerStart = this._verticalPosition;
        this._activeHandle = 'vertical';
        return true;
      },
      move: (startPointers, currentPointers) => {
        this._verticalPointerChange(
          startPointers[0],
          currentPointers[0],
        );
      },
      end: () => {
        this._activeHandle = undefined;
      },
    });

    const centerTracker = new PointerTracker(this._centerHandle, {
      start: (_, event) => {
        if (this._getActivePointerCount() > 0) return false;
        event.preventDefault();
        this._horizontalPositionOnPointerStart = this._horizontalPosition;
        this._verticalPositionOnPointerStart = this._verticalPosition;
        this._activeHandle = 'center';
        return true;
      },
      move: (startPointers, currentPointers) => {
        this._centerPointerChange(
          startPointers[0],
          currentPointers[0],
        );
      },
      end: () => {
        this._activeHandle = undefined;
      },
    });
  }

  private _getActivePointerCount(): number {
    return this._activeHandle ? 1 : 0;
  }

  connectedCallback() {
    this._childrenChange();

    this._centerHandle.innerHTML = `
      <div class="${styles.scrubber}">
        <svg viewBox="0 0 40 40">
          <path class="${styles.arrowTop}" d="M20 0 L10 12 L30 12 Z"/>
          <path class="${styles.arrowBottom}" d="M20 40 L10 28 L30 28 Z"/>
          <path class="${styles.arrowLeft}" d="M0 20 L12 10 L12 30 Z"/>
          <path class="${styles.arrowRight}" d="M40 20 L28 10 L28 30 Z"/>
          <circle cx="20" cy="20" r="6" fill="currentColor"/>
        </svg>
      </div>
    `;

    this._resizeObserver = new ResizeObserver(() => this._resetPositions());
    this._resizeObserver.observe(this);

    window.addEventListener('keydown', this._onKeyDown);

    if (!this._everConnected) {
      this._resetPositions();
      this._everConnected = true;
    }
  }

  disconnectedCallback() {
    window.removeEventListener('keydown', this._onKeyDown);
    if (this._resizeObserver) this._resizeObserver.disconnect();
  }

  private _onKeyDown = (event: KeyboardEvent) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest('input')) return;

    const bounds = this.getBoundingClientRect();
    const step = 20;

    if (event.code === 'ArrowLeft' && !event.shiftKey) {
      this._verticalPosition = Math.max(0, this._verticalPosition - step);
      this._verticalRelativePosition = this._verticalPosition / bounds.width;
      this._setPositions();
    } else if (event.code === 'ArrowRight' && !event.shiftKey) {
      this._verticalPosition = Math.min(bounds.width, this._verticalPosition + step);
      this._verticalRelativePosition = this._verticalPosition / bounds.width;
      this._setPositions();
    } else if (event.code === 'ArrowUp' && !event.shiftKey) {
      this._horizontalPosition = Math.max(0, this._horizontalPosition - step);
      this._horizontalRelativePosition = this._horizontalPosition / bounds.height;
      this._setPositions();
    } else if (event.code === 'ArrowDown' && !event.shiftKey) {
      this._horizontalPosition = Math.min(bounds.height, this._horizontalPosition + step);
      this._horizontalRelativePosition = this._horizontalPosition / bounds.height;
      this._setPositions();
    } else if (event.code === 'Digit1' || event.code === 'Numpad1') {
      this._horizontalPosition = 0;
      this._verticalPosition = 0;
      this._horizontalRelativePosition = 0;
      this._verticalRelativePosition = 0;
      this._setPositions();
    } else if (event.code === 'Digit2' || event.code === 'Numpad2') {
      this._horizontalPosition = 0;
      this._verticalPosition = bounds.width;
      this._horizontalRelativePosition = 0;
      this._verticalRelativePosition = 1;
      this._setPositions();
    } else if (event.code === 'Digit3' || event.code === 'Numpad3') {
      this._horizontalPosition = bounds.height;
      this._verticalPosition = 0;
      this._horizontalRelativePosition = 1;
      this._verticalRelativePosition = 0;
      this._setPositions();
    } else if (event.code === 'Digit4' || event.code === 'Numpad4') {
      this._horizontalPosition = bounds.height;
      this._verticalPosition = bounds.width;
      this._horizontalRelativePosition = 1;
      this._verticalRelativePosition = 1;
      this._setPositions();
    } else if (event.code === 'Digit5' || event.code === 'Numpad5') {
      this._horizontalPosition = bounds.height / 2;
      this._verticalPosition = bounds.width / 2;
      this._horizontalRelativePosition = 0.5;
      this._verticalRelativePosition = 0.5;
      this._setPositions();
    }
  };

  private _resetPositions() {
    requestAnimationFrame(() => {
      const bounds = this.getBoundingClientRect();
      this._horizontalPosition = bounds.height * this._horizontalRelativePosition;
      this._verticalPosition = bounds.width * this._verticalRelativePosition;
      this._setPositions();
    });
  }

  get legacyClipCompat() {
    return this.hasAttribute(legacyClipCompatAttr);
  }

  set legacyClipCompat(val: boolean) {
    if (val) {
      this.setAttribute(legacyClipCompatAttr, '');
    } else {
      this.removeAttribute(legacyClipCompatAttr);
    }
  }

  private _childrenChange() {
    if (this._isUpdatingHandles) return;

    const handles = [this._horizontalHandle, this._verticalHandle, this._centerHandle];
    const children = Array.from(this.children);
    
    const lastThreeChildren = children.slice(-3);
    const handlesAreLastThree = 
      lastThreeChildren.length === 3 &&
      handles.every((h, i) => lastThreeChildren[i] === h);

    if (handlesAreLastThree) {
      return;
    }

    this._isUpdatingHandles = true;
    try {
      for (const handle of handles) {
        if (!children.includes(handle)) {
          this.appendChild(handle);
        }
      }
      
      const currentChildren = Array.from(this.children);
      const currentHandleIndices = handles.map(h => currentChildren.indexOf(h));
      const needsReorder = !currentHandleIndices.every((idx, i) => 
        i === 0 || idx > currentHandleIndices[i - 1]
      );

      if (needsReorder) {
        for (const handle of handles) {
          this.appendChild(handle);
        }
      }
    } finally {
      this._isUpdatingHandles = false;
    }
  }

  private _horizontalPointerChange(startPoint: Pointer, currentPoint: Pointer) {
    const bounds = this.getBoundingClientRect();

    this._horizontalPosition =
      this._horizontalPositionOnPointerStart +
      (currentPoint.clientY - startPoint.clientY);

    this._horizontalPosition = Math.max(
      0,
      Math.min(this._horizontalPosition, bounds.height),
    );
    this._horizontalRelativePosition = this._horizontalPosition / bounds.height;
    this._setPositions();
  }

  private _verticalPointerChange(startPoint: Pointer, currentPoint: Pointer) {
    const bounds = this.getBoundingClientRect();

    this._verticalPosition =
      this._verticalPositionOnPointerStart +
      (currentPoint.clientX - startPoint.clientX);

    this._verticalPosition = Math.max(
      0,
      Math.min(this._verticalPosition, bounds.width),
    );
    this._verticalRelativePosition = this._verticalPosition / bounds.width;
    this._setPositions();
  }

  private _centerPointerChange(startPoint: Pointer, currentPoint: Pointer) {
    const bounds = this.getBoundingClientRect();

    this._horizontalPosition =
      this._horizontalPositionOnPointerStart +
      (currentPoint.clientY - startPoint.clientY);
    this._verticalPosition =
      this._verticalPositionOnPointerStart +
      (currentPoint.clientX - startPoint.clientX);

    this._horizontalPosition = Math.max(
      0,
      Math.min(this._horizontalPosition, bounds.height),
    );
    this._verticalPosition = Math.max(
      0,
      Math.min(this._verticalPosition, bounds.width),
    );
    this._horizontalRelativePosition = this._horizontalPosition / bounds.height;
    this._verticalRelativePosition = this._verticalPosition / bounds.width;
    this._setPositions();
  }

  private _setPositions() {
    this.style.setProperty('--horizontal-split', `${this._horizontalPosition}px`);
    this.style.setProperty('--vertical-split', `${this._verticalPosition}px`);
  }
}

customElements.define('four-up', FourUp);
