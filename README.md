# RDF Explorer

A  application that loads RDF data (Turtle),
then provides an interactive graph explorer, SPARQL query pad, ShEx schema generation
and validation, and literal type inference.

## Quick start

```bash
npm install
npm run dev        # → http://localhost:5173  (no-cache headers, HMR)
npm run build      # production build in dist/
npm run type-check # tsc without emit
```

## Keyboard shortcuts

| Key | Action |
|---|---|
| `?` | Shortcuts overlay |
| `Alt+1`–`5` | Switch tab |
| `Alt+F` | Focus regex filter |
| `Alt+S` | Focus spotlight |
| `Alt+D` | Download Turtle |

## Features

### Load
- Drag-and-drop or click-to-browse a Turtle file
- SHA-256 file hash + load timestamp shown in header badge
- Build timestamp injected at bundle time (cache staleness indicator)

### Graph tab
| Gesture | Action |
|---|---|
| Scroll ↑ on node | Expand: reveal all edges in/out |
| Scroll ↓ on node | Contract: hide edges to unexpanded neighbours |
| Click node | Pin / unpin (gold glow + fixed position) |
| Drag node | Reposition |
| Click pinned node link | Open node-detail panel |

**Regex filter** — enter a JS regex; only matching nodes (+ expanded neighbours) render.  
**Spotlight** — dims all nodes except label matches; useful without filtering.  
**Group by** — `rdf:type`, namespace, or none (visual grouping via force layout).  
**Node detail panel** — shows all triples for a selected node; click object IRIs to
jump to them; "→ Turtle" button switches tab and scrolls CodeMirror to the node.

### Turtle tab
Read-only CodeMirror 6 editor with `codemirror-lang-turtle` syntax highlighting.
Click "→ Turtle" in the node detail panel to scroll directly to a node's IRI.

### SPARQL tab
Type a `SELECT … WHERE { … } LIMIT n` query and click ▶ Run.
Uses an in-memory N3.Store with a hand-rolled basic-graph-pattern evaluator
(supports qnames with standard prefixes, `?variables`, LIMIT).

### ShEx tab
1. **Generate ShEx** — introspects `rdf:type` usage to produce a ShEx 2.0 schema
   with one shape per `ex:*` class.
2. **Validate All** — runs `@shexjs/parser` + `@shexjs/validator` (lazy-loaded) over
   every typed node; shows ✓/✗ per node with error messages.

### Type Inference tab
Scans all plain-string literals and suggests `xsd:date`, `xsd:integer`, `xsd:gYear`,
`xsd:boolean`, `xsd:anyURI`, etc. based on value patterns.

## URL-hash history

Filter regex, pinned nodes, expanded nodes, and group-by are encoded in the URL hash
as base64 JSON. Browser Back/Forward navigates exploration history.

## Cache / reload workflow

The header badge shows:
- **green dot** — freshly loaded from file this session
- **amber dot** — bundle built at `[time]` (dev mode placeholder)

During `npm run dev`, Vite serves with `Cache-Control: no-store` so reloading the
page always picks up your latest spreadsheet parse. Each load shows a new SHA-256
hash so you can confirm a different file was processed.

## Development

### tools

* TypeScript
* Vite

## Project structure

```
src/
  lib/
    turtle-builder.ts      # Literate Turtle generator API
    graph-store.ts         # N3 parser, GraphData, URL-hash history
    sparql-runner.ts       # In-memory SPARQL evaluator
    shex-validator.ts      # ShEx generation + @shexjs validation
    type-inference.ts      # Literal datatype suggestions
  components/
    graph-view.ts          # D3 force-directed graph
    turtle-editor.ts       # CodeMirror 6 Turtle viewer
  styles/
    main.css               # Industrial monospace design system
  main.ts                  # UI orchestration
```
