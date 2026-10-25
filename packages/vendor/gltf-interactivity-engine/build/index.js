import * as glMatrix from 'gl-matrix';

/** Pre-resolve standard data edges into cached closures, without generated source. */
function compileValueOutputs(engine, nodes, standard, types) {
  const outputs = [];
  const signatures = types.map(t => t.signature),
    index = name => signatures.indexOf(name);
  const supported = type => /^(bool|int|float(?:[234](?:x[234])?)?)$/.test(signatures[type] ?? "");
  const scalar = (v, type) => signatures[type] === "bool" ? v === true || v === "true" : Number(v);
  const parse = (v, type) => ["int", "float", "bool"].includes(signatures[type]) ? scalar(v?.[0] ?? (signatures[type] === "float" ? NaN : signatures[type] === "bool" ? false : 0), type) : v ?? Array(Number(signatures[type].slice(5).split("x").reduce((n, v) => n * Number(v), 1))).fill(NaN);
  const read = cell => {
    if (cell.version !== Infinity && cell.version !== engine.valueEvaluationEpoch) {
      cell.value = cell.evaluate();
      cell.version = engine.valueEvaluationEpoch;
    }
    return cell.value;
  };
  const input = value => {
    if (!value) return undefined;
    if (value.node !== undefined) return outputs[Number(value.node)]?.[value.socket ?? "value"];
    const type = value.type;
    if (type === undefined || !supported(type)) return undefined;
    // Keep main's live-literal semantics when an editor changes value[0] or replaces the array.
    return {
      type,
      get value() {
        return parse(value.value, type);
      },
      version: Infinity,
      evaluate: () => parse(value.value, type)
    };
  };
  for (const [id, node] of nodes) {
    outputs[id] = {};
    const op = node.declaration.op;
    if (node.declaration.extension || node.constructor !== standard.get(op)) continue;
    let type = -1,
      evaluate;
    const a = input(node.values.a),
      b = input(node.values.b),
      kind = a ? signatures[a.type] : undefined;
    const numeric = a && ["float", "int"].includes(kind),
      matching = a && b && a.type === b.type;
    const av = a?.version === Infinity ? () => a.value : () => read(a),
      bv = b?.version === Infinity ? () => b.value : () => read(b);
    if (op === "variable/get") {
      const variable = engine.variables[node.configuration.variable?.value?.[0]];
      if (!variable) continue;
      type = variable.type;
      if (!supported(type)) continue;
      evaluate = signatures[type] === "bool" ? () => scalar(variable.value?.[0], type) : ["int", "float"].includes(signatures[type]) ? () => Number(variable.value?.[0]) : () => variable.value;
    } else if (op === "pointer/get") {
      type = node.configuration.type?.value?.[0];
      if (!supported(type)) continue;
      evaluate = () => {
        const result = node.processNode()?.value;
        if (!result) throw new Error("Missing pointer output");
        return parse(result.value, type);
      };
    } else if (/^math\/extract[234](?:x[234])?$/.test(op) && a && kind === "float" + op.slice(12)) {
      const count = Number(op.slice(12).split("x").reduce((n, v) => n * Number(v), 1));
      for (let j = 0; j < count; j++) outputs[id][String(j)] = {
        type: index("float"),
        value: 0,
        version: -1,
        evaluate: () => {
          engine.processNodeStarted(node);
          return av()[j];
        }
      };
      continue;
    } else if (/^math\/combine[234](?:x[234])?$/.test(op)) {
      const shape = op.slice(12),
        count = Number(shape.split("x").reduce((n, v) => n * Number(v), 1));
      const parts = Array.from({
        length: count
      }, (_, j) => input(node.values[String.fromCharCode(97 + j)]));
      if (parts.some(v => !v || signatures[v.type] !== "float")) continue;
      type = index("float" + shape);
      evaluate = () => parts.map(v => Number(read(v)));
    } else if (op === "math/select") {
      const condition = input(node.values.condition);
      if (!matching || signatures[condition?.type ?? -1] !== "bool") continue;
      type = a.type;
      evaluate = () => read(condition) ? av() : bv();
    } else if (op === "math/switch") {
      const fallback = input(node.values.default),
        selection = input(node.values.selection),
        cases = node.configuration.cases?.value ?? [];
      if (!fallback || signatures[selection?.type ?? -1] !== "int" || !cases.every(n => typeof n === "number" && n === (n | 0))) continue;
      const options = new Map();
      let valid = true;
      for (const n of cases) {
        const choice = input(node.values[String(n)]);
        if (!choice || choice.type !== fallback.type) {
          valid = false;
          break;
        }
        options.set(n, choice);
      }
      if (!valid) continue;
      type = fallback.type;
      evaluate = () => read(options.get(Number(read(selection))) ?? fallback);
    } else if (op.startsWith("type/") && a) {
      const conversions = {
        "type/floatToInt": ["float", "int", v => Number(v) | 0],
        "type/intToFloat": ["int", "float", Number],
        "type/boolToFloat": ["bool", "float", Number],
        "type/boolToInt": ["bool", "int", Number],
        "type/floatToBool": ["float", "bool", Boolean],
        "type/intToBool": ["int", "bool", Boolean]
      };
      const conversion = conversions[op];
      if (!conversion || kind !== conversion[0]) continue;
      type = index(conversion[1]);
      evaluate = () => conversion[2](av());
    } else if (op === "math/not" && a && ["int", "bool"].includes(kind)) {
      type = a.type;
      evaluate = kind === "bool" ? () => !av() : () => ~Number(av());
    } else if (matching && ["math/eq", "math/lt", "math/le", "math/gt", "math/ge"].includes(op)) {
      if (!["float", "int", "bool"].includes(kind) || op !== "math/eq" && !numeric) continue;
      type = index("bool");
      switch (op) {
        case "math/eq":
          evaluate = () => av() === bv();
          break;
        case "math/lt":
          evaluate = () => Number(av()) < Number(bv());
          break;
        case "math/le":
          evaluate = () => Number(av()) <= Number(bv());
          break;
        case "math/gt":
          evaluate = () => Number(av()) > Number(bv());
          break;
        case "math/ge":
          evaluate = () => Number(av()) >= Number(bv());
      }
    } else if (matching && ["math/and", "math/or", "math/xor", "math/lsl", "math/asr"].includes(op) && ["bool", "int"].includes(kind)) {
      type = a.type;
      if (kind === "bool") {
        if (op === "math/and") evaluate = () => {
          const x = av(),
            y = bv();
          return Boolean(x && y);
        };else if (op === "math/or") evaluate = () => {
          const x = av(),
            y = bv();
          return Boolean(x || y);
        };else if (op === "math/xor") evaluate = () => av() !== bv();
      } else switch (op) {
        case "math/and":
          evaluate = () => Number(av()) & Number(bv());
          break;
        case "math/or":
          evaluate = () => Number(av()) | Number(bv());
          break;
        case "math/xor":
          evaluate = () => Number(av()) ^ Number(bv());
          break;
        case "math/lsl":
          evaluate = () => Number(av()) << Number(bv());
          break;
        case "math/asr":
          evaluate = () => Number(av()) >> Number(bv());
          break;
      }
    } else if (matching && numeric) {
      type = a.type;
      const wrap = v => kind === "int" ? v | 0 : v;
      switch (op) {
        case "math/add":
          evaluate = () => wrap(Number(av()) + Number(bv()));
          break;
        case "math/sub":
          evaluate = () => wrap(Number(av()) - Number(bv()));
          break;
        case "math/mul":
          evaluate = kind === "int" ? () => Math.imul(Number(av()), Number(bv())) : () => Number(av()) * Number(bv());
          break;
        case "math/div":
          evaluate = () => wrap(Number(av()) / Number(bv()));
          break;
        case "math/rem":
          evaluate = () => wrap(Number(av()) % Number(bv()));
          break;
      }
    } else if (a && kind === "float") {
      type = a.type;
      if (op === "math/floor") evaluate = () => Math.floor(Number(av()));else if (op === "math/trunc") evaluate = () => Math.trunc(Number(av()));
    }
    if (evaluate && type >= 0) {
      const calculate = evaluate;
      outputs[id].value = {
        type,
        value: 0,
        version: -1,
        evaluate: () => {
          if (op !== "pointer/get") engine.processNodeStarted(node);
          return calculate();
        }
      };
    }
  }
  return outputs;
}

/** Pre-bind common synchronous control nodes; custom/opaque inputs retain the interpreter. */
function compileControlNodes(engine, nodes, standard, outputs, types) {
  const reader = v => {
    if (!v) return undefined;
    if (v.node !== undefined) {
      const cell = outputs[Number(v.node)]?.[v.socket ?? "value"];
      if (!cell) return undefined;
      return () => {
        if (cell.version !== Infinity && cell.version !== engine.valueEvaluationEpoch) {
          cell.value = cell.evaluate();
          cell.version = engine.valueEvaluationEpoch;
        }
        return cell.value;
      };
    }
    const name = types[v.type]?.signature;
    if (!name || !/^(bool|int|float(?:[234](?:x[234])?)?)$/.test(name)) return undefined;
    const value = v.value ?? (name === "bool" ? [false] : name === "int" ? [0] : Array(name === "float" ? 1 : Number(name.slice(5).split("x").reduce((n, v) => n * Number(v), 1))).fill(NaN));
    return () => {
      const current = v.value ?? value;
      return ["int", "float"].includes(name) ? Number(current[0]) : name === "bool" ? current[0] === true || current[0] === "true" : current;
    };
  };
  for (const node of nodes.values()) {
    const op = node.declaration.op;
    if (node.declaration.extension || node.constructor !== standard.get(op)) continue;
    const flow = socket => {
      const edge = node.flows[socket],
        target = edge ? nodes.get(Number(edge.node)) : undefined;
      if (!edge || !target || !target.INPUT_FLOWS.includes(edge.socket ?? "in")) return () => {/*no-op*/};
      return () => {
        engine.processExecutingNextNode(edge);
        target.processNode(edge.socket);
      };
    };
    if (op === "variable/set") {
      const ids = node.configuration.variables.value.map(Number),
        getters = ids.map(id => reader(node.values[String(id)]));
      if (getters.some(v => !v)) continue;
      const variables = ids.map(id => engine.variables[id]),
        values = [],
        next = flow("out");
      node.processNode = () => {
        engine.clearValueEvaluationCache();
        for (let j = 0; j < getters.length; j++) values[j] = getters[j]();
        engine.processNodeStarted(node);
        for (let j = 0; j < ids.length; j++) {
          engine.clearVariableInterpolation(ids[j]);
          const v = values[j];
          variables[j].value = Array.isArray(v) ? v : [v];
        }
        next();
      };
    } else if (op === "flow/branch") {
      const condition = reader(node.values.condition);
      if (!condition) continue;
      const yes = flow("true"),
        no = flow("false");
      node.processNode = () => {
        engine.clearValueEvaluationCache();
        const c = condition();
        engine.processNodeStarted(node);
        if (c) yes();else no();
      };
    } else if (op === "flow/sequence") {
      const flows = Object.keys(node.flows).sort().map(flow);
      node.processNode = () => {
        engine.clearValueEvaluationCache();
        engine.processNodeStarted(node);
        for (const activate of flows) activate();
      };
    }
  }
  // Recover constant decision tables from balanced standard branch trees.
  // Debug/custom execution hooks use the original per-node path.
  for (const root of nodes.values()) {
    if (root.declaration.op !== "flow/branch" || root.constructor !== standard.get("flow/branch")) continue;
    const first = root.values.condition,
      comparison = first?.node === undefined ? undefined : nodes.get(Number(first.node));
    if (!comparison || !["math/lt", "math/eq"].includes(comparison.declaration.op)) continue;
    const selection = comparison.values.a,
      getSelection = reader(selection);
    if (!getSelection || selection?.node === undefined) continue;
    const equal = v => v?.node === selection.node && (v?.socket ?? "value") === (selection.socket ?? "value");
    let size = 0;
    const active = new Set();
    const build = n => {
      if (active.has(n.index) || n.declaration.extension || n.constructor !== standard.get("flow/branch")) return undefined;
      const source = n.values.condition?.node,
        c = source === undefined ? undefined : nodes.get(Number(source));
      if (!c || !outputs[c.index]?.value || c.declaration.extension || c.constructor !== standard.get(c.declaration.op) || !["math/lt", "math/eq"].includes(c.declaration.op) || !equal(c.values.a) || c.values.b?.type === undefined || types[c.values.b.type]?.signature !== "int" || c.values.b.node !== undefined || c.values.b.value?.length !== 1) return undefined;
      active.add(n.index);
      size++;
      const edge = socket => {
        const f = n.flows[socket],
          target = f ? nodes.get(Number(f.node)) : undefined;
        if (!f || !target || !target.INPUT_FLOWS.includes(f.socket ?? "in")) return () => {/*no-op*/};
        return build(target) ?? (() => {
          engine.processExecutingNextNode(f);
          target.processNode(f.socket);
        });
      };
      const result = {
        op: c.declaration.op,
        get limit() {
          return Number(c.values.b.value?.[0]);
        },
        yes: edge("true"),
        no: edge("false")
      };
      active.delete(n.index);
      return result;
    };
    const tree = build(root);
    if (!tree || size < 3) continue;
    const fallback = root.processNode.bind(root);
    root.processNode = socket => {
      if (engine.hasExecutionHooks()) {
        fallback(socket);
        return;
      }
      engine.clearValueEvaluationCache();
      const selected = Number(getSelection());
      let current = tree;
      while (typeof current !== "function") current = (current.op === "math/lt" ? selected < current.limit : selected === current.limit) ? current.yes : current.no;
      current();
    };
  }
}

var TrieNodeType = /*#__PURE__*/function (TrieNodeType) {
  TrieNodeType[TrieNodeType["ROOT"] = 0] = "ROOT";
  TrieNodeType[TrieNodeType["STRING"] = 1] = "STRING";
  TrieNodeType[TrieNodeType["INDEX"] = 2] = "INDEX";
  return TrieNodeType;
}(TrieNodeType || {});
class TrieNode {
  children;
  isEndOfPath;
  trieNodeType;
  setterCallback;
  getterCallback;
  typeName;
  readOnly;
  // the single numeric child; its key is the exclusive upper bound of the indices it matches
  indexKey;
  indexBound;
  constructor(type) {
    this.children = new Map();
    this.isEndOfPath = false;
    this.trieNodeType = type;
    this.readOnly = false;
    this.indexKey = undefined;
    this.indexBound = 0;
  }
  getValue(path) {
    return this.getterCallback?.(path);
  }
  setValue(path, value) {
    this.setterCallback?.(path, value);
  }
}
class JsonPtrTrie {
  root;
  constructor() {
    this.root = new TrieNode(TrieNodeType.ROOT);
  }

  /**
   * Adds a path to the JSON Pointer Trie along with getter and setter callbacks.
   * @param path - The JSON Pointer path to add.
   * @param getterCallback - A callback function to get the value at the specified path.
   * @param setterCallback - A callback function to set the value at the specified path.
   */
  addPath(path, getterCallback, setterCallback, typeName, readOnly) {
    const pathPieces = path.split('/');
    let currentNode = this.root;
    for (let i = 0; i < pathPieces.length; i++) {
      const pathPiece = pathPieces[i];
      if (!currentNode.children.has(pathPiece)) {
        let nodeToSet;
        if (isNaN(Number(pathPiece))) {
          nodeToSet = new TrieNode(TrieNodeType.STRING);
        } else {
          // a numeric segment re-keys the existing index child instead of adding a second one
          if (currentNode.indexKey === undefined) {
            nodeToSet = new TrieNode(TrieNodeType.INDEX);
          } else {
            nodeToSet = currentNode.children.get(currentNode.indexKey);
            currentNode.children.delete(currentNode.indexKey);
          }
          currentNode.indexKey = pathPiece;
          currentNode.indexBound = Number(pathPiece);
        }
        currentNode.children.set(pathPiece, nodeToSet);
      }
      currentNode = currentNode.children.get(pathPiece);
    }
    currentNode.isEndOfPath = true;
    currentNode.getterCallback = getterCallback;
    currentNode.setterCallback = setterCallback;
    currentNode.typeName = typeName;
    currentNode.readOnly = readOnly;
  }
  removePath(path) {
    const pathPieces = path.split('/');
    let currentNode = this.root;
    for (let i = 0; i < pathPieces.length - 1; i++) {
      const pathPiece = pathPieces[i];
      const child = currentNode.children.get(pathPiece);
      if (!child) {
        return;
      }
      currentNode = child;
    }
    const lastPiece = pathPieces[pathPieces.length - 1];
    currentNode.children.delete(lastPiece);
    if (currentNode.indexKey === lastPiece) {
      currentNode.indexKey = undefined;
      currentNode.indexBound = 0;
    }
  }

  /** The registered entry for a JSON pointer, or undefined if the path is not a registered pointer. */
  resolve(path) {
    const node = this.traversePath(path);
    return node !== undefined && node.isEndOfPath ? node : undefined;
  }

  /**
   * Checks if a given JSON Pointer path is valid within the Trie.
   * @param path - The JSON Pointer path to validate.
   * @returns `true` if the path is valid, `false` otherwise.
   */
  isPathValid(path) {
    return this.resolve(path) !== undefined;
  }
  isReadOnly(path) {
    return this.resolve(path)?.readOnly ?? false;
  }

  /**
   * Retrieves the value at a specified JSON Pointer path.
   * @param path - The JSON Pointer path to retrieve the value from.
   * @returns The value at the specified path.
   */
  getPathValue(path) {
    return this.resolve(path)?.getValue(path);
  }
  getPathTypeName(path) {
    return this.resolve(path)?.typeName;
  }

  /**
   * Sets the value at a specified JSON Pointer path.
   * @param path - The JSON Pointer path to set the value for.
   * @param value - The value to set at the specified path.
   */
  setPathValue(path, value) {
    return this.resolve(path)?.setValue(path, value);
  }

  /**
   * Returns all registered paths exactly as they were added to the trie.
   */
  getRegisteredPaths() {
    const paths = [];
    const walk = (node, segments) => {
      if (node.isEndOfPath) {
        paths.push(segments.join("/"));
      }
      for (const [segment, child] of node.children.entries()) {
        walk(child, [...segments, segment]);
      }
    };
    walk(this.root, []);
    return paths.sort();
  }
  traversePath(path) {
    const pathPieces = path.split('/');
    let currentNode = this.root;
    for (let i = 0; i < pathPieces.length; i++) {
      const pathPiece = pathPieces[i];
      let child = currentNode.children.get(pathPiece);
      if (child === undefined) {
        // a numeric piece matches the index child when 0 <= piece < its key
        const index = Number(pathPiece);
        if (isNaN(index) || currentNode.indexKey === undefined || index >= currentNode.indexBound || index < 0) {
          return undefined;
        }
        child = currentNode.children.get(currentNode.indexKey);
      }
      currentNode = child;
    }
    return currentNode;
  }
}

/** Tracks which node instances are NoOpNode, without BehaveEngineNode needing to import NoOp.ts (avoids a circular import, since NoOp.ts extends BehaveEngineNode). */
const noOpNodes = new WeakSet();
function registerNoOpNode(node) {
  noOpNodes.add(node);
}
function isNoOpNode(node) {
  return noOpNodes.has(node);
}

// JSON Pointer Template parsing and effective pointer generation (KHR_interactivity, Object Model Access)

const decodeJsonPointerToken = token => token.replace(/~1/g, "/").replace(/~0/g, "~");
const hasTemplateDelimiter = value => ["[", "]", "{", "}"].some(delimiter => value.includes(delimiter));
const isValidJsonPointer = path => {
  return (path === "" || path.startsWith("/")) && !/(^|[^~])~([^01]|$)/.test(path);
};
const hasOddDelimiterRun = (segment, delimiter) => {
  const escapedDelimiter = delimiter.replace(/[[\]{}]/g, "\\$&");
  return (segment.match(new RegExp(`${escapedDelimiter}+`, "g")) ?? []).some(run => run.length % 2 === 1);
};

// spec: a segment is a parameter if it starts with a single "[" (index) or "{" (ref); doubled brackets are literals
const segmentParameterKind = segment => {
  if (segment[0] === "[" && segment[1] !== "[") return "index";
  if (segment[0] === "{" && segment[1] !== "{") return "ref";
  return undefined;
};
const parsePathTemplate = path => {
  const sockets = [];
  const seenSocketIds = new Set();
  if (!isValidJsonPointer(path)) {
    return {
      valid: false,
      sockets: []
    };
  }
  for (const segment of path.split("/")) {
    if (segment === "[" || segment === "{") {
      return {
        valid: false,
        sockets: []
      };
    }
    const kind = segmentParameterKind(segment);
    if (kind === undefined) {
      if (hasOddDelimiterRun(segment, "[") || hasOddDelimiterRun(segment, "]") || hasOddDelimiterRun(segment, "{") || hasOddDelimiterRun(segment, "}")) {
        return {
          valid: false,
          sockets: []
        };
      }
      continue;
    }
    const encodedId = segment.slice(1, -1);
    if (!segment.endsWith(kind === "index" ? "]" : "}") || encodedId.length === 0 || hasTemplateDelimiter(encodedId)) {
      return {
        valid: false,
        sockets: []
      };
    }
    const id = decodeJsonPointerToken(encodedId);
    if (seenSocketIds.has(id)) {
      return {
        valid: false,
        sockets: []
      };
    }
    seenSocketIds.add(id);
    sockets.push({
      id,
      kind
    });
  }
  return {
    valid: true,
    sockets
  };
};

/** Literal text (doubled brackets already collapsed) alternating with parameter sockets. */

/** Splits a valid template once so effective pointers can be generated without re-parsing it. */
const compilePathTemplate = path => {
  const parts = [];
  let literal = "";
  path.split("/").forEach((segment, i) => {
    if (i > 0) {
      literal += "/";
    }
    const kind = segmentParameterKind(segment);
    if (kind === undefined) {
      literal += segment.replace(/\[\[/g, "[").replace(/]]/g, "]").replace(/{{/g, "{").replace(/}}/g, "}");
      return;
    }
    parts.push(literal, {
      id: decodeJsonPointerToken(segment.slice(1, -1)),
      kind
    });
    literal = "";
  });
  parts.push(literal);
  return parts;
};
const fillPathTemplate = (template, resolve) => {
  let path = "";
  for (const part of template) {
    path += typeof part === "string" ? part : resolve(part);
  }
  return path;
};

// type names per graph `types` array, shared by all nodes of a graph
const typeNameCache = new WeakMap();
const typeSignatureName = type => type?.signature === "custom" && type?.extensions ? Object.keys(type.extensions)[0] : type.signature;
const LITERAL_INPUT = 0;
const CONNECTED_INPUT = 1;
const DEFAULT_INPUT = 2;

// an input socket resolved on first evaluation; reused while the node still holds the same socket object

const warnIfSingleElementArray = val => {
  if (Array.isArray(val) && val.length === 1) {
    console.error("This should not happen – an array with a single value was returned");
  }
};
class BehaveEngineNode {
  REQUIRED_VALUES = {};
  REQUIRED_CONFIGURATIONS = {};
  // input flow socket ids of the operation; empty for value and event operations
  INPUT_FLOWS = [];
  index;
  name;
  world;
  graphEngine;
  idToBehaviourNodeMap;
  flows;
  values;
  outValues;
  declaration;
  variables;
  types;
  events;
  configuration;
  addEventToWorkQueue;
  // all outputs of the last processNode() pull, valid while the engine's evaluation epoch is unchanged
  outputCache;
  outputCacheEpoch = -1;
  typeNameList;
  typeNameSource;
  preparedInputs;
  requiredValueKeys;
  requiredValueKeysSource;
  compiledPointer;
  compiledPointerSource;
  constructor(props) {
    const {
      index,
      flows,
      values,
      idToBehaviourNodeMap,
      graphEngine,
      variables,
      events,
      types,
      configuration,
      addEventToWorkQueue,
      declaration
    } = props;
    this.index = index;
    this.idToBehaviourNodeMap = idToBehaviourNodeMap;
    this.graphEngine = graphEngine;
    this.variables = variables;
    this.types = types;
    this.events = events;
    this.values = values;
    this.flows = flows;
    this.configuration = configuration;
    this.outValues = {};
    this.addEventToWorkQueue = flow => {
      const nextNode = flow?.node === undefined ? undefined : this.idToBehaviourNodeMap.get(Number(flow.node));
      if (nextNode !== undefined && !nextNode.INPUT_FLOWS.includes(flow.socket ?? "in")) {
        return;
      }
      addEventToWorkQueue(flow);
    };
    this.declaration = declaration;
  }

  /**
   * Initializes and returns a new BehaveEngineNode instance.
   * @param props - The properties and settings for the BehaveEngineNode.
   * @returns A new BehaveEngineNode instance.
   */
  static init(props) {
    return new this(props);
  }

  /**
   * Processes the node and its associated flow.
   * @param flowSocket - The socket associated with the flow (optional).
   */
  processNode(flowSocket) {
    if (this.flows !== undefined && this.flows.out !== undefined) {
      this.processFlow(this.flows.out);
    }
  }

  /**
   * Processes a specific flow associated with this node.
   * @param flow - The flow object to be processed.
   */
  processFlow(flow) {
    if (flow === undefined || flow.node === undefined) {
      return;
    }
    const nextNode = this.idToBehaviourNodeMap.get(Number(flow.node));
    // spec: a flow to an input socket the target does not have is unconnected
    if (nextNode === undefined || !nextNode.INPUT_FLOWS.includes(flow.socket ?? "in")) {
      return;
    }
    this.graphEngine.processExecutingNextNode(flow);
    nextNode.processNode(flow.socket);
  }

  /**
   * Validates the presence of required values.
   * @param values - An object containing values to be validated.
   * @throws An error if a required value is missing.
   */
  validateValues(values) {
    Object.keys(this.REQUIRED_VALUES).forEach(requiredValue => {
      if (values == null || values[requiredValue] == null) {
        const err = `Required Value ${requiredValue} is missing for ${this.name}`;
        console.error(err);
        throw new Error(err);
      }
    });
  }

  /**
   * Validates the presence of required configurations.
   * @param configurations - An object containing configurations to be validated.
   * @throws An error if a required configuration is missing.
   */
  validateConfigurations(configurations) {
    let isMissingConfigs = false;
    Object.entries(this.REQUIRED_CONFIGURATIONS).forEach(([key, value]) => {
      if (configurations[key] == null) {
        if (value.defaultValue == null) {
          const err = `Required Configuration ${key} is missing and there is no default value provided for ${this.name}`;
          console.error(err);
          throw new Error(err);
        } else {
          configurations[key] = {
            value: value.defaultValue
          };
          isMissingConfigs = true;
        }
      }
    });
    if (isMissingConfigs) {
      Object.entries(this.REQUIRED_CONFIGURATIONS).forEach(([key, value]) => {
        configurations[key] = {
          value: value.defaultValue
        };
      });
    }

    // spec: value validation (type, range, allowed values) is done by each node, which falls back to its default configuration
  }

  /**
   * Evaluates all values based on their definitions.
   * @param vals - An array of value names to be evaluated.
   * @returns An object containing the evaluated values.
   */
  evaluateAllValues(vals) {
    const res = {};
    for (let i = 0; i < vals.length; i++) {
      res[vals[i]] = this.evaluateValue(vals[i], this.values[vals[i]]);
    }
    return res;
  }

  /** evaluateAllValues over the keys of REQUIRED_VALUES. */
  evaluateRequiredValues() {
    if (this.requiredValueKeysSource !== this.REQUIRED_VALUES) {
      this.requiredValueKeys = Object.keys(this.REQUIRED_VALUES);
      this.requiredValueKeysSource = this.REQUIRED_VALUES;
    }
    return this.evaluateAllValues(this.requiredValueKeys);
  }
  evaluateValue(key, val) {
    if (val === undefined) {
      throw new Error(`Value ${key} is missing for ${this.name}`);
    }
    let input = this.preparedInputs === undefined ? undefined : this.preparedInputs.get(key);
    if (input === undefined || input.source !== val || input.kind === LITERAL_INPUT && (val.value !== input.rawValue || !Object.is(val.value[0], input.rawFirst) || val.type !== input.rawType)) {
      input = this.prepareInput(key, val);
      if (input === undefined) {
        return undefined;
      }
    }
    if (input.kind === LITERAL_INPUT) {
      return input.parsed;
    }
    if (input.kind === CONNECTED_INPUT) {
      const compiled = this.graphEngine.getCompiledOutput(input.node.index, input.socket);
      if (compiled !== undefined) {
        input.source.type = compiled.type;
        return compiled.value;
      }
      const output = this.pullOutput(input.node, input.socket);
      const type = output.type;
      input.source.type = type;
      if (type !== input.typeIndex) {
        input.typeIndex = type;
        input.typeName = this.getType(type);
        const result = this.parseType(input.typeName, output.value);
        warnIfSingleElementArray(result);
        return result;
      }
      return this.parseType(input.typeName, output.value);
    }
    // spec: neither value nor node -> type-default value
    return this.parseType(input.typeName, this.getDefaultValueForType(input.typeName));
  }
  prepareInput(key, val) {
    let input;
    if (val.value != null) {
      const typeName = this.getType(val.type);
      const parsed = this.parseType(typeName, val.value);
      warnIfSingleElementArray(parsed);
      input = {
        source: val,
        kind: LITERAL_INPUT,
        rawValue: val.value,
        rawFirst: val.value[0],
        rawType: val.type,
        parsed,
        typeIndex: val.type,
        typeName,
        node: undefined,
        socket: ""
      };
    } else if (val.node != null) {
      // evaluation writes the resolved type into the socket; write into a copy, not the caller's object
      const source = {
        ...val
      };
      this.values[key] = source;
      const node = this.idToBehaviourNodeMap.get(Number(val.node));
      input = {
        source,
        kind: CONNECTED_INPUT,
        rawValue: undefined,
        rawFirst: undefined,
        rawType: undefined,
        parsed: undefined,
        typeIndex: undefined,
        typeName: "",
        node,
        socket: val.socket
      };
    } else if (val.type != null) {
      input = {
        source: val,
        kind: DEFAULT_INPUT,
        rawValue: undefined,
        rawFirst: undefined,
        rawType: undefined,
        parsed: undefined,
        typeIndex: val.type,
        typeName: this.getType(val.type),
        node: undefined,
        socket: ""
      };
    } else {
      return undefined;
    }
    if (this.preparedInputs === undefined) {
      this.preparedInputs = new Map();
    }
    this.preparedInputs.set(key, input);
    return input;
  }

  // output of another node's socket: this epoch's cached result, then its stored outValues, else process it
  pullOutput(dependentNode, socket) {
    if (dependentNode.outputCacheEpoch === this.graphEngine.valueEvaluationEpoch) {
      const cached = dependentNode.outputCache[socket];
      if (cached !== undefined) {
        return cached;
      }
    }
    const stored = dependentNode.outValues === undefined ? undefined : dependentNode.outValues[socket];
    if (stored !== undefined) {
      return stored;
    }
    const outputs = dependentNode.processNode();
    if (outputs === undefined || outputs[socket] === undefined) {
      if (isNoOpNode(dependentNode)) {
        throw new Error(`"${this.name}" depends on output socket "${socket}" of "${dependentNode.name}", which does not execute or produce output because this tool does not implement its operation.`);
      }
      throw new Error(`Output socket ${socket} is missing on ${dependentNode.name}`);
    }
    dependentNode.outputCache = outputs;
    dependentNode.outputCacheEpoch = this.graphEngine.valueEvaluationEpoch;
    return outputs[socket];
  }

  /**
   * Evaluates all configurations based on their definitions.
   * @param configs - An array of configuration names to be evaluated.
   * @returns An object containing the evaluated configuration values.
   */
  evaluateAllConfigurations(configs) {
    const res = {};
    for (let i = 0; i < configs.length; i++) {
      res[configs[i]] = this.evaluateConfiguration(this.configuration[configs[i]]);
    }
    return res;
  }
  typeNames() {
    let names = this.typeNameList;
    if (names === undefined || this.typeNameSource !== this.types || names.length !== this.types.length) {
      names = typeNameCache.get(this.types);
      if (names === undefined || names.length !== this.types.length) {
        names = this.types.map(typeSignatureName);
        typeNameCache.set(this.types, names);
      }
      this.typeNameList = names;
      this.typeNameSource = this.types;
    }
    return names;
  }
  getType(id) {
    const name = this.typeNames()[id];
    if (name === undefined) {
      console.log(id);
      console.log(this.types);
      return typeSignatureName(this.types[id]);
    }
    return name;
  }
  getTypeIndex(name) {
    return this.typeNames().indexOf(name);
  }
  getDefaultValueForType(type) {
    switch (type) {
      case "ref":
        return [null];
      case "bool":
        return [false];
      case "int":
        return [0];
      case "float":
        return [NaN];
      case "float2":
        return [NaN, NaN];
      case "float3":
        return [NaN, NaN, NaN];
      case "float4":
      case "float2x2":
        return [NaN, NaN, NaN, NaN];
      case "float3x3":
        return [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN];
      case "float4x4":
        return [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN];
      default:
        console.error(`No default value for type ${type} returning NaN which is probably not valid`);
        return [NaN];
    }
  }
  parseType(type, val) {
    const scalarValue = Array.isArray(val) ? val[0] : val;
    switch (type) {
      case "bool":
        return scalarValue === "true" || scalarValue === true;
      case "int":
        return Number(scalarValue);
      case "float":
        return Number(scalarValue);
      case "float2":
        return val;
      case "float3":
        return val;
      case "float4":
        return val;
      case "float4x4":
        return val;
      case "ref":
        // spec: a ref literal that cannot be resolved is a null reference; "" is the document root, never an object
        return scalarValue === "" ? null : scalarValue;
      default:
        return val;
    }
  }
  evaluateConfiguration(configuration) {
    return configuration.value;
  }

  // Resolve a "#/..."-style JSON pointer ref down to its trailing id.
  resolveRef = ref => {
    if (ref == null || ref === "") {
      return -1;
    }
    // last non-empty "/" segment
    const str = String(ref);
    let end = str.length;
    while (end > 0 && str.charCodeAt(end - 1) === 47) {
      end--;
    }
    return end === 0 ? -1 : Number(str.slice(str.lastIndexOf("/", end - 1) + 1, end));
  };
  populatePath(path, refs, indices) {
    if (this.compiledPointerSource !== path) {
      this.compiledPointer = compilePathTemplate(path);
      this.compiledPointerSource = path;
    }
    const template = this.compiledPointer;
    if (template.length === 1) {
      return template[0];
    }
    return fillPathTemplate(template, ({
      id,
      kind
    }) => {
      if (kind === "index") {
        return String(indices[id]);
      }
      const index = this.resolveRef(refs[id]);
      if (index === -1) {
        throw new Error(`Invalid reference value for ${id}: ${refs[id]}`);
      }
      return index.toString();
    });
  }

  // spec pointer/set + pointer/interpolate steps 2-4: negative index, null ref, unresolvable,
  // type mismatch or immutable property -> undefined (caller activates err)
  resolveWritablePointer(pointer, refs, indices, typeName) {
    for (const id in indices) {
      if (Number(indices[id]) < 0) {
        return undefined;
      }
    }
    for (const id in refs) {
      if (this.resolveRef(refs[id]) === -1) {
        return undefined;
      }
    }
    const path = this.populatePath(pointer, refs, indices);
    const entry = this.graphEngine.resolveJsonPtr(path);
    if (entry === undefined || entry.typeName !== typeName || entry.readOnly) {
      return undefined;
    }
    return {
      path,
      entry
    };
  }
  parsePathRefVariables(path) {
    return this.parsePathTemplateSockets(path, "ref");
  }
  parsePathIndexVariables(path) {
    return this.parsePathTemplateSockets(path, "index");
  }

  // spec: an invalid pointer template makes the node invalid and the graph must be rejected
  parsePathTemplateSockets(path, kind) {
    const {
      valid,
      sockets
    } = parsePathTemplate(path);
    if (!valid) {
      throw new Error(`Invalid JSON pointer template: ${path}`);
    }
    return sockets.filter(socket => socket.kind === kind).map(socket => socket.id);
  }
}

class OnStartNode extends BehaveEngineNode {
  constructor(props) {
    super(props);
    this.name = "OnStart";
    this.outValues.event = {
      value: [`/extensions/KHR_interactivity/events/${this.events.length}`],
      type: this.getTypeIndex('ref')
    };
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    return super.processNode(flowSocket);
  }
}

class OnTickNode extends BehaveEngineNode {
  _startTime = NaN;
  _lastTickTime = NaN;
  _floatTypeIndex = -1;
  _refTypeIndex = -1;
  constructor(props) {
    super(props);
    this.name = "OnTick";
    this._floatTypeIndex = this.getTypeIndex('float');
    this._refTypeIndex = this.getTypeIndex('ref');
    this.outValues.event = {
      value: [`/extensions/KHR_interactivity/events/${this.events.length + 1}`],
      type: this._refTypeIndex
    };
    this.outValues.timeSinceStart = {
      value: [NaN],
      type: this._floatTypeIndex
    };
    this.outValues.timeSinceLastTick = {
      value: [NaN],
      type: this._floatTypeIndex
    };
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    const tickTime = this.graphEngine.lastTickTime / 1000;
    if (isNaN(this._startTime)) {
      this.outValues.timeSinceStart = {
        value: [0],
        type: this._floatTypeIndex
      };
      this.outValues.timeSinceLastTick = {
        value: [NaN],
        type: this._floatTypeIndex
      };
      this._startTime = tickTime;
    } else {
      this.outValues.timeSinceStart = {
        value: [tickTime - this._startTime],
        type: this._floatTypeIndex
      };
      this.outValues.timeSinceLastTick = {
        value: [tickTime - this._lastTickTime],
        type: this._floatTypeIndex
      };
    }
    this._lastTickTime = tickTime;
    return super.processNode(flowSocket);
  }
}

class Branch extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    condition: {}
  };
  constructor(props) {
    super(props);
    this.name = "Branch";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      condition
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    if (typeof condition === "boolean" ? condition : JSON.parse(condition)) {
      if (this.flows.true != null) {
        this.processFlow(this.flows.true);
      }
    } else {
      if (this.flows.false != null) {
        this.processFlow(this.flows.false);
      }
    }
  }
}

class DoN extends BehaveEngineNode {
  INPUT_FLOWS = ["in", "reset"];
  REQUIRED_VALUES = {
    n: {}
  };
  _currentCount;
  constructor(props) {
    super(props);
    this.name = "DoN";
    this.validateValues(this.values);
    this._currentCount = 0;
    this.outValues.currentCount = {
      value: [this._currentCount],
      type: this.getTypeIndex('int')
    };
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      n
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    if (flowSocket === "reset") {
      this._currentCount = 0;
      this.outValues.currentCount = {
        value: [this._currentCount],
        type: this.getTypeIndex('int')
      };
      return;
    }
    if (this._currentCount >= Number(n)) {
      return;
    }
    this._currentCount++;
    this.outValues.currentCount = {
      value: [this._currentCount],
      type: this.getTypeIndex('int')
    };
    super.processNode(flowSocket);
  }
}

class ForLoop extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_CONFIGURATIONS = {
    initialIndex: {
      defaultValue: [0]
    }
  };
  REQUIRED_VALUES = {
    startIndex: {},
    endIndex: {}
  };
  _initialIndex;
  constructor(props) {
    super(props);
    this.name = "ForLoop";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      initialIndex
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    // spec: initialIndex must be an int32, otherwise the default configuration (0) is used
    const init = initialIndex?.[0];
    this._initialIndex = init === (init | 0) ? init : 0;
    this.outValues.index = {
      value: [this._initialIndex],
      type: this.getTypeIndex('int')
    };
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      startIndex
    } = this.evaluateAllValues(["startIndex"]);
    this.graphEngine.processNodeStarted(this);
    // spec: index = startIndex, then re-evaluate endIndex before each iteration; index is never forced to endIndex
    let index = Number(startIndex);
    const intType = this.getTypeIndex('int');
    this.outValues.index = {
      value: [index],
      type: intType
    };
    const evaluateEndIndex = () => {
      this.graphEngine.clearValueEvaluationCache();
      return Number(this.evaluateAllValues(["endIndex"]).endIndex);
    };
    while (index < evaluateEndIndex()) {
      if (this.flows.loopBody != null) {
        this.processFlow(this.flows.loopBody);
      }
      index++;
      this.outValues.index = {
        value: [index],
        type: intType
      };
    }
    if (this.flows.completed != null) {
      this.processFlow(this.flows.completed);
    }
  }
}

class MultiGate extends BehaveEngineNode {
  INPUT_FLOWS = ["in", "reset"];
  REQUIRED_CONFIGURATIONS = {
    isRandom: {
      defaultValue: [false]
    },
    isLoop: {
      defaultValue: [false]
    }
  };
  _numberOutputFlows;
  _currentIndex;
  _isRandom;
  _isLoop;
  _orderedOutFlows;
  _unSeenOutIndexes;
  constructor(props) {
    super(props);
    this.name = "MultiGate";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      isRandom,
      isLoop
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._numberOutputFlows = Object.keys(this.flows).length;
    // spec: if any configuration value is invalid, the node uses the default configuration
    const isValid = typeof isRandom?.[0] === "boolean" && typeof isLoop?.[0] === "boolean";
    this._isRandom = isValid ? isRandom[0] : false;
    this._isLoop = isValid ? isLoop[0] : false;
    this._orderedOutFlows = Object.keys(this.flows).sort();
    this._unSeenOutIndexes = Array(this._numberOutputFlows).fill(0).map((_, index) => index);
    this._currentIndex = this._isRandom ? Math.floor(Math.random() * this._unSeenOutIndexes.length) : 0;
    this.outValues.lastIndex = {
      value: [-1],
      type: this.getTypeIndex('int')
    };
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    this.graphEngine.processNodeStarted(this);
    if (flowSocket === "reset") {
      this._currentIndex = this._isRandom ? Math.floor(Math.random() * this._unSeenOutIndexes.length) : 0;
      this._unSeenOutIndexes = Array(this._numberOutputFlows).fill(0).map((_, index) => index);
      this.outValues.lastIndex = {
        value: [-1],
        type: this.getTypeIndex('int')
      };
      return;
    }
    if (this._unSeenOutIndexes.length === 0) {
      return;
    }
    const currentFlowName = this._orderedOutFlows[this._unSeenOutIndexes[this._currentIndex]];
    this.outValues.lastIndex = {
      value: [this._unSeenOutIndexes[this._currentIndex]],
      type: this.getTypeIndex('int')
    };
    this.processFlow(this.flows[currentFlowName]);
    this._unSeenOutIndexes.splice(this._currentIndex, 1);
    if (this._unSeenOutIndexes.length === 0) {
      if (this._isLoop) {
        this._unSeenOutIndexes = Array(this._numberOutputFlows).fill(0).map((_, index) => index);
      } else {
        return;
      }
    }
    if (this._isRandom) {
      this._currentIndex = Math.floor(Math.random() * this._unSeenOutIndexes.length);
    } else {
      this._currentIndex = this._currentIndex % this._unSeenOutIndexes.length;
    }
  }
}

class Sequence extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  _numberOutputFlows;
  constructor(props) {
    super(props);
    this.name = "Sequence";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    this._numberOutputFlows = Object.keys(this.flows).length;
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    this.graphEngine.processNodeStarted(this);
    const flows = Object.keys(this.flows).sort();
    for (let i = 0; i < flows.length; i++) {
      const flow = this.flows[flows[i]];
      if (!flow) continue;
      this.processFlow(flow);
    }
  }
}

class Switch extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_CONFIGURATIONS = {
    cases: {
      defaultValue: []
    }
  };
  REQUIRED_VALUES = {
    selection: {}
  };
  _cases;
  constructor(props) {
    super(props);
    this.name = "Switch";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      cases
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    // spec: non-int32 cases -> default configuration (no cases); duplicate cases are ignored
    const isValid = Array.isArray(cases) && cases.every(c => c === (c | 0));
    this._cases = isValid ? [...new Set(cases)] : [];
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    this.graphEngine.clearValueEvaluationCache();
    const {
      selection
    } = this.evaluateRequiredValues();
    // spec: only configured cases route to their flow; anything else takes the default flow
    const selected = this._cases.includes(Number(selection)) ? this.flows[String(selection)] : this.flows.default;
    if (selected != null) {
      this.processFlow(selected);
    }
  }
}

class Throttle extends BehaveEngineNode {
  INPUT_FLOWS = ["in", "reset"];
  REQUIRED_VALUES = {
    duration: {}
  };
  _lastRemainingTime;
  _lastSuccessfulCall;
  constructor(props) {
    super(props);
    this.name = "Throttle";
    this.validateValues(this.values);
    this._lastRemainingTime = NaN;
    this.outValues.lastRemainingTime = {
      value: [NaN],
      type: this.getTypeIndex('float')
    };
    this._lastSuccessfulCall = 0;
  }
  processNode(flowSocket) {
    if (flowSocket === "reset") {
      this._lastRemainingTime = NaN;
      this.outValues.lastRemainingTime = {
        value: [NaN],
        type: this.getTypeIndex('float')
      };
      return;
    }
    this.graphEngine.clearValueEvaluationCache();
    const {
      duration
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    if (isNaN(duration) || !isFinite(duration) || duration < 0) {
      if (this.flows.err) {
        this.processFlow(this.flows.err);
      }
    } else {
      const now = this.graphEngine.lastTickTime;
      if (!isNaN(this._lastRemainingTime)) {
        const timeSinceLastCall = now - this._lastSuccessfulCall;
        if (timeSinceLastCall < duration * 1000) {
          // throttle
          this._lastRemainingTime = duration - timeSinceLastCall / 1000;
          this.outValues.lastRemainingTime = {
            value: [duration - timeSinceLastCall / 1000],
            type: this.getTypeIndex('float')
          };
          return;
        }
      }
      this._lastRemainingTime = 0;
      this.outValues.lastRemainingTime = {
        value: [0],
        type: this.getTypeIndex('float')
      };
      this._lastSuccessfulCall = now;
      super.processNode(flowSocket);
    }
  }
}

class WaitAll extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    inputFlows: {
      defaultValue: [0]
    }
  };
  _lockedFlows;
  _numberInputFlows;
  constructor(props) {
    super(props);
    this.name = "WaitAll";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      inputFlows
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    // spec: inputFlows must be an integer in [0, 64], otherwise the default configuration (0) is used
    const count = inputFlows?.[0];
    this._numberInputFlows = Number.isInteger(count) && count >= 0 && count <= 64 ? count : 0;
    this._lockedFlows = [...Array(this._numberInputFlows).keys()];
    // spec: numbered input flows "0".."n-1" plus reset; there is no "in"
    this.INPUT_FLOWS = [...this._lockedFlows.map(String), "reset"];
    this.outValues.remainingInputs = {
      value: [this._lockedFlows.length],
      type: this.getTypeIndex('int')
    };
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    this.graphEngine.processNodeStarted(this);
    if (flowSocket === "reset") {
      this._lockedFlows = [...Array(this._numberInputFlows).keys()];
      this.outValues.remainingInputs = {
        value: [this._lockedFlows.length],
        type: this.getTypeIndex('int')
      };
      return;
    }
    const flowIndexToRemove = this._lockedFlows.findIndex(flow => flow === Number(flowSocket));
    if (flowIndexToRemove !== -1) {
      this._lockedFlows.splice(flowIndexToRemove, 1);
    }
    this.outValues.remainingInputs = {
      value: [this._lockedFlows.length],
      type: this.getTypeIndex('int')
    };
    if (this._lockedFlows.length === 0) {
      if (this.flows.completed != null) {
        this.processFlow(this.flows.completed);
      }
    } else {
      if (this.flows.out != null) {
        this.processFlow(this.flows.out);
      }
    }
  }
}

class WhileLoop extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    condition: {}
  };
  constructor(props) {
    super(props);
    this.name = "WhileLoop";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    this.graphEngine.clearValueEvaluationCache();
    let condition = this.evaluateRequiredValues().condition;
    while (condition) {
      if (this.flows.loopBody != null) {
        this.processFlow(this.flows.loopBody);
      }
      this.graphEngine.clearValueEvaluationCache();
      condition = this.evaluateRequiredValues().condition;
    }
    if (this.flows.completed != null) {
      this.processFlow(this.flows.completed);
    }
  }
}

class PointerGet extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    pointer: {},
    type: {}
  };
  _pointer;
  _refs;
  _indices;
  _typeIndex;
  constructor(props) {
    super(props);
    this.name = "PointerGet";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      pointer,
      type
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._pointer = pointer[0];
    this._typeIndex = type[0];
    this._refs = this.parsePathRefVariables(this._pointer);
    this._indices = this.parsePathIndexVariables(this._pointer);
  }
  processNode(flowSocket) {
    const configValues = this.evaluateAllValues(this._refs);
    const configIndices = this.evaluateAllValues(this._indices);
    const populatedPath = this.populatePath(this._pointer, configValues, configIndices);
    this.graphEngine.processNodeStarted(this);
    const pointer = this.graphEngine.resolveJsonPtr(populatedPath);
    if (pointer !== undefined) {
      const configuredTypeName = this.getType(this._typeIndex);
      if (pointer.typeName !== configuredTypeName) {
        return {
          'value': {
            value: this.getDefaultValueForType(configuredTypeName),
            type: this._typeIndex
          },
          'isValid': {
            value: [false],
            type: this.getTypeIndex('bool')
          }
        };
      }
      const value = pointer.getValue(populatedPath);
      if (value !== undefined) {
        return {
          'value': {
            value,
            type: this._typeIndex
          },
          'isValid': {
            value: [true],
            type: this.getTypeIndex('bool')
          }
        };
      } else {
        return {
          'value': {
            value: this.getDefaultValueForType(configuredTypeName),
            type: this._typeIndex
          },
          'isValid': {
            value: [false],
            type: this.getTypeIndex('bool')
          }
        };
      }
    } else {
      const typeName = this.getType(this._typeIndex);
      return {
        'value': {
          value: this.getDefaultValueForType(typeName),
          type: this._typeIndex
        },
        'isValid': {
          value: [false],
          type: this.getTypeIndex('bool')
        }
      };
    }
  }
}

class PointerSet extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_CONFIGURATIONS = {
    pointer: {},
    type: {}
  };
  REQUIRED_VALUES = {
    value: {}
  };
  _pointer;
  _refs;
  _indices;
  _typeIndex;
  constructor(props) {
    super(props);
    this.name = "PointerSet";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      pointer,
      type
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._pointer = pointer[0];
    this._typeIndex = type[0];
    this._refs = this.parsePathRefVariables(this._pointer);
    this._indices = this.parsePathIndexVariables(this._pointer);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const configValues = this.evaluateAllValues(this._refs);
    const configIndices = this.evaluateAllValues(this._indices);
    const requiredValues = this.evaluateRequiredValues();
    const targetValue = requiredValues.value;
    this.graphEngine.processNodeStarted(this);
    const pointer = this.resolveWritablePointer(this._pointer, configValues, configIndices, this.getType(this._typeIndex));
    if (pointer === undefined) {
      if (this.flows.err) {
        this.processFlow(this.flows.err);
      }
      return;
    }
    this.graphEngine.clearPointerInterpolation(pointer.path);
    pointer.entry.setValue(pointer.path, targetValue);
    super.processNode(flowSocket);
  }
}

let InteractivityValueType = /*#__PURE__*/function (InteractivityValueType) {
  InteractivityValueType["INT"] = "int";
  InteractivityValueType["BOOLEAN"] = "bool";
  InteractivityValueType["FLOAT"] = "float";
  InteractivityValueType["FLOAT2"] = "float2";
  InteractivityValueType["FLOAT3"] = "float3";
  InteractivityValueType["FLOAT4"] = "float4";
  InteractivityValueType["FLOAT2X2"] = "float2x2";
  InteractivityValueType["FLOAT3X3"] = "float3x3";
  InteractivityValueType["FLOAT4X4"] = "float4x4";
  InteractivityValueType["CUSTOM"] = "custom";
  InteractivityValueType["REF"] = "ref";
  return InteractivityValueType;
}({});
/**
 * Event-bus channel for a custom event. Events with an `id` use it (external dispatchers address
 * them by id); id-less events are internal-only, so they get an index-keyed channel that can't
 * collide with an id.
 */
const getCustomEventChannel = (event, index) => event?.id ? `KHR_INTERACTIVITY:${event.id}` : `KHR_INTERACTIVITY_INTERNAL:${index}`;
let InteractivityConfigurationValueType = /*#__PURE__*/function (InteractivityConfigurationValueType) {
  InteractivityConfigurationValueType["INT"] = "int";
  InteractivityConfigurationValueType["BOOLEAN"] = "bool";
  InteractivityConfigurationValueType["INT_ARR"] = "int[]";
  InteractivityConfigurationValueType["STRING"] = "string";
  return InteractivityConfigurationValueType;
}({});

// copy of a default output, so a consumer mutating a received value cannot change the default
const copyOutput = output => ({
  value: Array.isArray(output.value) ? output.value.slice() : output.value,
  type: output.type
});
class Receive extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    event: {}
  };
  _defaultValues = {};
  // declared event values: type index as declared and its resolved type name
  _valueTypes = new Map();
  _event;
  _eventRefOutput;
  constructor(props) {
    super(props);
    this.name = "CustomEventReceiveNode";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      event
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._event = event[0];
    this._eventRefOutput = {
      value: [`/extensions/KHR_interactivity/events/${this._event + 2}`],
      type: this.getTypeIndex('ref')
    };
    this.setUpEventListener();
  }
  setUpEventListener() {
    const {
      event
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    const customEventDesc = this.events[event[0]];
    const defaultValues = {};
    Object.entries(customEventDesc.values ?? {}).forEach(([key, value]) => {
      const typeName = this.getType(value.type);
      let defaultVal = this.getDefaultValueForType(typeName);
      if (value.value) {
        // if there is a given default value in the CE then use that
        defaultVal = value.value;
      }
      defaultValues[key] = {
        value: defaultVal,
        type: value.type
      };
      this._valueTypes.set(key, {
        type: value.type,
        typeName
      });
    });
    defaultValues.event = this._eventRefOutput;
    this._defaultValues = defaultValues;
    this.outValues = this.defaultOutputs({});
    this.graphEngine.addCustomEventListener(getCustomEventChannel(customEventDesc, event[0]), e => {
      if (this.graphEngine.isEventPropagationCancelled(this._eventRefOutput.value[0])) {
        return;
      }
      this.graphEngine.processNodeStarted(this);
      const ce = e.detail;
      // values missing from the event fall back to their defaults
      const outValues = this.defaultOutputs(ce);
      for (const ceKey in ce) {
        const declared = this._valueTypes.get(ceKey);
        if (declared === undefined) {
          throw new Error(`Event value ${ceKey} is not declared on event ${customEventDesc.name ?? customEventDesc.id ?? `#${event[0]}`}`);
        }
        outValues[ceKey] = {
          value: this.parseType(declared.typeName, [ce[ceKey]]),
          type: declared.type
        };
      }
      this.outValues = outValues;
      super.processNode();
    });
  }
  defaultOutputs(provided) {
    const outputs = {};
    for (const key in this._defaultValues) {
      if (!(key in provided)) {
        outputs[key] = copyOutput(this._defaultValues[key]);
      }
    }
    return outputs;
  }
  parseType(type, val) {
    switch (type) {
      case "bool":
        return [JSON.parse(val[0]) === true];
      case "int":
        return [Number(val[0])];
      case "float":
        return [Number(val[0])];
      case "float2":
        return this.parseMaybeJSON(val[0]);
      case "float3":
        return this.parseMaybeJSON(val[0]);
      case "float4":
        return this.parseMaybeJSON(val[0]);
      case "float2x2":
        return this.parseMaybeJSON(val[0]);
      case "float3x3":
        return this.parseMaybeJSON(val[0]);
      case "float4x4":
        return this.parseMaybeJSON(val[0]);
      default:
        return val;
    }
  }
  parseMaybeJSON(input) {
    try {
      let inputCopy = input;
      if (typeof input === "string") {
        inputCopy = JSON.parse(input);
      }

      // Create copy of array, otherwise use JSON.parse for copying objects.
      // This avoids issues with Float32Array that are parsed incorrectly via the JSON functions.
      if (inputCopy.slice) {
        inputCopy = inputCopy.slice(0);
      } else {
        inputCopy = JSON.parse(JSON.stringify(inputCopy));
      }
      return inputCopy;
    } catch (e) {
      throw new Error("Error while parsing JSON in event/receive");
    }
  }
}

class Send extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_CONFIGURATIONS = {
    event: {}
  };
  _event;
  _valueKeys;
  constructor(props) {
    super(props);
    this.name = "Send";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      event
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._event = event[0];
  }
  processNode(flowSocket) {
    const customEventDesc = this.events[this._event];
    this.graphEngine.clearValueEvaluationCache();
    if (this._valueKeys === undefined) {
      this._valueKeys = Object.keys(customEventDesc.values ?? {});
    }
    const vals = this.evaluateAllValues(this._valueKeys);
    this.graphEngine.processNodeStarted(this);
    this.graphEngine.dispatchCustomEvent(getCustomEventChannel(customEventDesc, this._event), vals);
    super.processNode(flowSocket);
  }
}

class VariableGet extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    variable: {}
  };
  _variable;
  constructor(props) {
    super(props);
    this.name = "VariableGetNode";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      variable
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._variable = variable[0];
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    const variable = this.variables[this._variable];
    return {
      value: {
        value: variable.value,
        type: variable.type
      }
    };
  }
}

class VariableSet extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_CONFIGURATIONS = {
    variables: {}
  };
  _variables;
  _variableKeys;
  constructor(props) {
    super(props);
    this.name = "VariableSet";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      variables
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    if (typeof variables[0] === "string") {
      this._variables = JSON.parse(variables);
    } else {
      this._variables = variables;
    }
    if (!Array.isArray(this._variables)) {
      this._variables = [this._variables];
    }
    this._variableKeys = this._variables.map(variable => variable.toString());
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const vals = this.evaluateAllValues(this._variableKeys);
    this.graphEngine.processNodeStarted(this);
    for (const variableId of this._variables) {
      this.graphEngine.clearVariableInterpolation(variableId);
      const value = vals[variableId.toString()];
      if (Array.isArray(value)) {
        this.variables[variableId].value = value;
      } else {
        this.variables[variableId].value = [value];
      }
    }
    super.processNode(flowSocket);
  }
}

class AbsoluteValue extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "AbsoluteValueNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "int":
        val = [Math.abs(a) | 0];
        break;
      case "float":
        val = [Math.abs(a)];
        break;
      case "float2":
        val = [Math.abs(a[0]), Math.abs(a[1])];
        break;
      case "float3":
        val = [Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2])];
        break;
      case "float4":
        val = [Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3])];
        break;
      case "float2x2":
        val = [Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3])];
        break;
      case "float3x3":
        val = [Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3]), Math.abs(a[4]), Math.abs(a[5]), Math.abs(a[6]), Math.abs(a[7]), Math.abs(a[8])];
        break;
      case "float4x4":
        val = [Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2]), Math.abs(a[3]), Math.abs(a[4]), Math.abs(a[5]), Math.abs(a[6]), Math.abs(a[7]), Math.abs(a[8]), Math.abs(a[9]), Math.abs(a[10]), Math.abs(a[11]), Math.abs(a[12]), Math.abs(a[13]), Math.abs(a[14]), Math.abs(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Euler extends BehaveEngineNode {
  constructor(props) {
    super(props);
    this.name = "EulerNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    return {
      'value': {
        value: [Math.E],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class Pi extends BehaveEngineNode {
  constructor(props) {
    super(props);
    this.name = "PiNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    return {
      'value': {
        value: [Math.PI],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class Tau extends BehaveEngineNode {
  constructor(props) {
    super(props);
    this.name = "TauNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    return {
      'value': {
        value: [2 * Math.PI],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class Sign extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "SignNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "int":
      case "float":
        val = [Math.sign(a)];
        break;
      case "float2":
        val = [Math.sign(a[0]), Math.sign(a[1])];
        break;
      case "float3":
        val = [Math.sign(a[0]), Math.sign(a[1]), Math.sign(a[2])];
        break;
      case "float4":
        val = [Math.sign(a[0]), Math.sign(a[1]), Math.sign(a[2]), Math.sign(a[3])];
        break;
      case "float2x2":
        val = [Math.sign(a[0]), Math.sign(a[1]), Math.sign(a[2]), Math.sign(a[3])];
        break;
      case "float3x3":
        val = [Math.sign(a[0]), Math.sign(a[1]), Math.sign(a[2]), Math.sign(a[3]), Math.sign(a[4]), Math.sign(a[5]), Math.sign(a[6]), Math.sign(a[7]), Math.sign(a[8])];
        break;
      case "float4x4":
        val = [Math.sign(a[0]), Math.sign(a[1]), Math.sign(a[2]), Math.sign(a[3]), Math.sign(a[4]), Math.sign(a[5]), Math.sign(a[6]), Math.sign(a[7]), Math.sign(a[8]), Math.sign(a[9]), Math.sign(a[10]), Math.sign(a[11]), Math.sign(a[12]), Math.sign(a[13]), Math.sign(a[14]), Math.sign(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Truncate extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "TruncateNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.trunc(a)];
        break;
      case "float2":
        val = [Math.trunc(a[0]), Math.trunc(a[1])];
        break;
      case "float3":
        val = [Math.trunc(a[0]), Math.trunc(a[1]), Math.trunc(a[2])];
        break;
      case "float4":
        val = [Math.trunc(a[0]), Math.trunc(a[1]), Math.trunc(a[2]), Math.trunc(a[3])];
        break;
      case "float2x2":
        val = [Math.trunc(a[0]), Math.trunc(a[1]), Math.trunc(a[2]), Math.trunc(a[3])];
        break;
      case "float3x3":
        val = [Math.trunc(a[0]), Math.trunc(a[1]), Math.trunc(a[2]), Math.trunc(a[3]), Math.trunc(a[4]), Math.trunc(a[5]), Math.trunc(a[6]), Math.trunc(a[7]), Math.trunc(a[8])];
        break;
      case "float4x4":
        val = [Math.trunc(a[0]), Math.trunc(a[1]), Math.trunc(a[2]), Math.trunc(a[3]), Math.trunc(a[4]), Math.trunc(a[5]), Math.trunc(a[6]), Math.trunc(a[7]), Math.trunc(a[8]), Math.trunc(a[9]), Math.trunc(a[10]), Math.trunc(a[11]), Math.trunc(a[12]), Math.trunc(a[13]), Math.trunc(a[14]), Math.trunc(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Floor extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "FloorNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.floor(a)];
        break;
      case "float2":
        val = [Math.floor(a[0]), Math.floor(a[1])];
        break;
      case "float3":
        val = [Math.floor(a[0]), Math.floor(a[1]), Math.floor(a[2])];
        break;
      case "float4":
        val = [Math.floor(a[0]), Math.floor(a[1]), Math.floor(a[2]), Math.floor(a[3])];
        break;
      case "float2x2":
        val = [Math.floor(a[0]), Math.floor(a[1]), Math.floor(a[2]), Math.floor(a[3])];
        break;
      case "float3x3":
        val = [Math.floor(a[0]), Math.floor(a[1]), Math.floor(a[2]), Math.floor(a[3]), Math.floor(a[4]), Math.floor(a[5]), Math.floor(a[6]), Math.floor(a[7]), Math.floor(a[8])];
        break;
      case "float4x4":
        val = [Math.floor(a[0]), Math.floor(a[1]), Math.floor(a[2]), Math.floor(a[3]), Math.floor(a[4]), Math.floor(a[5]), Math.floor(a[6]), Math.floor(a[7]), Math.floor(a[8]), Math.floor(a[9]), Math.floor(a[10]), Math.floor(a[11]), Math.floor(a[12]), Math.floor(a[13]), Math.floor(a[14]), Math.floor(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Ceil extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "CeilNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.ceil(a)];
        break;
      case "float2":
        val = [Math.ceil(a[0]), Math.ceil(a[1])];
        break;
      case "float3":
        val = [Math.ceil(a[0]), Math.ceil(a[1]), Math.ceil(a[2])];
        break;
      case "float4":
        val = [Math.ceil(a[0]), Math.ceil(a[1]), Math.ceil(a[2]), Math.ceil(a[3])];
        break;
      case "float2x2":
        val = [Math.ceil(a[0]), Math.ceil(a[1]), Math.ceil(a[2]), Math.ceil(a[3])];
        break;
      case "float3x3":
        val = [Math.ceil(a[0]), Math.ceil(a[1]), Math.ceil(a[2]), Math.ceil(a[3]), Math.ceil(a[4]), Math.ceil(a[5]), Math.ceil(a[6]), Math.ceil(a[7]), Math.ceil(a[8])];
        break;
      case "float4x4":
        val = [Math.ceil(a[0]), Math.ceil(a[1]), Math.ceil(a[2]), Math.ceil(a[3]), Math.ceil(a[4]), Math.ceil(a[5]), Math.ceil(a[6]), Math.ceil(a[7]), Math.ceil(a[8]), Math.ceil(a[9]), Math.ceil(a[10]), Math.ceil(a[11]), Math.ceil(a[12]), Math.ceil(a[13]), Math.ceil(a[14]), Math.ceil(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Round extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "RoundNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [round(a)];
        break;
      case "float2":
        val = [round(a[0]), round(a[1])];
        break;
      case "float3":
        val = [round(a[0]), round(a[1]), round(a[2])];
        break;
      case "float4":
        val = [round(a[0]), round(a[1]), round(a[2]), round(a[3])];
        break;
      case "float2x2":
        val = [round(a[0]), round(a[1]), round(a[2]), round(a[3])];
        break;
      case "float3x3":
        val = [round(a[0]), round(a[1]), round(a[2]), round(a[3]), round(a[4]), round(a[5]), round(a[6]), round(a[7]), round(a[8])];
        break;
      case "float4x4":
        val = [round(a[0]), round(a[1]), round(a[2]), round(a[3]), round(a[4]), round(a[5]), round(a[6]), round(a[7]), round(a[8]), round(a[9]), round(a[10]), round(a[11]), round(a[12]), round(a[13]), round(a[14]), round(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    function round(a) {
      return a < 0 ? -Math.round(-a) : Math.round(a);
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Negate extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "NegateNode";
    this.validateValues(this.values);
  }
  negate(a) {
    return -a | 0;
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "int":
        val = [-a | 0];
        break;
      case "float":
        val = [a * -1];
        break;
      case "float2":
        val = [a[0] * -1, a[1] * -1];
        break;
      case "float3":
        val = [a[0] * -1, a[1] * -1, a[2] * -1];
        break;
      case "float4":
        val = [a[0] * -1, a[1] * -1, a[2] * -1, a[3] * -1];
        break;
      case "float2x2":
        val = [a[0] * -1, a[1] * -1, a[2] * -1, a[3] * -1];
        break;
      case "float3x3":
        val = [a[0] * -1, a[1] * -1, a[2] * -1, a[3] * -1, a[4] * -1, a[5] * -1, a[6] * -1, a[7] * -1, a[8] * -1];
        break;
      case "float4x4":
        val = [a[0] * -1, a[1] * -1, a[2] * -1, a[3] * -1, a[4] * -1, a[5] * -1, a[6] * -1, a[7] * -1, a[8] * -1, a[9] * -1, a[10] * -1, a[11] * -1, a[12] * -1, a[13] * -1, a[14] * -1, a[15] * -1];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Add extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "AddNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
        val = [a + b | 0];
        break;
      case "float":
        val = [a + b];
        break;
      case "float2":
        val = [a[0] + b[0], a[1] + b[1]];
        break;
      case "float3":
        val = [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
        break;
      case "float4":
        val = [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
        break;
      case "float2x2":
        val = [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]];
        break;
      case "float3x3":
        val = [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4], a[5] + b[5], a[6] + b[6], a[7] + b[7], a[8] + b[8]];
        break;
      case "float4x4":
        val = [a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3], a[4] + b[4], a[5] + b[5], a[6] + b[6], a[7] + b[7], a[8] + b[8], a[9] + b[9], a[10] + b[10], a[11] + b[11], a[12] + b[12], a[13] + b[13], a[14] + b[14], a[15] + b[15]];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Subtract extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "SubtractNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
        val = [a - b | 0];
        break;
      case "float":
        val = [a - b];
        break;
      case "float2":
        val = [a[0] - b[0], a[1] - b[1]];
        break;
      case "float3":
        val = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        break;
      case "float4":
        val = [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
        break;
      case "float2x2":
        val = [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]];
        break;
      case "float3x3":
        val = [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3], a[4] - b[4], a[5] - b[5], a[6] - b[6], a[7] - b[7], a[8] - b[8]];
        break;
      case "float4x4":
        val = [a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3], a[4] - b[4], a[5] - b[5], a[6] - b[6], a[7] - b[7], a[8] - b[8], a[9] - b[9], a[10] - b[10], a[11] - b[11], a[12] - b[12], a[13] - b[13], a[14] - b[14], a[15] - b[15]];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Multiply extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "MultiplyNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
        val = [Math.imul(a, b)];
        break;
      case "float":
        val = [a * b];
        break;
      case "float2":
        val = [a[0] * b[0], a[1] * b[1]];
        break;
      case "float3":
        val = [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
        break;
      case "float4":
        val = [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3]];
        break;
      case "float2x2":
        val = [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3]];
        break;
      case "float3x3":
        val = [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3], a[4] * b[4], a[5] * b[5], a[6] * b[6], a[7] * b[7], a[8] * b[8]];
        break;
      case "float4x4":
        val = [a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3], a[4] * b[4], a[5] * b[5], a[6] * b[6], a[7] * b[7], a[8] * b[8], a[9] * b[9], a[10] * b[10], a[11] * b[11], a[12] * b[12], a[13] * b[13], a[14] * b[14], a[15] * b[15]];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Divide extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "DivideNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
        val = [a / b | 0];
        break;
      case "float":
        val = [a / b];
        break;
      case "float2":
        val = [a[0] / b[0], a[1] / b[1]];
        break;
      case "float3":
        val = [a[0] / b[0], a[1] / b[1], a[2] / b[2]];
        break;
      case "float4":
        val = [a[0] / b[0], a[1] / b[1], a[2] / b[2], a[3] / b[3]];
        break;
      case "float2x2":
        val = [a[0] / b[0], a[1] / b[1], a[2] / b[2], a[3] / b[3]];
        break;
      case "float3x3":
        val = [a[0] / b[0], a[1] / b[1], a[2] / b[2], a[3] / b[3], a[4] / b[4], a[5] / b[5], a[6] / b[6], a[7] / b[7], a[8] / b[8]];
        break;
      case "float4x4":
        val = [a[0] / b[0], a[1] / b[1], a[2] / b[2], a[3] / b[3], a[4] / b[4], a[5] / b[5], a[6] / b[6], a[7] / b[7], a[8] / b[8], a[9] / b[9], a[10] / b[10], a[11] / b[11], a[12] / b[12], a[13] / b[13], a[14] / b[14], a[15] / b[15]];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Remainder extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "RemainderNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
        val = [a % b | 0];
        break;
      case "float":
        val = [a % b];
        break;
      case "float2":
        val = [a[0] % b[0], a[1] % b[1]];
        break;
      case "float3":
        val = [a[0] % b[0], a[1] % b[1], a[2] % b[2]];
        break;
      case "float4":
        val = [a[0] % b[0], a[1] % b[1], a[2] % b[2], a[3] % b[3]];
        break;
      case "float2x2":
        val = [a[0] % b[0], a[1] % b[1], a[2] % b[2], a[3] % b[3]];
        break;
      case "float3x3":
        val = [a[0] % b[0], a[1] % b[1], a[2] % b[2], a[3] % b[3], a[4] % b[4], a[5] % b[5], a[6] % b[6], a[7] % b[7], a[8] % b[8]];
        break;
      case "float4x4":
        val = [a[0] % b[0], a[1] % b[1], a[2] % b[2], a[3] % b[3], a[4] % b[4], a[5] % b[5], a[6] % b[6], a[7] % b[7], a[8] % b[8], a[9] % b[9], a[10] % b[10], a[11] % b[11], a[12] % b[12], a[13] % b[13], a[14] % b[14], a[15] % b[15]];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Min extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "MinNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
      case "float":
        val = [Math.min(a, b)];
        break;
      case "float2":
        val = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
        break;
      case "float3":
        val = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
        break;
      case "float4":
        val = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
        break;
      case "float2x2":
        val = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
        break;
      case "float3x3":
        val = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3]), Math.min(a[4], b[4]), Math.min(a[5], b[5]), Math.min(a[6], b[6]), Math.min(a[7], b[7]), Math.min(a[8], b[8])];
        break;
      case "float4x4":
        val = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3]), Math.min(a[4], b[4]), Math.min(a[5], b[5]), Math.min(a[6], b[6]), Math.min(a[7], b[7]), Math.min(a[8], b[8]), Math.min(a[9], b[9]), Math.min(a[10], b[10]), Math.min(a[11], b[11]), Math.min(a[12], b[12]), Math.min(a[13], b[13]), Math.min(a[14], b[14]), Math.min(a[15], b[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Max extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "MaxNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
      case "float":
        val = [Math.max(a, b)];
        break;
      case "float2":
        val = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
        break;
      case "float3":
        val = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])];
        break;
      case "float4":
        val = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
        break;
      case "float2x2":
        val = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
        break;
      case "float3x3":
        val = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5]), Math.max(a[6], b[6]), Math.max(a[7], b[7]), Math.max(a[8], b[8])];
        break;
      case "float4x4":
        val = [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]), Math.max(a[4], b[4]), Math.max(a[5], b[5]), Math.max(a[6], b[6]), Math.max(a[7], b[7]), Math.max(a[8], b[8]), Math.max(a[9], b[9]), Math.max(a[10], b[10]), Math.max(a[11], b[11]), Math.max(a[12], b[12]), Math.max(a[13], b[13]), Math.max(a[14], b[14]), Math.max(a[15], b[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Mix extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {}
  };
  constructor(props) {
    super(props);
    this.name = "MixNode";
    this.validateValues(this.values);
  }
  mix = (a, b, t) => {
    return a + t * (b - a);
  };
  processNode(flowSocket) {
    const {
      a,
      b,
      c
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "float":
        val = [this.mix(a, b, c)];
        break;
      case "float2":
        val = [this.mix(a[0], b[0], c[0]), this.mix(a[1], b[1], c[1])];
        break;
      case "float3":
        val = [this.mix(a[0], b[0], c[0]), this.mix(a[1], b[1], c[1]), this.mix(a[2], b[2], c[2])];
        break;
      case "float4":
        val = [this.mix(a[0], b[0], c[0]), this.mix(a[1], b[1], c[1]), this.mix(a[2], b[2], c[2]), this.mix(a[3], b[3], c[3])];
        break;
      case "float2x2":
        val = [this.mix(a[0], b[0], c[0]), this.mix(a[1], b[1], c[1]), this.mix(a[2], b[2], c[2]), this.mix(a[3], b[3], c[3])];
        break;
      case "float3x3":
        val = [this.mix(a[0], b[0], c[0]), this.mix(a[1], b[1], c[1]), this.mix(a[2], b[2], c[2]), this.mix(a[3], b[3], c[3]), this.mix(a[4], b[4], c[4]), this.mix(a[5], b[5], c[5]), this.mix(a[6], b[6], c[6]), this.mix(a[7], b[7], c[7]), this.mix(a[8], b[8], c[8])];
        break;
      case "float4x4":
        val = [this.mix(a[0], b[0], c[0]), this.mix(a[1], b[1], c[1]), this.mix(a[2], b[2], c[2]), this.mix(a[3], b[3], c[3]), this.mix(a[4], b[4], c[4]), this.mix(a[5], b[5], c[5]), this.mix(a[6], b[6], c[6]), this.mix(a[7], b[7], c[7]), this.mix(a[8], b[8], c[8]), this.mix(a[9], b[9], c[9]), this.mix(a[10], b[10], c[10]), this.mix(a[11], b[11], c[11]), this.mix(a[12], b[12], c[12]), this.mix(a[13], b[13], c[13]), this.mix(a[14], b[14], c[14]), this.mix(a[15], b[15], c[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Saturate extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "SaturateNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.min(Math.max(a, 0.0), 1.0)];
        break;
      case "float2":
        val = [Math.min(Math.max(a[0], 0.0), 1.0), Math.min(Math.max(a[1], 0.0), 1.0)];
        break;
      case "float3":
        val = [Math.min(Math.max(a[0], 0.0), 1.0), Math.min(Math.max(a[1], 0.0), 1.0), Math.min(Math.max(a[2], 0.0), 1.0)];
        break;
      case "float4":
        val = [Math.min(Math.max(a[0], 0.0), 1.0), Math.min(Math.max(a[1], 0.0), 1.0), Math.min(Math.max(a[2], 0.0), 1.0), Math.min(Math.max(a[3], 0.0), 1.0)];
        break;
      case "float2x2":
        val = [Math.min(Math.max(a[0], 0.0), 1.0), Math.min(Math.max(a[1], 0.0), 1.0), Math.min(Math.max(a[2], 0.0), 1.0), Math.min(Math.max(a[3], 0.0), 1.0)];
        break;
      case "float3x3":
        val = [Math.min(Math.max(a[0], 0.0), 1.0), Math.min(Math.max(a[1], 0.0), 1.0), Math.min(Math.max(a[2], 0.0), 1.0), Math.min(Math.max(a[3], 0.0), 1.0), Math.min(Math.max(a[4], 0.0), 1.0), Math.min(Math.max(a[5], 0.0), 1.0), Math.min(Math.max(a[6], 0.0), 1.0), Math.min(Math.max(a[7], 0.0), 1.0), Math.min(Math.max(a[8], 0.0), 1.0)];
        break;
      case "float4x4":
        val = [Math.min(Math.max(a[0], 0.0), 1.0), Math.min(Math.max(a[1], 0.0), 1.0), Math.min(Math.max(a[2], 0.0), 1.0), Math.min(Math.max(a[3], 0.0), 1.0), Math.min(Math.max(a[4], 0.0), 1.0), Math.min(Math.max(a[5], 0.0), 1.0), Math.min(Math.max(a[6], 0.0), 1.0), Math.min(Math.max(a[7], 0.0), 1.0), Math.min(Math.max(a[8], 0.0), 1.0), Math.min(Math.max(a[9], 0.0), 1.0), Math.min(Math.max(a[10], 0.0), 1.0), Math.min(Math.max(a[11], 0.0), 1.0), Math.min(Math.max(a[12], 0.0), 1.0), Math.min(Math.max(a[13], 0.0), 1.0), Math.min(Math.max(a[14], 0.0), 1.0), Math.min(Math.max(a[15], 0.0), 1.0)];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Clamp extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {}
  };
  constructor(props) {
    super(props);
    this.name = "ClampNode";
    this.validateValues(this.values);
  }
  clamp(a, b, c) {
    return Math.min(Math.max(a, Math.min(b, c)), Math.max(b, c));
  }
  processNode(flowSocket) {
    const {
      a,
      b,
      c
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    const typeIndexC = this.values['c'].type;
    const typeC = this.getType(typeIndexC);
    if (typeA !== typeB || typeB !== typeC) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
      case "float":
        val = [this.clamp(a, b, c)];
        break;
      case "float2":
        val = [this.clamp(a[0], b[0], c[0]), this.clamp(a[1], b[1], c[1])];
        break;
      case "float3":
        val = [this.clamp(a[0], b[0], c[0]), this.clamp(a[1], b[1], c[1]), this.clamp(a[2], b[2], c[2])];
        break;
      case "float4":
        val = [this.clamp(a[0], b[0], c[0]), this.clamp(a[1], b[1], c[1]), this.clamp(a[2], b[2], c[2]), this.clamp(a[3], b[3], c[3])];
        break;
      case "float2x2":
        val = [this.clamp(a[0], b[0], c[0]), this.clamp(a[1], b[1], c[1]), this.clamp(a[2], b[2], c[2]), this.clamp(a[3], b[3], c[3])];
        break;
      case "float3x3":
        val = [this.clamp(a[0], b[0], c[0]), this.clamp(a[1], b[1], c[1]), this.clamp(a[2], b[2], c[2]), this.clamp(a[3], b[3], c[3]), this.clamp(a[4], b[4], c[4]), this.clamp(a[5], b[5], c[5]), this.clamp(a[6], b[6], c[6]), this.clamp(a[7], b[7], c[7]), this.clamp(a[8], b[8], c[8])];
        break;
      case "float4x4":
        val = [this.clamp(a[0], b[0], c[0]), this.clamp(a[1], b[1], c[1]), this.clamp(a[2], b[2], c[2]), this.clamp(a[3], b[3], c[3]), this.clamp(a[4], b[4], c[4]), this.clamp(a[5], b[5], c[5]), this.clamp(a[6], b[6], c[6]), this.clamp(a[7], b[7], c[7]), this.clamp(a[8], b[8], c[8]), this.clamp(a[9], b[9], c[9]), this.clamp(a[10], b[10], c[10]), this.clamp(a[11], b[11], c[11]), this.clamp(a[12], b[12], c[12]), this.clamp(a[13], b[13], c[13]), this.clamp(a[14], b[14], c[14]), this.clamp(a[15], b[15], c[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class DegreeToRadians extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "DegreeToRadiansNode";
    this.validateValues(this.values);
  }
  degreeToRadians(a) {
    return a * Math.PI / 180;
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [this.degreeToRadians(a)];
        break;
      case "float2":
        val = [this.degreeToRadians(a[0]), this.degreeToRadians(a[1])];
        break;
      case "float3":
        val = [this.degreeToRadians(a[0]), this.degreeToRadians(a[1]), this.degreeToRadians(a[2])];
        break;
      case "float4":
        val = [this.degreeToRadians(a[0]), this.degreeToRadians(a[1]), this.degreeToRadians(a[2]), this.degreeToRadians(a[3])];
        break;
      case "float2x2":
        val = [this.degreeToRadians(a[0]), this.degreeToRadians(a[1]), this.degreeToRadians(a[2]), this.degreeToRadians(a[3])];
        break;
      case "float3x3":
        val = [this.degreeToRadians(a[0]), this.degreeToRadians(a[1]), this.degreeToRadians(a[2]), this.degreeToRadians(a[3]), this.degreeToRadians(a[4]), this.degreeToRadians(a[5]), this.degreeToRadians(a[6]), this.degreeToRadians(a[7]), this.degreeToRadians(a[8])];
        break;
      case "float4x4":
        val = [this.degreeToRadians(a[0]), this.degreeToRadians(a[1]), this.degreeToRadians(a[2]), this.degreeToRadians(a[3]), this.degreeToRadians(a[4]), this.degreeToRadians(a[5]), this.degreeToRadians(a[6]), this.degreeToRadians(a[7]), this.degreeToRadians(a[8]), this.degreeToRadians(a[9]), this.degreeToRadians(a[10]), this.degreeToRadians(a[11]), this.degreeToRadians(a[12]), this.degreeToRadians(a[13]), this.degreeToRadians(a[14]), this.degreeToRadians(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class RadiansToDegrees extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "RadiansToDegreesNode";
    this.validateValues(this.values);
  }
  radiansToDegrees(a) {
    return a * 180 / Math.PI;
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [this.radiansToDegrees(a)];
        break;
      case "float2":
        val = [this.radiansToDegrees(a[0]), this.radiansToDegrees(a[1])];
        break;
      case "float3":
        val = [this.radiansToDegrees(a[0]), this.radiansToDegrees(a[1]), this.radiansToDegrees(a[2])];
        break;
      case "float4":
        val = [this.radiansToDegrees(a[0]), this.radiansToDegrees(a[1]), this.radiansToDegrees(a[2]), this.radiansToDegrees(a[3])];
        break;
      case "float2x2":
        val = [this.radiansToDegrees(a[0]), this.radiansToDegrees(a[1]), this.radiansToDegrees(a[2]), this.radiansToDegrees(a[3])];
        break;
      case "float3x3":
        val = [this.radiansToDegrees(a[0]), this.radiansToDegrees(a[1]), this.radiansToDegrees(a[2]), this.radiansToDegrees(a[3]), this.radiansToDegrees(a[4]), this.radiansToDegrees(a[5]), this.radiansToDegrees(a[6]), this.radiansToDegrees(a[7]), this.radiansToDegrees(a[8])];
        break;
      case "float4x4":
        val = [this.radiansToDegrees(a[0]), this.radiansToDegrees(a[1]), this.radiansToDegrees(a[2]), this.radiansToDegrees(a[3]), this.radiansToDegrees(a[4]), this.radiansToDegrees(a[5]), this.radiansToDegrees(a[6]), this.radiansToDegrees(a[7]), this.radiansToDegrees(a[8]), this.radiansToDegrees(a[9]), this.radiansToDegrees(a[10]), this.radiansToDegrees(a[11]), this.radiansToDegrees(a[12]), this.radiansToDegrees(a[13]), this.radiansToDegrees(a[14]), this.radiansToDegrees(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Sine extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "SineNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.sin(a)];
        break;
      case "float2":
        val = [Math.sin(a[0]), Math.sin(a[1])];
        break;
      case "float3":
        val = [Math.sin(a[0]), Math.sin(a[1]), Math.sin(a[2])];
        break;
      case "float4":
        val = [Math.sin(a[0]), Math.sin(a[1]), Math.sin(a[2]), Math.sin(a[3])];
        break;
      case "float2x2":
        val = [Math.sin(a[0]), Math.sin(a[1]), Math.sin(a[2]), Math.sin(a[3])];
        break;
      case "float3x3":
        val = [Math.sin(a[0]), Math.sin(a[1]), Math.sin(a[2]), Math.sin(a[3]), Math.sin(a[4]), Math.sin(a[5]), Math.sin(a[6]), Math.sin(a[7]), Math.sin(a[8])];
        break;
      case "float4x4":
        val = [Math.sin(a[0]), Math.sin(a[1]), Math.sin(a[2]), Math.sin(a[3]), Math.sin(a[4]), Math.sin(a[5]), Math.sin(a[6]), Math.sin(a[7]), Math.sin(a[8]), Math.sin(a[9]), Math.sin(a[10]), Math.sin(a[11]), Math.sin(a[12]), Math.sin(a[13]), Math.sin(a[14]), Math.sin(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Cosine extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "CosineNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.cos(a)];
        break;
      case "float2":
        val = [Math.cos(a[0]), Math.cos(a[1])];
        break;
      case "float3":
        val = [Math.cos(a[0]), Math.cos(a[1]), Math.cos(a[2])];
        break;
      case "float4":
        val = [Math.cos(a[0]), Math.cos(a[1]), Math.cos(a[2]), Math.cos(a[3])];
        break;
      case "float2x2":
        val = [Math.cos(a[0]), Math.cos(a[1]), Math.cos(a[2]), Math.cos(a[3])];
        break;
      case "float3x3":
        val = [Math.cos(a[0]), Math.cos(a[1]), Math.cos(a[2]), Math.cos(a[3]), Math.cos(a[4]), Math.cos(a[5]), Math.cos(a[6]), Math.cos(a[7]), Math.cos(a[8])];
        break;
      case "float4x4":
        val = [Math.cos(a[0]), Math.cos(a[1]), Math.cos(a[2]), Math.cos(a[3]), Math.cos(a[4]), Math.cos(a[5]), Math.cos(a[6]), Math.cos(a[7]), Math.cos(a[8]), Math.cos(a[9]), Math.cos(a[10]), Math.cos(a[11]), Math.cos(a[12]), Math.cos(a[13]), Math.cos(a[14]), Math.cos(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Tangent extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "TangentNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.tan(a)];
        break;
      case "float2":
        val = [Math.tan(a[0]), Math.tan(a[1])];
        break;
      case "float3":
        val = [Math.tan(a[0]), Math.tan(a[1]), Math.tan(a[2])];
        break;
      case "float4":
        val = [Math.tan(a[0]), Math.tan(a[1]), Math.tan(a[2]), Math.tan(a[3])];
        break;
      case "float2x2":
        val = [Math.tan(a[0]), Math.tan(a[1]), Math.tan(a[2]), Math.tan(a[3])];
        break;
      case "float3x3":
        val = [Math.tan(a[0]), Math.tan(a[1]), Math.tan(a[2]), Math.tan(a[3]), Math.tan(a[4]), Math.tan(a[5]), Math.tan(a[6]), Math.tan(a[7]), Math.tan(a[8]), Math.tan(a[12]), Math.tan(a[13]), Math.tan(a[14])];
        break;
      case "float4x4":
        val = [Math.tan(a[0]), Math.tan(a[1]), Math.tan(a[2]), Math.tan(a[3]), Math.tan(a[4]), Math.tan(a[5]), Math.tan(a[6]), Math.tan(a[7]), Math.tan(a[8]), Math.tan(a[9]), Math.tan(a[10]), Math.tan(a[11]), Math.tan(a[12]), Math.tan(a[13]), Math.tan(a[14]), Math.tan(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Arcsine extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "ArcsineNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.asin(a)];
        break;
      case "float2":
        val = [Math.asin(a[0]), Math.asin(a[1])];
        break;
      case "float3":
        val = [Math.asin(a[0]), Math.asin(a[1]), Math.asin(a[2])];
        break;
      case "float4":
        val = [Math.asin(a[0]), Math.asin(a[1]), Math.asin(a[2]), Math.asin(a[3])];
        break;
      case "float2x2":
        val = [Math.asin(a[0]), Math.asin(a[1]), Math.asin(a[2]), Math.asin(a[3])];
        break;
      case "float3x3":
        val = [Math.asin(a[0]), Math.asin(a[1]), Math.asin(a[2]), Math.asin(a[3]), Math.asin(a[4]), Math.asin(a[5]), Math.asin(a[6]), Math.asin(a[7]), Math.asin(a[8])];
        break;
      case "float4x4":
        val = [Math.asin(a[0]), Math.asin(a[1]), Math.asin(a[2]), Math.asin(a[3]), Math.asin(a[4]), Math.asin(a[5]), Math.asin(a[6]), Math.asin(a[7]), Math.asin(a[8]), Math.asin(a[9]), Math.asin(a[10]), Math.asin(a[11]), Math.asin(a[12]), Math.asin(a[13]), Math.asin(a[14]), Math.asin(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Arccosine extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "ArccosineNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.acos(a)];
        break;
      case "float2":
        val = [Math.acos(a[0]), Math.acos(a[1])];
        break;
      case "float3":
        val = [Math.acos(a[0]), Math.acos(a[1]), Math.acos(a[2])];
        break;
      case "float4":
        val = [Math.acos(a[0]), Math.acos(a[1]), Math.acos(a[2]), Math.acos(a[3])];
        break;
      case "float2x2":
        val = [Math.acos(a[0]), Math.acos(a[1]), Math.acos(a[2]), Math.acos(a[3])];
        break;
      case "float3x3":
        val = [Math.acos(a[0]), Math.acos(a[1]), Math.acos(a[2]), Math.acos(a[3]), Math.acos(a[4]), Math.acos(a[5]), Math.acos(a[6]), Math.acos(a[7]), Math.acos(a[8])];
        break;
      case "float4x4":
        val = [Math.acos(a[0]), Math.acos(a[1]), Math.acos(a[2]), Math.acos(a[3]), Math.acos(a[4]), Math.acos(a[5]), Math.acos(a[6]), Math.acos(a[7]), Math.acos(a[8]), Math.acos(a[9]), Math.acos(a[10]), Math.acos(a[11]), Math.acos(a[12]), Math.acos(a[13]), Math.acos(a[14]), Math.acos(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Arctangent extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "ArctangentNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.atan(a)];
        break;
      case "float2":
        val = [Math.atan(a[0]), Math.atan(a[1])];
        break;
      case "float3":
        val = [Math.atan(a[0]), Math.atan(a[1]), Math.atan(a[2])];
        break;
      case "float4":
        val = [Math.atan(a[0]), Math.atan(a[1]), Math.atan(a[2]), Math.atan(a[3])];
        break;
      case "float2x2":
        val = [Math.atan(a[0]), Math.atan(a[1]), Math.atan(a[2]), Math.atan(a[3])];
        break;
      case "float3x3":
        val = [Math.atan(a[0]), Math.atan(a[1]), Math.atan(a[2]), Math.atan(a[3]), Math.atan(a[4]), Math.atan(a[5]), Math.atan(a[6]), Math.atan(a[7]), Math.atan(a[8])];
        break;
      case "float4x4":
        val = [Math.atan(a[0]), Math.atan(a[1]), Math.atan(a[2]), Math.atan(a[3]), Math.atan(a[4]), Math.atan(a[5]), Math.atan(a[6]), Math.atan(a[7]), Math.atan(a[8]), Math.atan(a[9]), Math.atan(a[10]), Math.atan(a[11]), Math.atan(a[12]), Math.atan(a[13]), Math.atan(a[14]), Math.atan(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Arctangent2 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "Arctangent2Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeAIndex = this.values['a'].type;
    const typeA = this.getType(typeAIndex);
    const typeBIndex = this.values['b'].type;
    const typeB = this.getType(typeBIndex);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "float":
        val = [Math.atan2(a, b)];
        break;
      case "float2":
        val = [Math.atan2(a[0], b[0]), Math.atan2(a[1], b[1])];
        break;
      case "float3":
        val = [Math.atan2(a[0], b[0]), Math.atan2(a[1], b[1]), Math.atan2(a[2], b[2])];
        break;
      case "float4":
        val = [Math.atan2(a[0], b[0]), Math.atan2(a[1], b[1]), Math.atan2(a[2], b[2]), Math.atan2(a[3], b[3])];
        break;
      case "float2x2":
        val = [Math.atan2(a[0], b[0]), Math.atan2(a[1], b[1]), Math.atan2(a[2], b[2]), Math.atan2(a[3], b[3])];
        break;
      case "float3x3":
        val = [Math.atan2(a[0], b[0]), Math.atan2(a[1], b[1]), Math.atan2(a[2], b[2]), Math.atan2(a[3], b[3]), Math.atan2(a[4], b[4]), Math.atan2(a[5], b[5]), Math.atan2(a[6], b[6]), Math.atan2(a[7], b[7]), Math.atan2(a[8], b[8])];
        break;
      case "float4x4":
        val = [Math.atan2(a[0], b[0]), Math.atan2(a[1], b[1]), Math.atan2(a[2], b[2]), Math.atan2(a[3], b[3]), Math.atan2(a[4], b[4]), Math.atan2(a[5], b[5]), Math.atan2(a[6], b[6]), Math.atan2(a[7], b[7]), Math.atan2(a[8], b[8]), Math.atan2(a[9], b[9]), Math.atan2(a[10], b[10]), Math.atan2(a[11], b[11]), Math.atan2(a[12], b[12]), Math.atan2(a[13], b[13]), Math.atan2(a[14], b[14]), Math.atan2(a[15], b[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeAIndex
      }
    };
  }
}

class Log extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "LogNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.log(a)];
        break;
      case "float2":
        val = [Math.log(a[0]), Math.log(a[1])];
        break;
      case "float3":
        val = [Math.log(a[0]), Math.log(a[1]), Math.log(a[2])];
        break;
      case "float4":
        val = [Math.log(a[0]), Math.log(a[1]), Math.log(a[2]), Math.log(a[3])];
        break;
      case "float2x2":
        val = [Math.log(a[0]), Math.log(a[1]), Math.log(a[2]), Math.log(a[3])];
        break;
      case "float3x3":
        val = [Math.log(a[0]), Math.log(a[1]), Math.log(a[2]), Math.log(a[3]), Math.log(a[4]), Math.log(a[5]), Math.log(a[6]), Math.log(a[7]), Math.log(a[8])];
        break;
      case "float4x4":
        val = [Math.log(a[0]), Math.log(a[1]), Math.log(a[2]), Math.log(a[3]), Math.log(a[4]), Math.log(a[5]), Math.log(a[6]), Math.log(a[7]), Math.log(a[8]), Math.log(a[9]), Math.log(a[10]), Math.log(a[11]), Math.log(a[12]), Math.log(a[13]), Math.log(a[14]), Math.log(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Log2 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "Log2Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.log2(a)];
        break;
      case "float2":
        val = [Math.log2(a[0]), Math.log2(a[1])];
        break;
      case "float3":
        val = [Math.log2(a[0]), Math.log2(a[1]), Math.log2(a[2])];
        break;
      case "float4":
        val = [Math.log2(a[0]), Math.log2(a[1]), Math.log2(a[2]), Math.log2(a[3])];
        break;
      case "float2x2":
        val = [Math.log2(a[0]), Math.log2(a[1]), Math.log2(a[2]), Math.log2(a[3])];
        break;
      case "float3x3":
        val = [Math.log2(a[0]), Math.log2(a[1]), Math.log2(a[2]), Math.log2(a[3]), Math.log2(a[4]), Math.log2(a[5]), Math.log2(a[6]), Math.log2(a[7]), Math.log2(a[8])];
        break;
      case "float4x4":
        val = [Math.log2(a[0]), Math.log2(a[1]), Math.log2(a[2]), Math.log2(a[3]), Math.log2(a[4]), Math.log2(a[5]), Math.log2(a[6]), Math.log2(a[7]), Math.log2(a[8]), Math.log2(a[9]), Math.log2(a[10]), Math.log2(a[11]), Math.log2(a[12]), Math.log2(a[13]), Math.log2(a[14]), Math.log2(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Log10 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "Log10Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.log10(a)];
        break;
      case "float2":
        val = [Math.log10(a[0]), Math.log10(a[1])];
        break;
      case "float3":
        val = [Math.log10(a[0]), Math.log10(a[1]), Math.log10(a[2])];
        break;
      case "float4":
        val = [Math.log10(a[0]), Math.log10(a[1]), Math.log10(a[2]), Math.log10(a[3])];
        break;
      case "float2x2":
        val = [Math.log10(a[0]), Math.log10(a[1]), Math.log10(a[2]), Math.log10(a[3])];
        break;
      case "float3x3":
        val = [Math.log10(a[0]), Math.log10(a[1]), Math.log10(a[2]), Math.log10(a[3]), Math.log10(a[4]), Math.log10(a[5]), Math.log10(a[6]), Math.log10(a[7]), Math.log10(a[8])];
        break;
      case "float4x4":
        val = [Math.log10(a[0]), Math.log10(a[1]), Math.log10(a[2]), Math.log10(a[3]), Math.log10(a[4]), Math.log10(a[5]), Math.log10(a[6]), Math.log10(a[7]), Math.log10(a[8]), Math.log10(a[9]), Math.log10(a[10]), Math.log10(a[11]), Math.log10(a[12]), Math.log10(a[13]), Math.log10(a[14]), Math.log10(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Power extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "PowerNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "float":
        val = [Math.pow(a, b)];
        break;
      case "float2":
        val = [Math.pow(a[0], b[0]), Math.pow(a[1], b[1])];
        break;
      case "float3":
        val = [Math.pow(a[0], b[0]), Math.pow(a[1], b[1]), Math.pow(a[2], b[2])];
        break;
      case "float4":
        val = [Math.pow(a[0], b[0]), Math.pow(a[1], b[1]), Math.pow(a[2], b[2]), Math.pow(a[3], b[3])];
        break;
      case "float2x2":
        val = [Math.pow(a[0], b[0]), Math.pow(a[1], b[1]), Math.pow(a[2], b[2]), Math.pow(a[3], b[3])];
        break;
      case "float3x3":
        val = [Math.pow(a[0], b[0]), Math.pow(a[1], b[1]), Math.pow(a[2], b[2]), Math.pow(a[3], b[3]), Math.pow(a[4], b[4]), Math.pow(a[5], b[5]), Math.pow(a[6], b[6]), Math.pow(a[7], b[7]), Math.pow(a[8], b[8])];
        break;
      case "float4x4":
        val = [Math.pow(a[0], b[0]), Math.pow(a[1], b[1]), Math.pow(a[2], b[2]), Math.pow(a[3], b[3]), Math.pow(a[4], b[4]), Math.pow(a[5], b[5]), Math.pow(a[6], b[6]), Math.pow(a[7], b[7]), Math.pow(a[8], b[8]), Math.pow(a[9], b[9]), Math.pow(a[10], b[10]), Math.pow(a[11], b[11]), Math.pow(a[12], b[12]), Math.pow(a[13], b[13]), Math.pow(a[14], b[14]), Math.pow(a[15], b[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class SquareRoot extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "SquareRootNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.sqrt(a)];
        break;
      case "float2":
        val = [Math.sqrt(a[0]), Math.sqrt(a[1])];
        break;
      case "float3":
        val = [Math.sqrt(a[0]), Math.sqrt(a[1]), Math.sqrt(a[2])];
        break;
      case "float4":
        val = [Math.sqrt(a[0]), Math.sqrt(a[1]), Math.sqrt(a[2]), Math.sqrt(a[3])];
        break;
      case "float2x2":
        val = [Math.sqrt(a[0]), Math.sqrt(a[1]), Math.sqrt(a[2]), Math.sqrt(a[3])];
        break;
      case "float3x3":
        val = [Math.sqrt(a[0]), Math.sqrt(a[1]), Math.sqrt(a[2]), Math.sqrt(a[3]), Math.sqrt(a[4]), Math.sqrt(a[5]), Math.sqrt(a[6]), Math.sqrt(a[7]), Math.sqrt(a[8])];
        break;
      case "float4x4":
        val = [Math.sqrt(a[0]), Math.sqrt(a[1]), Math.sqrt(a[2]), Math.sqrt(a[3]), Math.sqrt(a[4]), Math.sqrt(a[5]), Math.sqrt(a[6]), Math.sqrt(a[7]), Math.sqrt(a[8]), Math.sqrt(a[9]), Math.sqrt(a[10]), Math.sqrt(a[11]), Math.sqrt(a[12]), Math.sqrt(a[13]), Math.sqrt(a[14]), Math.sqrt(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class CubeRoot extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "CubeRootNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;

    // MATRIX TO FIX AND ALL REST EXPONENTIAL
    switch (type) {
      case "float":
        val = [Math.cbrt(a)];
        break;
      case "float2":
        val = [Math.cbrt(a[0]), Math.cbrt(a[1])];
        break;
      case "float3":
        val = [Math.cbrt(a[0]), Math.cbrt(a[1]), Math.cbrt(a[2])];
        break;
      case "float4":
        val = [Math.cbrt(a[0]), Math.cbrt(a[1]), Math.cbrt(a[2]), Math.cbrt(a[3])];
        break;
      case "float2x2":
        val = [Math.cbrt(a[0]), Math.cbrt(a[1]), Math.cbrt(a[2]), Math.cbrt(a[3])];
        break;
      case "float3x3":
        val = [Math.cbrt(a[0]), Math.cbrt(a[1]), Math.cbrt(a[2]), Math.cbrt(a[3]), Math.cbrt(a[4]), Math.cbrt(a[5]), Math.cbrt(a[6]), Math.cbrt(a[7]), Math.cbrt(a[8])];
        break;
      case "float4x4":
        val = [Math.cbrt(a[0]), Math.cbrt(a[1]), Math.cbrt(a[2]), Math.cbrt(a[3]), Math.cbrt(a[4]), Math.cbrt(a[5]), Math.cbrt(a[6]), Math.cbrt(a[7]), Math.cbrt(a[8]), Math.cbrt(a[9]), Math.cbrt(a[10]), Math.cbrt(a[11]), Math.cbrt(a[12]), Math.cbrt(a[13]), Math.cbrt(a[14]), Math.cbrt(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Random extends BehaveEngineNode {
  constructor(props) {
    super(props);
    this.name = "RandomNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    return {
      'value': {
        id: "value",
        value: [Math.random()],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class Dot extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "DotNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "float2":
        val = a[0] * b[0] + a[1] * b[1];
        break;
      case "float3":
        val = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        break;
      case "float4":
        val = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class Cross extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "CrossNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "float3":
        val = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Normalize extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "NormalizeNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    let isValid = true;
    switch (type) {
      case "float2":
        // eslint-disable-next-line no-case-declarations
        const length2 = Math.hypot(a[0], a[1]);
        if (length2 === 0 || isNaN(length2) || !isFinite(length2)) {
          val = [0, 0];
          isValid = false;
        } else {
          val = [a[0] / length2, a[1] / length2];
        }
        break;
      case "float3":
        // eslint-disable-next-line no-case-declarations
        const length3 = Math.hypot(a[0], a[1], a[2]);
        if (length3 === 0 || isNaN(length3) || !isFinite(length3)) {
          val = [0, 0, 0];
          isValid = false;
        } else {
          val = [a[0] / length3, a[1] / length3, a[2] / length3];
        }
        break;
      case "float4":
        // eslint-disable-next-line no-case-declarations
        const length4 = Math.hypot(a[0], a[1], a[2], a[3]);
        if (length4 === 0 || isNaN(length4) || !isFinite(length4)) {
          val = [0, 0, 0, 0];
          isValid = false;
        } else {
          val = [a[0] / length4, a[1] / length4, a[2] / length4, a[3] / length4];
        }
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      },
      'isValid': {
        value: isValid,
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class Rotate2D extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    angle: {}
  };
  constructor(props) {
    super(props);
    this.name = "Rotate2DNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      angle
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexAngle = this.values['angle'].type;
    const typeAngle = this.getType(typeIndexAngle);
    if (typeAngle !== "float") {
      throw Error("Invalid type");
    }
    let val;
    switch (typeA) {
      case "float2":
        // eslint-disable-next-line no-case-declarations
        const cosTheta = Math.cos(Number(angle));
        // eslint-disable-next-line no-case-declarations
        const sinTheta = Math.sin(Number(angle));

        // eslint-disable-next-line no-case-declarations
        const rotationMatrix = [[cosTheta, -sinTheta], [sinTheta, cosTheta]];
        val = [a[0] * rotationMatrix[0][0] + a[1] * rotationMatrix[0][1], a[0] * rotationMatrix[1][0] + a[1] * rotationMatrix[1][1]];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Rotate3D extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    rotation: {}
  };
  constructor(props) {
    super(props);
    this.name = "Rotate3DNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      rotation
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexRotation = this.values['rotation'].type;
    const typeRotation = this.getType(typeIndexRotation);
    if (typeA !== "float3") {
      throw Error("a input should be a float3");
    }
    if (typeRotation !== "float4") {
      throw Error("rotation input should be a float4");
    }
    const r = [rotation[0], rotation[1], rotation[2]];
    const rCrossA = this.cross(r, a);
    const rCrossRCrossA = this.cross(r, rCrossA);
    const val = [a[0] + 2 * (rCrossRCrossA[0] + rotation[3] * rCrossA[0]), a[1] + 2 * (rCrossRCrossA[1] + rotation[3] * rCrossA[1]), a[2] + 2 * (rCrossRCrossA[2] + rotation[3] * rCrossA[2])];
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
  cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
}

class VectorLength extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "VectorLengthNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float2":
      case "float3":
      case "float4":
        val = Math.hypot(...a);
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class IsInfNode extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "IsInfNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = Math.abs(Number(a)) === Infinity;
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class IsNaNNode extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "IsNaNNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = isNaN(Number(a));
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class LessThanOrEqualTo extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "LessOrEqualToNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
      case "float":
        val = a <= b;
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class LessThan extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "LessThanNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
      case "float":
        val = a < b;
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class Equality extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "EqualityNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error(`input types not equivalent: a=${typeA}, b=${typeB}, values=${JSON.stringify(this.values)}`);
    }
    let val;
    switch (typeA) {
      case "bool":
        val = JSON.parse(a) === JSON.parse(b);
        break;
      case "int":
      case "float":
        val = a === b;
        break;
      case "float2":
        val = a[0] === b[0] && a[1] === b[1];
        break;
      case "float3":
        val = a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
        break;
      case "float4":
        val = a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
        break;
      case "float2x2":
        val = a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
        break;
      case "float3x3":
        val = a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8];
        break;
      case "float4x4":
        val = a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3] && a[4] === b[4] && a[5] === b[5] && a[6] === b[6] && a[7] === b[7] && a[8] === b[8] && a[9] === b[9] && a[10] === b[10] && a[11] === b[11] && a[12] === b[12] && a[13] === b[13] && a[14] === b[14] && a[15] === b[15];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class GreaterThanOrEqualTo extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "GreaterThanOrEqualToNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
      case "float":
        val = a >= b;
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        id: "value",
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class GreaterThan extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "GreaterThanNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "int":
      case "float":
        val = a > b;
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class Inf extends BehaveEngineNode {
  constructor(props) {
    super(props);
    this.name = "InfNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    return {
      'value': {
        value: [Infinity],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class SetDelay extends BehaveEngineNode {
  INPUT_FLOWS = ["in", "cancel"];
  REQUIRED_VALUES = {
    duration: {}
  };
  _runningDelayIndices;
  constructor(props) {
    super(props);
    this.name = "SetDelay";
    this.validateValues(this.values);
    this._runningDelayIndices = [];
    this.outValues.lastDelay = {
      value: [null],
      type: this.getTypeIndex('ref')
    };
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    if (flowSocket === "cancel") {
      this.outValues.lastDelay = {
        value: [null],
        type: this.getTypeIndex('ref')
      };
      for (const delayIndex of this._runningDelayIndices) {
        this.graphEngine.cancelScheduledDelay(delayIndex);
      }
      this._runningDelayIndices = [];
      return;
    }
    this.graphEngine.clearValueEvaluationCache();
    const {
      duration
    } = this.evaluateRequiredValues();

    // Browser and Node timers use signed 32-bit millisecond delays. Larger values
    // otherwise wrap or clamp to a near-immediate activation, contrary to the spec.
    if (isNaN(duration) || !isFinite(duration) || duration < 0 || duration * 1000 > 2147483647) {
      if (this.flows.err) {
        this.processFlow(this.flows.err);
      }
    } else {
      const delayIndex = this.graphEngine.scheduledDelays.length;
      const delayId = setTimeout(() => {
        this.graphEngine.removeScheduledDelay(delayIndex);
        this.addEventToWorkQueue(this.flows.done);
      }, duration * 1000);
      this.graphEngine.pushScheduledDelay(delayId, () => {
        this._runningDelayIndices = this._runningDelayIndices.filter(index => index !== delayIndex);
      });
      this._runningDelayIndices.push(delayIndex);
      this.outValues.lastDelay = {
        value: [`/extensions/KHR_interactivity/delays/${delayIndex}`],
        type: this.getTypeIndex('ref')
      };
      this.processFlow(this.flows.out);
    }
  }
}

class CancelDelay extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    delay: {}
  };
  constructor(props) {
    super(props);
    this.name = "CancelDelay";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      delay
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const delayIndex = this.resolveRef(delay);
    this.graphEngine.cancelScheduledDelay(delayIndex);
    this.processFlow(this.flows.out);
  }
}

class NotANumber extends BehaveEngineNode {
  constructor(props) {
    super(props);
    this.name = "NanNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    return {
      'value': {
        value: [NaN],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class Select extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    condition: {}
  };
  constructor(props) {
    super(props);
    this.name = "SelectNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b,
      condition
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    const typeIndexCondition = this.values['condition'].type;
    const typeCondition = this.getType(typeIndexCondition);
    if (typeCondition !== "bool") {
      throw Error("condition has invalid type");
    }
    let val = JSON.parse(condition) ? a : b;
    if (typeA === "int" || typeA === "bool" || typeA === "float") {
      val = [val];
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class BoolToInt extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "BoolToInt";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    if (type !== "bool") {
      throw Error("Invalid type");
    }
    const val = JSON.parse(a) | 0;
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('int')
      }
    };
  }
}

class BoolToFloat extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "BoolToFloat";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    if (type !== "bool") {
      throw Error("Invalid type");
    }
    const val = +JSON.parse(a);
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class FloatToBool extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "FloatToBool";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    if (type !== "float") {
      throw Error("Invalid type");
    }
    const val = !!a;
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class FloatToInt extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "FloatToInt";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    if (type !== "float") {
      throw Error("Invalid type");
    }
    const val = a | 0;
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('int')
      }
    };
  }
}

class IntToBool extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "IntToBool";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    if (type !== "int") {
      throw Error("Invalid type");
    }
    const val = !!a;
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class IntToFloat extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "IntToFloat";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    if (type !== "int") {
      throw Error("Invalid type");
    }
    const val = a;
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class Extract2 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "Extract2Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "float2") {
      throw Error("invalid input type");
    }
    return {
      '0': {
        value: [a[0]],
        type: this.getTypeIndex("float")
      },
      '1': {
        value: [a[1]],
        type: this.getTypeIndex("float")
      }
    };
  }
}

class Extract3 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "Extract3Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "float3") {
      throw Error("invalid input type");
    }
    return {
      '0': {
        value: [a[0]],
        type: this.getTypeIndex("float")
      },
      '1': {
        value: [a[1]],
        type: this.getTypeIndex("float")
      },
      '2': {
        value: [a[2]],
        type: this.getTypeIndex("float")
      }
    };
  }
}

class Extract4 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "Extract4Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "float4") {
      throw Error("invalid input type");
    }
    return {
      '0': {
        value: [a[0]],
        type: this.getTypeIndex("float")
      },
      '1': {
        value: [a[1]],
        type: this.getTypeIndex("float")
      },
      '2': {
        value: [a[2]],
        type: this.getTypeIndex("float")
      },
      '3': {
        value: [a[3]],
        type: this.getTypeIndex("float")
      }
    };
  }
}

class Extract2x2 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "Extract2x2Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "float2x2") {
      throw Error("invalid input type");
    }
    return {
      '0': {
        value: [a[0]],
        type: this.getTypeIndex("float")
      },
      '1': {
        value: [a[1]],
        type: this.getTypeIndex("float")
      },
      '2': {
        value: [a[2]],
        type: this.getTypeIndex("float")
      },
      '3': {
        value: [a[3]],
        type: this.getTypeIndex("float")
      }
    };
  }
}

class Extract3x3 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "Extract3x3Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "float3x3") {
      throw Error("invalid input type");
    }
    return {
      '0': {
        value: [a[0]],
        type: this.getTypeIndex("float")
      },
      '1': {
        value: [a[1]],
        type: this.getTypeIndex("float")
      },
      '2': {
        value: [a[2]],
        type: this.getTypeIndex("float")
      },
      '3': {
        value: [a[3]],
        type: this.getTypeIndex("float")
      },
      '4': {
        value: [a[4]],
        type: this.getTypeIndex("float")
      },
      '5': {
        value: [a[5]],
        type: this.getTypeIndex("float")
      },
      '6': {
        value: [a[6]],
        type: this.getTypeIndex("float")
      },
      '7': {
        value: [a[7]],
        type: this.getTypeIndex("float")
      },
      '8': {
        value: [a[8]],
        type: this.getTypeIndex("float")
      }
    };
  }
}

class Extract4x4 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "Extract4x4Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "float4x4") {
      throw Error("invalid input type");
    }
    return {
      '0': {
        value: [a[0]],
        type: this.getTypeIndex("float")
      },
      '1': {
        value: [a[1]],
        type: this.getTypeIndex("float")
      },
      '2': {
        value: [a[2]],
        type: this.getTypeIndex("float")
      },
      '3': {
        value: [a[3]],
        type: this.getTypeIndex("float")
      },
      '4': {
        value: [a[4]],
        type: this.getTypeIndex("float")
      },
      '5': {
        value: [a[5]],
        type: this.getTypeIndex("float")
      },
      '6': {
        value: [a[6]],
        type: this.getTypeIndex("float")
      },
      '7': {
        value: [a[7]],
        type: this.getTypeIndex("float")
      },
      '8': {
        value: [a[8]],
        type: this.getTypeIndex("float")
      },
      '9': {
        value: [a[9]],
        type: this.getTypeIndex("float")
      },
      '10': {
        value: [a[10]],
        type: this.getTypeIndex("float")
      },
      '11': {
        value: [a[11]],
        type: this.getTypeIndex("float")
      },
      '12': {
        value: [a[12]],
        type: this.getTypeIndex("float")
      },
      '13': {
        value: [a[13]],
        type: this.getTypeIndex("float")
      },
      '14': {
        value: [a[14]],
        type: this.getTypeIndex("float")
      },
      '15': {
        value: [a[15]],
        type: this.getTypeIndex("float")
      }
    };
  }
}

class Combine2 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "Combine2Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== "float" || typeB !== "float") {
      throw Error("invalid input types");
    }
    return {
      'value': {
        value: [a, b],
        type: this.getTypeIndex("float2")
      }
    };
  }
}

class Combine3 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {}
  };
  constructor(props) {
    super(props);
    this.name = "Combine3Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b,
      c
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    const typeIndexC = this.values['c'].type;
    const typeC = this.getType(typeIndexC);
    if (typeA !== "float" || typeB !== "float" || typeC !== "float") {
      throw Error("invalid input types");
    }
    return {
      'value': {
        value: [a, b, c],
        type: this.getTypeIndex("float3")
      }
    };
  }
}

class Combine4 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {},
    d: {}
  };
  constructor(props) {
    super(props);
    this.name = "Combine4Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b,
      c,
      d
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    const typeIndexC = this.values['c'].type;
    const typeC = this.getType(typeIndexC);
    const typeIndexD = this.values['d'].type;
    const typeD = this.getType(typeIndexD);
    if (typeA !== "float" || typeB !== "float" || typeC !== "float" || typeD !== "float") {
      throw Error("invalid input types");
    }
    return {
      'value': {
        value: [a, b, c, d],
        type: this.getTypeIndex("float4")
      }
    };
  }
}

class Combine2x2 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {},
    d: {}
  };
  constructor(props) {
    super(props);
    this.name = "Combine2x2Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b,
      c,
      d
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const characters = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < characters.length; i++) {
      const typeIndex = this.values[characters[i]].type;
      const typ = this.getType(typeIndex);
      if (typ !== "float") {
        throw Error(`invalid input type for ${characters[i]}`);
      }
    }
    return {
      'value': {
        value: [a, b, c, d],
        type: this.getTypeIndex("float2x2")
      }
    };
  }
}

class Combine3x3 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {},
    d: {},
    e: {},
    f: {},
    g: {},
    h: {},
    i: {}
  };
  constructor(props) {
    super(props);
    this.name = "Combine3x3Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b,
      c,
      d,
      e,
      f,
      g,
      h,
      i
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const characters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    for (let i = 0; i < characters.length; i++) {
      const typeIndex = this.values[characters[i]].type;
      const typ = this.getType(typeIndex);
      if (typ !== "float") {
        throw Error(`invalid input type for ${characters[i]}`);
      }
    }
    return {
      'value': {
        value: [a, b, c, d, e, f, g, h, i],
        type: this.getTypeIndex("float3x3")
      }
    };
  }
}

class Combine4x4 extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {},
    d: {},
    e: {},
    f: {},
    g: {},
    h: {},
    i: {},
    j: {},
    k: {},
    l: {},
    m: {},
    n: {},
    o: {},
    p: {}
  };
  constructor(props) {
    super(props);
    this.name = "Combine4x4Node";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b,
      c,
      d,
      e,
      f,
      g,
      h,
      i,
      j,
      k,
      l,
      m,
      n,
      o,
      p
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const characters = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p'];
    for (let i = 0; i < characters.length; i++) {
      const typeIndex = this.values[characters[i]].type;
      const typ = this.getType(typeIndex);
      if (typ !== "float") {
        throw Error(`invalid input type for ${characters[i]}`);
      }
    }
    return {
      'value': {
        value: [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p],
        type: this.getTypeIndex("float4x4")
      }
    };
  }
}

class PointerInterpolate extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_CONFIGURATIONS = {
    pointer: {},
    type: {}
  };
  REQUIRED_VALUES = {
    value: {},
    duration: {},
    p1: {},
    p2: {}
  };
  _pointer;
  _refs;
  _indices;
  _typeIndex;
  constructor(props) {
    super(props);
    this.name = "PointerInterpolate";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      pointer,
      type
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._pointer = pointer[0];
    this._typeIndex = type[0];
    this._refs = this.parsePathRefVariables(this._pointer);
    this._indices = this.parsePathIndexVariables(this._pointer);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const configVals = this.evaluateAllValues(this._refs);
    const configIndices = this.evaluateAllValues(this._indices);
    const requiredVals = this.evaluateRequiredValues();
    const {
      p1,
      p2
    } = this.evaluateAllValues(["p1", "p2"]);
    const targetValue = requiredVals.value;
    const duration = requiredVals.duration;
    this.graphEngine.processNodeStarted(this);
    const valueType = this.getType(this._typeIndex);
    const pointer = this.resolveWritablePointer(this._pointer, configVals, configIndices, valueType);
    if (pointer === undefined || !isValidInterpolationInput(duration, p1, p2)) {
      if (this.flows.err) {
        this.processFlow(this.flows.err);
      }
      return;
    }
    const initialValue = pointer.entry.getValue(pointer.path);
    this.graphEngine.animateCubicBezier(pointer.path, p1, p2, initialValue, targetValue, duration, valueType, () => {
      if (this.flows.done) {
        this.addEventToWorkQueue(this.flows.done);
      }
    });
    if (this.flows.out) {
      this.processFlow(this.flows.out);
    }
  }
}
function isValidInterpolationInput(duration, p1, p2) {
  const durationValue = Number(duration);
  if (Number.isNaN(durationValue) || !Number.isFinite(durationValue) || durationValue < 0) {
    return false;
  }
  return [p1, p2].every(point => {
    if (!Array.isArray(point) || point.length < 2) {
      return false;
    }
    const x = Number(point[0]);
    const y = Number(point[1]);
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1;
  });
}

class QuatMul extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "QuatMulNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== "float4") {
      throw Error(`a should be of type float4, got ${typeA}`);
    }
    if (typeB !== "float4") {
      throw Error(`b should be of type float4, got ${typeB}`);
    }

    // plain number arrays: gl-matrix defaults to Float32Array, but spec floats are doubles
    const quatA = Array(4).fill(0);
    glMatrix.quat.set(quatA, a[0], a[1], a[2], a[3]);
    const quatB = Array(4).fill(0);
    glMatrix.quat.set(quatB, b[0], b[1], b[2], b[3]);
    const result = Array(4).fill(0);
    glMatrix.quat.mul(result, quatA, quatB);
    const val = [result[0], result[1], result[2], result[3]];
    return {
      'value': {
        value: val,
        type: this.getTypeIndex("float4")
      }
    };
  }
}

class QuatConjugate extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "QuatConjugateNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    if (type !== "float4") {
      throw Error(`a should be of type float4, got ${type}`);
    }
    const val = [-a[0], -a[1], -a[2], a[3]];
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class QuatFromAxisAngle extends BehaveEngineNode {
  REQUIRED_VALUES = {
    axis: {},
    angle: {}
  };
  constructor(props) {
    super(props);
    this.name = "QuatFromAxisAngleNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      axis,
      angle
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexAxis = this.values['axis'].type;
    const typeAxis = this.getType(typeIndexAxis);
    const typeIndexAngle = this.values['angle'].type;
    const typeAngle = this.getType(typeIndexAngle);
    if (typeAxis !== "float3") {
      throw Error(`axis should be of type float3, got ${typeAxis}`);
    }
    if (typeAngle !== "float") {
      throw Error(`angle should be of type float, got ${typeAngle}`);
    }
    const x = axis[0] * Math.sin(Number(angle) / 2);
    const y = axis[1] * Math.sin(Number(angle) / 2);
    const z = axis[2] * Math.sin(Number(angle) / 2);
    const w = Math.cos(Number(angle) / 2);
    const val = [x, y, z, w];
    return {
      'value': {
        value: val,
        type: this.getTypeIndex("float4")
      }
    };
  }
}

class QuatToAxisAngle extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "QuatToAxisAngleNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "float4") {
      throw Error(`a should be of type float4, got ${typeA}`);
    }
    if (this.isCloseTo(a[3], 0)) {
      return {
        'axis': {
          value: [1, 0, 0],
          type: this.getTypeIndex("float3")
        },
        'angle': {
          value: [0],
          type: this.getTypeIndex("float")
        }
      };
    }
    const axisX = a[0] / Math.sqrt(1 - a[3] * a[3]);
    const axisY = a[1] / Math.sqrt(1 - a[3] * a[3]);
    const axisZ = a[2] / Math.sqrt(1 - a[3] * a[3]);
    const angle = 2 * Math.acos(a[3]);
    return {
      'axis': {
        value: [axisX, axisY, axisZ],
        type: this.getTypeIndex("float3")
      },
      'angle': {
        value: [angle],
        type: this.getTypeIndex("float")
      }
    };
  }
  isCloseTo(a, b, epsilon = 1e-6) {
    return Math.abs(a - b) < epsilon;
  }
}

const VALID_ORDERS = ["xyz", "xzy", "yxz", "yzx", "zxy", "zyx"];
class QuatFromAngles extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    order: {
      defaultValue: ["yxz"]
    }
  };
  REQUIRED_VALUES = {
    x: {},
    y: {},
    z: {}
  };
  _order;
  constructor(props) {
    super(props);
    this.name = "QuatFromAnglesNode";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      order
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    // spec: order must be exactly one of the six axis permutations, otherwise the default configuration ("yxz") is used
    const o = order?.[0];
    this._order = typeof o === "string" && VALID_ORDERS.includes(o) ? o : "yxz";
  }
  multiplyQuaternions(q1, q2) {
    const [x1, y1, z1, w1] = q1;
    const [x2, y2, z2, w2] = q2;
    return [x1 * w2 + w1 * x2 + y1 * z2 - z1 * y2, y1 * w2 + w1 * y2 + z1 * x2 - x1 * z2, z1 * w2 + w1 * z2 + x1 * y2 - y1 * x2, w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2];
  }
  processNode(flowSocket) {
    const {
      x,
      y,
      z
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexAngleX = this.values['x'].type;
    const typeAngleX = this.getType(typeIndexAngleX);
    const typeIndexAngleY = this.values['y'].type;
    const typeAngleY = this.getType(typeIndexAngleY);
    const typeIndexAngleZ = this.values['z'].type;
    const typeAngleZ = this.getType(typeIndexAngleZ);
    if (typeAngleX !== "float" || typeAngleY !== "float" || typeAngleZ !== "float") {
      throw Error(`Angles must be of type float.`);
    }

    // 1. Get the validated rotation order
    const order = this._order;

    // 2. Generate elemental quaternions for each axis rotation
    const cx = Math.cos(Number(x) / 2);
    const sx = Math.sin(Number(x) / 2);
    const cy = Math.cos(Number(y) / 2);
    const sy = Math.sin(Number(y) / 2);
    const cz = Math.cos(Number(z) / 2);
    const sz = Math.sin(Number(z) / 2);
    const qX = [sx, 0, 0, cx];
    const qY = [0, sy, 0, cy];
    const qZ = [0, 0, sz, cz];

    // Map characters to their respective quaternions
    const quatMap = {
      x: qX,
      y: qY,
      z: qZ
    };

    // 3. Multiply quaternions in the sequence of the specified intrinsic order (e.g., Y * X * Z)
    const qFirst = quatMap[order[0]];
    const qSecond = quatMap[order[1]];
    const qThird = quatMap[order[2]];
    const tempQuat = this.multiplyQuaternions(qFirst, qSecond);
    const finalQuat = this.multiplyQuaternions(tempQuat, qThird);
    return {
      'value': {
        value: finalQuat,
        type: this.getTypeIndex("float4")
      }
    };
  }
}

class QuatFromDirections extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "QuatFromDirectionsNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== "float3") {
      throw Error(`a should be of type float3, got ${typeA}`);
    }
    if (typeB !== "float3") {
      throw Error(`b should be of type float3, got ${typeB}`);
    }
    const c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (this.isCloseTo(c, 1)) {
      return {
        'value': {
          value: [0, 0, 0, 1],
          type: this.getTypeIndex("float4")
        }
      };
    }
    if (this.isCloseTo(c, -1)) {
      // Find a perpendicular vector to a by using cross product with [1,0,0] or [0,1,0]
      let perpendicular;
      if (Math.abs(a[0]) < Math.abs(a[1])) {
        // Cross product with [1,0,0]
        perpendicular = [0, -a[2], a[1]];
      } else {
        // Cross product with [0,1,0] 
        perpendicular = [-a[2], 0, a[0]];
      }

      // Normalize the perpendicular vector
      const length = Math.sqrt(perpendicular[0] * perpendicular[0] + perpendicular[1] * perpendicular[1] + perpendicular[2] * perpendicular[2]);
      const x = perpendicular[0] / length;
      const y = perpendicular[1] / length;
      const z = perpendicular[2] / length;
      const w = 0;
      return {
        'value': {
          value: [x, y, z, w],
          type: this.getTypeIndex("float4")
        }
      };
    }
    const aCrossB = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const aCrossBLength = Math.sqrt(aCrossB[0] * aCrossB[0] + aCrossB[1] * aCrossB[1] + aCrossB[2] * aCrossB[2]);
    const aCrossBNormalized = [aCrossB[0] / aCrossBLength, aCrossB[1] / aCrossBLength, aCrossB[2] / aCrossBLength];
    const x = aCrossBNormalized[0] * Math.sqrt(0.5 - 0.5 * c);
    const y = aCrossBNormalized[1] * Math.sqrt(0.5 - 0.5 * c);
    const z = aCrossBNormalized[2] * Math.sqrt(0.5 - 0.5 * c);
    const w = Math.sqrt(0.5 + 0.5 * c);
    return {
      'value': {
        value: [x, y, z, w],
        type: this.getTypeIndex("float4")
      }
    };
  }
  isCloseTo(a, b, epsilon = 1e-6) {
    return Math.abs(a - b) < epsilon;
  }
}

class Not extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "NotNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    let val;
    switch (typeA) {
      case "bool":
        val = !JSON.parse(a);
        break;
      case "int":
        val = ~a;
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: typeIndexA
      }
    };
  }
}

class Xor extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "XorNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "bool":
        val = JSON.parse(a) !== JSON.parse(b);
        break;
      case "int":
        val = a ^ b;
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: typeIndexA
      }
    };
  }
}

class Or extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "OrNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "bool":
        val = JSON.parse(a) || JSON.parse(b);
        break;
      case "int":
        val = a | b;
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: typeIndexA
      }
    };
  }
}

class And extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "AndNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "bool":
        val = JSON.parse(a) && JSON.parse(b);
        break;
      case "int":
        val = a & b;
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: [val],
        type: typeIndexA
      }
    };
  }
}

class LeftShift extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "LeftShiftNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== "int" || typeB !== "int") {
      throw Error("invalid input type");
    }
    const val = a << b;
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('int')
      }
    };
  }
}

class RightShift extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "RightShiftNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== "int" || typeB !== "int") {
      throw Error("invalid input type");
    }
    const val = a >> b;
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('int')
      }
    };
  }
}

class CountLeadingZeros extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "CountLeadingZerosNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "int") {
      throw Error("invalid input type");
    }
    const val = Math.clz32(a);
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('int')
      }
    };
  }
}

class CountOneBits extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "CountOneBitsNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "int") {
      throw Error("invalid input type");
    }
    let count = 0;
    let tempNumber = a;
    while (tempNumber !== 0) {
      tempNumber = tempNumber & tempNumber - 1;
      count++;
    }
    return {
      'value': {
        value: [count],
        type: this.getTypeIndex('int')
      }
    };
  }
}

class CountTrailingZeros extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "CountTrailingZerosNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "int") {
      throw Error("invalid input type");
    }
    const val = a ? 31 - Math.clz32(a & -a) : 32;
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('int')
      }
    };
  }
}

class Fraction extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "FractionNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [a - Math.floor(a)];
        break;
      case "float2":
        val = [a[0] - Math.floor(a[0]), a[1] - Math.floor(a[1])];
        break;
      case "float3":
        val = [a[0] - Math.floor(a[0]), a[1] - Math.floor(a[1]), a[2] - Math.floor(a[2])];
        break;
      case "float4":
        val = [a[0] - Math.floor(a[0]), a[1] - Math.floor(a[1]), a[2] - Math.floor(a[2]), a[3] - Math.floor(a[3])];
        break;
      case "float2x2":
        val = [a[0] - Math.floor(a[0]), a[1] - Math.floor(a[1]), a[2] - Math.floor(a[2]), a[3] - Math.floor(a[3])];
        break;
      case "float3x3":
        val = [a[0] - Math.floor(a[0]), a[1] - Math.floor(a[1]), a[2] - Math.floor(a[2]), a[3] - Math.floor(a[3]), a[4] - Math.floor(a[4]), a[5] - Math.floor(a[5]), a[6] - Math.floor(a[6]), a[7] - Math.floor(a[7]), a[8] - Math.floor(a[8])];
        break;
      case "float4x4":
        val = [a[0] - Math.floor(a[0]), a[1] - Math.floor(a[1]), a[2] - Math.floor(a[2]), a[3] - Math.floor(a[3]), a[4] - Math.floor(a[4]), a[5] - Math.floor(a[5]), a[6] - Math.floor(a[6]), a[7] - Math.floor(a[7]), a[8] - Math.floor(a[8]), a[9] - Math.floor(a[9]), a[10] - Math.floor(a[10]), a[11] - Math.floor(a[11]), a[12] - Math.floor(a[12]), a[13] - Math.floor(a[13]), a[14] - Math.floor(a[14]), a[15] - Math.floor(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class HyperbolicSine extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "HyperbolicSineNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.sinh(a)];
        break;
      case "float2":
        val = [Math.sinh(a[0]), Math.sinh(a[1])];
        break;
      case "float3":
        val = [Math.sinh(a[0]), Math.sinh(a[1]), Math.sinh(a[2])];
        break;
      case "float4":
        val = [Math.sinh(a[0]), Math.sinh(a[1]), Math.sinh(a[2]), Math.sinh(a[3])];
        break;
      case "float2x2":
        val = [Math.sinh(a[0]), Math.sinh(a[1]), Math.sinh(a[2]), Math.sinh(a[3])];
        break;
      case "float3x3":
        val = [Math.sinh(a[0]), Math.sinh(a[1]), Math.sinh(a[2]), Math.sinh(a[3]), Math.sinh(a[4]), Math.sinh(a[5]), Math.sinh(a[6]), Math.sinh(a[7]), Math.sinh(a[8])];
        break;
      case "float4x4":
        val = [Math.sinh(a[0]), Math.sinh(a[1]), Math.sinh(a[2]), Math.sinh(a[3]), Math.sinh(a[4]), Math.sinh(a[5]), Math.sinh(a[6]), Math.sinh(a[7]), Math.sinh(a[8]), Math.sinh(a[9]), Math.sinh(a[10]), Math.sinh(a[11]), Math.sinh(a[12]), Math.sinh(a[13]), Math.sinh(a[14]), Math.sinh(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class InverseHyperbolicSine extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "InverseHyperbolicSineNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.asinh(a)];
        break;
      case "float2":
        val = [Math.asinh(a[0]), Math.asinh(a[1])];
        break;
      case "float3":
        val = [Math.asinh(a[0]), Math.asinh(a[1]), Math.asinh(a[2])];
        break;
      case "float4":
        val = [Math.asinh(a[0]), Math.asinh(a[1]), Math.asinh(a[2]), Math.asinh(a[3])];
        break;
      case "float2x2":
        val = [Math.asinh(a[0]), Math.asinh(a[1]), Math.asinh(a[2]), Math.asinh(a[3])];
        break;
      case "float3x3":
        val = [Math.asinh(a[0]), Math.asinh(a[1]), Math.asinh(a[2]), Math.asinh(a[3]), Math.asinh(a[4]), Math.asinh(a[5]), Math.asinh(a[6]), Math.asinh(a[7]), Math.asinh(a[8])];
        break;
      case "float4x4":
        val = [Math.asinh(a[0]), Math.asinh(a[1]), Math.asinh(a[2]), Math.asinh(a[3]), Math.asinh(a[4]), Math.asinh(a[5]), Math.asinh(a[6]), Math.asinh(a[7]), Math.asinh(a[8]), Math.asinh(a[9]), Math.asinh(a[10]), Math.asinh(a[11]), Math.asinh(a[12]), Math.asinh(a[13]), Math.asinh(a[14]), Math.asinh(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class InverseHyperbolicCosine extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "InverseHyperbolicCosineNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.acosh(a)];
        break;
      case "float2":
        val = [Math.acosh(a[0]), Math.acosh(a[1])];
        break;
      case "float3":
        val = [Math.acosh(a[0]), Math.acosh(a[1]), Math.acosh(a[2])];
        break;
      case "float4":
        val = [Math.acosh(a[0]), Math.acosh(a[1]), Math.acosh(a[2]), Math.acosh(a[3])];
        break;
      case "float2x2":
        val = [Math.acosh(a[0]), Math.acosh(a[1]), Math.acosh(a[2]), Math.acosh(a[3])];
        break;
      case "float3x3":
        val = [Math.acosh(a[0]), Math.acosh(a[1]), Math.acosh(a[2]), Math.acosh(a[3]), Math.acosh(a[4]), Math.acosh(a[5]), Math.acosh(a[6]), Math.acosh(a[7]), Math.acosh(a[8])];
        break;
      case "float4x4":
        val = [Math.acosh(a[0]), Math.acosh(a[1]), Math.acosh(a[2]), Math.acosh(a[3]), Math.acosh(a[4]), Math.acosh(a[5]), Math.acosh(a[6]), Math.acosh(a[7]), Math.acosh(a[8]), Math.acosh(a[9]), Math.acosh(a[10]), Math.acosh(a[11]), Math.acosh(a[12]), Math.acosh(a[13]), Math.acosh(a[14]), Math.acosh(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class InverseHyperbolicTangent extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "InverseHyperbolicTangentNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.atanh(a)];
        break;
      case "float2":
        val = [Math.atanh(a[0]), Math.atanh(a[1])];
        break;
      case "float3":
        val = [Math.atanh(a[0]), Math.atanh(a[1]), Math.atanh(a[2])];
        break;
      case "float4":
        val = [Math.atanh(a[0]), Math.atanh(a[1]), Math.atanh(a[2]), Math.atanh(a[3])];
        break;
      case "float2x2":
        val = [Math.atanh(a[0]), Math.atanh(a[1]), Math.atanh(a[2]), Math.atanh(a[3])];
        break;
      case "float3x3":
        val = [Math.atanh(a[0]), Math.atanh(a[1]), Math.atanh(a[2]), Math.atanh(a[3]), Math.atanh(a[4]), Math.atanh(a[5]), Math.atanh(a[6]), Math.atanh(a[7]), Math.atanh(a[8])];
        break;
      case "float4x4":
        val = [Math.atanh(a[0]), Math.atanh(a[1]), Math.atanh(a[2]), Math.atanh(a[3]), Math.atanh(a[4]), Math.atanh(a[5]), Math.atanh(a[6]), Math.atanh(a[7]), Math.atanh(a[8]), Math.atanh(a[9]), Math.atanh(a[10]), Math.atanh(a[11]), Math.atanh(a[12]), Math.atanh(a[13]), Math.atanh(a[14]), Math.atanh(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class Exponential extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "ExponentialNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    let val;
    switch (typeA) {
      case "float":
        val = [Math.exp(a)];
        break;
      case "float2":
        val = [Math.exp(a[0]), Math.exp(a[1])];
        break;
      case "float3":
        val = [Math.exp(a[0]), Math.exp(a[1]), Math.exp(a[2])];
        break;
      case "float4":
        val = [Math.exp(a[0]), Math.exp(a[1]), Math.exp(a[2]), Math.exp(a[3])];
        break;
      case "float2x2":
        val = [Math.exp(a[0]), Math.exp(a[1]), Math.exp(a[2]), Math.exp(a[3])];
        break;
      case "float3x3":
        val = [Math.exp(a[0]), Math.exp(a[1]), Math.exp(a[2]), Math.exp(a[3]), Math.exp(a[4]), Math.exp(a[5]), Math.exp(a[6]), Math.exp(a[7]), Math.exp(a[8])];
        break;
      case "float4x4":
        val = [Math.exp(a[0]), Math.exp(a[1]), Math.exp(a[2]), Math.exp(a[3]), Math.exp(a[4]), Math.exp(a[5]), Math.exp(a[6]), Math.exp(a[7]), Math.exp(a[8]), Math.exp(a[9]), Math.exp(a[10]), Math.exp(a[11]), Math.exp(a[12]), Math.exp(a[13]), Math.exp(a[14]), Math.exp(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class HyperbolicCosine extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "HyperbolicCosineNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.cosh(a)];
        break;
      case "float2":
        val = [Math.cosh(a[0]), Math.cosh(a[1])];
        break;
      case "float3":
        val = [Math.cosh(a[0]), Math.cosh(a[1]), Math.cosh(a[2])];
        break;
      case "float4":
        val = [Math.cosh(a[0]), Math.cosh(a[1]), Math.cosh(a[2]), Math.cosh(a[3])];
        break;
      case "float2x2":
        val = [Math.cosh(a[0]), Math.cosh(a[1]), Math.cosh(a[2]), Math.cosh(a[3])];
        break;
      case "float3x3":
        val = [Math.cosh(a[0]), Math.cosh(a[1]), Math.cosh(a[2]), Math.cosh(a[3]), Math.cosh(a[4]), Math.cosh(a[5]), Math.cosh(a[6]), Math.cosh(a[7]), Math.cosh(a[8])];
        break;
      case "float4x4":
        val = [Math.cosh(a[0]), Math.cosh(a[1]), Math.cosh(a[2]), Math.cosh(a[3]), Math.cosh(a[4]), Math.cosh(a[5]), Math.cosh(a[6]), Math.cosh(a[7]), Math.cosh(a[8]), Math.cosh(a[9]), Math.cosh(a[10]), Math.cosh(a[11]), Math.cosh(a[12]), Math.cosh(a[13]), Math.cosh(a[14]), Math.cosh(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

class HyperbolicTangent extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "HyperbolicTangentNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let val;
    switch (type) {
      case "float":
        val = [Math.tanh(a)];
        break;
      case "float2":
        val = [Math.tanh(a[0]), Math.tanh(a[1])];
        break;
      case "float3":
        val = [Math.tanh(a[0]), Math.tanh(a[1]), Math.tanh(a[2])];
        break;
      case "float4":
        val = [Math.tanh(a[0]), Math.tanh(a[1]), Math.tanh(a[2]), Math.tanh(a[3])];
        break;
      case "float2x2":
        val = [Math.tanh(a[0]), Math.tanh(a[1]), Math.tanh(a[2]), Math.tanh(a[3])];
        break;
      case "float3x3":
        val = [Math.tanh(a[0]), Math.tanh(a[1]), Math.tanh(a[2]), Math.tanh(a[3]), Math.tanh(a[4]), Math.tanh(a[5]), Math.tanh(a[6]), Math.tanh(a[7]), Math.tanh(a[8])];
        break;
      case "float4x4":
        val = [Math.tanh(a[0]), Math.tanh(a[1]), Math.tanh(a[2]), Math.tanh(a[3]), Math.tanh(a[4]), Math.tanh(a[5]), Math.tanh(a[6]), Math.tanh(a[7]), Math.tanh(a[8]), Math.tanh(a[9]), Math.tanh(a[10]), Math.tanh(a[11]), Math.tanh(a[12]), Math.tanh(a[13]), Math.tanh(a[14]), Math.tanh(a[15])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndex
      }
    };
  }
}

/**
 * Eases a floating-point value from its initial value to its target value over time.
 *
 * @param t - The current progress (between 0 and 1) of the easing animation.
 * @param easingParameters -  parameters used to determine easing function
 * @returns The eased floating-point value at the current progress.
 */

const easeFloat = (t, easingParameters) => {
  if (easingParameters.easingType === 0) {
    // cubic
    return cubicBezierFloat(t, easingParameters.initialValue, easingParameters.targetValue, easingParameters.cp1, easingParameters.cp2);
  } else if (easingParameters.easingType == 2) {
    //linear
    return linearFloat(t, easingParameters.initialValue, easingParameters.targetValue);
  } else {
    return easingParameters.targetValue;
  }
};

/**
 * Eases an array of three floating-point values from their initial values to their target values over time.
 *
 * @param t - The current progress (between 0 and 1) of the easing animation.
 * @param easingParameters -  parameters used to determine easing function
 * @returns An array of eased floating-point values at the current progress.
 */
const easeFloat3 = (t, easingParameters) => {
  if (easingParameters.easingType === 0) {
    //cubic
    return [cubicBezierFloat(t, easingParameters.initialValue[0], easingParameters.targetValue[0], easingParameters.cp1[0], easingParameters.cp2[0]), cubicBezierFloat(t, easingParameters.initialValue[1], easingParameters.targetValue[1], easingParameters.cp1[1], easingParameters.cp2[1]), cubicBezierFloat(t, easingParameters.initialValue[2], easingParameters.targetValue[2], easingParameters.cp1[2], easingParameters.cp2[2])];
  } else if (easingParameters.easingType == 2) {
    //linear
    return [linearFloat(t, easingParameters.initialValue[0], easingParameters.targetValue[0]), linearFloat(t, easingParameters.initialValue[1], easingParameters.targetValue[1]), linearFloat(t, easingParameters.initialValue[2], easingParameters.targetValue[2])];
  } else {
    return [easingParameters.targetValue[0], easingParameters.targetValue[1], easingParameters.targetValue[2]];
  }
};

/**
 * Eases an array of four floating-point values from their initial values to their target values over time.
 *
 * @param t - The current progress (between 0 and 1) of the easing animation.
 * @param easingParameters -  parameters used to determine easing function
 * @returns An array of eased floating-point values at the current progress.
 */
const easeFloat4 = (t, easingParameters) => {
  if (easingParameters.easingType === 0) {
    // cubic
    return [cubicBezierFloat(t, easingParameters.initialValue[0], easingParameters.targetValue[0], easingParameters.cp1[0], easingParameters.cp2[0]), cubicBezierFloat(t, easingParameters.initialValue[1], easingParameters.targetValue[1], easingParameters.cp1[1], easingParameters.cp2[1]), cubicBezierFloat(t, easingParameters.initialValue[2], easingParameters.targetValue[2], easingParameters.cp1[2], easingParameters.cp2[2]), cubicBezierFloat(t, easingParameters.initialValue[3], easingParameters.targetValue[3], easingParameters.cp1[3], easingParameters.cp2[3])];
  } else if (easingParameters.easingType === 1) {
    //slerp
    return slerpFloat4(t, easingParameters.initialValue, easingParameters.targetValue);
  } else if (easingParameters.easingType == 2) {
    //linear
    return [linearFloat(t, easingParameters.initialValue[0], easingParameters.targetValue[0]), linearFloat(t, easingParameters.initialValue[1], easingParameters.targetValue[1]), linearFloat(t, easingParameters.initialValue[2], easingParameters.targetValue[2]), linearFloat(t, easingParameters.initialValue[2], easingParameters.targetValue[3])];
  } else {
    return [easingParameters.targetValue[0], easingParameters.targetValue[1], easingParameters.targetValue[2], easingParameters.targetValue[3]];
  }
};
const slerpFloat4 = (t, initialVal, targetVal) => {
  // plain number arrays: gl-matrix defaults to Float32Array, but spec floats are doubles
  const q1 = [initialVal[1], initialVal[2], initialVal[3], initialVal[0]];
  const q2 = [targetVal[1], targetVal[2], targetVal[3], targetVal[0]];
  const outQuat = Array(4).fill(0);
  glMatrix.quat.slerp(outQuat, q1, q2, t);
  return [outQuat[3], outQuat[0], outQuat[1], outQuat[2]];
};
const cubicBezierFloat = (t, initialVal, targetVal, cp1, cp2) => {
  return Math.pow(1 - t, 3) * initialVal + 3 * Math.pow(1 - t, 2) * t * cp1 + 3 * (1 - t) * Math.pow(t, 2) * cp2 + Math.pow(t, 3) * targetVal;
};
const linearFloat = (t, initialVal, targetVal) => {
  return initialVal + (targetVal - initialVal) * t;
};

/**
 * Evaluates the cubic Bézier easing function defined by the implicit end points P0 (0,0) and
 * P3 (1,1) and the control points P1/P2, as required by `variable/interpolate` and
 * `pointer/interpolate` ("construct a cubic Bézier easing function for the [0, 1] input range").
 *
 * This is a function of x, not of the Bézier parameter: the input progress `x` is the elapsed
 * fraction of the duration, and the curve parameter `s` with Bx(s) = x has to be solved for
 * before By(s) can be taken as the output progress. Same definition as CSS `cubic-bezier()`.
 * The spec's requirement that P1.x and P2.x lie within [0, 1] is what makes Bx monotonic and
 * therefore invertible; y is unconstrained, so the result may leave [0, 1] (e.g. "back" curves).
 *
 * @param x - input progress position, expected within [0, 1]
 * @param p1 - control point P1 as [x, y]
 * @param p2 - control point P2 as [x, y]
 * @returns the output progress position used as the interpolation coefficient
 */
const cubicBezierEase = (x, p1, p2) => {
  // polynomial coefficients of B(s) with the implicit end points, per coordinate
  const cx = 3 * p1[0];
  const bx = 3 * (p2[0] - p1[0]) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * p1[1];
  const by = 3 * (p2[1] - p1[1]) - cy;
  const ay = 1 - cy - by;
  const sampleX = s => ((ax * s + bx) * s + cx) * s;
  const sampleY = s => ((ay * s + by) * s + cy) * s;
  const sampleDerivativeX = s => (3 * ax * s + 2 * bx) * s + cx;
  if (x <= 0) {
    return 0;
  }
  if (x >= 1) {
    return 1;
  }

  // Newton-Raphson from an initial guess of s = x, which converges for most curves
  let s = x;
  for (let i = 0; i < 8; i++) {
    const error = sampleX(s) - x;
    if (Math.abs(error) < 1e-7) {
      return sampleY(s);
    }
    const derivative = sampleDerivativeX(s);
    if (Math.abs(derivative) < 1e-7) {
      break;
    }
    s -= error / derivative;
  }

  // bisection fallback for curves with (near) zero horizontal slope, e.g. p1.x = p2.x = 0
  let low = 0;
  let high = 1;
  s = x;
  while (low < high) {
    const sampled = sampleX(s);
    if (Math.abs(sampled - x) < 1e-7) {
      break;
    }
    if (sampled < x) {
      low = s;
    } else {
      high = s;
    }
    const next = (high + low) / 2;
    if (next === s) {
      break;
    }
    s = next;
  }
  return sampleY(s);
};
const cubicBezier = (t, P0, P1, P2, P3) => {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  const p = {
    x: 0,
    y: 0
  };
  p.x = uuu * P0.x + 3 * uu * t * P1.x + 3 * u * tt * P2.x + ttt * P3.x;
  p.y = uuu * P0.y + 3 * uu * t * P1.y + 3 * u * tt * P2.y + ttt * P3.y;
  return p;
};

class VariableInterpolate extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_CONFIGURATIONS = {
    variable: {},
    useSlerp: {}
  };
  REQUIRED_VALUES = {
    value: {},
    duration: {},
    p1: {},
    p2: {}
  };
  _variable;
  _useSlerp;
  _valueType;
  constructor(props) {
    super(props);
    this.name = "VariableInterpolate";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      variable,
      useSlerp
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._variable = variable[0];
    this._useSlerp = useSlerp[0];
    this._valueType = this.getType(this.variables[this._variable].type);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      value,
      duration,
      p1,
      p2
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    if (isNaN(duration) || !isFinite(duration) || isNaN(p1[0]) || !isFinite(p1[0]) || isNaN(p1[1]) || !isFinite(p1[1]) || isNaN(p2[0]) || !isFinite(p2[0]) || isNaN(p2[1]) || !isFinite(p2[1]) || duration < 0 || p1[0] < 0 || p1[0] > 1 || p2[0] < 0 || p2[0] > 1) {
      if (this.flows.err) {
        this.processFlow(this.flows.err);
      }
      return;
    }
    this.graphEngine.clearVariableInterpolation(this._variable);

    //set of interpolation
    const callback = () => {
      this.graphEngine.clearVariableInterpolation(this._variable);
      if (this.flows.done) {
        this.addEventToWorkQueue(this.flows.done);
      }
    };
    // variables store every type as a flat component array (float -> [x], float4 -> [x,y,z,w])
    const initialValue = [...this.variables[this._variable].value];
    const targetValue = Array.isArray(value) ? [...value] : [value];
    const startTime = this.graphEngine.lastTickTime;
    const interpolationAction = () => {
      const elapsedDuration = (this.graphEngine.lastTickTime - startTime) / 1000;
      const t = Math.min(elapsedDuration / duration, 1);
      // q is the output progress position: the easing curve evaluated at input progress t
      const q = cubicBezierEase(t, p1, p2);
      if (this._valueType === "float4" && this._useSlerp) {
        this.variables[this._variable].value = slerpFloat4(q, initialValue, targetValue);
      } else {
        this.variables[this._variable].value = targetValue.map((target, i) => linearFloat(q, initialValue[i], target));
      }
      if (elapsedDuration >= duration) {
        this.variables[this._variable].value = targetValue;
        this.graphEngine.clearVariableInterpolation(this._variable);
        callback();
      }
    };
    this.graphEngine.setVariableInterpolationCallback(this._variable, {
      action: interpolationAction
    });
    if (this.flows.out) {
      this.processFlow(this.flows.out);
    }
  }
}

class NoOpNode extends BehaveEngineNode {
  constructor(props) {
    super(props);
    registerNoOpNode(this);
    this.name = `NoOp (unsupported op "${this.declaration.op}")`;
    const outValues = {};
    Object.entries(this.declaration.outputValueSockets || {}).forEach(([key, value]) => {
      const typeName = this.getType(value.type);
      const defaultValue = this.getDefaultValueForType(typeName);
      outValues[key] = {
        value: defaultValue,
        type: value.type
      };
    });
    this.outValues = outValues;
  }
  processNode(flowSocket) {
    this.graphEngine.processNodeStarted(this);
    // no-op
  }
}

const flattenMatrix = matrix => {
  return matrix.flat();
};
const unflattenMatrix = (flatMatrix, dimension) => {
  return flatMatrix.reduce((acc, val, index) => {
    const row = Math.floor(index / dimension);
    const col = index % dimension;
    if (!acc[row]) {
      acc[row] = [];
    }
    acc[row][col] = val;
    return acc;
  }, []);
};

class MatDecompose extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "MatDecompose";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const validTypePairings = typeA === "float4x4";
    if (!validTypePairings) {
      throw Error("Invalid type for a");
    }
    const result = {
      'translation': {
        value: [0, 0, 0],
        type: this.getTypeIndex("float3")
      },
      'rotation': {
        value: [0, 0, 0, 1],
        type: this.getTypeIndex("float4")
      },
      'scale': {
        value: [1, 1, 1],
        type: this.getTypeIndex("float3")
      }
    };
    const unflattenedA = unflattenMatrix(a, 4);
    result.translation.value = [unflattenedA[3][0], unflattenedA[3][1], unflattenedA[3][2]];
    const s_x = Math.sqrt(unflattenedA[0][0] * unflattenedA[0][0] + unflattenedA[0][1] * unflattenedA[0][1] + unflattenedA[0][2] * unflattenedA[0][2]);
    const s_y = Math.sqrt(unflattenedA[1][0] * unflattenedA[1][0] + unflattenedA[1][1] * unflattenedA[1][1] + unflattenedA[1][2] * unflattenedA[1][2]);
    const s_z = Math.sqrt(unflattenedA[2][0] * unflattenedA[2][0] + unflattenedA[2][1] * unflattenedA[2][1] + unflattenedA[2][2] * unflattenedA[2][2]);
    if (isNaN(s_x) || isNaN(s_y) || isNaN(s_z) || !isFinite(s_x) || !isFinite(s_y) || !isFinite(s_z) || s_x === 0 || s_y === 0 || s_z === 0) {
      result.scale.value = [s_x, s_y, s_z];
      return result;
    }
    const B = [[unflattenedA[0][0] / s_x, unflattenedA[0][1] / s_x, unflattenedA[0][2] / s_x], [unflattenedA[1][0] / s_y, unflattenedA[1][1] / s_y, unflattenedA[1][2] / s_y], [unflattenedA[2][0] / s_z, unflattenedA[2][1] / s_z, unflattenedA[2][2] / s_z]];
    const detB = B[0][0] * (B[1][1] * B[2][2] - B[1][2] * B[2][1]) - B[0][1] * (B[1][0] * B[2][2] - B[1][2] * B[2][0]) + B[0][2] * (B[1][0] * B[2][1] - B[1][1] * B[2][0]);

    // detemine scale signs based on detB sign
    if (detB > 0) {
      result.scale.value = [s_x, s_y, s_z];
    } else {
      result.scale.value = [-s_x, -s_y, -s_z];
      B[0][0] = -B[0][0];
      B[0][1] = -B[0][1];
      B[0][2] = -B[0][2];
      B[1][0] = -B[1][0];
      B[1][1] = -B[1][1];
      B[1][2] = -B[1][2];
      B[2][0] = -B[2][0];
      B[2][1] = -B[2][1];
      B[2][2] = -B[2][2];
    }

    // get rotation from B matrix and turn it into a quaternion
    // plain number arrays: gl-matrix defaults to Float32Array, but spec floats are doubles
    const B_matrix = [B[0][0], B[0][1], B[0][2], B[1][0], B[1][1], B[1][2], B[2][0], B[2][1], B[2][2]];
    const rotation = Array(4).fill(0);
    glMatrix.quat.fromMat3(rotation, B_matrix);
    result.rotation.value = [rotation[0], rotation[1], rotation[2], rotation[3]];
    return result;
  }
}

class MatCompose extends BehaveEngineNode {
  REQUIRED_VALUES = {
    translation: {},
    rotation: {},
    scale: {}
  };
  constructor(props) {
    super(props);
    this.name = "MatCompose";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      translation,
      rotation,
      scale
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexTranslation = this.values['translation'].type;
    const typeTranslation = this.getType(typeIndexTranslation);
    const typeIndexRotation = this.values['rotation'].type;
    const typeRotation = this.getType(typeIndexRotation);
    const typeIndexScale = this.values['scale'].type;
    const typeScale = this.getType(typeIndexScale);
    const validTypePairings = typeTranslation === "float3" && typeRotation === "float4" && typeScale === "float3";
    if (!validTypePairings) {
      throw Error("Invalid type pairings");
    }

    // Create matrices for translation, rotation and scale
    // plain number arrays: gl-matrix defaults to Float32Array, but spec floats are doubles
    const rotationMatrix = Array(16).fill(0);
    const scaleMatrix = Array(16).fill(0);
    const resultMatrix = Array(16).fill(0);

    // Set up individual transformation matrices
    glMatrix.mat4.fromQuat(rotationMatrix, rotation); // rotation is in xyzw
    glMatrix.mat4.fromScaling(scaleMatrix, scale);

    // Multiply matrices in TRS order (Translation * Rotation * Scale)
    glMatrix.mat4.multiply(resultMatrix, rotationMatrix, scaleMatrix);
    resultMatrix[12] = translation[0];
    resultMatrix[13] = translation[1];
    resultMatrix[14] = translation[2];
    const val = [resultMatrix[0], resultMatrix[1], resultMatrix[2], resultMatrix[3], resultMatrix[4], resultMatrix[5], resultMatrix[6], resultMatrix[7], resultMatrix[8], resultMatrix[9], resultMatrix[10], resultMatrix[11], resultMatrix[12], resultMatrix[13], resultMatrix[14], resultMatrix[15]];
    return {
      'value': {
        value: val,
        type: this.getTypeIndex("float4x4")
      }
    };
  }
}

class MatMul extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "MatMul";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    const validTypePairings = typeA === "float4x4" && typeB === "float4x4" || typeA === "float3x3" && typeB === "float3x3" || typeA === "float2x2" && typeB === "float2x2";
    if (!validTypePairings) {
      throw Error("Invalid type pairings");
    }
    if (typeA === "float4x4") {
      // plain number arrays: gl-matrix defaults to Float32Array, but spec floats are doubles
      const matA = [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[9], a[10], a[11], a[12], a[13], a[14], a[15]];
      const matB = [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]];
      const result = Array(16).fill(0);
      glMatrix.mat4.multiply(result, matA, matB);
      return {
        'value': {
          value: [result[0], result[1], result[2], result[3], result[4], result[5], result[6], result[7], result[8], result[9], result[10], result[11], result[12], result[13], result[14], result[15]],
          type: typeIndexA
        }
      };
    } else if (typeA === "float3x3") {
      const matA = [a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8]];
      const matB = [b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8]];
      const result = Array(9).fill(0);
      glMatrix.mat3.multiply(result, matA, matB);
      return {
        'value': {
          value: [result[0], result[1], result[2], result[3], result[4], result[5], result[6], result[7], result[8]],
          type: typeIndexA
        }
      };
    } else if (typeA === "float2x2") {
      const matA = [a[0], a[1], a[2], a[3]];
      const matB = [b[0], b[1], b[2], b[3]];
      const result = Array(4).fill(0);
      glMatrix.mat2.multiply(result, matA, matB);
      return {
        'value': {
          value: [result[0], result[1], result[2], result[3]],
          type: typeIndexA
        }
      };
    } else {
      throw Error(`Invalid type ${typeA}`);
    }
  }
}

class MathSwitch extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    cases: {
      defaultValue: []
    }
  };
  REQUIRED_VALUES = {
    default: {},
    selection: {}
  };
  _cases;
  constructor(props) {
    super(props);
    this.name = "MathSwitchNode";
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      cases
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    // spec: non-int32 cases -> default configuration (no cases); duplicate cases are ignored
    const isValid = Array.isArray(cases) && cases.every(c => c === (c | 0));
    this._cases = isValid ? [...new Set(cases)] : [];
  }
  processNode(flowSocket) {
    const evaluatedValues = this.evaluateRequiredValues();
    const defaultSelection = evaluatedValues.default;
    const selection = evaluatedValues.selection;
    this.graphEngine.processNodeStarted(this);
    // ensure all cases are defined
    const caseVals = this.evaluateAllValues(this._cases.map(v => `${v}`));
    for (const [key, caseVal] of Object.entries(caseVals)) {
      if (caseVal === undefined) {
        throw Error(`case value ${key} is undefined`);
      }
    }
    const typeIndexSelection = this.values['selection'].type;
    const typeSelection = this.getType(typeIndexSelection);
    const typeIndexDefault = this.values['default'].type;
    const typeDefault = this.getType(typeIndexDefault);
    if (typeSelection !== 'int') {
      throw Error("selection has invalid type expected int");
    }

    // ensure all cases are of the same type as the default
    for (const [key, caseVal] of Object.entries(caseVals)) {
      const typeIndexCase = this.values[key].type;
      const typeCase = this.getType(typeIndexCase);
      if (typeCase !== typeDefault) {
        throw Error(`case value ${key} has invalid type, expected ${typeDefault}`);
      }
    }
    const selectionIndex = Number(selection);
    const val = caseVals[`${selectionIndex}`];
    if (val === undefined) {
      const returnVal = Array.isArray(defaultSelection) ? defaultSelection : [defaultSelection];
      return {
        'value': {
          value: returnVal,
          type: typeIndexDefault
        }
      };
    }
    const returnVal = Array.isArray(val) ? val : [val];
    return {
      'value': {
        value: returnVal,
        type: typeIndexDefault
      }
    };
  }
}

class Inverse extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "InverseNode";
    this.validateValues(this.values);
  }
  static createZeroMatrix(size) {
    return Array(size * size).fill(0);
  }
  static invert4x4(matrix) {
    // plain number arrays: gl-matrix defaults to Float32Array, but spec floats are doubles
    const colMajor = matrix;
    const determinant = glMatrix.mat4.determinant(colMajor);
    if (!Number.isFinite(determinant) || determinant === 0) {
      return {
        value: this.createZeroMatrix(4),
        isValid: false
      };
    }
    const result = Array(16).fill(0);
    const success = glMatrix.mat4.invert(result, colMajor);
    if (!success) {
      return {
        value: this.createZeroMatrix(4),
        isValid: false
      };
    }
    return {
      value: Array.from(result),
      isValid: true
    };
  }
  static invert3x3(matrix) {
    const colMajor = matrix;
    const determinant = glMatrix.mat3.determinant(colMajor);
    if (!Number.isFinite(determinant) || determinant === 0) {
      return {
        value: this.createZeroMatrix(3),
        isValid: false
      };
    }
    const result = Array(9).fill(0);
    const success = glMatrix.mat3.invert(result, colMajor);
    if (!success) {
      return {
        value: this.createZeroMatrix(3),
        isValid: false
      };
    }
    return {
      value: Array.from(result),
      isValid: true
    };
  }
  static invert2x2(matrix) {
    const colMajor = matrix;
    const determinant = glMatrix.mat2.determinant(colMajor);
    if (!Number.isFinite(determinant) || determinant === 0) {
      return {
        value: this.createZeroMatrix(2),
        isValid: false
      };
    }
    const result = Array(4).fill(0);
    const success = glMatrix.mat2.invert(result, colMajor);
    if (!success) {
      return {
        value: this.createZeroMatrix(2),
        isValid: false
      };
    }
    return {
      value: Array.from(result),
      isValid: true
    };
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndex = this.values['a'].type;
    const type = this.getType(typeIndex);
    let result;
    switch (type) {
      case "float4x4":
        result = Inverse.invert4x4(a);
        break;
      case "float3x3":
        result = Inverse.invert3x3(a);
        break;
      case "float2x2":
        result = Inverse.invert2x2(a);
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: result.value,
        type: typeIndex
      },
      'isValid': {
        value: result.isValid,
        type: this.getTypeIndex('bool')
      }
    };
  }
}

// debug/log message template parsing and effective message generation (KHR_interactivity, Debug Output Operations)

/** Spec state machine; returns undefined when the template is syntactically invalid. */
const parseMessageTemplate = message => {
  const parameters = [];
  let state = 0;
  let paramStart = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    if (char === "{") {
      if (state === 0) {
        state = 1;
      } else if (state === 1) {
        state = 0;
      } else {
        return undefined;
      }
    } else if (char === "}") {
      if (state === 0) {
        state = 3;
      } else if (state === 3) {
        state = 0;
      } else if (state === 2) {
        parameters.push({
          id: message.slice(paramStart + 1, i),
          start: paramStart,
          end: i
        });
        state = 0;
      } else {
        return undefined;
      }
    } else if (state === 1) {
      paramStart = i - 1;
      state = 2;
    } else if (state === 3) {
      return undefined;
    }
  }
  return state === 0 ? parameters : undefined;
};

/** Substitute parameters (right to left) with their string forms, then collapse doubled brackets. */
const populateMessageTemplate = (message, parameters, toString) => {
  let result = message;
  for (const parameter of [...parameters].sort((a, b) => b.start - a.start)) {
    const text = toString(parameter.id).replace(/{/g, "{{").replace(/}/g, "}}");
    result = result.slice(0, parameter.start) + text + result.slice(parameter.end + 1);
  }
  return result.replace(/{{/g, "{").replace(/}}/g, "}");
};

class DebugLog extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_CONFIGURATIONS = {
    message: {
      defaultValue: [""]
    },
    severity: {
      defaultValue: [0]
    }
  };
  _message;
  _severity;
  _parameters;
  _socketIds;
  constructor(props) {
    super(props);
    this.name = "DebugLog";
    this.validateConfigurations(this.configuration);
    const {
      message,
      severity
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    const parameters = typeof message?.[0] === "string" ? parseMessageTemplate(message[0]) : undefined;
    const severityValue = severity?.[0];
    // spec: a non-string/invalid message or a non-int32 severity selects the default configuration
    if (parameters === undefined || typeof severityValue !== "number" || severityValue !== (severityValue | 0)) {
      this._message = "";
      this._severity = 0;
      this._parameters = [];
    } else {
      this._message = message[0];
      this._severity = severityValue;
      this._parameters = parameters;
    }
    this._socketIds = [...new Set(this._parameters.map(parameter => parameter.id))];

    // spec: a node missing a template parameter socket is invalid and the graph must be rejected
    const missing = this._socketIds.filter(id => this.values[id] === undefined);
    if (missing.length > 0) {
      throw new Error(`debug/log node ${this.index} is missing input value socket(s) ${missing.map(id => `"${id}"`).join(", ")} required by its message template`);
    }
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();

    // spec: all input values are evaluated, including extra sockets not used by the template
    const values = this.evaluateAllValues(Object.keys(this.values));
    const populatedTemplate = populateMessageTemplate(this._message, this._parameters, id => formatValue(values[id], this.getType(this.values[id].type)));
    this.graphEngine.processNodeStarted(this);
    this.graphEngine.processDebugLog(this, populatedTemplate, this._severity);
    super.processNode(flowSocket);
  }
}
function formatValue(value, typeName) {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  switch (typeName) {
    case "bool":
    case "int":
    case "float":
      return value.toString();
    case "float2":
      return `[${value[0]}, ${value[1]}]`;
    case "float3":
      return `[${value[0]}, ${value[1]}, ${value[2]}]`;
    case "float4":
      return `[${value[0]}, ${value[1]}, ${value[2]}, ${value[3]}]`;
    case "float2x2":
      return `[
                [${value[0]}, ${value[1]}],
                [${value[2]}, ${value[3]}]
            ]`;
    case "float3x3":
      return `[
                [${value[0]}, ${value[1]}, ${value[2]}],
                [${value[3]}, ${value[4]}, ${value[5]}],
                [${value[6]}, ${value[7]}, ${value[8]}]
            ]`;
    case "float4x4":
      return `[
                [${value[0]}, ${value[1]}, ${value[2]}, ${value[3]}],
                [${value[4]}, ${value[5]}, ${value[6]}, ${value[7]}],
                [${value[8]}, ${value[9]}, ${value[10]}, ${value[11]}],
                [${value[12]}, ${value[13]}, ${value[14]}, ${value[15]}]
            ]`;
    default:
      return value.toString();
  }
}

class QuatAngleBetween extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "QuatAngleBetweenNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== "float4") {
      throw Error(`a should be of type float4, got ${typeA}`);
    }
    if (typeB !== "float4") {
      throw Error(`b should be of type float4, got ${typeB}`);
    }
    const dotProduct = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    const angle = 2 * Math.acos(dotProduct);
    return {
      'value': {
        value: [angle],
        type: this.getTypeIndex("float")
      }
    };
  }
}

class QuatSlerp extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {}
  };
  constructor(props) {
    super(props);
    this.name = "QuatSlerpNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b,
      c
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    const typeIndexC = this.values['c'].type;
    const typeC = this.getType(typeIndexC);
    if (typeA !== "float4") {
      throw Error(`a should be of type float4, got ${typeA}`);
    }
    if (typeB !== "float4") {
      throw Error(`b should be of type float4, got ${typeB}`);
    }
    if (typeC !== "float") {
      throw Error(`c should be of type float, got ${typeC}`);
    }

    // plain number arrays: gl-matrix defaults to Float32Array, but spec floats are doubles
    const quatA = Array(4).fill(0);
    glMatrix.quat.set(quatA, a[0], a[1], a[2], a[3]);
    const quatB = Array(4).fill(0);
    glMatrix.quat.set(quatB, b[0], b[1], b[2], b[3]);
    const result = Array(4).fill(0);
    const t = Number(c);
    glMatrix.quat.slerp(result, quatA, quatB, t);
    const val = [result[0], result[1], result[2], result[3]];
    return {
      'value': {
        value: val,
        type: this.getTypeIndex("float4")
      }
    };
  }
}

class QuatFromUpForward extends BehaveEngineNode {
  REQUIRED_VALUES = {
    up: {},
    forward: {}
  };
  constructor(props) {
    super(props);
    this.name = "QuatFromUpForwardNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      up,
      forward
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexUp = this.values['up'].type;
    const typeUp = this.getType(typeIndexUp);
    const typeIndexForward = this.values['forward'].type;
    const typeForward = this.getType(typeIndexForward);
    if (typeUp !== "float3") {
      throw Error(`up should be of type float3, got ${typeUp}`);
    }
    if (typeForward !== "float3") {
      throw Error(`forward should be of type float3, got ${typeForward}`);
    }

    // plain number arrays: gl-matrix defaults to Float32Array, but spec floats are doubles
    const fwd = [forward[0], forward[1], forward[2]];
    const upVec = [up[0], up[1], up[2]];
    const right = Array(3).fill(0);
    glMatrix.vec3.cross(right, upVec, fwd);
    if (glMatrix.vec3.len(right) < 1e-6) {
      // If up and forward are colinear, choose auxiliary axis least aligned with forward
      const ax = Math.abs(fwd[0]);
      const ay = Math.abs(fwd[1]);
      const az = Math.abs(fwd[2]);
      let arbitrary;
      if (ax <= ay && ax <= az) {
        arbitrary = [1, 0, 0];
      } else if (ay <= ax && ay <= az) {
        arbitrary = [0, 1, 0];
      } else {
        arbitrary = [0, 0, 1];
      }
      glMatrix.vec3.cross(right, arbitrary, fwd);
    }
    glMatrix.vec3.normalize(right, right);
    const trueUp = Array(3).fill(0);
    glMatrix.vec3.cross(trueUp, fwd, right);
    const m = Array(9).fill(0);
    // Set columns of rotation matrix: right, up, forward
    m[0] = right[0];
    m[1] = right[1];
    m[2] = right[2];
    m[3] = trueUp[0];
    m[4] = trueUp[1];
    m[5] = trueUp[2];
    m[6] = fwd[0];
    m[7] = fwd[1];
    m[8] = fwd[2];
    const outQ = Array(4).fill(0);
    glMatrix.quat.fromMat3(outQ, m);
    glMatrix.quat.normalize(outQ, outQ);
    const val = [outQ[0], outQ[1], outQ[2], outQ[3]];
    return {
      'value': {
        value: val,
        type: this.getTypeIndex("float4")
      }
    };
  }
}

class Determinant extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "DeterminantNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "float4x4" && typeA !== "float3x3" && typeA !== "float2x2") {
      throw Error("Invalid type");
    }
    let val;
    let unflattenedA;
    switch (typeA) {
      case "float4x4":
        unflattenedA = unflattenMatrix(a, 4);
        val = unflattenedA[0][0] * (unflattenedA[1][1] * (unflattenedA[2][2] * unflattenedA[3][3] - unflattenedA[2][3] * unflattenedA[3][2]) - unflattenedA[1][2] * (unflattenedA[2][1] * unflattenedA[3][3] - unflattenedA[2][3] * unflattenedA[3][1]) + unflattenedA[1][3] * (unflattenedA[2][1] * unflattenedA[3][2] - unflattenedA[2][2] * unflattenedA[3][1])) - unflattenedA[0][1] * (unflattenedA[1][0] * (unflattenedA[2][2] * unflattenedA[3][3] - unflattenedA[2][3] * unflattenedA[3][2]) - unflattenedA[1][2] * (unflattenedA[2][0] * unflattenedA[3][3] - unflattenedA[2][3] * unflattenedA[3][0]) + unflattenedA[1][3] * (unflattenedA[2][0] * unflattenedA[3][2] - unflattenedA[2][2] * unflattenedA[3][0])) + unflattenedA[0][2] * (unflattenedA[1][0] * (unflattenedA[2][1] * unflattenedA[3][3] - unflattenedA[2][3] * unflattenedA[3][1]) - unflattenedA[1][1] * (unflattenedA[2][0] * unflattenedA[3][3] - unflattenedA[2][3] * unflattenedA[3][0]) + unflattenedA[1][3] * (unflattenedA[2][0] * unflattenedA[3][1] - unflattenedA[2][1] * unflattenedA[3][0])) - unflattenedA[0][3] * (unflattenedA[1][0] * (unflattenedA[2][1] * unflattenedA[3][2] - unflattenedA[2][2] * unflattenedA[3][1]) - unflattenedA[1][1] * (unflattenedA[2][0] * unflattenedA[3][2] - unflattenedA[2][2] * unflattenedA[3][0]) + unflattenedA[1][2] * (unflattenedA[2][0] * unflattenedA[3][1] - unflattenedA[2][1] * unflattenedA[3][0]));
        break;
      case "float3x3":
        unflattenedA = unflattenMatrix(a, 3);
        val = unflattenedA[0][0] * (unflattenedA[1][1] * unflattenedA[2][2] - unflattenedA[1][2] * unflattenedA[2][1]) - unflattenedA[0][1] * (unflattenedA[1][0] * unflattenedA[2][2] - unflattenedA[1][2] * unflattenedA[2][0]) + unflattenedA[0][2] * (unflattenedA[1][0] * unflattenedA[2][1] - unflattenedA[1][1] * unflattenedA[2][0]);
        break;
      case "float2x2":
        unflattenedA = unflattenMatrix(a, 2);
        val = unflattenedA[0][0] * unflattenedA[1][1] - unflattenedA[0][1] * unflattenedA[1][0];
        break;
    }
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('float')
      }
    };
  }
}

class Transform extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "TransformNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);

    // MATRIX TO FIX
    const validTypePairings = typeA === "float4" && typeB === "float4x4" || typeA === "float3" && typeB === "float3x3" || typeA === "float2" && typeB === "float2x2";
    if (!validTypePairings) {
      throw Error("Invalid type pairings");
    }
    const dimension = Number(typeA.charAt(typeA.length - 1));
    const val = [];
    for (let row = 0; row < dimension; row++) {
      let sum = 0;
      for (let col = 0; col < dimension; col++) {
        sum += b[col * dimension + row] * a[col];
      }
      val.push(sum);
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

class Transpose extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {}
  };
  constructor(props) {
    super(props);
    this.name = "TransposeNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    if (typeA !== "float4x4" && typeA !== "float3x3" && typeA !== "float2x2") {
      throw Error("Invalid type");
    }
    const dimension = Number(typeA.charAt(typeA.length - 1));
    const val = [];
    const unflattenedA = unflattenMatrix(a, dimension);
    for (let col = 0; col < dimension; col++) {
      val.push([]);
      for (let row = 0; row < dimension; row++) {
        val[col].push(unflattenedA[row][col]);
      }
    }
    const flattenedVal = flattenMatrix(val);
    return {
      'value': {
        value: flattenedVal,
        type: typeIndexA
      }
    };
  }
}

class RefEquality extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "RefEquality";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error(`input types not equivalent: a=${typeA}, b=${typeB}, values=${JSON.stringify(this.values)}`);
    }
    if (typeA !== "ref") {
      throw Error(`input types not ref: a=${typeA}, b=${typeB}, values=${JSON.stringify(this.values)}`);
    }
    const val = a === b;
    return {
      'value': {
        value: [val],
        type: this.getTypeIndex('bool')
      }
    };
  }
}

class EventStopPropagation extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    stopImmediate: {},
    event: {}
  };
  constructor(props) {
    super(props);
    this.name = 'EventStopPropagation';
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      stopImmediate,
      event
    } = this.evaluateRequiredValues();
    if (stopImmediate) {
      this.graphEngine.propagationCancelled.add(event);
    } else {
      this.graphEngine.propagationCancelledPending.add(event);
    }
    super.processNode(flowSocket);
  }
}

class SmoothStep extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {}
  };
  constructor(props) {
    super(props);
    this.name = "SmoothStepNode";
    this.validateValues(this.values);
  }
  saturate = x => {
    return Math.min(Math.max(x, 0), 1);
  };
  smoothStep = (a, b, c) => {
    const lo = Math.min(a, b);
    // spec: no special case for a == b; division yields +-Inf/NaN, which saturate/propagate
    const t = this.saturate((c - lo) / Math.abs(b - a));
    return t * t * (3 - 2 * t);
  };
  processNode(flowSocket) {
    const {
      a,
      b,
      c
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    let val;
    switch (typeA) {
      case "float":
        val = [this.smoothStep(a, b, c)];
        break;
      case "float2":
        val = [this.smoothStep(a[0], b[0], c[0]), this.smoothStep(a[1], b[1], c[1])];
        break;
      case "float3":
        val = [this.smoothStep(a[0], b[0], c[0]), this.smoothStep(a[1], b[1], c[1]), this.smoothStep(a[2], b[2], c[2])];
        break;
      case "float4":
        val = [this.smoothStep(a[0], b[0], c[0]), this.smoothStep(a[1], b[1], c[1]), this.smoothStep(a[2], b[2], c[2]), this.smoothStep(a[3], b[3], c[3])];
        break;
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

const THRESHOLD = 1e-6;
class Slerp extends BehaveEngineNode {
  REQUIRED_VALUES = {
    a: {},
    b: {},
    c: {}
  };
  constructor(props) {
    super(props);
    this.name = "SlerpNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      a,
      b,
      c
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexA = this.values['a'].type;
    const typeA = this.getType(typeIndexA);
    const typeIndexB = this.values['b'].type;
    const typeB = this.getType(typeIndexB);
    const typeIndexC = this.values['c'].type;
    const typeC = this.getType(typeIndexC);
    if (typeA !== typeB) {
      throw Error("input types not equivalent");
    }
    if (typeC !== "float") {
      throw Error("c must be of type float");
    }
    const t = Number(c);
    let val;
    switch (typeA) {
      case "float2":
        {
          const lenA = Math.hypot(a[0], a[1]);
          const lenB = Math.hypot(b[0], b[1]);
          if (lenA <= THRESHOLD || lenB <= THRESHOLD) {
            val = [(1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1]];
            break;
          }
          const ax = a[0] / lenA,
            ay = a[1] / lenA;
          const bx = b[0] / lenB,
            by = b[1] / lenB;
          let theta = Math.acos(Math.min(Math.max(ax * bx + ay * by, -1), 1));
          if (ax * by - ay * bx < 0) {
            theta = -theta;
          }
          const L = (1 - t) * lenA + t * lenB;
          val = [(ax * Math.cos(t * theta) - ay * Math.sin(t * theta)) * L, (ax * Math.sin(t * theta) + ay * Math.cos(t * theta)) * L];
          break;
        }
      case "float3":
        {
          const lenA = Math.hypot(a[0], a[1], a[2]);
          const lenB = Math.hypot(b[0], b[1], b[2]);
          if (lenA <= THRESHOLD || lenB <= THRESHOLD) {
            val = [(1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1], (1 - t) * a[2] + t * b[2]];
            break;
          }
          const ax = a[0] / lenA,
            ay = a[1] / lenA,
            az = a[2] / lenA;
          const bx = b[0] / lenB,
            by = b[1] / lenB,
            bz = b[2] / lenB;
          const d = Math.min(Math.max(ax * bx + ay * by + az * bz, -1), 1);
          const L = (1 - t) * lenA + t * lenB;
          if (1 - d <= THRESHOLD) {
            // nearly parallel — linear blend
            val = [(1 - t) * a[0] + t * b[0], (1 - t) * a[1] + t * b[1], (1 - t) * a[2] + t * b[2]];
            break;
          }
          // Build rotation quaternion from axis-angle
          let rx, ry, rz;
          if (1 + d <= THRESHOLD) {
            // antiparallel — pick any perpendicular axis
            if (Math.abs(ax) <= Math.abs(ay) && Math.abs(ax) <= Math.abs(az)) {
              const len = Math.hypot(0, -az, ay);
              rx = 0;
              ry = -az / len;
              rz = ay / len;
            } else if (Math.abs(ay) <= Math.abs(az)) {
              const len = Math.hypot(-az, 0, ax);
              rx = -az / len;
              ry = 0;
              rz = ax / len;
            } else {
              const len = Math.hypot(-ay, ax, 0);
              rx = -ay / len;
              ry = ax / len;
              rz = 0;
            }
          } else {
            // normalized cross product of â and b̂
            const cx = ay * bz - az * by;
            const cy = az * bx - ax * bz;
            const cz = ax * by - ay * bx;
            const cLen = Math.hypot(cx, cy, cz);
            rx = cx / cLen;
            ry = cy / cLen;
            rz = cz / cLen;
          }
          const angle = t * Math.acos(d);
          const s = Math.sin(angle / 2);
          const qx = rx * s,
            qy = ry * s,
            qz = rz * s,
            qw = Math.cos(angle / 2);
          // Rotate â by quaternion q
          // plain number arrays: gl-matrix defaults to Float32Array, but spec floats are doubles
          const q = [qx, qy, qz, qw];
          const aVec = [ax, ay, az];
          const rotated = Array(3).fill(0);
          glMatrix.vec3.transformQuat(rotated, aVec, q);
          val = [rotated[0] * L, rotated[1] * L, rotated[2] * L];
          break;
        }
      default:
        throw Error("Invalid type");
    }
    return {
      'value': {
        value: val,
        type: typeIndexA
      }
    };
  }
}

// Matrix constants from the OkLab paper (optimized for double-precision)
// Step 1: linear RGB -> LMS
const M1 = [[0.4122214708, 0.5363325363, 0.0514459929], [0.2119034982, 0.6806995451, 0.1073969566], [0.0883024619, 0.2817188376, 0.6299787005]];

// Step 2: LMS^(1/3) -> Lab
const M2 = [[+0.2104542553, +0.7936177850, -0.0040720468], [+1.9779984951, -2.4285922050, +0.4505937099], [+0.0259040371, +0.7827717662, -0.8086757660]];
function cbrt(x) {
  return Math.cbrt(x);
}
class RgbToOkLCh extends BehaveEngineNode {
  REQUIRED_VALUES = {
    r: {},
    g: {},
    b: {}
  };
  constructor(props) {
    super(props);
    this.name = "RgbToOkLChNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      r,
      g,
      b
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexFloat = this.getTypeIndex("float");
    const rv = Number(r);
    const gv = Number(g);
    const bv = Number(b);

    // LMS = M1 * [r, g, b]
    const Lp = M1[0][0] * rv + M1[0][1] * gv + M1[0][2] * bv;
    const Mp = M1[1][0] * rv + M1[1][1] * gv + M1[1][2] * bv;
    const Sp = M1[2][0] * rv + M1[2][1] * gv + M1[2][2] * bv;

    // Lab = M2 * [cbrt(Lp), cbrt(Mp), cbrt(Sp)]
    const cLp = cbrt(Lp);
    const cMp = cbrt(Mp);
    const cSp = cbrt(Sp);
    const L = M2[0][0] * cLp + M2[0][1] * cMp + M2[0][2] * cSp;
    const a = M2[1][0] * cLp + M2[1][1] * cMp + M2[1][2] * cSp;
    const bOk = M2[2][0] * cLp + M2[2][1] * cMp + M2[2][2] * cSp;
    const chroma = Math.sqrt(a * a + bOk * bOk);
    const hue = Math.atan2(bOk, a);
    return {
      'l': {
        value: [L],
        type: typeIndexFloat
      },
      'c': {
        value: [chroma],
        type: typeIndexFloat
      },
      'h': {
        value: [hue],
        type: typeIndexFloat
      }
    };
  }
}

// Matrix constants from the OkLab paper (optimized for double-precision)
// Step 1: Lab -> LMS
const M3 = [[1.0, +0.3963377774, +0.2158037573], [1.0, -0.1055613458, -0.0638541728], [1.0, -0.0894841775, -1.2914855480]];

// Step 2: LMS^3 -> linear RGB
const M4 = [[+4.0767416621, -3.3077115913, +0.2309699292], [-1.2684380046, +2.6097574011, -0.3413193965], [-0.0041960863, -0.7034186147, +1.7076147010]];
class RgbFromOkLCh extends BehaveEngineNode {
  REQUIRED_VALUES = {
    l: {},
    c: {},
    h: {}
  };
  constructor(props) {
    super(props);
    this.name = "RgbFromOkLChNode";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    const {
      l,
      c,
      h
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const typeIndexFloat = this.getTypeIndex("float");
    const L = Number(l);
    const C = Number(c);
    const H = Number(h);
    const aOk = C * Math.cos(H);
    const bOk = C * Math.sin(H);

    // LMS = M3 * [L, a, b]
    const Lp = M3[0][0] * L + M3[0][1] * aOk + M3[0][2] * bOk;
    const Mp = M3[1][0] * L + M3[1][1] * aOk + M3[1][2] * bOk;
    const Sp = M3[2][0] * L + M3[2][1] * aOk + M3[2][2] * bOk;

    // RGB = M4 * [Lp^3, Mp^3, Sp^3]
    const Lp3 = Lp * Lp * Lp;
    const Mp3 = Mp * Mp * Mp;
    const Sp3 = Sp * Sp * Sp;
    const rv = M4[0][0] * Lp3 + M4[0][1] * Mp3 + M4[0][2] * Sp3;
    const gv = M4[1][0] * Lp3 + M4[1][1] * Mp3 + M4[1][2] * Sp3;
    const bv = M4[2][0] * Lp3 + M4[2][1] * Mp3 + M4[2][2] * Sp3;
    return {
      'r': {
        value: [rv],
        type: typeIndexFloat
      },
      'g': {
        value: [gv],
        type: typeIndexFloat
      },
      'b': {
        value: [bv],
        type: typeIndexFloat
      }
    };
  }
}

class OnSelect extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    nodeIndex: {
      defaultValue: [-1]
    }
  };
  _nodeIndex;
  constructor(props) {
    super(props);
    this.name = 'OnSelect';
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      nodeIndex
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._nodeIndex = nodeIndex[0];
    this.outValues.selectionPoint = {
      type: this.getTypeIndex('float3'),
      value: [NaN, NaN, NaN]
    };
    this.outValues.selectionRayOrigin = {
      type: this.getTypeIndex('float3'),
      value: [NaN, NaN, NaN]
    };
    this.outValues.selectedNode = {
      type: this.getTypeIndex('ref'),
      value: [null]
    };
    this.outValues.controllerIndex = {
      type: this.getTypeIndex('int'),
      value: [-1]
    };
    this.outValues.event = {
      type: this.getTypeIndex('ref'),
      value: [null]
    };
    this.setUpOnSelect();
    this.graphEngine.selectNodes.push(this);
  }
  setUpOnSelect() {
    const callback = (selectedNode, controllerIndex, selectionPoint, selectionRayOrigin, event) => {
      this.outValues.selectionPoint = {
        type: this.getTypeIndex('float3'),
        value: selectionPoint ?? [NaN, NaN, NaN]
      };
      this.outValues.selectionRayOrigin = {
        type: this.getTypeIndex('float3'),
        value: selectionRayOrigin ?? [NaN, NaN, NaN]
      };
      this.outValues.selectedNode = {
        type: this.getTypeIndex('ref'),
        value: [selectedNode]
      };
      this.outValues.controllerIndex = {
        type: this.getTypeIndex('int'),
        value: [controllerIndex]
      };
      this.outValues.event = {
        type: this.getTypeIndex('ref'),
        value: [event]
      };
      this.addEventToWorkQueue(this.flows.out);
    };
    this.graphEngine.selectableNodesIndices.set(Number(this._nodeIndex), callback);
  }
}

class AnimationStart extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    animation: {},
    startTime: {},
    endTime: {},
    speed: {}
  };
  constructor(props) {
    super(props);
    this.name = "AnimationStart";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      animation,
      startTime,
      endTime,
      speed
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const animationIndex = this.resolveRef(animation);
    const validAnimation = this.graphEngine.getWorld().animations.length > animationIndex && animationIndex >= 0;
    const validStartTime = !isNaN(startTime) && isFinite(startTime);
    // Infinite end times are valid and represent unbounded playback. Only the start time is
    // required to be finite by the KHR_interactivity animation/start operation.
    const validEndTime = !isNaN(endTime);
    const validSpeed = !isNaN(speed) && isFinite(speed) && speed > 0;
    if (validAnimation && validStartTime && validEndTime && validSpeed) {
      this.graphEngine.animationCompletionCallbacks.set(animationIndex, () => {
        if (this.flows.done) {
          this.addEventToWorkQueue(this.flows.done);
        }
      });
      this.graphEngine.startAnimation(animationIndex, startTime, endTime, speed, () => this.graphEngine.completeAnimation(animationIndex));
      if (this.flows.out) {
        this.processFlow(this.flows.out);
      }
    } else {
      if (this.flows.err) {
        this.processFlow(this.flows.err);
      }
    }
  }
}

class AnimationStop extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    animation: {}
  };
  constructor(props) {
    super(props);
    this.name = "AnimationStop";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      animation
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const animationIndex = this.resolveRef(animation);
    const validAnimation = this.graphEngine.getWorld().animations.length > animationIndex && animationIndex >= 0;
    if (validAnimation) {
      this.graphEngine.animationCompletionCallbacks.delete(animationIndex);
      this.graphEngine.stopAnimation(animationIndex);
      if (this.flows.out) {
        this.processFlow(this.flows.out);
      }
    } else {
      if (this.flows.err) {
        this.processFlow(this.flows.err);
      }
    }
  }
}

class AnimationStopAt extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    animation: {},
    stopTime: {}
  };
  constructor(props) {
    super(props);
    this.name = "AnimationStopAt";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      animation,
      stopTime
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const animationIndex = this.resolveRef(animation);
    const validAnimation = this.graphEngine.getWorld().animations.length > animationIndex && animationIndex >= 0;
    // spec: only NaN is invalid; an out-of-range stop time lets the animation reach its end
    const validStopTime = !isNaN(stopTime);
    if (validAnimation && validStopTime) {
      this.graphEngine.stopAnimationAt(animationIndex, stopTime, () => {
        if (this.flows.done) {
          this.addEventToWorkQueue(this.flows.done);
        }
      });
      if (this.flows.out) {
        this.processFlow(this.flows.out);
      }
    } else {
      if (this.flows.err) {
        this.processFlow(this.flows.err);
      }
    }
  }
}

class OnHoverIn extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    nodeIndex: {
      defaultValue: [-1]
    }
  };
  _nodeIndex;
  constructor(props) {
    super(props);
    this.name = 'OnHoverIn';
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      nodeIndex
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._nodeIndex = Number(nodeIndex[0]);
    this.outValues.hoveredNode = {
      type: this.getTypeIndex('ref'),
      value: [null]
    };
    this.outValues.controllerIndex = {
      type: this.getTypeIndex('int'),
      value: [-1]
    };
    this.outValues.event = {
      type: this.getTypeIndex('ref'),
      value: [this._nodeIndex]
    };
    this.setUpOnHoverIn();
  }
  setUpOnHoverIn() {
    const callback = (selectedNodeRef, controllerIndex, firstCommonHoverNodeIndex) => {
      const hoverInformation = this.graphEngine.hoverableNodesIndices.get(this._nodeIndex);
      if (hoverInformation) {
        this.outValues.hoveredNode = {
          type: this.getTypeIndex('ref'),
          value: [selectedNodeRef ?? null]
        };
        this.outValues.controllerIndex = {
          type: this.getTypeIndex('int'),
          value: [controllerIndex]
        };
        this.addEventToWorkQueue(this.flows.out);
      }
      this.graphEngine.queueFunctionCall(() => {
        // if (!this.graphEngine.propagationCancelled.has(this._nodeIndex)) {
        const parentNodeIndex = this.graphEngine.getParentNodeIndex(this._nodeIndex);
        this.graphEngine.alertOnHoverIn(selectedNodeRef, controllerIndex, parentNodeIndex, firstCommonHoverNodeIndex);
        // }
      });
    };
    const hoverInformation = this.graphEngine.hoverableNodesIndices.get(this._nodeIndex);
    if (hoverInformation) {
      hoverInformation.callbackHoverIn = callback;
    } else {
      this.graphEngine.hoverableNodesIndices.set(this._nodeIndex, {
        callbackHoverIn: callback
      });
    }
  }
}

class OnHoverOut extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    nodeIndex: {
      defaultValue: [-1]
    }
  };
  _nodeIndex;
  constructor(props) {
    super(props);
    this.name = 'OnHoverOut';
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      nodeIndex
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._nodeIndex = Number(nodeIndex[0]);
    this.outValues.hoveredNode = {
      type: this.getTypeIndex('ref'),
      value: [null]
    };
    this.outValues.controllerIndex = {
      type: this.getTypeIndex('int'),
      value: [-1]
    };
    this.outValues.event = {
      type: this.getTypeIndex('ref'),
      value: [this._nodeIndex]
    };
    this.setUpOnHoverOut();
  }
  setUpOnHoverOut() {
    const callback = (selectedNodeRef, controllerIndex, firstCommonHoverNodeIndex) => {
      const hoverInformation = this.graphEngine.hoverableNodesIndices.get(this._nodeIndex);
      if (hoverInformation) {
        this.outValues.hoveredNode = {
          type: this.getTypeIndex('ref'),
          value: [selectedNodeRef ?? null]
        };
        this.outValues.controllerIndex = {
          type: this.getTypeIndex('int'),
          value: [controllerIndex]
        };
        this.addEventToWorkQueue(this.flows.out);
      }
      this.graphEngine.queueFunctionCall(() => {
        // if (!this.graphEngine.propagationCancelled.has(this._nodeIndex)) {
        const parentNodeIndex = this.graphEngine.getParentNodeIndex(this._nodeIndex);
        this.graphEngine.alertOnHoverOut(selectedNodeRef, controllerIndex, parentNodeIndex, firstCommonHoverNodeIndex);
        // }
      });
    };
    const hoverInformation = this.graphEngine.hoverableNodesIndices.get(this._nodeIndex);
    if (hoverInformation) {
      hoverInformation.callbackHoverOut = callback;
    } else {
      this.graphEngine.hoverableNodesIndices.set(this._nodeIndex, {
        callbackHoverOut: callback
      });
    }
  }
}

// Single source of truth for op -> runtime BehaveEngineNode class. registerKnownBehaviorNodes
// iterates this; tools/tests import it to check parity with the authoring palette (tst/opRegistryParity.test.ts).
const behaveEngineNodeRegistry = [["event/onStart", OnStartNode], ["event/onTick", OnTickNode], ["flow/branch", Branch], ["flow/setDelay", SetDelay], ["flow/cancelDelay", CancelDelay], ["flow/doN", DoN], ["flow/for", ForLoop], ["flow/multiGate", MultiGate], ["flow/sequence", Sequence], ["flow/switch", Switch], ["flow/throttle", Throttle], ["flow/waitAll", WaitAll], ["flow/while", WhileLoop], ["pointer/get", PointerGet], ["pointer/set", PointerSet], ["pointer/interpolate", PointerInterpolate], ["math/abs", AbsoluteValue], ["event/receive", Receive], ["event/send", Send], ["variable/get", VariableGet], ["variable/set", VariableSet], ["variable/interpolate", VariableInterpolate], ["math/E", Euler], ["math/Inf", Inf], ["math/NaN", NotANumber], ["math/Pi", Pi], ["math/Tau", Tau], ["math/sign", Sign], ["math/trunc", Truncate], ["math/floor", Floor], ["math/fract", Fraction], ["math/ceil", Ceil], ["math/round", Round], ["math/neg", Negate], ["math/add", Add], ["math/sub", Subtract], ["math/mul", Multiply], ["math/div", Divide], ["math/rem", Remainder], ["math/min", Min], ["math/max", Max], ["math/mix", Mix], ["math/saturate", Saturate], ["math/clamp", Clamp], ["math/smoothStep", SmoothStep], ["math/rad", DegreeToRadians], ["math/deg", RadiansToDegrees], ["math/sin", Sine], ["math/cos", Cosine], ["math/tan", Tangent], ["math/asin", Arcsine], ["math/acos", Arccosine], ["math/atan", Arctangent], ["math/atan2", Arctangent2], ["math/sinh", HyperbolicSine], ["math/cosh", HyperbolicCosine], ["math/tanh", HyperbolicTangent], ["math/asinh", InverseHyperbolicSine], ["math/acosh", InverseHyperbolicCosine], ["math/atanh", InverseHyperbolicTangent], ["math/exp", Exponential], ["math/log", Log], ["math/log2", Log2], ["math/log10", Log10], ["math/pow", Power], ["math/sqrt", SquareRoot], ["math/cbrt", CubeRoot], ["math/random", Random], ["math/lt", LessThan], ["math/le", LessThanOrEqualTo], ["math/eq", Equality], ["math/ge", GreaterThanOrEqualTo], ["math/gt", GreaterThan], ["math/dot", Dot], ["math/cross", Cross], ["math/normalize", Normalize], ["math/rotate2D", Rotate2D], ["math/rotate3D", Rotate3D], ["math/length", VectorLength], ["math/slerp", Slerp], ["math/isInf", IsInfNode], ["math/isNaN", IsNaNNode], ["math/select", Select], ["math/switch", MathSwitch], ["math/extract2", Extract2], ["math/extract3", Extract3], ["math/extract4", Extract4], ["math/extract2x2", Extract2x2], ["math/extract3x3", Extract3x3], ["math/extract4x4", Extract4x4], ["math/combine2", Combine2], ["math/combine3", Combine3], ["math/combine4", Combine4], ["math/combine2x2", Combine2x2], ["math/combine3x3", Combine3x3], ["math/combine4x4", Combine4x4], ["type/boolToInt", BoolToInt], ["type/boolToFloat", BoolToFloat], ["type/floatToBool", FloatToBool], ["type/floatToInt", FloatToInt], ["type/intToBool", IntToBool], ["type/intToFloat", IntToFloat], ["math/not", Not], ["math/xor", Xor], ["math/or", Or], ["math/and", And], ["math/lsl", LeftShift], ["math/asr", RightShift], ["math/clz", CountLeadingZeros], ["math/ctz", CountTrailingZeros], ["math/popcnt", CountOneBits], ["math/quatMul", QuatMul], ["math/quatConjugate", QuatConjugate], ["math/quatFromAxisAngle", QuatFromAxisAngle], ["math/quatAngleBetween", QuatAngleBetween], ["math/quatSlerp", QuatSlerp], ["math/quatToAxisAngle", QuatToAxisAngle], ["math/quatFromDirections", QuatFromDirections], ["math/quatFromUpForward", QuatFromUpForward], ["math/quatFromAngles", QuatFromAngles], ["math/matDecompose", MatDecompose], ["math/matCompose", MatCompose], ["math/determinant", Determinant], ["math/transform", Transform], ["math/transpose", Transpose], ["math/matMul", MatMul], ["math/inverse", Inverse], ["debug/log", DebugLog], ["event/stopPropagation", EventStopPropagation], ["ref/eq", RefEquality], ["math/rgbToOkLCh", RgbToOkLCh], ["math/rgbFromOkLCh", RgbFromOkLCh], ["animation/start", AnimationStart], ["animation/stop", AnimationStop], ["animation/stopAt", AnimationStopAt], ["event/onSelect", OnSelect], ["event/onHoverIn", OnHoverIn], ["event/onHoverOut", OnHoverOut]];

/** The graph failed load-time validation; per the spec it is rejected and never runs. */
class GraphRejectedError extends Error {
  constructor(message) {
    super(message);
    this.name = "GraphRejectedError";
  }
}
const defaultNodeHook = _node => {/*no-op*/};
const defaultFlowHook = _flow => {/*no-op*/};
class BasicBehaveEngine {
  registry;
  executionErrorListener;
  idToBehaviourNodeMap;
  eventBus;
  onTickNodeIndices;
  _lastTickTime;
  _pauseTickTime;
  _pauseDuration;
  _scheduledDelays;
  scheduledDelayOwners = new Map();
  nodes;
  _variables;
  events;
  types;
  jsonPtrTrie;
  _fps;
  // bumped by clearValueEvaluationCache; node output caches from an older epoch are stale
  valueEvaluationEpoch = 0;
  compiledOutputs = [];
  _timerID;
  hoverableNodesIndices;
  selectableNodesIndices;
  selectNodes;
  lastHoveredNodeIndices;
  rigidBodyTriggerNodeIndices;
  propagationCancelled;
  propagationCancelledPending;
  animationCompletionCallbacks;
  constructor(fps, eventBus) {
    this.registry = new Map();
    this.idToBehaviourNodeMap = new Map();
    this.jsonPtrTrie = new JsonPtrTrie();
    this._fps = fps;
    this.onTickNodeIndices = [];
    this._lastTickTime = NaN;
    this._pauseTickTime = NaN;
    this._pauseDuration = 0;
    this.eventBus = eventBus;
    this._variables = [];
    this.events = [];
    this._scheduledDelays = [];
    this.nodes = [];
    this.types = [];
    this._timerID = null;
    this.hoverableNodesIndices = new Map();
    this.lastHoveredNodeIndices = new Map();
    this.selectableNodesIndices = new Map();
    this.selectNodes = [];
    this.rigidBodyTriggerNodeIndices = new Map();
    this.propagationCancelled = new Set();
    this.propagationCancelledPending = new Set();
    this.animationCompletionCallbacks = new Map();
    this.registerKnownBehaviorNodes();
  }
  get lastTickTime() {
    return this._lastTickTime - this._pauseDuration;
  }
  get fps() {
    return this._fps;
  }
  get variables() {
    return this._variables;
  }
  completeAnimation(animationIndex) {
    const callback = this.animationCompletionCallbacks.get(animationIndex);
    callback?.();
    this.animationCompletionCallbacks.delete(animationIndex);
  }
  startAnimation(animationIndex, startTime, endTime, speed, callback) {
    // Implemented by decorators
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  stopAnimation(animationIndex) {
    // Implemented by decorators
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  stopAnimationAt(animationIndex, stopTime, callback) {
    // Implemented by decorators
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  applyImpulseToRigidBody(nodeIndex, linearImpulse, angularImpulse) {
    // Implemented by decorators
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  applyPointImpulseToRigidBody(nodeIndex, impulse, position) {
    // Implemented by decorators
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  rayCastRigidBodies(rayStart, rayEnd, collisionFilterIndex) {
    // Implemented by decorators
    return {
      hitNodeIndex: -1,
      hitFraction: undefined,
      hitNormal: undefined
    };
  }
  rigidBodyTriggerEntered(nodeIndex, colliderNodeIndex, motionNodeIndex) {
    const callback = this.rigidBodyTriggerNodeIndices.get(nodeIndex)?.triggerEntered;
    if (callback) {
      callback(colliderNodeIndex, motionNodeIndex);
    }
  }
  rigidBodyTriggerExited(nodeIndex, colliderNodeIndex, motionNodeIndex) {
    const callback = this.rigidBodyTriggerNodeIndices.get(nodeIndex)?.triggerExited;
    if (callback) {
      callback(colliderNodeIndex, motionNodeIndex);
    }
  }
  select(selectedNodeIndex, controllerIndex, selectionPoint, selectionRayOrigin) {
    const onSelectEventIndex = this.events.findIndex(event => event.id === "onSelect");
    const eventRef = `/extensions/KHR_interactivity/events/${onSelectEventIndex}`;
    for (let nodeIndex = selectedNodeIndex;;) {
      this.flushPendingPropagationCancellations();
      if (this.propagationCancelled.has(eventRef)) {
        break;
      }
      const callback = this.selectableNodesIndices.get(nodeIndex);
      if (callback !== undefined) {
        callback(`/nodes/${selectedNodeIndex}`, controllerIndex, selectionPoint, selectionRayOrigin, eventRef);
        return;
      }
      const parent = this.getParentNodeIndex(nodeIndex);
      if (parent === undefined) {
        return;
      }
      nodeIndex = parent;
    }
  }
  hoverOn(nodeIndex, controllerIndex) {
    const lastHoverNodeIndex = this.lastHoveredNodeIndices.get(controllerIndex);
    if (nodeIndex === lastHoverNodeIndex) {
      return;
    }
    const oldHoverIndicies = new Set();
    let firstCommonHoverNodeIndex = undefined;
    if (lastHoverNodeIndex !== undefined && nodeIndex !== undefined) {
      let currentOldHoverNodeIndex = lastHoverNodeIndex;
      while (currentOldHoverNodeIndex !== undefined) {
        oldHoverIndicies.add(currentOldHoverNodeIndex);
        currentOldHoverNodeIndex = this.getParentNodeIndex(currentOldHoverNodeIndex);
      }
      let currentHoverNodeIndex = nodeIndex;
      while (currentHoverNodeIndex !== undefined) {
        if (oldHoverIndicies.has(currentHoverNodeIndex)) {
          firstCommonHoverNodeIndex = currentHoverNodeIndex;
          break;
        }
        currentHoverNodeIndex = this.getParentNodeIndex(currentHoverNodeIndex);
      }
    }
    const lastHoverNodeRef = lastHoverNodeIndex !== undefined ? `/nodes/${lastHoverNodeIndex}` : undefined;
    const newHoverNodeRef = nodeIndex !== undefined ? `/nodes/${nodeIndex}` : undefined;
    this.alertOnHoverOut(lastHoverNodeRef, controllerIndex, lastHoverNodeIndex, firstCommonHoverNodeIndex);
    this.alertOnHoverIn(newHoverNodeRef, controllerIndex, nodeIndex, firstCommonHoverNodeIndex);
    this.lastHoveredNodeIndices.set(controllerIndex, nodeIndex);
  }
  alertOnHoverIn(selectedNodeRef, controllerIndex, currentHoverNodeIndex, firstCommonHoverNodeIndex) {
    while (currentHoverNodeIndex !== undefined && currentHoverNodeIndex !== firstCommonHoverNodeIndex) {
      const hoverInformation = this.hoverableNodesIndices.get(currentHoverNodeIndex);
      if (hoverInformation?.callbackHoverIn !== undefined) {
        hoverInformation.callbackHoverIn(selectedNodeRef, controllerIndex, firstCommonHoverNodeIndex);
        break;
      }
      currentHoverNodeIndex = this.getParentNodeIndex(currentHoverNodeIndex);
    }
  }
  alertOnHoverOut(selectedNodeRef, controllerIndex, currentHoverNodeIndex, firstCommonHoverNodeIndex) {
    while (currentHoverNodeIndex !== undefined && currentHoverNodeIndex !== firstCommonHoverNodeIndex) {
      const hoverInformation = this.hoverableNodesIndices.get(currentHoverNodeIndex);
      if (hoverInformation?.callbackHoverOut !== undefined) {
        hoverInformation.callbackHoverOut(selectedNodeRef, controllerIndex, firstCommonHoverNodeIndex);
        break;
      }
      currentHoverNodeIndex = this.getParentNodeIndex(currentHoverNodeIndex);
    }
  }
  clearScheduledDelays() {
    // actually cancel the pending flow/setDelay timers - dropping the references alone leaves
    // them queued, so their callbacks keep firing after the graph is torn down
    for (let index = 0; index < this._scheduledDelays.length; index++) {
      const delay = this._scheduledDelays[index];
      if (delay !== undefined) {
        clearTimeout(delay);
      }
      this.removeScheduledDelay(index);
    }
    this._scheduledDelays = [];
    this.scheduledDelayOwners.clear();
  }
  dispose = () => {
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
      this._timerID = null;
    }
    this.clearScheduledDelays();
    this.clearEventList();
    this.clearCustomEventListeners();
  };
  get scheduledDelays() {
    return this._scheduledDelays;
  }
  pushScheduledDelay = (delay, removeOwner) => {
    if (removeOwner) this.scheduledDelayOwners.set(this._scheduledDelays.length, removeOwner);
    this.jsonPtrTrie.addPath(`/extensions/KHR_interactivity/delays/${this._scheduledDelays.length}`, () => [delay], () => undefined, "ref", true);
    this._scheduledDelays.push(delay);
  };
  getScheduledDelay = index => {
    if (index >= this._scheduledDelays.length || index < 0) {
      return undefined;
    }
    return this._scheduledDelays[index];
  };
  cancelScheduledDelay = index => {
    const delay = this.getScheduledDelay(index);
    if (delay !== undefined) {
      clearTimeout(delay);
      this.removeScheduledDelay(index);
    }
  };
  removeScheduledDelay = index => {
    this.scheduledDelayOwners.get(index)?.();
    this.scheduledDelayOwners.delete(index);
    if (index >= 0 && index < this._scheduledDelays.length) {
      this.jsonPtrTrie.removePath(`/extensions/KHR_interactivity/delays/${index}`);
      this._scheduledDelays[index] = undefined;
    }
  };
  getEventList = () => {
    return this.eventBus.getEventList();
  };
  clearEventList = () => {
    this.eventBus.clearEventList();
  };
  addEvent = event => {
    this.eventBus.addEvent(event);
  };
  clearValueEvaluationCache = () => {
    this.valueEvaluationEpoch++;
  };
  getCompiledOutput = (node, socket) => {
    const output = this.compiledOutputs[node]?.[socket];
    if (output && output.version !== this.valueEvaluationEpoch) {
      output.value = output.evaluate();
      output.version = this.valueEvaluationEpoch;
    }
    return output;
  };
  registerJsonPointer = (jsonPtr, getterCallback, setterCallback, typeName, readOnly) => {
    this.jsonPtrTrie.addPath(jsonPtr, getterCallback, setterCallback, typeName, readOnly);
  };
  getRegisteredJsonPointers = () => {
    return this.jsonPtrTrie.getRegisteredPaths();
  };

  // object models replace this one lookup; the accessors below all go through it
  resolveJsonPtr = jsonPtr => {
    return this.jsonPtrTrie.resolve(jsonPtr);
  };
  isValidJsonPtr = jsonPtr => {
    return this.resolveJsonPtr(jsonPtr) !== undefined;
  };
  isReadOnly = jsonPtr => {
    return this.resolveJsonPtr(jsonPtr)?.readOnly ?? false;
  };
  getPathValue = path => {
    return this.resolveJsonPtr(path)?.getValue(path);
  };
  getPathTypeName = path => {
    return this.resolveJsonPtr(path)?.typeName;
  };
  setPathValue = (path, value) => {
    this.resolveJsonPtr(path)?.setValue(path, value);
  };
  addCustomEventListener = (name, func) => {
    this.eventBus.addCustomEventListener(name, func);
  };
  dispatchCustomEvent = (name, vals) => {
    this.eventBus.dispatchCustomEvent(name, vals);
  };
  clearCustomEventListeners = () => {
    this.eventBus.clearCustomEventListeners();
  };
  queueFunctionCall = func => {
    this.eventBus.addEvent({
      func
    });
  };
  registerGraphEventPointers = () => {
    const eventCountWithLifecycleEvents = (this.events?.length ?? 0) + 2;
    this.registerJsonPointer(`/extensions/KHR_interactivity/events/${eventCountWithLifecycleEvents}`, path => [path], () => undefined, "ref", true);
  };
  loadBehaveGraph = (behaveGraph, runGraph = true) => {
    const runtimeGraph = cloneGraphData(behaveGraph);
    this.compiledOutputs = [];
    this.clearValueEvaluationCache();
    this.hoverableNodesIndices.clear();
    this.selectableNodesIndices.clear();
    this.lastHoveredNodeIndices.clear();
    this.propagationCancelled.clear();
    this.propagationCancelledPending.clear();
    this._pauseDuration = 0;
    this._pauseTickTime = NaN;
    try {
      this.validateGraph(runtimeGraph);
    } catch (e) {
      throw new GraphRejectedError(`The graph is invalid: ${e instanceof Error ? e.message : e}`);
    }

    // spec: all top-level graph arrays are optional
    this.nodes = runtimeGraph.nodes ?? [];
    this._variables = runtimeGraph.variables ?? [];
    this.events = runtimeGraph.events ?? [];
    this.types = runtimeGraph.types ?? [];
    this.idToBehaviourNodeMap.clear();
    this.registerGraphEventPointers();
    const defaultProps = {
      idToBehaviourNodeMap: this.idToBehaviourNodeMap,
      variables: this._variables,
      events: this.events
    };
    this._variables.forEach(variable => {
      if (variable.value === undefined) {
        // TODO get the default value from the type
        variable.value = [0];
      }
      // sanitize, these need to be arrays
      if (!Array.isArray(variable.value)) {
        variable.value = [variable.value];
      }
    });
    let index = 0;
    this.nodes.forEach(node => {
      const nodeDeclaration = runtimeGraph.declarations[node.declaration];
      if (nodeDeclaration === undefined) {
        throw new GraphRejectedError(`Unrecognized node declaration ${node.declaration} but declerations has ${Object.keys(runtimeGraph.declarations).length} keys`);
      }
      const behaviourNodeProps = {
        ...defaultProps,
        index: index,
        flows: node.flows || {},
        values: node.values || {},
        configuration: node.configuration || {},
        variables: this._variables,
        types: this.types,
        graphEngine: this,
        declaration: nodeDeclaration,
        addEventToWorkQueue: this.addEventToWorkQueue
      };
      const nodeType = nodeDeclaration.op;
      let behaviourNode;
      try {
        if (this.registry.get(nodeType) === undefined) {
          behaviourNode = new NoOpNode(behaviourNodeProps);
        } else {
          behaviourNode = this.registry.get(nodeType).init(behaviourNodeProps);
        }
      } catch (e) {
        // node constructors validate their configuration/sockets; a throw there is a load-time rejection
        throw new GraphRejectedError(`Node ${index} (${nodeType}) is invalid: ${e instanceof Error ? e.message : e}`);
      }
      this.idToBehaviourNodeMap.set(index, behaviourNode);
      index++;
    });
    this.compiledOutputs = compileValueOutputs(this, this.idToBehaviourNodeMap, new Map(behaveEngineNodeRegistry), this.types);
    compileControlNodes(this, this.idToBehaviourNodeMap, new Map(behaveEngineNodeRegistry), this.compiledOutputs, this.types);
    this.onTickNodeIndices = this.nodes.map((node, idx) => runtimeGraph.declarations[node.declaration].op === "event/onTick" ? idx : -1).filter(idx => idx !== -1);
    const onStartIndices = this.nodes.map((node, idx) => runtimeGraph.declarations[node.declaration].op === "event/onStart" ? idx : -1).filter(idx => idx !== -1);
    for (const startNodeIndex of onStartIndices) {
      const startFlow = {
        node: startNodeIndex,
        socket: "start"
      };
      this.addEventToWorkQueue(startFlow);
    }
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
      this._timerID = null;
    }
    if (runGraph) {
      this.executeEventQueue();
    }
  };
  pauseEventQueue = () => {
    this._pauseTickTime = performance.now();
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
      this._timerID = null;
    }
  };
  playEventQueue = () => {
    if (this._timerID === null) {
      this.executeEventQueue();
    }
  };
  processNodeStarted = defaultNodeHook;
  processAddingNodeToQueue = flowBeingAdded => {
    //pass
  };
  processExecutingNextNode = defaultFlowHook;
  hasExecutionHooks = () => this.processNodeStarted !== defaultNodeHook || this.processExecutingNextNode !== defaultFlowHook;
  processDebugLog = (node, message, severity) => {
    if (severity === 0) {
      console.log(`[DebugLog #${node.index}]`, message);
    } else if (severity === 1) {
      console.warn(`[DebugLog #${node.index}]`, message);
    } else if (severity === 2) {
      console.error(`[DebugLog #${node.index}]`, message);
    }
  };
  registerKnownPointers = () => {
    //pass
  };
  getWorld = () => {
    //pass
  };
  getParentNodeIndex = nodeIndex => {
    //pass
    return undefined;
  };
  isSlerpPath = path => {
    if (path.endsWith("rotation")) {
      return true;
    } else {
      return false;
    }
  };
  animateCubicBezier = (path, p1, p2, initialValue, targetValue, duration, valueType, callback) => {
    this.clearPointerInterpolation(path);
    const startTime = this.lastTickTime;
    const action = async () => {
      const elapsedDuration = (this.lastTickTime - startTime) / 1000;
      const t = Math.min(elapsedDuration / duration, 1);
      // q is the output progress position: the easing curve evaluated at input progress t
      const q = cubicBezierEase(t, p1, p2);
      if (valueType === "float3") {
        const value = [linearFloat(q, initialValue[0], targetValue[0]), linearFloat(q, initialValue[1], targetValue[1]), linearFloat(q, initialValue[2], targetValue[2])];
        this.setPathValue(path, value);
      } else if (valueType === "float4") {
        if (this.isSlerpPath(path)) {
          const value = slerpFloat4(q, initialValue, targetValue);
          this.setPathValue(path, value);
        } else {
          const value = [linearFloat(q, initialValue[0], targetValue[0]), linearFloat(q, initialValue[1], targetValue[1]), linearFloat(q, initialValue[2], targetValue[2]), linearFloat(q, initialValue[3], targetValue[3])];
          this.setPathValue(path, value);
        }
      } else if (valueType === "float") {
        const value = [linearFloat(q, initialValue[0], targetValue[0])];
        this.setPathValue(path, value);
      } else if (valueType == "float2") {
        const value = [linearFloat(q, initialValue[0], targetValue[0]), linearFloat(q, initialValue[1], targetValue[1])];
        this.setPathValue(path, value);
      }
      if (elapsedDuration >= duration) {
        this.setPathValue(path, targetValue);
        this.clearPointerInterpolation(path);
        callback();
      }
    };
    this.setPointerInterpolationCallback(path, {
      action: action
    });
  };
  registerKnownBehaviorNodes = () => {
    for (const [op, behaveEngineNode] of behaveEngineNodeRegistry) {
      this.registerBehaveEngineNode(op, behaveEngineNode);
    }
  };
  validateGraph = behaviorGraph => {
    const nodes = behaviorGraph.nodes ?? [];
    let index = 0;
    for (const node of nodes) {
      // for each node, ensure that it's values do not reference a later node
      if (node.values !== undefined) {
        for (const key of Object.keys(node.values)) {
          if (node.values[key].node !== undefined) {
            const referencedNode = Number(node.values[key].node);
            if (referencedNode >= index) {
              const opOf = idx => {
                const declIdx = nodes[idx]?.declaration;
                return behaviorGraph.declarations?.[declIdx]?.op ?? `declaration ${declIdx}`;
              };
              throw Error(`Invalid reference: node ${index} ('${opOf(index)}', socket '${key}') references node ${referencedNode} ('${opOf(referencedNode)}'), but a node may only reference nodes that appear earlier in the array (index < ${index}). Reorder the nodes so that node ${referencedNode} comes before node ${index}.`);
            }
          }
        }
      }
      index++;
    }
  };
  registerBehaveEngineNode = (type, behaviorNode) => {
    if (this.registry.has(type)) {
      console.warn(`Behavior node ${type} is already registered and will be overwritten`);
    }
    this.registry.set(type, behaviorNode);
  };
  addEventToWorkQueue = flow => {
    if (flow === undefined || flow.node === undefined) {
      return;
    }
    const nextNode = this.idToBehaviourNodeMap.get(Number(flow.node));
    if (nextNode === undefined) {
      return;
    }
    this.processAddingNodeToQueue(flow);
    this.eventBus.addEvent({
      behaveNode: nextNode,
      inSocketId: flow.socket
    });
  };
  executeEventQueueTick = () => {
    this.executeEventQueue(true);
  };
  executeEventQueue = (manualStep = false) => {
    // process events in queue
    this._lastTickTime = performance.now();
    if (!isNaN(this._pauseTickTime)) {
      this._pauseDuration += this._lastTickTime - this._pauseTickTime;
      this._pauseTickTime = NaN;
    }
    this.propagationCancelled.clear();
    this.propagationCancelledPending.clear();

    // events queued while processing run on the next tick
    const eventQueue = this.eventBus.getEventList().slice();
    this.eventBus.clearEventList();
    for (let i = 0; i < eventQueue.length; i++) {
      const eventToStart = eventQueue[i];
      if (eventToStart.behaveNode) {
        eventToStart.behaveNode.processNode(eventToStart.inSocketId);
      } else if (eventToStart.func) {
        eventToStart.func();
      }
    }

    // process interpolations
    for (const interpolation of Object.values(this.eventBus.getVariableInterpolationCallbacks())) {
      interpolation.action();
    }
    for (const interpolation of Object.values(this.eventBus.getPointerInterpolationCallbacks())) {
      interpolation.action();
    }

    // process onTick nodes
    for (const onTickNodeIndex of this.onTickNodeIndices) {
      const tickFlow = {
        node: onTickNodeIndex,
        socket: "tick"
      };
      const tickNode = this.idToBehaviourNodeMap.get(Number(tickFlow.node));
      tickNode.processNode();
    }
    if (this._timerID !== null) {
      clearTimeout(this._timerID);
    }
    if (manualStep) {
      return;
    }
    this._timerID = setTimeout(() => {
      try {
        this.executeEventQueue();
      } catch (e) {
        // a throwing node halts the loop; report it instead of failing silently in a timer
        this._timerID = null;
        if (this.executionErrorListener === undefined) {
          throw e;
        }
        this.executionErrorListener(e);
      }
    }, 1000 / this.fps);
  };

  /** Receives runtime errors that stopped the event loop after the initial load. */
  setExecutionErrorListener = listener => {
    this.executionErrorListener = listener;
  };
  flushPendingPropagationCancellations = () => {
    for (const event of this.propagationCancelledPending) {
      this.propagationCancelled.add(event);
    }
    this.propagationCancelledPending.clear();
  };
  setPointerInterpolationCallback(path, action) {
    this.eventBus.setPointerInterpolationCallback(path, action);
  }
  setVariableInterpolationCallback(variable, action) {
    this.eventBus.setVariableInterpolationCallback(variable, action);
  }
  clearPointerInterpolation(path) {
    this.eventBus.clearPointerInterpolation(path);
  }
  clearVariableInterpolation(variable) {
    this.eventBus.clearVariableInterpolation(variable);
  }
  isEventPropagationCancelled(event) {
    return this.propagationCancelled.has(event);
  }
}
function cloneGraphData(value) {
  if (Array.isArray(value)) {
    return value.map(entry => cloneGraphData(entry));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneGraphData(entry)]));
  }
  return value;
}

class DOMEventBus {
  eventList;
  customEventListeners;
  eventListeners;
  variableInterpolationCallbacks;
  pointerInterpolationCallbacks;
  constructor() {
    this.eventList = [];
    this.customEventListeners = {};
    this.eventListeners = {};
    this.variableInterpolationCallbacks = {};
    this.pointerInterpolationCallbacks = {};
  }
  getEventList = () => {
    return this.eventList;
  };
  clearEventList = () => {
    this.eventList = [];
  };
  addEvent = event => {
    this.eventList.push(event);
  };
  addCustomEventListener = (name, func) => {
    if (!this.customEventListeners[name]) {
      this.customEventListeners[name] = [];
      const eventListener = e => {
        this.customEventListeners[name].forEach(func => {
          this.eventList.push({
            func: () => func(e),
            inSocketId: name
          });
        });
      };
      document.addEventListener(name, eventListener);
      this.eventListeners[name] = eventListener;
    }
    this.customEventListeners[name].push(func);
  };
  dispatchCustomEvent = (name, vals) => {
    const event = new CustomEvent(name, {
      detail: vals
    });
    document.dispatchEvent(event);
  };
  getCustomEventsNames = () => {
    return Object.keys(this.customEventListeners);
  };
  clearCustomEventListeners = () => {
    this.customEventListeners = {};
    Object.keys(this.eventListeners).forEach(name => {
      document.removeEventListener(name, this.eventListeners[name]);
    });
    this.eventListeners = {};
  };
  setVariableInterpolationCallback = (variable, action) => {
    this.variableInterpolationCallbacks[variable] = action;
  };
  clearVariableInterpolation = variable => {
    if (this.variableInterpolationCallbacks[variable] !== undefined) {
      delete this.variableInterpolationCallbacks[variable];
    }
  };
  getVariableInterpolationCallbacks = () => {
    return this.variableInterpolationCallbacks;
  };
  setPointerInterpolationCallback = (pointer, action) => {
    this.pointerInterpolationCallbacks[pointer] = action;
  };
  clearPointerInterpolation = pointer => {
    if (this.pointerInterpolationCallbacks[pointer] !== undefined) {
      delete this.pointerInterpolationCallbacks[pointer];
    }
  };
  getPointerInterpolationCallbacks = () => {
    return this.pointerInterpolationCallbacks;
  };
}

class ApplyImpulse extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    nodeIndex: {},
    linearImpulse: {},
    angularImpulse: {}
  };
  constructor(props) {
    super(props);
    this.name = "ApplyImpulse";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      nodeIndex,
      linearImpulse,
      angularImpulse
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    this.graphEngine.applyImpulseToRigidBody(nodeIndex, linearImpulse, angularImpulse);
  }
}

class ApplyPointImpulse extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    nodeIndex: {},
    impulse: {},
    position: {}
  };
  constructor(props) {
    super(props);
    this.name = "ApplyPointImpulse";
    this.validateValues(this.values);
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      nodeIndex,
      impulse,
      position
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    this.graphEngine.applyPointImpulseToRigidBody(nodeIndex, impulse, position);
  }
}

class RayCast extends BehaveEngineNode {
  INPUT_FLOWS = ["in"];
  REQUIRED_VALUES = {
    rayStart: {},
    rayEnd: {},
    collisionFilterIndex: {}
  };
  constructor(props) {
    super(props);
    this.name = "RayCast";
    this.validateValues(this.values);
    this.outValues.hitNode = {
      value: [-1],
      type: this.getTypeIndex('ref')
    };
    this.outValues.hitFraction = {
      value: [NaN],
      type: this.getTypeIndex('float')
    };
    this.outValues.hitNormal = {
      value: [NaN, NaN, NaN],
      type: this.getTypeIndex('vec3')
    };
  }
  processNode(flowSocket) {
    this.graphEngine.clearValueEvaluationCache();
    const {
      rayStart,
      rayEnd,
      collisionFilterIndex
    } = this.evaluateRequiredValues();
    this.graphEngine.processNodeStarted(this);
    const hitResult = this.graphEngine.rayCastRigidBodies(rayStart, rayEnd, collisionFilterIndex);
    if (hitResult.hitNodeIndex < 0) {
      this.outValues.hitNode = {
        value: [-1],
        type: this.getTypeIndex('ref')
      };
      this.outValues.hitFraction = {
        value: [NaN],
        type: this.getTypeIndex('float')
      };
      this.outValues.hitNormal = {
        value: [NaN, NaN, NaN],
        type: this.getTypeIndex('vec3')
      };
      if (this.flows.miss) {
        this.processFlow(this.flows.miss);
      }
    } else {
      this.outValues.hitNode = {
        value: [hitResult.hitNodeIndex],
        type: this.getTypeIndex('ref')
      };
      this.outValues.hitFraction = {
        value: [hitResult.hitFraction],
        type: this.getTypeIndex('float')
      };
      this.outValues.hitNormal = {
        value: hitResult.hitNormal,
        type: this.getTypeIndex('vec3')
      };
      if (this.flows.hit) {
        this.processFlow(this.flows.hit);
      }
    }
  }
}

class TriggerEntered extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    nodeIndex: {
      defaultValue: [-1]
    }
  };
  _nodeIndex;
  constructor(props) {
    super(props);
    this.name = 'TriggerEntered';
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      nodeIndex
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._nodeIndex = Number(nodeIndex[0]);
    this.outValues.colliderNode = {
      type: this.getTypeIndex('ref'),
      value: [-1]
    };
    this.outValues.motionNode = {
      type: this.getTypeIndex('ref'),
      value: [-1]
    };
    this.setUpOnTriggerEntered();
  }
  setUpOnTriggerEntered() {
    const callback = (colliderNodeRef, motionNodeRef) => {
      this.outValues.colliderNode = {
        type: this.getTypeIndex('ref'),
        value: [colliderNodeRef]
      };
      this.outValues.motionNode = {
        type: this.getTypeIndex('ref'),
        value: [motionNodeRef ?? -1]
      };
      console.log("TriggerEntered", {
        node: this._nodeIndex,
        outValues: this.outValues
      });
      this.addEventToWorkQueue(this.flows.out);
    };
    const triggerCallbacks = this.graphEngine.rigidBodyTriggerNodeIndices.get(this._nodeIndex);
    if (triggerCallbacks) {
      triggerCallbacks.triggerEntered = callback;
    } else {
      this.graphEngine.rigidBodyTriggerNodeIndices.set(this._nodeIndex, {
        triggerEntered: callback
      });
    }
  }
}

class TriggerExited extends BehaveEngineNode {
  REQUIRED_CONFIGURATIONS = {
    nodeIndex: {
      defaultValue: [-1]
    }
  };
  _nodeIndex;
  constructor(props) {
    super(props);
    this.name = 'TriggerExited';
    this.validateValues(this.values);
    this.validateConfigurations(this.configuration);
    const {
      nodeIndex
    } = this.evaluateAllConfigurations(Object.keys(this.REQUIRED_CONFIGURATIONS));
    this._nodeIndex = Number(nodeIndex[0]);
    this.outValues.colliderNode = {
      type: this.getTypeIndex('ref'),
      value: [-1]
    };
    this.outValues.motionNode = {
      type: this.getTypeIndex('ref'),
      value: [-1]
    };
    this.setUpOnTriggerExited();
  }
  setUpOnTriggerExited() {
    const callback = (colliderNodeRef, motionNodeRef) => {
      this.outValues.colliderNode = {
        type: this.getTypeIndex('ref'),
        value: [colliderNodeRef]
      };
      this.outValues.motionNode = {
        type: this.getTypeIndex('ref'),
        value: [motionNodeRef ?? -1]
      };
      console.log("TriggerExited", {
        node: this._nodeIndex,
        outValues: this.outValues
      });
      this.addEventToWorkQueue(this.flows.out);
    };
    const triggerCallbacks = this.graphEngine.rigidBodyTriggerNodeIndices.get(this._nodeIndex);
    if (triggerCallbacks) {
      triggerCallbacks.triggerExited = callback;
    } else {
      this.graphEngine.rigidBodyTriggerNodeIndices.set(this._nodeIndex, {
        triggerExited: callback
      });
    }
  }
}

class ADecorator {
  behaveEngine;
  constructor(behaveEngine) {
    this.behaveEngine = behaveEngine;
  }
  registerJsonPointer = (jsonPtr, getterCallback, setterCallback, typeName, readOnly) => {
    this.behaveEngine.registerJsonPointer(jsonPtr, getterCallback, setterCallback, typeName, readOnly);
  };

  /**
   * BasicBehaveEngine calls some of its own hooks internally (e.g. `this.getWorld()`,
   * `this.getParentNodeIndex()`) so the decorator's implementation has to be reachable via the
   * wrapped engine's own properties, not just via the decorator instance. Subclasses must call
   * this once, after their own hook fields (getWorld/getParentNodeIndex/startAnimation/
   * stopAnimation/stopAnimationAt) are assigned, to bridge them onto the engine.
   */
  bridgeEngineHooks() {
    this.behaveEngine.getWorld = this.getWorld;
    this.behaveEngine.getParentNodeIndex = this.getParentNodeIndex;
    this.behaveEngine.startAnimation = this.startAnimation;
    this.behaveEngine.stopAnimation = this.stopAnimation;
    this.behaveEngine.stopAnimationAt = this.stopAnimationAt;
  }

  /** Tears down listeners/observers registered by this decorator. Call before discarding it. */
  dispose() {
    // stop the wrapped engine (kills its tick loop + scheduled delays), which also clears its
    // event queue and custom-event listeners - otherwise the old graph keeps running after a
    // new model/graph replaces this decorator
    this.behaveEngine.dispose();
  }
  registerRigidBodyNodes() {
    this.behaveEngine.registerBehaveEngineNode("rigid_body/applyImpulse", ApplyImpulse);
    this.behaveEngine.registerBehaveEngineNode("rigid_body/applyPointImpulse", ApplyPointImpulse);
    this.behaveEngine.registerBehaveEngineNode("rigid_body/rayCast", RayCast);
    this.behaveEngine.registerBehaveEngineNode("event/rigid_body_triggerEntered", TriggerEntered);
    this.behaveEngine.registerBehaveEngineNode("event/rigid_body_triggerExited", TriggerExited);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  applyImpulseToRigidBody(nodeIndex, linearImpulse, angularImpulse) {
    // Overwrite with application logic here
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  applyPointImpulseToRigidBody(nodeIndex, impulse, position) {
    // Overwrite with application logic here
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  rayCastRigidBodies(rayStart, rayEnd, collisionFilterIndex) {
    // Overwrite with application logic here
    return {
      hitNodeIndex: -1,
      hitFraction: undefined,
      hitNormal: undefined
    };
  }
  rigidBodyTriggerEntered(nodeIndex, colliderNodeIndex, motionNodeIndex) {
    this.behaveEngine.rigidBodyTriggerEntered(nodeIndex, colliderNodeIndex, motionNodeIndex);
  }
  rigidBodyTriggerExited(nodeIndex, colliderNodeIndex, motionNodeIndex) {
    this.behaveEngine.rigidBodyTriggerExited(nodeIndex, colliderNodeIndex, motionNodeIndex);
  }
  hoverOn(nodeIndex, controllerIndex) {
    this.behaveEngine.hoverOn(nodeIndex, controllerIndex);
  }
  select(selectedNodeIndex, controllerIndex, selectionPoint, selectionRayOrigin) {
    this.behaveEngine.select(selectedNodeIndex, controllerIndex, selectionPoint, selectionRayOrigin);
  }
  getEventList() {
    return this.behaveEngine.getEventList();
  }
  clearEventList() {
    this.behaveEngine.clearEventList();
  }
  addEvent(event) {
    this.behaveEngine.addEvent(event);
  }
  addCustomEventListener(name, func) {
    this.behaveEngine.addCustomEventListener(name, func);
  }
  clearCustomEventListeners() {
    this.behaveEngine.clearCustomEventListeners();
  }
  registerBehaveEngineNode(type, behaveEngineNode) {
    this.behaveEngine.registerBehaveEngineNode(type, behaveEngineNode);
  }
  getRegisteredJsonPointers() {
    return this.behaveEngine.getRegisteredJsonPointers();
  }
  resolveJsonPtr(path) {
    return this.behaveEngine.resolveJsonPtr(path);
  }
  isValidJsonPtr(path) {
    return this.behaveEngine.isValidJsonPtr(path);
  }
  isReadOnly(path) {
    return this.behaveEngine.isReadOnly(path);
  }
  isSlerpPath(path) {
    return this.behaveEngine.isSlerpPath(path);
  }
  animateCubicBezier(path, p1, p2, initialValue, targetValue, duration, valueType, callback) {
    this.behaveEngine.animateCubicBezier(path, p1, p2, initialValue, targetValue, duration, valueType, callback);
  }
  get fps() {
    return this.behaveEngine.fps;
  }
  loadBehaveGraph(behaveGraph, runGraph = true) {
    this.behaveEngine.loadBehaveGraph(behaveGraph, runGraph);
  }
  pauseEventQueue() {
    this.behaveEngine.pauseEventQueue();
  }
  playEventQueue() {
    this.behaveEngine.playEventQueue();
  }
  executeEventQueueTick() {
    this.behaveEngine.executeEventQueueTick();
  }
  setExecutionErrorListener(listener) {
    this.behaveEngine.setExecutionErrorListener?.(listener);
  }
  dispatchCustomEvent(name, vals) {
    this.behaveEngine.dispatchCustomEvent(name, vals);
  }
  setPathValue(path, targetValue) {
    this.behaveEngine.setPathValue(path, targetValue);
  }
  getPathValue(path) {
    return this.behaveEngine.getPathValue(path);
  }
  getPathTypeName(path) {
    return this.behaveEngine.getPathTypeName(path);
  }
  clearValueEvaluationCache() {
    this.behaveEngine.clearValueEvaluationCache();
  }
  setPointerInterpolationCallback(path, action) {
    this.behaveEngine.setPointerInterpolationCallback(path, action);
  }
  clearPointerInterpolation(path) {
    this.behaveEngine.clearPointerInterpolation(path);
  }
  setVariableInterpolationCallback(variable, action) {
    this.behaveEngine.setVariableInterpolationCallback(variable, action);
  }
  clearVariableInterpolation(variable) {
    this.behaveEngine.clearVariableInterpolation(variable);
  }
}

// Generated by scripts/generate-runtime-schema.mjs from Khronos schemas and the operation catalogue.
// Runtime validation rules only; documentation annotations are omitted.
const INTERACTIVITY_SCHEMAS = {
  "declaration.KHR_interactivity.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "declaration.KHR_interactivity.schema.json",
    "type": "object",
    "allOf": [{
      "$ref": "glTFProperty.schema.json"
    }],
    "$defs": {
      "declarationValueSocket": {
        "type": "object",
        "allOf": [{
          "$ref": "glTFProperty.schema.json"
        }],
        "properties": {
          "type": {
            "allOf": [{
              "$ref": "glTFid.schema.json"
            }]
          },
          "extensions": {},
          "extras": {}
        },
        "required": ["type"]
      }
    },
    "properties": {
      "op": {
        "type": "string"
      },
      "inputValueSockets": {
        "type": "object",
        "additionalProperties": {
          "$ref": "#/$defs/declarationValueSocket"
        },
        "minProperties": 1
      },
      "outputValueSockets": {
        "type": "object",
        "additionalProperties": {
          "$ref": "#/$defs/declarationValueSocket"
        },
        "minProperties": 1
      },
      "extension": {
        "type": "string"
      },
      "extensions": {},
      "extras": {}
    },
    "required": ["op"],
    "dependentRequired": {
      "inputValueSockets": ["extension"],
      "outputValueSockets": ["extension"]
    }
  },
  "event.KHR_interactivity.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "event.KHR_interactivity.schema.json",
    "type": "object",
    "allOf": [{
      "$ref": "nameableProperty.KHR_interactivity.schema.json"
    }],
    "properties": {
      "id": {
        "type": "string"
      },
      "values": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "allOf": [{
            "$ref": "glTFProperty.schema.json"
          }],
          "properties": {
            "type": {
              "allOf": [{
                "$ref": "glTFid.schema.json"
              }]
            },
            "value": {
              "type": "array",
              "minItems": 1
            },
            "extensions": {},
            "extras": {}
          },
          "required": ["type"]
        },
        "minProperties": 1,
        "not": {
          "required": ["event"]
        }
      },
      "name": {},
      "extensions": {},
      "extras": {}
    }
  },
  "glTF.KHR_interactivity.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "glTF.KHR_interactivity.schema.json",
    "type": "object",
    "allOf": [{
      "$ref": "glTFProperty.schema.json"
    }],
    "properties": {
      "graphs": {
        "type": "array",
        "items": {
          "$ref": "graph.KHR_interactivity.schema.json"
        },
        "minItems": 1,
        "maxItems": 2147483648
      },
      "graph": {
        "allOf": [{
          "$ref": "glTFid.schema.json"
        }]
      },
      "extensions": {},
      "extras": {}
    },
    "required": ["graphs"]
  },
  "graph.KHR_interactivity.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "graph.KHR_interactivity.schema.json",
    "type": "object",
    "allOf": [{
      "$ref": "glTFChildOfRootProperty.schema.json"
    }],
    "properties": {
      "types": {
        "type": "array",
        "items": {
          "$ref": "type.KHR_interactivity.schema.json"
        },
        "minItems": 1,
        "maxItems": 2147483648
      },
      "variables": {
        "type": "array",
        "items": {
          "$ref": "variable.KHR_interactivity.schema.json"
        },
        "minItems": 1,
        "maxItems": 2147483648
      },
      "events": {
        "type": "array",
        "items": {
          "$ref": "event.KHR_interactivity.schema.json"
        },
        "minItems": 1,
        "maxItems": 2147483648
      },
      "declarations": {
        "type": "array",
        "items": {
          "$ref": "declaration.KHR_interactivity.schema.json"
        },
        "minItems": 1,
        "maxItems": 2147483648
      },
      "nodes": {
        "type": "array",
        "items": {
          "$ref": "node.KHR_interactivity.schema.json"
        },
        "minItems": 1,
        "maxItems": 2147483648
      },
      "name": {},
      "extensions": {},
      "extras": {}
    },
    "dependentRequired": {
      "variables": ["types"],
      "nodes": ["declarations"]
    }
  },
  "nameableProperty.KHR_interactivity.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "nameableProperty.KHR_interactivity.schema.json",
    "type": "object",
    "allOf": [{
      "$ref": "glTFProperty.schema.json"
    }],
    "properties": {
      "name": {
        "type": "string"
      }
    }
  },
  "node.KHR_interactivity.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "node.KHR_interactivity.schema.json",
    "type": "object",
    "allOf": [{
      "$ref": "glTFProperty.schema.json"
    }],
    "properties": {
      "declaration": {
        "allOf": [{
          "$ref": "glTFid.schema.json"
        }]
      },
      "configuration": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "allOf": [{
            "$ref": "glTFProperty.schema.json"
          }],
          "properties": {
            "value": {
              "type": "array",
              "minItems": 1
            },
            "extensions": {},
            "extras": {}
          }
        },
        "minProperties": 1
      },
      "values": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "allOf": [{
            "$ref": "glTFProperty.schema.json"
          }],
          "properties": {
            "node": {
              "allOf": [{
                "$ref": "glTFid.schema.json"
              }]
            },
            "socket": {
              "type": "string"
            },
            "type": {
              "allOf": [{
                "$ref": "glTFid.schema.json"
              }]
            },
            "value": {
              "type": "array",
              "minItems": 1
            },
            "extensions": {},
            "extras": {}
          },
          "dependentRequired": {
            "socket": ["node"],
            "value": ["type"]
          },
          "not": {
            "required": ["node", "value"]
          },
          "anyOf": [{
            "required": ["type"]
          }, {
            "required": ["node"]
          }]
        },
        "minProperties": 1
      },
      "flows": {
        "type": "object",
        "additionalProperties": {
          "type": "object",
          "allOf": [{
            "$ref": "glTFProperty.schema.json"
          }],
          "properties": {
            "node": {
              "allOf": [{
                "$ref": "glTFid.schema.json"
              }]
            },
            "socket": {
              "type": "string"
            },
            "extensions": {},
            "extras": {}
          },
          "required": ["node"]
        },
        "minProperties": 1
      },
      "extensions": {},
      "extras": {}
    },
    "required": ["declaration"]
  },
  "type.KHR_interactivity.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "type.KHR_interactivity.schema.json",
    "type": "object",
    "allOf": [{
      "$ref": "glTFProperty.schema.json"
    }],
    "properties": {
      "signature": {
        "type": "string",
        "oneOf": [{
          "const": "bool"
        }, {
          "const": "float"
        }, {
          "const": "float2"
        }, {
          "const": "float3"
        }, {
          "const": "float4"
        }, {
          "const": "float2x2"
        }, {
          "const": "float3x3"
        }, {
          "const": "float4x4"
        }, {
          "const": "int"
        }, {
          "const": "ref"
        }, {
          "const": "custom"
        }]
      },
      "extensions": {},
      "extras": {}
    },
    "required": ["signature"]
  },
  "variable.KHR_interactivity.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "variable.KHR_interactivity.schema.json",
    "type": "object",
    "allOf": [{
      "$ref": "nameableProperty.KHR_interactivity.schema.json"
    }],
    "properties": {
      "type": {
        "allOf": [{
          "$ref": "glTFid.schema.json"
        }]
      },
      "value": {
        "type": "array",
        "minItems": 1
      },
      "name": {},
      "extensions": {},
      "extras": {}
    },
    "required": ["type"]
  },
  "glTFProperty.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "glTFProperty.schema.json",
    "type": "object",
    "properties": {
      "extensions": {
        "$ref": "extensions.schema.json"
      },
      "extras": {
        "$ref": "extras.schema.json"
      }
    }
  },
  "glTFChildOfRootProperty.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "glTFChildOfRootProperty.schema.json",
    "type": "object",
    "$ref": "glTFProperty.schema.json",
    "properties": {
      "name": {
        "type": "string"
      }
    }
  },
  "glTFid.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "glTFid.schema.json",
    "type": "integer",
    "minimum": 0
  },
  "extensions.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "extensions.schema.json",
    "type": "object",
    "additionalProperties": {
      "type": "object"
    }
  },
  "extras.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "extras.schema.json"
  }
};
const OPERATION_SCHEMAS = {
  "math/E": {
    "inputs": {},
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "math/Pi": {
    "inputs": {},
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "math/Inf": {
    "inputs": {},
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "math/NaN": {
    "inputs": {},
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "math/Tau": {
    "inputs": {},
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "math/abs": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/sign": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/trunc": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/floor": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/ceil": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/round": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/fract": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/neg": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/add": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/sub": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/mul": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/div": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/rem": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/min": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/max": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/clamp": {
    "inputs": {
      "a": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "c": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/saturate": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/mix": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "c": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/smoothStep": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      },
      "b": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      },
      "c": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/eq": {
    "inputs": {
      "a": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  },
  "math/lt": {
    "inputs": {
      "a": {
        "types": ["int", "float"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  },
  "math/le": {
    "inputs": {
      "a": {
        "types": ["int", "float"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  },
  "math/gt": {
    "inputs": {
      "a": {
        "types": ["int", "float"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  },
  "math/ge": {
    "inputs": {
      "a": {
        "types": ["int", "float"],
        "group": "T"
      },
      "b": {
        "types": ["int", "float"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  },
  "math/rad": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/deg": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/sin": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/cos": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/tan": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/asin": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/acos": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/atan": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/atan2": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      },
      "b": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/isNaN": {
    "inputs": {
      "a": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  },
  "math/isInf": {
    "inputs": {
      "a": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  },
  "math/select": {
    "inputs": {
      "condition": {
        "types": ["bool"]
      },
      "a": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"],
        "group": "T"
      },
      "b": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"],
        "group": "T"
      }
    }
  },
  "math/switch": {
    "inputs": {
      "default": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"],
        "group": "T"
      },
      "selection": {
        "types": ["int"]
      }
    },
    "outputs": {
      "value": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"],
        "group": "T"
      }
    }
  },
  "math/random": {
    "inputs": {},
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "event/onStart": {
    "inputs": {},
    "outputs": {
      "event": {
        "types": ["ref"]
      }
    }
  },
  "event/onTick": {
    "inputs": {},
    "outputs": {
      "event": {
        "types": ["ref"]
      },
      "timeSinceStart": {
        "types": ["float"]
      },
      "timeSinceLastTick": {
        "types": ["float"]
      }
    }
  },
  "event/receive": {
    "inputs": {},
    "outputs": {
      "event": {
        "types": ["ref"]
      }
    }
  },
  "event/send": {
    "inputs": {},
    "outputs": {}
  },
  "event/stopPropagation": {
    "inputs": {
      "stopImmediate": {
        "types": ["bool"]
      },
      "event": {
        "types": ["ref"]
      }
    },
    "outputs": {}
  },
  "flow/switch": {
    "inputs": {
      "selection": {
        "types": ["int"]
      }
    },
    "outputs": {}
  },
  "flow/while": {
    "inputs": {
      "condition": {
        "types": ["bool"]
      }
    },
    "outputs": {}
  },
  "flow/doN": {
    "inputs": {
      "n": {
        "types": ["int"]
      }
    },
    "outputs": {
      "currentCount": {
        "types": ["int"]
      }
    }
  },
  "flow/multiGate": {
    "inputs": {},
    "outputs": {
      "lastIndex": {
        "types": ["int"]
      }
    }
  },
  "flow/waitAll": {
    "inputs": {},
    "outputs": {
      "remainingInputs": {
        "types": ["int"]
      }
    }
  },
  "flow/throttle": {
    "inputs": {
      "duration": {
        "types": ["float"]
      }
    },
    "outputs": {
      "lastRemainingTime": {
        "types": ["float"]
      }
    }
  },
  "flow/setDelay": {
    "inputs": {
      "duration": {
        "types": ["float"]
      }
    },
    "outputs": {
      "lastDelay": {
        "types": ["ref"]
      }
    }
  },
  "flow/cancelDelay": {
    "inputs": {
      "delay": {
        "types": ["ref"]
      }
    },
    "outputs": {}
  },
  "flow/branch": {
    "inputs": {
      "condition": {
        "types": ["bool"]
      }
    },
    "outputs": {}
  },
  "flow/for": {
    "inputs": {
      "startIndex": {
        "types": ["int"]
      },
      "endIndex": {
        "types": ["int"]
      }
    },
    "outputs": {
      "index": {
        "types": ["int"]
      }
    }
  },
  "flow/sequence": {
    "inputs": {},
    "outputs": {}
  },
  "variable/set": {
    "inputs": {},
    "outputs": {}
  },
  "variable/get": {
    "inputs": {},
    "outputs": {
      "value": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"]
      }
    }
  },
  "variable/interpolate": {
    "inputs": {
      "value": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"]
      },
      "duration": {
        "types": ["float"]
      },
      "p1": {
        "types": ["float2"]
      },
      "p2": {
        "types": ["float2"]
      }
    },
    "outputs": {}
  },
  "math/sinh": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/cosh": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/tanh": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/asinh": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/acosh": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/atanh": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/exp": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/log": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/log2": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/log10": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/sqrt": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/cbrt": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/pow": {
    "inputs": {
      "a": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      },
      "b": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float", "float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/length": {
    "inputs": {
      "a": {
        "types": ["float2", "float3", "float4"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "math/normalize": {
    "inputs": {
      "a": {
        "types": ["float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float2", "float3", "float4"],
        "group": "T"
      },
      "isValid": {
        "types": ["bool"]
      }
    }
  },
  "math/dot": {
    "inputs": {
      "a": {
        "types": ["float2", "float3", "float4"],
        "group": "T"
      },
      "b": {
        "types": ["float2", "float3", "float4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "math/cross": {
    "inputs": {
      "a": {
        "types": ["float3"]
      },
      "b": {
        "types": ["float3"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float3"]
      }
    }
  },
  "math/slerp": {
    "inputs": {
      "a": {
        "types": ["float2", "float3"],
        "group": "T"
      },
      "b": {
        "types": ["float2", "float3"],
        "group": "T"
      },
      "c": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float2", "float3"],
        "group": "T"
      }
    }
  },
  "math/rotate2D": {
    "inputs": {
      "a": {
        "types": ["float2"]
      },
      "angle": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float2"]
      }
    }
  },
  "math/rotate3D": {
    "inputs": {
      "a": {
        "types": ["float3"]
      },
      "rotation": {
        "types": ["float4"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float3"]
      }
    }
  },
  "math/transform": {
    "inputs": {
      "a": {
        "types": ["float2", "float3", "float4"],
        "group": "T"
      },
      "b": {
        "types": ["float2x2", "float3x3", "float4x4"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float2", "float3", "float4"],
        "group": "T"
      }
    }
  },
  "math/transpose": {
    "inputs": {
      "a": {
        "types": ["float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/determinant": {
    "inputs": {
      "a": {
        "types": ["float2x2", "float3x3", "float4x4"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "math/inverse": {
    "inputs": {
      "a": {
        "types": ["float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "isValid": {
        "types": ["bool"]
      }
    }
  },
  "math/matMul": {
    "inputs": {
      "a": {
        "types": ["float2x2", "float3x3", "float4x4"],
        "group": "T"
      },
      "b": {
        "types": ["float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["float2x2", "float3x3", "float4x4"],
        "group": "T"
      }
    }
  },
  "math/matCompose": {
    "inputs": {
      "translation": {
        "types": ["float3"]
      },
      "rotation": {
        "types": ["float4"]
      },
      "scale": {
        "types": ["float3"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4x4"]
      }
    }
  },
  "math/matDecompose": {
    "inputs": {
      "a": {
        "types": ["float4x4"]
      }
    },
    "outputs": {
      "translation": {
        "types": ["float3"]
      },
      "rotation": {
        "types": ["float4"]
      },
      "scale": {
        "types": ["float3"]
      }
    }
  },
  "math/combine2": {
    "inputs": {
      "a": {
        "types": ["float"]
      },
      "b": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float2"]
      }
    }
  },
  "math/combine3": {
    "inputs": {
      "a": {
        "types": ["float"]
      },
      "b": {
        "types": ["float"]
      },
      "c": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float3"]
      }
    }
  },
  "math/combine4": {
    "inputs": {
      "a": {
        "types": ["float"]
      },
      "b": {
        "types": ["float"]
      },
      "c": {
        "types": ["float"]
      },
      "d": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4"]
      }
    }
  },
  "math/combine2x2": {
    "inputs": {
      "a": {
        "types": ["float"]
      },
      "b": {
        "types": ["float"]
      },
      "c": {
        "types": ["float"]
      },
      "d": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float2x2"]
      }
    }
  },
  "math/combine3x3": {
    "inputs": {
      "a": {
        "types": ["float"]
      },
      "b": {
        "types": ["float"]
      },
      "c": {
        "types": ["float"]
      },
      "d": {
        "types": ["float"]
      },
      "e": {
        "types": ["float"]
      },
      "f": {
        "types": ["float"]
      },
      "g": {
        "types": ["float"]
      },
      "h": {
        "types": ["float"]
      },
      "i": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float3x3"]
      }
    }
  },
  "math/combine4x4": {
    "inputs": {
      "a": {
        "types": ["float"]
      },
      "b": {
        "types": ["float"]
      },
      "c": {
        "types": ["float"]
      },
      "d": {
        "types": ["float"]
      },
      "e": {
        "types": ["float"]
      },
      "f": {
        "types": ["float"]
      },
      "g": {
        "types": ["float"]
      },
      "h": {
        "types": ["float"]
      },
      "i": {
        "types": ["float"]
      },
      "j": {
        "types": ["float"]
      },
      "k": {
        "types": ["float"]
      },
      "l": {
        "types": ["float"]
      },
      "m": {
        "types": ["float"]
      },
      "n": {
        "types": ["float"]
      },
      "o": {
        "types": ["float"]
      },
      "p": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4x4"]
      }
    }
  },
  "math/extract2": {
    "inputs": {
      "a": {
        "types": ["float2"]
      }
    },
    "outputs": {
      "0": {
        "types": ["float"]
      },
      "1": {
        "types": ["float"]
      }
    }
  },
  "math/extract3": {
    "inputs": {
      "a": {
        "types": ["float3"]
      }
    },
    "outputs": {
      "0": {
        "types": ["float"]
      },
      "1": {
        "types": ["float"]
      },
      "2": {
        "types": ["float"]
      }
    }
  },
  "math/extract4": {
    "inputs": {
      "a": {
        "types": ["float4"]
      }
    },
    "outputs": {
      "0": {
        "types": ["float"]
      },
      "1": {
        "types": ["float"]
      },
      "2": {
        "types": ["float"]
      },
      "3": {
        "types": ["float"]
      }
    }
  },
  "math/extract2x2": {
    "inputs": {
      "a": {
        "types": ["float2x2"]
      }
    },
    "outputs": {
      "0": {
        "types": ["float"]
      },
      "1": {
        "types": ["float"]
      },
      "2": {
        "types": ["float"]
      },
      "3": {
        "types": ["float"]
      }
    }
  },
  "math/extract3x3": {
    "inputs": {
      "a": {
        "types": ["float3x3"]
      }
    },
    "outputs": {
      "0": {
        "types": ["float"]
      },
      "1": {
        "types": ["float"]
      },
      "2": {
        "types": ["float"]
      },
      "3": {
        "types": ["float"]
      },
      "4": {
        "types": ["float"]
      },
      "5": {
        "types": ["float"]
      },
      "6": {
        "types": ["float"]
      },
      "7": {
        "types": ["float"]
      },
      "8": {
        "types": ["float"]
      }
    }
  },
  "math/extract4x4": {
    "inputs": {
      "a": {
        "types": ["float4x4"]
      }
    },
    "outputs": {
      "0": {
        "types": ["float"]
      },
      "1": {
        "types": ["float"]
      },
      "2": {
        "types": ["float"]
      },
      "3": {
        "types": ["float"]
      },
      "4": {
        "types": ["float"]
      },
      "5": {
        "types": ["float"]
      },
      "6": {
        "types": ["float"]
      },
      "7": {
        "types": ["float"]
      },
      "8": {
        "types": ["float"]
      },
      "9": {
        "types": ["float"]
      },
      "10": {
        "types": ["float"]
      },
      "11": {
        "types": ["float"]
      },
      "12": {
        "types": ["float"]
      },
      "13": {
        "types": ["float"]
      },
      "14": {
        "types": ["float"]
      },
      "15": {
        "types": ["float"]
      }
    }
  },
  "math/not": {
    "inputs": {
      "a": {
        "types": ["bool", "int"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool", "int"],
        "group": "T"
      }
    }
  },
  "math/and": {
    "inputs": {
      "a": {
        "types": ["bool", "int"],
        "group": "T"
      },
      "b": {
        "types": ["bool", "int"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool", "int"],
        "group": "T"
      }
    }
  },
  "math/or": {
    "inputs": {
      "a": {
        "types": ["bool", "int"],
        "group": "T"
      },
      "b": {
        "types": ["bool", "int"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool", "int"],
        "group": "T"
      }
    }
  },
  "math/xor": {
    "inputs": {
      "a": {
        "types": ["bool", "int"],
        "group": "T"
      },
      "b": {
        "types": ["bool", "int"],
        "group": "T"
      }
    },
    "outputs": {
      "value": {
        "types": ["bool", "int"],
        "group": "T"
      }
    }
  },
  "math/asr": {
    "inputs": {
      "a": {
        "types": ["int"]
      },
      "b": {
        "types": ["int"]
      }
    },
    "outputs": {
      "value": {
        "types": ["int"]
      }
    }
  },
  "math/lsl": {
    "inputs": {
      "a": {
        "types": ["int"]
      },
      "b": {
        "types": ["int"]
      }
    },
    "outputs": {
      "value": {
        "types": ["int"]
      }
    }
  },
  "math/clz": {
    "inputs": {
      "a": {
        "types": ["int"]
      }
    },
    "outputs": {
      "value": {
        "types": ["int"]
      }
    }
  },
  "math/ctz": {
    "inputs": {
      "a": {
        "types": ["int"]
      }
    },
    "outputs": {
      "value": {
        "types": ["int"]
      }
    }
  },
  "math/popcnt": {
    "inputs": {
      "a": {
        "types": ["int"]
      }
    },
    "outputs": {
      "value": {
        "types": ["int"]
      }
    }
  },
  "type/boolToInt": {
    "inputs": {
      "a": {
        "types": ["bool"]
      }
    },
    "outputs": {
      "value": {
        "types": ["int"]
      }
    }
  },
  "type/boolToFloat": {
    "inputs": {
      "a": {
        "types": ["bool"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "type/intToBool": {
    "inputs": {
      "a": {
        "types": ["int"]
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  },
  "type/intToFloat": {
    "inputs": {
      "a": {
        "types": ["int"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "type/floatToBool": {
    "inputs": {
      "a": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  },
  "type/floatToInt": {
    "inputs": {
      "a": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["int"]
      }
    }
  },
  "pointer/set": {
    "inputs": {
      "value": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"]
      }
    },
    "outputs": {}
  },
  "pointer/get": {
    "inputs": {},
    "outputs": {
      "value": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"]
      },
      "isValid": {
        "types": ["bool"]
      }
    }
  },
  "pointer/interpolate": {
    "inputs": {
      "value": {
        "types": ["bool", "int", "float", "float2", "float3", "float4", "float2x2", "float3x3", "float4x4", "ref"]
      },
      "duration": {
        "types": ["float"]
      },
      "p1": {
        "types": ["float2"]
      },
      "p2": {
        "types": ["float2"]
      }
    },
    "outputs": {}
  },
  "animation/start": {
    "inputs": {
      "animation": {
        "types": ["ref"]
      },
      "startTime": {
        "types": ["float"]
      },
      "endTime": {
        "types": ["float"]
      },
      "speed": {
        "types": ["float"]
      }
    },
    "outputs": {}
  },
  "animation/stop": {
    "inputs": {
      "animation": {
        "types": ["ref"]
      }
    },
    "outputs": {}
  },
  "animation/stopAt": {
    "inputs": {
      "animation": {
        "types": ["ref"]
      },
      "stopTime": {
        "types": ["float"]
      }
    },
    "outputs": {}
  },
  "event/onSelect": {
    "extension": "KHR_node_selectability",
    "inputs": {},
    "outputs": {
      "selectedNode": {
        "types": ["ref"]
      },
      "controllerIndex": {
        "types": ["int"]
      },
      "selectionPoint": {
        "types": ["float3"]
      },
      "selectionRayOrigin": {
        "types": ["float3"]
      },
      "event": {
        "types": ["ref"]
      }
    }
  },
  "event/onHoverIn": {
    "extension": "KHR_node_hoverability",
    "inputs": {},
    "outputs": {
      "hoveredNode": {
        "types": ["ref"]
      },
      "controllerIndex": {
        "types": ["int"]
      },
      "event": {
        "types": ["ref"]
      }
    }
  },
  "event/onHoverOut": {
    "extension": "KHR_node_hoverability",
    "inputs": {},
    "outputs": {
      "hoveredNode": {
        "types": ["ref"]
      },
      "controllerIndex": {
        "types": ["int"]
      },
      "event": {
        "types": ["ref"]
      }
    }
  },
  "math/quatConjugate": {
    "inputs": {
      "a": {
        "types": ["float4"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4"]
      }
    }
  },
  "math/quatMul": {
    "inputs": {
      "a": {
        "types": ["float4"]
      },
      "b": {
        "types": ["float4"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4"]
      }
    }
  },
  "math/quatAngleBetween": {
    "inputs": {
      "a": {
        "types": ["float4"]
      },
      "b": {
        "types": ["float4"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float"]
      }
    }
  },
  "math/quatFromAxisAngle": {
    "inputs": {
      "axis": {
        "types": ["float3"]
      },
      "angle": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4"]
      }
    }
  },
  "math/quatFromAngles": {
    "inputs": {
      "x": {
        "types": ["float"]
      },
      "y": {
        "types": ["float"]
      },
      "z": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4"]
      }
    }
  },
  "math/quatToAxisAngle": {
    "inputs": {
      "a": {
        "types": ["float4"]
      }
    },
    "outputs": {
      "axis": {
        "types": ["float3"]
      },
      "angle": {
        "types": ["float"]
      }
    }
  },
  "math/quatFromDirections": {
    "inputs": {
      "a": {
        "types": ["float3"]
      },
      "b": {
        "types": ["float3"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4"]
      }
    }
  },
  "math/quatFromUpForward": {
    "inputs": {
      "up": {
        "types": ["float3"]
      },
      "forward": {
        "types": ["float3"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4"]
      }
    }
  },
  "math/quatSlerp": {
    "inputs": {
      "a": {
        "types": ["float4"]
      },
      "b": {
        "types": ["float4"]
      },
      "c": {
        "types": ["float"]
      }
    },
    "outputs": {
      "value": {
        "types": ["float4"]
      }
    }
  },
  "math/rgbToOkLCh": {
    "inputs": {
      "r": {
        "types": ["float"]
      },
      "g": {
        "types": ["float"]
      },
      "b": {
        "types": ["float"]
      }
    },
    "outputs": {
      "l": {
        "types": ["float"]
      },
      "c": {
        "types": ["float"]
      },
      "h": {
        "types": ["float"]
      }
    }
  },
  "math/rgbFromOkLCh": {
    "inputs": {
      "l": {
        "types": ["float"]
      },
      "c": {
        "types": ["float"]
      },
      "h": {
        "types": ["float"]
      }
    },
    "outputs": {
      "r": {
        "types": ["float"]
      },
      "g": {
        "types": ["float"]
      },
      "b": {
        "types": ["float"]
      }
    }
  },
  "debug/log": {
    "inputs": {},
    "outputs": {}
  },
  "rigid_body/applyImpulse": {
    "extension": "KHR_physics_rigid_bodies",
    "inputs": {
      "nodeIndex": {
        "types": ["int"]
      },
      "linearImpulse": {
        "types": ["float3"]
      },
      "angularImpulse": {
        "types": ["float3"]
      }
    },
    "outputs": {}
  },
  "rigid_body/applyPointImpulse": {
    "extension": "KHR_physics_rigid_bodies",
    "inputs": {
      "nodeIndex": {
        "types": ["int"]
      },
      "impulse": {
        "types": ["float3"]
      },
      "position": {
        "types": ["float3"]
      }
    },
    "outputs": {}
  },
  "rigid_body/rayCast": {
    "extension": "KHR_physics_rigid_bodies",
    "inputs": {
      "rayStart": {
        "types": ["float3"]
      },
      "rayEnd": {
        "types": ["float3"]
      },
      "collisionFilterIndex": {
        "types": ["int"]
      }
    },
    "outputs": {
      "hitNodeIndex": {
        "types": ["int"]
      },
      "hitFraction": {
        "types": ["float"]
      },
      "hitNormal": {
        "types": ["float3"]
      }
    }
  },
  "event/rigid_body_triggerEntered": {
    "extension": "KHR_physics_rigid_bodies",
    "inputs": {},
    "outputs": {
      "colliderNodeIndex": {
        "types": ["int"]
      },
      "motionNodeIndex": {
        "types": ["int"]
      }
    }
  },
  "event/rigid_body_triggerExited": {
    "extension": "KHR_physics_rigid_bodies",
    "inputs": {},
    "outputs": {
      "colliderNodeIndex": {
        "types": ["int"]
      },
      "motionNodeIndex": {
        "types": ["int"]
      }
    }
  },
  "ref/eq": {
    "inputs": {
      "a": {
        "types": ["ref"]
      },
      "b": {
        "types": ["ref"]
      }
    },
    "outputs": {
      "value": {
        "types": ["bool"]
      }
    }
  }
};

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function fail(message) {
  throw new Error(`Invalid KHR_interactivity: ${message}`);
}
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);

// The checked-in Khronos schemas use this subset of JSON Schema 2020-12. Keep the
// validation rules intact so structural validation follows the specification, not fixtures.
function matches(value, schema, root = schema) {
  if (schema === true) return true;
  if (schema === false) return false;
  if (schema.$ref) {
    const [file, fragment] = schema.$ref.split("#");
    const referencedRoot = file ? INTERACTIVITY_SCHEMAS[file] : root;
    if (!referencedRoot) fail(`unresolved schema ${schema.$ref}`);
    const referenced = fragment ? fragment.slice(1).split("/").reduce((node, key) => node[key], referencedRoot) : referencedRoot;
    if (!matches(value, referenced, referencedRoot)) return false;
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => type === "object" ? object(value) : type === "array" ? Array.isArray(value) : type === "integer" ? Number.isInteger(value) : type === "null" ? value === null : typeof value === type)) return false;
  }
  if (own(schema, "const") && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.allOf && !schema.allOf.every(part => matches(value, part, root))) return false;
  if (schema.anyOf && !schema.anyOf.some(part => matches(value, part, root))) return false;
  if (schema.oneOf && schema.oneOf.filter(part => matches(value, part, root)).length !== 1) return false;
  if (schema.not && matches(value, schema.not, root)) return false;
  if (typeof value === "number" && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) return false;
  if (typeof value === "string" && (value.length < (schema.minLength ?? 0) || schema.pattern && !new RegExp(schema.pattern).test(value))) return false;
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) return false;
    if (schema.items && !value.every(item => matches(item, schema.items, root))) return false;
    if (schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) return false;
  }
  if (object(value)) {
    if ((schema.required ?? []).some(key => !own(value, key))) return false;
    if (Object.keys(value).length < (schema.minProperties ?? 0)) return false;
    for (const [key, entry] of Object.entries(value)) {
      if (schema.properties && own(schema.properties, key)) {
        if (!matches(entry, schema.properties[key], root)) return false;
      } else if (schema.additionalProperties !== undefined && !matches(entry, schema.additionalProperties, root)) return false;
      if ((schema.dependentRequired?.[key] ?? []).some(dependency => !own(value, dependency))) return false;
    }
  }
  return true;
}
function validateInteractivityExtension(extension) {
  // Non-default graphs may be invalid without invalidating the default graph.
  if (!object(extension) || !Array.isArray(extension.graphs) || extension.graphs.length === 0) fail("graphs must be a nonempty array");
  const index = extension.graph === undefined ? 0 : extension.graph;
  if (!Number.isInteger(index) || index < 0 || index >= extension.graphs.length) fail("default graph index is out of range");
  validateInteractivityGraph(extension.graphs[index]);
}
function validateInteractivityGraph(graph) {
  if (!matches(graph, INTERACTIVITY_SCHEMAS["graph.KHR_interactivity.schema.json"])) fail("graph does not match the Khronos JSON schema");
  const types = graph.types ?? [];
  const variables = graph.variables ?? [];
  const events = graph.events ?? [];
  const declarations = graph.declarations ?? [];
  const nodes = graph.nodes ?? [];
  const index = (value, length, label) => {
    if (!Number.isInteger(value) || value < 0 || value >= length) fail(`${label} index is out of range`);
    return value;
  };
  const signature = value => types[index(value, types.length, "type")].signature;
  const literal = entry => {
    const type = signature(entry.type);
    if (entry.value === undefined || type === "custom") return type;
    const count = {
      bool: 1,
      int: 1,
      float: 1,
      float2: 2,
      float3: 3,
      float4: 4,
      float2x2: 4,
      float3x3: 9,
      float4x4: 16,
      ref: 1
    };
    if (entry.value.length !== count[type]) fail(`wrong component count for ${type}`);
    for (const value of entry.value) {
      if (type === "bool") {
        if (typeof value !== "boolean") fail("bool value must be boolean");
      } else if (type === "int") {
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) fail("int value must be int32");
      } else if (type === "ref") {
        if (value !== null && (typeof value !== "string" || value !== "" && !value.startsWith("/") || /~(?:[^01]|$)/.test(value))) fail("invalid JSON pointer reference");
      } else if (typeof value !== "number" && !["NaN", "Infinity", "-Infinity"].includes(value)) fail("float component must be numeric");
    }
    return type;
  };
  const unique = (values, label) => {
    if (new Set(values).size !== values.length) fail(`duplicate ${label}`);
  };
  unique(types.filter(type => type.signature !== "custom").map(type => type.signature), "type signatures");
  variables.forEach(literal);
  unique(events.filter(event => event.id !== undefined).map(event => event.id), "event ids");
  for (const event of events) for (const [id, value] of Object.entries(event.values ?? {})) {
    if (id === "event") fail("reserved event socket id");
    literal(value);
  }
  unique(declarations.map(declaration => JSON.stringify([declaration.op, declaration.extension ?? ""])), "declarations");
  for (const declaration of declarations) {
    if (!declaration.extension) {
      if (!OPERATION_SCHEMAS[declaration.op] || OPERATION_SCHEMAS[declaration.op].extension) fail(`unknown core operation ${declaration.op}`);
      if (declaration.inputValueSockets || declaration.outputValueSockets) fail("core declaration cannot redefine sockets");
    }
    for (const socket of Object.values(declaration.inputValueSockets ?? {})) literal(socket);
    for (const socket of Object.values(declaration.outputValueSockets ?? {})) literal(socket);
  }
  const outputs = [];
  nodes.forEach((node, nodeIndex) => {
    const declaration = declarations[index(node.declaration, declarations.length, "declaration")];
    const op = declaration.op;
    // Extension operations have exactly the value sockets their declaration defines.
    const spec = declaration.extension ? undefined : OPERATION_SCHEMAS[op];
    const inputs = {};
    for (const [id, source] of Object.entries(node.values ?? {})) {
      if (source.node !== undefined) {
        const ref = index(source.node, nodeIndex, "input node");
        const socket = source.socket ?? "value";
        const type = outputs[ref][socket];
        if (!type) fail(`node ${nodeIndex} input ${id} references output socket ${socket} not defined by node ${ref}`);
        if (source.type !== undefined && signature(source.type) !== type) fail("wired input type does not match output");
        inputs[id] = type;
      } else inputs[id] = literal(source);
    }
    for (const flow of Object.values(node.flows ?? {})) {
      index(flow.node, nodes.length, "flow node");
      if (flow.node <= nodeIndex) fail("output flow must point to a later node");
    }
    const config = key => node.configuration?.[key]?.value;
    const requireType = (key, allowed) => {
      const type = inputs[key];
      if (!type || allowed && !allowed.includes(type)) fail(`invalid or missing ${op} input ${key}`);
      return type;
    };
    const groups = {};
    for (const [key, socket] of Object.entries(spec?.inputs ?? {})) {
      const type = requireType(key, socket.types);
      if (socket.group) {
        if (groups[socket.group] && groups[socket.group] !== type) fail(`inconsistent ${op} type group ${socket.group}`);
        groups[socket.group] = type;
      }
    }
    if (!spec) for (const [key, socket] of Object.entries(declaration.inputValueSockets ?? {})) requireType(key, [signature(socket.type)]);
    const output = {};
    for (const [key, socket] of Object.entries(spec?.outputs ?? {})) output[key] = socket.group ? groups[socket.group] ?? socket.types[0] : socket.types[0];
    if (!spec) for (const [key, socket] of Object.entries(declaration.outputValueSockets ?? {})) output[key] = signature(socket.type);
    if (spec && op.startsWith("variable/")) {
      const ids = op === "variable/set" ? config("variables") : config("variable");
      if (!ids?.length) fail(`missing ${op} variable configuration`);
      for (const id of ids) index(id, variables.length, "variable");
      const type = signature(variables[ids[0]].type);
      if (op === "variable/get") output.value = type;
      if (op === "variable/set") for (const id of ids) requireType(String(id), [signature(variables[id].type)]);
      if (op === "variable/interpolate") {
        requireType("value", [type]);
        if (!type.startsWith("float")) fail("variable interpolation requires a float type");
        const slerp = config("useSlerp");
        if (!slerp || slerp.length !== 1 || typeof slerp[0] !== "boolean" || slerp[0] && type !== "float4") fail("invalid useSlerp");
      }
    }
    if (spec && (op === "event/send" || op === "event/receive")) {
      const id = config("event")?.[0];
      const event = events[index(id, events.length, "event")];
      for (const [key, socket] of Object.entries(event.values ?? {})) {
        if (op === "event/send") requireType(key, [signature(socket.type)]);else output[key] = signature(socket.type);
      }
    }
    if (spec && op.startsWith("pointer/")) {
      const pointer = config("pointer");
      if (!pointer || pointer.length !== 1 || typeof pointer[0] !== "string") fail("invalid pointer configuration");
      const parsed = parsePathTemplate(pointer[0]);
      if (!parsed.valid) fail("invalid pointer template");
      const type = signature(config("type")?.[0]);
      for (const socket of parsed.sockets) {
        if (op === "pointer/set" && socket.id === "value" || op === "pointer/interpolate" && ["value", "duration", "p1", "p2"].includes(socket.id)) fail("reserved pointer socket id");
        requireType(socket.id, [socket.kind === "index" ? "int" : "ref"]);
      }
      if (op === "pointer/get") output.value = type;else requireType("value", [type]);
      if (op === "pointer/interpolate" && !type.startsWith("float")) fail("pointer interpolation requires a float type");
    }
    if (spec && op === "math/switch") {
      const type = requireType("default");
      const cases = config("cases") ?? [];
      // Invalid int32 configurations use the empty default, as in MathSwitch.
      if (cases.every(value => value === (value | 0))) {
        for (const value of new Set(cases)) requireType(String(value), [type]);
      }
      output.value = type;
    }
    if (spec && op === "debug/log") {
      const message = config("message")?.[0];
      if (typeof message === "string") for (const parameter of parseMessageTemplate(message) ?? []) requireType(parameter.id);
    }
    outputs.push(output);
  });
}

export { ADecorator, AnimationStart, AnimationStop, AnimationStopAt, BasicBehaveEngine, BehaveEngineNode, DOMEventBus, GraphRejectedError, InteractivityConfigurationValueType, InteractivityValueType, OnHoverIn, OnHoverOut, OnSelect, cubicBezier, cubicBezierEase, easeFloat, easeFloat3, easeFloat4, getCustomEventChannel, linearFloat, slerpFloat4, validateInteractivityExtension, validateInteractivityGraph };
//# sourceMappingURL=index.js.map
