/**
 * base-panel.ts
 *
 * Provides `buildBasePanel()` — the standard drop-zone + file-input widget
 * that every GraphSource panel needs.  Loaders call this and optionally append
 * extra controls afterwards.
 *
 * Also re-exports the shared `esc()` helper so loaders don't have to
 * reimplement it.
 */

import type { GraphSource } from '@modular-rdf/graph-source-api'

/** HTML-escape for safe insertion into text content or attribute values. */
export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Append a standard drop-zone + hidden file-input into `container`.
 *
 * @param container  - Element to append into (the loader's panel div).
 * @param loader     - The owning loader (used for name, description, accepts).
 * @param onFile     - Called with each accepted File.
 * @returns the root `.dropzone` element, in case the caller wants to style it.
 */
export function buildBasePanel(
  container: HTMLElement,
  loader:    Pick<GraphSource, 'name' | 'description' | 'accepts'>,
  onFile:    (file: File) => void,
): HTMLElement {
  const hint = loader.description ?? loader.accepts.join(' · ')

  const zone = document.createElement('div')
  zone.className = 'dropzone loader-dropzone'
  zone.setAttribute('data-loader-name', loader.name)

  const icon    = document.createElement('div')
  icon.className   = 'dropzone-icon'
  icon.textContent = '📂'

  const nameEl  = document.createElement('div')
  nameEl.className   = 'dropzone-text'
  nameEl.textContent = loader.name

  const hintEl  = document.createElement('div')
  hintEl.className   = 'dropzone-hint'
  hintEl.textContent = hint

  const fi      = document.createElement('input')
  fi.type       = 'file'
  fi.accept     = loader.accepts.join(',')
  fi.multiple   = true
  fi.style.display = 'none'

  zone.append(icon, nameEl, hintEl, fi)

  zone.addEventListener('click',    e  => { if (e.target !== fi) fi.click() })
  zone.addEventListener('dragover', e  => { e.preventDefault(); zone.classList.add('dragging') })
  zone.addEventListener('dragleave', () => zone.classList.remove('dragging'))
  zone.addEventListener('drop', e => {
    e.preventDefault()
    zone.classList.remove('dragging')
    for (const f of e.dataTransfer?.files ?? []) onFile(f)
  })
  fi.addEventListener('change', () => {
    for (const f of fi.files ?? []) onFile(f)
    fi.value = ''
  })

  container.appendChild(zone)
  return zone
}
