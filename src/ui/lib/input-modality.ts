/**
 * Publishes `data-input-modality` on the document element for the focus-ring styles
 * (src/ui/theme/base.css): rings follow navigation keys, or a key followed by focus on a
 * different control; pointer input and modifiers alone keep rings silent. Imported once for its
 * side effect from src/main.tsx; the listeners live for the document lifetime.
 */

const FOCUS_NAVIGATION = new Set(['Tab', 'Home', 'End', 'PageUp', 'PageDown'])

let pointerOwnsFocus = false
let keyFocusOrigin: EventTarget | undefined

function publish(): void {
  document.documentElement.setAttribute('data-input-modality', pointerOwnsFocus ? 'pointer' : 'keyboard')
}

if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => {
    pointerOwnsFocus = true
    keyFocusOrigin = undefined
    publish()
  }, true)
  window.addEventListener('keydown', (event) => {
    if (event.isComposing) {
      keyFocusOrigin = undefined
      return
    }
    // composedPath preserves the real control inside an open shadow root.
    keyFocusOrigin = event.composedPath()[0]
    if (!FOCUS_NAVIGATION.has(event.key) && !event.key.startsWith('Arrow')) return
    pointerOwnsFocus = false
    publish()
  }, true)
  window.addEventListener('focusin', (event) => {
    if (keyFocusOrigin === undefined || event.composedPath()[0] === keyFocusOrigin) return
    keyFocusOrigin = undefined
    if (!pointerOwnsFocus) return
    pointerOwnsFocus = false
    publish()
  }, true)
  window.addEventListener('blur', () => { keyFocusOrigin = undefined })
}
