// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

// @atrium/behaviors — renderer-neutral behaviour support (scripting-4b-2).
// No DOM, no Three.js: the browser page and the Node tests import the same code.

export * from './behavior-spec.js'
export * from './templates.js'
export {
  createBehaviorEngine, loadBehavior, installBudgetedLoops, NodeEventBus,
  BudgetExceeded, STEP_BUDGET, LOG_MESSAGE_MAX,
  graphReport, inertLoadCopy, keepRegistryByAllowlist,
  createDelayTable, installDelaySubclasses,
  DELAY_PENDING_MAX, DELAY_SECONDS_MAX, INERT_OP_PREFIX, MISSING_SELECT_OUTPUTS,
} from './adapter.js'
export {
  createBehaviorRunner, SEND_FRAME_MS, SEND_KEYS_MAX, LOG_LINES_MAX,
} from './runner.js'
