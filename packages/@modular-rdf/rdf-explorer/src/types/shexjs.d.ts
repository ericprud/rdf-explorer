// Minimal ambient declarations for @shexjs packages
// Avoids pulling in their raw .ts source files which have broken deps.

declare module '@shexjs/parser' {
  export function construct(schema: string, options?: unknown): unknown
}

declare module '@shexjs/validator' {
  export class ShExValidator {
    constructor(schema: unknown, db: unknown, options: unknown)
    validateShapeMap(shapeMap: { node: string; shape: string }[]): {
      status: string
      reason?: string
      node?: string
      shape?: string
    }[]
  }
}
