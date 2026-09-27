/**
 * Ambient surface for the shell's shared control atoms.
 *
 * `@deepseek-ai/dsh-client-ui-primitives` is a first-party build input the web
 * shell shares through its frozen module table (PLATFORM_MODULES). It is NOT a
 * dependency of this package — the bundle keeps it external and the loader
 * answers it from the seed table — so at type-check time the specifier has no
 * declaration file to resolve. This shim declares the atoms this plugin uses
 * with permissive props; the authoritative prop contracts live upstream
 * (packages/client/ui-primitives/README.md, the component catalog).
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ComponentType } from 'react'

  /** Any atom: the plugin passes native element attributes plus a few atom props. */
  type Atom = ComponentType<any>

  export const Button: Atom
  export const Input: Atom
  export const Pill: Atom
  export const Switch: Atom
  export const Checkbox: Atom
  export const SegmentedControl: Atom
  export const SegmentedTabs: Atom
  export const Tag: Atom
  export const StateDot: Atom
  export const PathLabel: Atom
  export const DisclosureRow: Atom
  export const Modal: Atom
  export const Toast: Atom
  export const Tooltip: Atom
  export const Menu: Atom
  export const MenuItemButton: Atom
}
