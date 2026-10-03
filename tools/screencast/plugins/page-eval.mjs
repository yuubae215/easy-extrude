// Example plugin — the extension point of screencast/1.0 (ADR-160).
//
// Adds `x-page/eval`: run one page-side expression when the step begins
// (switch a render style, open a panel the UI has no gesture for, ...).
// It lives OUTSIDE the core union on purpose: the core vocabulary stays
// declarative, and a scenario that needs an escape hatch says so by name.
//
//   "plugins": ["../plugins/page-eval.mjs"],
//   { "do": "x-page/eval", "expression": "window.__easyExtrude.setRobotAppearance('skeleton')", "duration": 600 }
//
// An ActionDef has the same shape as a core one (see src/actions.mjs) plus a
// JSON Schema for its own payload — the core schema never validates x-* bodies.
export const actions = [
  {
    kind: 'x-page/eval',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['do', 'expression'],
      properties: {
        do: { const: 'x-page/eval' },
        expression: { type: 'string', minLength: 1 },
        duration: { type: 'integer', minimum: 0 },
        async: { type: 'boolean' },
        note: { type: 'string' },
      },
    },
    duration: s => s.duration ?? 300,
    async begin(rt, s) {
      await rt.page.evaluate(expr => Promise.resolve((0, eval)(expr)).then(() => undefined), s.expression)
      return {}
    },
  },
]
