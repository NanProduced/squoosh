interface FourUpAttributes extends preact.JSX.HTMLAttributes {
  'legacy-clip-compat'?: boolean;
}

declare module 'preact' {
  namespace createElement.JSX {
    interface IntrinsicElements {
      'four-up': FourUpAttributes;
    }
  }
}

export {};
