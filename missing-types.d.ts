/**
 * Copyright 2020 Google Inc. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/// <reference path="./emscripten-types.d.ts" />

declare module 'entry-data:*' {
  export const main: string;
  export const deps: string[];
}

declare module 'url:*' {
  const value: string;
  export default value;
}

declare module 'img-url:*' {
  const value: string;
  export default value;
  export const width: number;
  export const height: number;
}

declare module 'omt:*' {
  const value: string;
  export default value;
}

declare module 'css:*' {
  const source: string;
  export default source;
}

declare module 'data-url:*' {
  const url: string;
  export default url;
}

declare module 'data-url-text:*' {
  const url: string;
  export default url;
}

declare module 'service-worker:*' {
  const url: string;
  export default url;
}

declare var ga: {
  (...args: any[]): void;
  q: any[];
};

declare const __PRODUCTION__: boolean;

declare class OffscreenCanvas {
  width: number;
  height: number;
  constructor(width: number, height: number);
  getContext(contextId: '2d', contextAttributes?: any): OffscreenCanvasRenderingContext2D | null;
  getContext(contextId: 'webgl' | 'webgl2', contextAttributes?: any): any;
  convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob>;
}

interface OffscreenCanvasRenderingContext2D {
  readonly canvas: OffscreenCanvas;
  filter: string;
  clearRect(x: number, y: number, w: number, h: number): void;
  getImageData(sx: number, sy: number, sw: number, sh: number): ImageData;
  putImageData(imagedata: ImageData, dx: number, dy: number, dirtyX?: number, dirtyY?: number, dirtyWidth?: number, dirtyHeight?: number): void;
  drawImage(image: any, dx: number, dy: number): void;
  drawImage(image: any, dx: number, dy: number, dw: number, dh: number): void;
  drawImage(image: any, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
  rotate(angle: number): void;
  scale(x: number, y: number): void;
  translate(x: number, y: number): void;
  save(): void;
  restore(): void;
}
