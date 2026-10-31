// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

export { SOMEvent }     from './SOMEvent.js'
export { SOMObject }    from './SOMObject.js'
export { SOMDocument }  from './SOMDocument.js'
export { SOMScene }     from './SOMScene.js'
export { SOMNode }      from './SOMNode.js'
export { SOMMesh }      from './SOMMesh.js'
export { SOMPrimitive } from './SOMPrimitive.js'
export { SOMMaterial }  from './SOMMaterial.js'
export { SOMCamera }    from './SOMCamera.js'
export { SOMAnimation } from './SOMAnimation.js'
export { SOMLight }     from './SOMLight.js'
export { SOMTexture }   from './SOMTexture.js'
export { SOMSkin }      from './SOMSkin.js'
export { parsePath }    from './SOMDocument.js'
export { CREATABLE_PATHS } from './SOMDocument.js'
// scripting-4c AC2 (Rev 1 M2) — worldPosition lives HERE now, so the server's
// distance check and the page's pre-check measure with the same code.
export { worldPosition } from './world-position.js'
// scripting-4d-1 G-L4 — the read-only `matrix` and `globalMatrix` pointers, ONE
// implementation for the page and the server, beside worldPosition.
export { localMatrix, worldMatrix } from './world-matrix.js'
export {
  pruneCandidateProperties,
  pruneDocumentInPlace,
  pruneDocumentDryRun,
  collectWholeDocumentCandidates,
  collectExtensionLights,
  countDocumentResources,
  countByType,
  emptyCounts,
  isPrunableType,
  copyDocument,
  PRUNE_COUNT_KEYS,
} from './prune.js'
