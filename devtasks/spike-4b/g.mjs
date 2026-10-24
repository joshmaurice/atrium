// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
// devtasks/spike-4b: a throwaway probe for the step 4 pre-brief D2 spike; not product code.
// Tiny graph builder for the probes.
export const T = { bool: 0, int: 1, float: 2, float3: 3 }
export const TYPES = [{ signature: 'bool' }, { signature: 'int' }, { signature: 'float' }, { signature: 'float3' }]
export function graph(nodes, { variables = [], events = [] } = {}) {
  const ops = [...new Set(nodes.map((n) => n.op))]
  return { types: TYPES, variables, events, declarations: ops.map((op) => ({ op })),
    nodes: nodes.map(({ op, ...rest }) => ({ declaration: ops.indexOf(op), ...rest })) }
}
export const lit = (type, value) => ({ type, value: Array.isArray(value) ? value : [value] })
export const to = (node, socket = 'in') => ({ node, socket })
