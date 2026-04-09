/**
 * TurtleEditor – CodeMirror 6 editor with Turtle syntax highlighting.
 *
 * Can be used in read-only mode (original behaviour) or editable mode.
 * When editable, call onChange(cb) to receive the updated text whenever
 * the user makes a change.
 *
 * Also exposes requestMeasure() so main.ts can tell CodeMirror to re-measure
 * after a tab switch (the pane starts as display:none so initial measurement
 * is 0-height, causing a missing scrollbar until the layout is recalculated).
 */
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, basicSetup }      from 'codemirror'
import { turtle }                       from 'codemirror-lang-turtle'
import { oneDark }                      from '@codemirror/theme-one-dark'

export interface TurtleEditorOptions {
  /** When true the user can type in the pane. Default: false. */
  editable?: boolean
}

export class TurtleEditor {
  private view:      EditorView
  private listeners: ((text: string) => void)[] = []

  constructor(container: HTMLElement, options: TurtleEditorOptions = {}) {
    const { editable = false } = options

    const changeListener: Extension = editable
      ? EditorView.updateListener.of(update => {
          if (update.docChanged) {
            const text = update.state.doc.toString()
            for (const cb of this.listeners) cb(text)
          }
        })
      : []

    this.view = new EditorView({
      state: EditorState.create({
        doc: '# Load a loader to generate Turtle\n',
        extensions: [
          basicSetup,
          turtle(),
          oneDark,
          EditorView.theme({
            '&': { height: '100%', fontSize: '12px' },
            '.cm-scroller': {
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              overflow:   'auto',
            },
            '.cm-content': { paddingBottom: '40px' },
          }),
          EditorView.editable.of(editable),
          EditorView.lineWrapping,
          changeListener,
        ],
      }),
      parent: container,
    })
  }

  setContent(text: string): void {
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
    })
  }

  getContent(): string {
    return this.view.state.doc.toString()
  }

  /** Register a callback fired on every user edit (only fires when editable:true). */
  onChange(cb: (text: string) => void): void {
    this.listeners.push(cb)
  }

  /**
   * Force CodeMirror to re-measure its container dimensions.
   * Call whenever the Turtle tab becomes visible to fix the
   * "no scrollbar on first load" issue caused by display:none initial state.
   */
  requestMeasure(): void {
    this.view.requestMeasure()
  }

  /**
   * Scroll so the first occurrence of `term` is visible and selected.
   */
  scrollToTerm(term: string): void {
    const doc = this.view.state.doc.toString()
    let idx = doc.indexOf(term)
    if (idx === -1) idx = doc.indexOf(decodeURIComponent(term))
    if (idx === -1) return

    this.view.dispatch({
      effects:   EditorView.scrollIntoView(idx, { y: 'center' }),
      selection: { anchor: idx, head: idx + term.length },
    })
    this.view.focus()
  }

  destroy(): void {
    this.view.destroy()
  }
}

/** @deprecated Use TurtleEditor directly */
export { TurtleEditor as TurtleViewer }
