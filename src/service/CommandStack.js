/**
 * CommandStack — Undo / Redo history manager (ADR-022)
 *
 * Usage pattern:
 *   After an operation is already applied, call push(cmd) to record it.
 *   Ctrl+Z → undo(), Ctrl+Y / Ctrl+Shift+Z → redo().
 */
export class CommandStack {
  /** Maximum number of undo entries before oldest is evicted. */
  static MAX = 50

  constructor() {
    /** @type {Array<{label: string, execute(): void, undo(): void}>} */
    this._undo = []
    /** @type {Array<{label: string, execute(): void, undo(): void}>} */
    this._redo = []
  }

  /**
   * Record an already-executed command onto the undo stack.
   * Does NOT call command.execute() — the caller has already applied it.
   * Clears the redo stack.
   * @param {{label: string, execute(): void, undo(): void}} command
   */
  push(command) {
    this._undo.push(command)
    if (this._undo.length > CommandStack.MAX) this._undo.shift()
    this._redo = []
  }

  /**
   * Undo the most recent command.
   * @returns {{label: string} | null} The undone command, or null if stack is empty.
   */
  undo() {
    const cmd = this._undo.pop()
    if (cmd) {
      cmd.undo()
      this._redo.push(cmd)
    }
    return cmd ?? null
  }

  /**
   * Redo the most recently undone command.
   * @returns {{label: string} | null} The redone command, or null if stack is empty.
   */
  redo() {
    const cmd = this._redo.pop()
    if (cmd) {
      cmd.execute()
      this._undo.push(cmd)
    }
    return cmd ?? null
  }

  /**
   * Discard all history. Call on scene load / clear.
   */
  clear() {
    this._undo = []
    this._redo = []
  }

  get canUndo() { return this._undo.length > 0 }
  get canRedo() { return this._redo.length > 0 }
}
