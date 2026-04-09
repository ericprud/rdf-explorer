/**
 * ShExEditor – editable CodeMirror 6 pane for ShEx schemas.
 *
 * Uses the same visual setup as TurtleViewer (oneDark, JetBrains Mono,
 * basicSetup) but is fully editable.  Turtle syntax highlighting is used as a
 * reasonable stand-in for ShEx since PREFIX declarations look identical and
 * the lezer-turtle grammar highlights angle-bracket IRIs and string literals
 * correctly.
 *
 * Exposes:
 *   getValue()              → current schema text
 *   setValue(text)          → replace content (resets undo history)
 *   requestMeasure()        → tell CodeMirror to re-measure after tab switch
 *   onChange(cb)            → register a listener for content changes
 *   destroy()               → clean up
 */
import { EditorState, Transaction, type Extension } from '@codemirror/state'
import { EditorView, basicSetup }                   from 'codemirror'
import { turtle }                       from 'codemirror-lang-turtle'
import { oneDark }                      from '@codemirror/theme-one-dark'

const PLACEHOLDER = '# Click "Generate ShEx" to produce a schema.\n# You can then edit it freely before running "Validate All".\n'

export class ShExEditor {
  private view:       EditorView
  private listeners:  ((text: string) => void)[] = []

  constructor(container: HTMLElement) {
    const changeListener: Extension = EditorView.updateListener.of(update => {
      if (update.docChanged) {
        const text = update.state.doc.toString()
        for (const cb of this.listeners) cb(text)
      }
    })

    this.view = new EditorView({
      state: EditorState.create({
        doc: PLACEHOLDER,
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
            '.cm-content':  { paddingBottom: '40px' },
          }),
          EditorView.lineWrapping,
          changeListener,
        ],
      }),
      parent: container,
    })
  }

  getValue(): string {
    return this.view.state.doc.toString()
  }

  /** Replace the entire document.  Passes `{ userEvent: 'shex.set' }` so
   *  change listeners can optionally ignore programmatic updates. */
  setValue(text: string): void {
    this.view.dispatch({
      changes:     { from: 0, to: this.view.state.doc.length, insert: text },
      annotations: [Transaction.userEvent.of('shex.set')],
    })
  }

  /** Register a callback fired on every user edit. */
  onChange(cb: (text: string) => void): void {
    this.listeners.push(cb)
  }

  /** Force CodeMirror to re-measure dimensions — call when the tab becomes visible. */
  requestMeasure(): void {
    this.view.requestMeasure()
  }

  destroy(): void {
    this.view.destroy()
  }
}
