// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

export { PointerInputBridge } from './PointerInputBridge.js'
export { projectRayToPlane, computeParentInverse } from './drag-math.js'
export { buildClipsFromSOM } from './build-clips.js'
export { initDocumentView } from './document-view.js'
export { loadBackground } from './load-background.js'
export {
  MODEL_PARSE_LIMITS, PARSE_REASONS, parseReasonText, preflightProblem, imageHeader, estimateTextureBytes,
  readGlb, glbImages, createTextureBudget, templateKey, createTemplateCache, parseTemplate,
  rewriteGltfJson, createUrlModifier, revokeBlobs, objectUrlApi, countVertices, disposeTemplate, measureBounds,
} from './model-parse.js'
export { AnimationBridge } from './AnimationBridge.js'
export { Stage } from './Stage.js'
export {
  threeGeometryToGltfPrimitive, buildAvatarDescriptor, buildTeleporterDescriptor,
  buildPrimitiveDescriptor, PRIMITIVE_KINDS, PRIMITIVE_REST_Y, PRIMITIVE_MATERIAL,
} from './geometry-utils.js'
