/**
 * Declaration seams for the browser half's two external modules. The client
 * is a hand-written `createElement` bundle: it imports React only for these
 * hook/constructor references (see src/client/panels/context.js, which
 * re-exports them to every panel) and the shell's UI primitives, which are
 * "implicitly external" components the shell provides at runtime.
 *
 * Declaring them here (rather than adding @types/react) keeps this package
 * dependency-free, mirrors how the dsh seams are declared in
 * dsh-seams.d.ts, and is what lets `noImplicitAny` type-check src/client at
 * all: without a declaration the mere `import React from 'react'` is a
 * TS7016.
 *
 * The signatures are deliberately LOOSE. React's hooks are generic and the
 * panels call them with dynamic values (`useState(null)` whose setter later
 * receives an object, `useRef(null)` that later holds a Timeout) — the real
 * runtime allows it and the panels are written that way. A strict generic
 * seam would pin the state literal type and light up ~90 errors in four
 * panels that the main config must keep green; the strict client track
 * checks the panels' OWN code (untyped parameters, callbacks, object
 * literals), not React's type parameters, so the seam stays a duck type.
 */
declare module 'react' {
  export const createElement: (type: any, props?: any, ...children: any[]) => any
  export const Fragment: any
  export const useState: (initial: any) => [any, (value: any) => void]
  export const useRef: (initial: any) => { current: any }
  export const useEffect: (effect: any, deps?: any) => void
  export const useMemo: (factory: any, deps?: any) => any
  export const useCallback: (fn: any, deps?: any) => any
  const React: {
    createElement: typeof createElement
    Fragment: typeof Fragment
    useState: typeof useState
    useRef: typeof useRef
    useEffect: typeof useEffect
    useMemo: typeof useMemo
    useCallback: typeof useCallback
  }
  export default React
}

/** The shell's platform-baseline UI primitives (rendered as elements). */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  export const Button: (props?: any, ...children: any[]) => any
  export const Checkbox: (props?: any, ...children: any[]) => any
  export const Input: (props?: any, ...children: any[]) => any
  export const Pill: (props?: any, ...children: any[]) => any
}
