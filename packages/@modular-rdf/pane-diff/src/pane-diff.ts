/**
 * @modular-rdf/pane-diff
 *
 * GraphHandler that shows a triple-level diff between the previous and current
 * RDF load.  Maintains its own prev/current text so main.ts needs no diff state.
 *
 * State machine (via updateText):
 *   first call  → "Load another file to compare."
 *   same text   → no-op (content unchanged)
 *   new text    → compute and render diff(prev, current)
 */
import type { GraphHandler, HandlerState, HandlerCallbacks } from '@modular-rdf/api-graph-handler'
import { diffTurtle, renderDiffHtml } from './diff'

class DiffPaneHandler implements GraphHandler {
  name  = 'diff'
  label = 'Diff'

  private prefixes:    Record<string, string> = {}
  private prevText     = ''
  private prevFilename = ''
  private content:     HTMLElement | null = null
  private filenamesEl: HTMLElement | null = null

  mount(container: HTMLElement, _callbacks: HandlerCallbacks): void {
    container.innerHTML = `
      <div class="pane-toolbar flex-row">
        <span class="mono text-xs text-muted grow">Triple-level diff: previous load vs current</span>
        <span class="mono text-xs text-muted diff-filenames"></span>
      </div>
      <div class="diff-pane pane-scroll-host"></div>`
    this.content     = container.querySelector('.diff-pane')
    this.filenamesEl = container.querySelector('.diff-filenames')
    this.msg('Load a file, then load another to compare.')
  }

  update(state: HandlerState): void {
    this.prefixes = state.prefixes
  }

  updateText(text: string, _format?: string, filename?: string): void {
    if (!this.content) return

    const prev     = this.prevText
    const prevName = this.prevFilename
    this.prevText     = text
    this.prevFilename = filename ?? ''

    if (!prev) {
      this.msg('Load another file to compare.')
      return
    }
    if (prev === text) return

    this.msg('Computing diff…')
    if (this.filenamesEl)
      this.filenamesEl.textContent = `${prevName || 'previous'} → ${filename || 'current'}`

    diffTurtle(prev, text).then(diff => {
      if (this.content) this.content.innerHTML = renderDiffHtml(diff, this.prefixes)
    })
  }

  private msg(text: string): void {
    if (this.content)
      this.content.innerHTML =
        `<div class="mono text-xs text-muted" style="padding:12px">${text}</div>`
  }
}

export const handler: GraphHandler = new DiffPaneHandler()
export default handler
