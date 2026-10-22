// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Tony Parisi / Metatron Studio. See LICENSE in repo root.
//
// One-off script to generate tests/fixtures/atrium.gltf — a circular
// gathering space with walls, columns, furniture, and a central fountain.
// All objects are named SOM nodes with PBR materials.
//
// Run from repo root:
//   node tests/fixtures/generate-atrium.js

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Resolve gltf-transform from packages/server — no extra install needed.
const coreUrl = new URL(
  '../../packages/server/node_modules/@gltf-transform/core/dist/index.modern.js',
  import.meta.url
)
const { Document, NodeIO } = await import(coreUrl)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const OUT_PATH = join(__dirname, 'atrium.gltf')

// ─── Scene layout constants ────────────────────────────────────────────────

const RADIUS = 10          // atrium radius in meters
const WALL_HEIGHT = 6      // wall height
const SEGMENTS = 64        // circle resolution
const NUM_COLUMNS = 8      // columns around perimeter
const COLUMN_RADIUS = 0.25
const COLUMN_INSET = 1.0   // distance from wall inward
const ARCHWAY_WIDTH = 0.12 // radians per archway half-gap (~1.2m at r=10)
const NUM_ARCHWAYS = 4     // evenly spaced

// ─── Geometry builders ─────────────────────────────────────────────────────
// All return { positions: number[], normals: number[], indices: number[] }
// Meshes centered at origin; position via node translation.
// Winding: CCW from outside (right-hand, glTF default).

function buildDisc(radius, segments) {
  const positions = [], normals = [], indices = []

  // Center vertex
  positions.push(0, 0, 0)
  normals.push(0, 1, 0)

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2
    positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius)
    normals.push(0, 1, 0)

    const next = (i + 1) % segments + 1
    indices.push(0, next, i + 1)
  }

  return { positions, normals, indices }
}

function buildBox(sx, sy, sz) {
  const x = sx / 2, y = sy / 2, z = sz / 2
  const positions = [], normals = [], indices = []

  const faces = [
    { n: [ 0, 0, 1], pts: [[-x,-y, z], [ x,-y, z], [ x, y, z], [-x, y, z]] },
    { n: [ 0, 0,-1], pts: [[ x,-y,-z], [-x,-y,-z], [-x, y,-z], [ x, y,-z]] },
    { n: [ 1, 0, 0], pts: [[ x,-y, z], [ x,-y,-z], [ x, y,-z], [ x, y, z]] },
    { n: [-1, 0, 0], pts: [[-x,-y,-z], [-x,-y, z], [-x, y, z], [-x, y,-z]] },
    { n: [ 0, 1, 0], pts: [[-x, y, z], [ x, y, z], [ x, y,-z], [-x, y,-z]] },
    { n: [ 0,-1, 0], pts: [[-x,-y,-z], [ x,-y,-z], [ x,-y, z], [-x,-y, z]] },
  ]

  faces.forEach(({ n, pts }, i) => {
    const base = i * 4
    for (const p of pts) { positions.push(...p); normals.push(...n) }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  })

  return { positions, normals, indices }
}

function buildCylinder(rTop, rBottom, height, segments) {
  const positions = [], normals = [], indices = []
  const halfH = height / 2

  const slope = (rBottom - rTop) / height
  const nLen = Math.sqrt(1 + slope * slope)

  // Sides
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2
    const a1 = ((i + 1) / segments) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)

    const base = positions.length / 3
    positions.push(
      rBottom * c0, -halfH, rBottom * s0,
      rTop    * c0, +halfH, rTop    * s0,
      rTop    * c1, +halfH, rTop    * s1,
      rBottom * c1, -halfH, rBottom * s1
    )
    normals.push(
      c0 / nLen, slope / nLen, s0 / nLen,
      c0 / nLen, slope / nLen, s0 / nLen,
      c1 / nLen, slope / nLen, s1 / nLen,
      c1 / nLen, slope / nLen, s1 / nLen
    )
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }

  // Bottom cap
  if (rBottom > 0) {
    const ci = positions.length / 3
    positions.push(0, -halfH, 0)
    normals.push(0, -1, 0)
    const capStart = positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      positions.push(rBottom * Math.cos(a), -halfH, rBottom * Math.sin(a))
      normals.push(0, -1, 0)
    }
    for (let i = 0; i < segments; i++) {
      indices.push(ci, capStart + i, capStart + i + 1)
    }
  }

  // Top cap
  if (rTop > 0) {
    const ci = positions.length / 3
    positions.push(0, halfH, 0)
    normals.push(0, 1, 0)
    const capStart = positions.length / 3
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2
      positions.push(rTop * Math.cos(a), halfH, rTop * Math.sin(a))
      normals.push(0, 1, 0)
    }
    for (let i = 0; i < segments; i++) {
      indices.push(ci, capStart + i + 1, capStart + i)
    }
  }

  return { positions, normals, indices }
}

function buildTorus(majorRadius, minorRadius, majorSegments, minorSegments) {
  const positions = [], normals = [], indices = []

  for (let i = 0; i <= majorSegments; i++) {
    const u = (i / majorSegments) * Math.PI * 2
    const cu = Math.cos(u), su = Math.sin(u)

    for (let j = 0; j <= minorSegments; j++) {
      const v = (j / minorSegments) * Math.PI * 2
      const cv = Math.cos(v), sv = Math.sin(v)

      positions.push(
        (majorRadius + minorRadius * cv) * cu,
        minorRadius * sv,
        (majorRadius + minorRadius * cv) * su
      )
      normals.push(cv * cu, sv, cv * su)

      if (i < majorSegments && j < minorSegments) {
        const a = i * (minorSegments + 1) + j
        const b = a + minorSegments + 1
        indices.push(a, a + 1, b, a + 1, b + 1, b)
      }
    }
  }

  return { positions, normals, indices }
}

function buildSphere(radius, widthSegments, heightSegments) {
  const positions = [], normals = [], indices = []

  for (let y = 0; y <= heightSegments; y++) {
    const phi = (y / heightSegments) * Math.PI

    for (let x = 0; x <= widthSegments; x++) {
      const theta = (x / widthSegments) * Math.PI * 2

      const nx = -Math.sin(phi) * Math.cos(theta)
      const ny = Math.cos(phi)
      const nz = Math.sin(phi) * Math.sin(theta)

      positions.push(nx * radius, ny * radius, nz * radius)
      normals.push(nx, ny, nz)

      if (y < heightSegments && x < widthSegments) {
        const a = y * (widthSegments + 1) + x
        const b = a + widthSegments + 1
        indices.push(a, b, a + 1, b, b + 1, a + 1)
      }
    }
  }

  return { positions, normals, indices }
}

/**
 * Build a wall arc segment between two angles. Normals face inward.
 */
function buildWallArc(radius, height, startAngle, endAngle, segments) {
  const hh = height / 2
  const positions = [], normals = [], indices = []

  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const angle = startAngle + t * (endAngle - startAngle)
    const cx = Math.cos(angle), cz = Math.sin(angle)

    // Inward-facing normals
    positions.push(cx * radius, -hh, cz * radius)
    normals.push(-cx, 0, -cz)
    positions.push(cx * radius, hh, cz * radius)
    normals.push(-cx, 0, -cz)

    if (i < segments) {
      const bl = i * 2, tl = i * 2 + 1
      const br = (i + 1) * 2, tr = (i + 1) * 2 + 1
      indices.push(bl, br, tl, tl, br, tr)
    }
  }

  return { positions, normals, indices }
}

// ─── glTF-Transform helpers ────────────────────────────────────────────────

function createMaterial(doc, name, rgb, opts = {}) {
  const mat = doc.createMaterial(name)
    .setBaseColorFactor([rgb[0], rgb[1], rgb[2], opts.alpha ?? 1.0])
    .setMetallicFactor(opts.metallic ?? 0)
    .setRoughnessFactor(opts.roughness ?? 1.0)

  if (opts.emissive) mat.setEmissiveFactor(opts.emissive)
  if (opts.alphaMode) mat.setAlphaMode(opts.alphaMode)
  if (opts.doubleSided) mat.setDoubleSided(true)

  return mat
}

function createMesh(doc, buffer, name, geom, material) {
  const { positions, normals, indices } = geom

  const posAcc = doc.createAccessor()
    .setArray(new Float32Array(positions))
    .setType('VEC3')
    .setBuffer(buffer)

  const norAcc = doc.createAccessor()
    .setArray(new Float32Array(normals))
    .setType('VEC3')
    .setBuffer(buffer)

  const idxAcc = doc.createAccessor()
    .setArray(new Uint16Array(indices))
    .setType('SCALAR')
    .setBuffer(buffer)

  const prim = doc.createPrimitive()
    .setAttribute('POSITION', posAcc)
    .setAttribute('NORMAL', norAcc)
    .setIndices(idxAcc)
    .setMaterial(material)

  return doc.createMesh(name).addPrimitive(prim)
}

// ─── Utility ───────────────────────────────────────────────────────────────

/** Convert a Y-axis yaw angle to a quaternion [x, y, z, w]. */
function yawToQuat(yaw) {
  const hy = yaw / 2
  return [0, Math.sin(hy), 0, Math.cos(hy)]
}

// ─── Build document ────────────────────────────────────────────────────────

async function main() {
  const doc = new Document()
  const buffer = doc.createBuffer().setURI('atrium.bin')
  const scene = doc.createScene('Atrium')

  // ── Materials ──────────────────────────────────────────────────────────

  const floorMat    = createMaterial(doc, 'MarbleFloor',  [0.85, 0.82, 0.78], { metallic: 0.1, roughness: 0.3 })
  const wallMat     = createMaterial(doc, 'StoneWall',    [0.75, 0.72, 0.68], { roughness: 0.8 })
  const columnMat   = createMaterial(doc, 'Marble',       [0.9, 0.88, 0.85],  { metallic: 0.05, roughness: 0.25 })
  const woodMat     = createMaterial(doc, 'DarkWood',     [0.35, 0.2, 0.1],   { roughness: 0.6 })
  const woodLightMat = createMaterial(doc, 'LightWood',   [0.6, 0.45, 0.28],  { roughness: 0.55 })
  const metalMat    = createMaterial(doc, 'BrushedMetal',  [0.7, 0.7, 0.72],  { metallic: 0.9, roughness: 0.35 })
  const stoneDarkMat = createMaterial(doc, 'DarkStone',    [0.4, 0.38, 0.36], { roughness: 0.7 })
  const waterMat    = createMaterial(doc, 'Water',         [0.3, 0.5, 0.7],   { alpha: 0.6, metallic: 0.2, roughness: 0.1, alphaMode: 'BLEND' })
  const emissiveMat = createMaterial(doc, 'GlowRing',     [1.0, 1.0, 1.0],   { emissive: [0.8, 0.7, 0.5] })

  // ── Floor ─────────────────────────────────────────────────────────────

  const floorNode = doc.createNode('Floor')
    .setMesh(createMesh(doc, buffer, 'mesh-floor', buildDisc(RADIUS, SEGMENTS), floorMat))
  scene.addChild(floorNode)

  // Floor accent ring (inlaid dark stone)
  const accentNode = doc.createNode('FloorAccent')
    .setMesh(createMesh(doc, buffer, 'mesh-floor-accent', buildTorus(RADIUS * 0.6, 0.08, 64, 8), stoneDarkMat))
    .setTranslation([0, 0.01, 0])
  scene.addChild(accentNode)

  // ── Ceiling ───────────────────────────────────────────────────────────

  const ceilingNode = doc.createNode('Ceiling')
    .setMesh(createMesh(doc, buffer, 'mesh-ceiling', buildDisc(RADIUS, SEGMENTS), wallMat))
    .setTranslation([0, WALL_HEIGHT, 0])
    .setRotation([1, 0, 0, 0]) // flip to face downward
  scene.addChild(ceilingNode)

  // ── Walls (arc segments with archway gaps) ────────────────────────────

  const wallsNode = doc.createNode('Walls')
  scene.addChild(wallsNode)

  const archPositions = []
  for (let i = 0; i < NUM_ARCHWAYS; i++) {
    archPositions.push((i / NUM_ARCHWAYS) * Math.PI * 2)
  }

  for (let i = 0; i < NUM_ARCHWAYS; i++) {
    const gapEnd = archPositions[i] + ARCHWAY_WIDTH
    const nextGapStart = (i + 1 < NUM_ARCHWAYS)
      ? archPositions[i + 1] - ARCHWAY_WIDTH
      : archPositions[0] - ARCHWAY_WIDTH + Math.PI * 2

    const arcSegments = Math.max(4, Math.round(
      (nextGapStart - gapEnd) / (Math.PI * 2) * SEGMENTS
    ))

    const wallNode = doc.createNode(`WallSegment-${i + 1}`)
      .setMesh(createMesh(doc, buffer, `mesh-wall-${i + 1}`,
        buildWallArc(RADIUS, WALL_HEIGHT, gapEnd, nextGapStart, arcSegments), wallMat))
      .setTranslation([0, WALL_HEIGHT / 2, 0])
    wallsNode.addChild(wallNode)
  }

  // ── Columns ───────────────────────────────────────────────────────────

  const columnsNode = doc.createNode('Columns')
  scene.addChild(columnsNode)

  const columnGeom = buildCylinder(COLUMN_RADIUS, COLUMN_RADIUS, WALL_HEIGHT, 16)

  for (let i = 0; i < NUM_COLUMNS; i++) {
    const angle = (i / NUM_COLUMNS) * Math.PI * 2
    const r = RADIUS - COLUMN_INSET
    const colNode = doc.createNode(`Column-${i + 1}`)
      .setMesh(createMesh(doc, buffer, `mesh-column-${i + 1}`, columnGeom, columnMat))
      .setTranslation([Math.cos(angle) * r, WALL_HEIGHT / 2, Math.sin(angle) * r])
    columnsNode.addChild(colNode)
  }

  // ── Furniture ─────────────────────────────────────────────────────────

  const furnitureNode = doc.createNode('Furniture')
  scene.addChild(furnitureNode)

  // -- Central table: round top on metal pedestal --
  const tableNode = doc.createNode('Table-Center')
    .setTranslation([-3, 0, 0])

  tableNode.addChild(
    doc.createNode('Table-Center-Top')
      .setMesh(createMesh(doc, buffer, 'mesh-table-top', buildCylinder(1.2, 1.2, 0.08, 32), woodMat))
      .setTranslation([0, 0.75, 0])
  )
  tableNode.addChild(
    doc.createNode('Table-Center-Pedestal')
      .setMesh(createMesh(doc, buffer, 'mesh-table-pedestal', buildCylinder(0.15, 0.15, 0.7, 12), metalMat))
      .setTranslation([0, 0.38, 0])
  )
  tableNode.addChild(
    doc.createNode('Table-Center-Base')
      .setMesh(createMesh(doc, buffer, 'mesh-table-base', buildCylinder(0.5, 0.5, 0.05, 24), metalMat))
      .setTranslation([0, 0.025, 0])
  )

  furnitureNode.addChild(tableNode)

  // -- Credenzas (long low cabinets against walls) --
  function addCredenza(name, angle, distance) {
    const x = Math.cos(angle) * distance
    const z = Math.sin(angle) * distance

    const credNode = doc.createNode(name)
      .setTranslation([x, 0, z])
      .setRotation(yawToQuat(Math.atan2(-x, -z)))

    credNode.addChild(
      doc.createNode(`${name}-Body`)
        .setMesh(createMesh(doc, buffer, `mesh-${name}-body`, buildBox(2.0, 0.8, 0.5), woodLightMat))
        .setTranslation([0, 0.4, 0])
    )
    credNode.addChild(
      doc.createNode(`${name}-Top`)
        .setMesh(createMesh(doc, buffer, `mesh-${name}-top`, buildBox(2.1, 0.04, 0.55), stoneDarkMat))
        .setTranslation([0, 0.82, 0])
    )

    furnitureNode.addChild(credNode)
  }

  addCredenza('Credenza-North', Math.PI * 0.25, 8)
  addCredenza('Credenza-South', Math.PI * 1.25, 8)
  addCredenza('Credenza-East',  Math.PI * 0.75, 8)
  addCredenza('Credenza-West',  Math.PI * 1.75, 8)

  // -- Benches --
  function addBench(name, angle, distance) {
    const x = Math.cos(angle) * distance
    const z = Math.sin(angle) * distance

    const benchNode = doc.createNode(name)
      .setTranslation([x, 0, z])
      .setRotation(yawToQuat(Math.atan2(-x, -z)))

    benchNode.addChild(
      doc.createNode(`${name}-Seat`)
        .setMesh(createMesh(doc, buffer, `mesh-${name}-seat`, buildBox(1.5, 0.06, 0.45), woodMat))
        .setTranslation([0, 0.45, 0])
    )
    benchNode.addChild(
      doc.createNode(`${name}-LegLeft`)
        .setMesh(createMesh(doc, buffer, `mesh-${name}-leg-l`, buildBox(0.06, 0.42, 0.4), metalMat))
        .setTranslation([-0.6, 0.21, 0])
    )
    benchNode.addChild(
      doc.createNode(`${name}-LegRight`)
        .setMesh(createMesh(doc, buffer, `mesh-${name}-leg-r`, buildBox(0.06, 0.42, 0.4), metalMat))
        .setTranslation([0.6, 0.21, 0])
    )

    furnitureNode.addChild(benchNode)
  }

  addBench('Bench-NE', Math.PI * 0.15, 5)
  addBench('Bench-SE', Math.PI * 0.85, 5)
  addBench('Bench-SW', Math.PI * 1.15, 5)
  addBench('Bench-NW', Math.PI * 1.85, 5)

  // ── Fountain ──────────────────────────────────────────────────────────

  const fountainNode = doc.createNode('Fountain')
    .setTranslation([4.5, 0, 0])
  scene.addChild(fountainNode)

  fountainNode.addChild(
    doc.createNode('Fountain-Basin')
      .setMesh(createMesh(doc, buffer, 'mesh-fountain-basin', buildCylinder(1.8, 1.8, 0.4, 32), stoneDarkMat))
      .setTranslation([0, 0.2, 0])
  )

  fountainNode.addChild(
    doc.createNode('Fountain-Water')
      .setMesh(createMesh(doc, buffer, 'mesh-fountain-water', buildDisc(1.6, 32), waterMat))
      .setTranslation([0, 0.35, 0])
  )

  fountainNode.addChild(
    doc.createNode('Fountain-Pillar')
      .setMesh(createMesh(doc, buffer, 'mesh-fountain-pillar', buildCylinder(0.15, 0.15, 1.2, 12), columnMat))
      .setTranslation([0, 0.6, 0])
  )

  fountainNode.addChild(
    doc.createNode('Fountain-Sphere')
      .setMesh(createMesh(doc, buffer, 'mesh-fountain-sphere', buildSphere(0.3, 16, 12), metalMat))
      .setTranslation([0, 1.4, 0])
  )

  fountainNode.addChild(
    doc.createNode('Fountain-GlowRing')
      .setMesh(createMesh(doc, buffer, 'mesh-fountain-glow', buildTorus(2.0, 0.05, 48, 8), emissiveMat))
      .setTranslation([0, 0.02, 0])
  )

  // ── Atrium world metadata ─────────────────────────────────────────────

  doc.getRoot().setExtras({
    atrium: {
      name: 'The Atrium',
      description: 'A circular gathering space with fountain and seating.',
      author: 'Project Atrium',
      navigation: {
        mode: ['WALK', 'FLY', 'ORBIT'],
        terrainFollowing: false,
        speed: { default: 1.4, min: 0.5, max: 5.0 },
        collision: { enabled: false },
        updateRate: { positionInterval: 1000, maxViewRate: 20 },
      },
      background: {
        // library-sky (L25a): a root path, never a document-relative one. A
        // document-relative value is now refused like any other non-A1 value.
        texture: '/tests/fixtures/skyboxtest1.png',
        type: 'equirectangular',
      },
    },
  })

  // ── Write: embed buffer as base64 data URI for self-contained .gltf ───

  const io = new NodeIO()
  const { json, resources } = await io.writeJSON(doc)

  for (const buf of json.buffers ?? []) {
    if (buf.uri && !buf.uri.startsWith('data:')) {
      const data = resources[buf.uri]
      if (data) {
        buf.uri = 'data:application/octet-stream;base64,' +
          Buffer.from(data).toString('base64')
      }
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify(json, null, 2))

  const nodeCount = json.nodes?.length ?? 0
  const meshCount = json.meshes?.length ?? 0
  const matCount = json.materials?.length ?? 0
  console.log(`Written: ${OUT_PATH}`)
  console.log(`  ${nodeCount} nodes, ${meshCount} meshes, ${matCount} materials`)
}

main().catch(err => { console.error(err); process.exit(1) })
