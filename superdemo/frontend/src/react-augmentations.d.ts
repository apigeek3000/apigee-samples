import 'react'

// `inert` ships only in @types/react's experimental typings, but the stable
// build (used here) doesn't expose it on HTMLAttributes. Declare it so JSX like
// `<nav inert={isCollapsed ? '' : undefined}>` typechecks. React 18 forwards the
// value verbatim: an empty string toggles the HTML boolean attribute on,
// `undefined` omits it.
declare module 'react' {
  interface HTMLAttributes<T> {
    inert?: string
  }
}
