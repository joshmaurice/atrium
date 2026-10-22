// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.

export { PointerInputBridge } from './PointerInputBridge.js'
export { projectRayToPlane, computeParentInverse } from './drag-math.js'
export { buildClipsFromSOM } from './build-clips.js'
export { initDocumentView } from './document-view.js'
export {
  loadBackground, createSkyLoader, skyReasonText, skyHeaderProblem,
  decodeWithTextureLoader, SKY_REASONS, SKY_MAX_SIDE, SKY_MAX_AREA, SKY_DECODE_TIMEOUT_MS,
} from './load-background.js'
export {
  MODEL_PARSE_LIMITS, PARSE_REASONS, parseReasonText, preflightProblem, imageHeader, estimateTextureBytes,
  readGlb, glbImages, createTextureBudget, templateKey, createTemplateCache, parseTemplate,
  rewriteGltfJson, createUrlModifier, revokeBlobs, objectUrlApi, countVertices, disposeTemplate, measureBounds,
} from './model-parse.js'
export {
  buildInstance, buildPlaceholder, disposeInstance, retargetClip,
  MODEL_WRAPPER_FLAG, MODEL_NAME_KEY, PLACEHOLDER_COLOURS,
} from './model-instances.js'
export {
  createModelBridge, MODEL_STATUS, MODEL_INSTANCE_LIMIT, HOST_FRAME_LIMIT, specKey, specTemplateKey,
} from './model-bridge.js'
export { AnimationBridge } from './AnimationBridge.js'
export { Stage } from './Stage.js'
export {
  threeGeometryToGltfPrimitive, buildAvatarDescriptor, buildTeleporterDescriptor,
  buildPrimitiveDescriptor, PRIMITIVE_KINDS, PRIMITIVE_REST_Y, PRIMITIVE_MATERIAL,
} from './geometry-utils.js'
