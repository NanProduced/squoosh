export default class FourUp extends HTMLElement {
  static get observedAttributes(): string[];

  get legacyClipCompat(): boolean;
  set legacyClipCompat(val: boolean);
}
