// dun.js

const fs = require('fs');
const { execSync } = require('child_process');
const seedrandom = require('seedrandom'); // Add this dependency

// ------------------------ Helper Functions ------------------------

/**
 * Executes the 'llm' command with the given prompt and returns the text output.
 * @param {string} prompt - The prompt to pass to the 'llm' command.
 * @returns {string} The text output from the 'llm' command.
 */
function execLLM(prompt) {
  try {
    const output = execSync(`llm "${prompt}"`, { encoding: 'utf-8' });
//    console.warn ({prompt, output});
    return output.trim();
  } catch (error) {
    console.error('Error executing llm:', error.message);
    return null;
  }
}

function asNarrator(prompt) {
  return execLLM("In the second person, as a narrator to a player, " + prompt);
}

function themedVersion(theme,template) {
  return asNarrator(`reword the following text with a ${theme} theme: ${template}`);
}

function themedContinuation(theme,previous,template) {
  previous = previous.replaceAll('\n', ' ');
  return asNarrator(`continue the following narrative with a ${theme}-themed rewording of '${template}': ${previous}`);
}

function getTheme() {
  return execLLM("A two-or-three word adjectival phrase, evocative of a dungeon (e.g. 'rusty iron' or 'dank mildewy').");
}


/**
 * Recursively checks whether all properties in `subset` are contained in `object`.
 */
function isSubset(subset, object) {
    if (typeof subset !== 'object' || subset === null) {
      return subset === object;
    }
    if (typeof object !== 'object' || object === null) return false;
    for (const key in subset) {
      if (!(key in object)) return false;
      if (!isSubset(subset[key], object[key])) return false;
    }
    return true;
  }
  
  /**
   * Converts a matcher expression (either a function or an object to be used for subset matching on an entity's label)
   * into a function.
   */
  function makeMatcher(matcherExpr) {
    if (!matcherExpr) return () => true; // no-op permissive matcher
    if (typeof matcherExpr === 'function') return matcherExpr;
    return (entity, graph) => isSubset(matcherExpr, entity.label);
  }
  
  /**
   * Converts an updater expression (either a function or an object to be deep-merged with an entity's label)
   * into a function.
   * If updateExpr is falsy, returns a function that does nothing.
   * Otherwise, returns the updater either directly (if it's a function)
   * or as a deep merge updater (if it's a JSON object).
   */
  function makeUpdater(updateExpr) {
    if (!updateExpr) return () => null; // no-op updater
    if (typeof updateExpr === 'function') return updateExpr;
    return (entityDict) => {
      function deepMerge(target, source) {
        for (const key in source) {
          if (source[key] && typeof source[key] === 'object') {
            if (!target[key] || typeof target[key] !== 'object') {
              target[key] = Array.isArray(source[key]) ? [] : {};
            }
            deepMerge(target[key], source[key]);
          } else {
            target[key] = source[key];
          }
        }
      }
      if (updateExpr) {
        entityDict.label = entityDict.label || {};
        deepMerge(entityDict.label, updateExpr);
      }
      return entityDict;
    };
  }
  
  /**
   * Generates unique IDs for nodes and edges.
   */
  class IDGenerator {
    constructor(prefix = 'gen') {
      this.prefix = prefix;
      this.counter = 0;
    }
    next() {
      return `${this.prefix}_${this.counter++}`;
    }
  }
  
  // ------------------------ Graph Grammar Simulator ------------------------
  
  class GraphGrammarSimulator {
    /**
     * @param {Object} graph - Graph object with keys "nodes" and "edges".
     * @param {Array} grammar - Array of subgrammars (each is an array of rules).
     */
    constructor(graph, grammar) {
      this.graph = graph;
      this.grammar = grammar;
      this.nodeIDGen = new IDGenerator('node');
      this.edgeIDGen = new IDGenerator('edge');
    }
  
    /**
     * Runs the simulation up to a given number of steps.
     */
    run(maxSteps = 1000) {
      let step = 0;
      while (step < maxSteps) {
        const candidateApplications = this.findNextApplication();
        if (!candidateApplications) {
//          console.log('No applicable rules found. Simulation halting.');
          break;
        }
        
        const candidate = this.weightedRandom(candidateApplications);
//        console.log(
//          `Step ${step + 1}: Applying rule of type ${candidate.rule.type} (weight ${candidate.rule.weight}).`
//        );
        this.applyCandidate(candidate);
        step++;
      }
//      console.log(`Simulation ended after ${step} steps.`);
    }
  
    /**
     * Iterates through subgrammars (by decreasing priority) to find all applicable rule applications.
     */
    findNextApplication() {
      let nodeCount = 0, edgeCount = 0, graphCount = 0; // Initialize counters
      for (const subgrammar of this.grammar) {
        const candidates = [];
        for (const rule of subgrammar) {
          switch (rule.type) {
            case 'node':
              this.findNodeApplications(rule, candidates);
              nodeCount += candidates.length; // Increment node count
              break;
            case 'edge':
              this.findEdgeApplications(rule, candidates);
              edgeCount += candidates.length; // Increment edge count
              break;
            case 'graph':
              this.findGraphApplications(rule, candidates);
              graphCount += candidates.length; // Increment graph count
              break;
            default:
              console.warn(`Unknown rule type ${rule.type}`);
          }
        }
        if (candidates.length > 0) {
//          console.log(`Node candidates: ${nodeCount}, Edge candidates: ${edgeCount}, Graph candidates: ${graphCount}`);
          return candidates;
        }
      }
      return null;
    }
  
    findNodeApplications(rule, candidates) {
      const matcher = makeMatcher(rule.lhs.node);
      for (const nodeID in this.graph.nodes) {
        const node = this.graph.nodes[nodeID];
        if (matcher(node, this.graph)) candidates.push({ rule, match: { node } });
      }
    }
  
    findEdgeApplications(rule, candidates) {
      const matcherSrc = makeMatcher(rule.lhs.src);
      const matcherDest = makeMatcher(rule.lhs.dest);
      const matcherEdge = makeMatcher(rule.lhs.edge);
      for (const edgeID in this.graph.edges) {
        const edge = this.graph.edges[edgeID];
        const srcNode = this.graph.nodes[edge.src];
        const destNode = this.graph.nodes[edge.dest];
        if (
          matcherSrc(srcNode, this.graph) &&
          matcherDest(destNode, this.graph) &&
          matcherEdge(edge, this.graph)
        ) {
          candidates.push({ rule, match: { src: srcNode, dest: destNode, edge } });
        }
      }
    }
  
    findGraphApplications(rule, candidates) {
      // Same as edge matching.
      const matcherSrc = makeMatcher(rule.lhs.src);
      const matcherDest = makeMatcher(rule.lhs.dest);
      const matcherEdge = makeMatcher(rule.lhs.edge);
      for (const edgeID in this.graph.edges) {
        const edge = this.graph.edges[edgeID];
        const srcNode = this.graph.nodes[edge.src];
        const destNode = this.graph.nodes[edge.dest];
        if (
          matcherSrc(srcNode, this.graph) &&
          matcherDest(destNode, this.graph) &&
          matcherEdge(edge, this.graph)
        ) {
          candidates.push({ rule, match: { src: srcNode, dest: destNode, edge } });
        }
      }
    }
  
    /**
     * Weighted random selection of an applicable rule.
     */
    weightedRandom(candidates) {
      const totalWeight = candidates.reduce((sum, candidate) => sum + candidate.rule.weight, 0);
      let r = Math.random() * totalWeight;
      for (const candidate of candidates) {
        r -= candidate.rule.weight;
        if (r <= 0) return candidate;
      }
      return candidates[candidates.length - 1];
    }
  
    /**
     * Applies a candidate rule.
     */
    applyCandidate(candidate) {
      const { rule, match } = candidate;
      if (rule.type === 'node') {
        const updateFn = makeUpdater(rule.rhs.node);
        const result = updateFn(match.node);
        if (result) this.graph.nodes[match.node.id] = result;
      } else if (rule.type === 'edge') {
        const updateFn = makeUpdater(rule.rhs.edge);
        const newEdge = updateFn(match.edge, match.src, match.dest);
        if (newEdge) this.graph.edges[match.edge.id] = newEdge;
      } else if (rule.type === 'graph') {
        // Remove the edge that is to be replaced.
        delete this.graph.edges[match.edge.id];
        if (rule.rhs.subgraph) {
          const subgraphResult = rule.rhs.subgraph({ src: match.src, dest: match.dest, edge: match.edge });
          if (subgraphResult) {
            const idMap = {};
            // Remap nodes with new unique IDs.
            if (subgraphResult.nodes)
              for (const node of subgraphResult.nodes) {
                const newID = this.nodeIDGen.next();
                idMap[node.id] = newID;
                const newNode = Object.assign({}, node, { id: newID });
                this.graph.nodes[newID] = newNode;
              }
            // Remap edges with new unique IDs.
            if (subgraphResult.edges)
              for (const edge of subgraphResult.edges) {
                const newID = this.edgeIDGen.next();
                const newEdge = JSON.parse(JSON.stringify(edge, (key, value) => {
                  if (typeof value === 'string' && idMap[value]) {
                  return idMap[value];
                  }
                  return value;
                }));
                newEdge.id = newID;
                this.graph.edges[newID] = newEdge;
              }
          }
        }
      }
    }
  }
  
  // ------------------------ Dungeon Grammar Definition ------------------------
  
  // Compact dungeon grammar: the grammar is an array of subgrammars.
  // Subgrammar 0 refines "path" edges into variants;
  // Subgrammar 1 expands a simple "path" edge into a more elaborate structure.
  const dungeonGrammar = {
    grammar: [
      [
        // Rule: Insert a room between the endpoints.
        {
          weight: 1,
          type: "graph",
          lhs: { edge: { type: "path" } },
          rhs: {
            edge: null, // no edge modification
            subgraph: ({ src, dest }) => ({
              nodes: [
                { id: "$midpoint", label: { type: "room" } }
              ],
              edges: [
                { src: src.id, dest: "$midpoint", label: { type: "path" } },
                { src: "$midpoint", dest: dest.id, label: { type: "path" } }
              ]
            })
          }
        },
        // Rule: Add a dead-end side branch.
        {
          weight: 1,
          type: "graph",
          lhs: { edge: { type: "path" } },
          rhs: {
            edge: null,
            subgraph: ({ src, edge }) => ({
              nodes: [
                { id: "$dead_end", label: { type: "dead_end" } }
              ],
              edges: [
                edge,
                { src: src.id, dest: "$dead_end", label: { type: "path" } }
              ]
            })
          }
        },
        // Rule: Add a parallel path
        {
          weight: 1,
          type: "graph",
          lhs: { edge: { type: "path" } },
          rhs: {
            edge: null,
            subgraph: ({ src, dest, edge }) => ({
              edges: [ edge, edge ]
            })
          }
        },
        // Rule: Insert key/door side branches into the path.
        {
          weight: 1,
          type: "graph",
          lhs: { edge: { type: "path" } },
          rhs: {
            edge: null,
            subgraph: ({ src, dest, edge }) => {
              const themePhrase = getTheme();
              const shutText = themedVersion (themePhrase, "There is a door here. It is closed and locked.");
              const keyText = themedVersion(themePhrase, "There is a key here. You pick it up.");
              const openText = themedContinuation(themePhrase, keyText + shutText, "The key unlocks the door, but will you pass through?");
              
              return {
                nodes: [
                  { id: "$key", label: { type: "key", text: keyText } },
                  { id: "$door", label: { type: "door", text: shutText, theme: themePhrase } }
                ],
                edges: [
                  { src: src.id, dest: "$key", label: { type: "path" } },
                  { src: "$key", dest: src.id, label: { type: "backtrack" } },
                  { src: src.id, dest: "$door", label: { type: "path" } },
                  { src: "$door", dest: dest.id, label: { type: "path" }, prereq: { node_id: "$key", text: openText } }
                ]
              }
            }
          }
        },
        {
          weight: 1,
          type: "edge",
          lhs: { edge: { type: "path" } },
          rhs: { edge: { type: "passage" } },
        },
        {
          weight: 1,
          type: "edge",
          lhs: { edge: { type: "path" } },
          rhs: { edge: { type: "monster" } }
        },
        {
          weight: 1,
          type: "edge",
          lhs: { edge: { type: "path" } },
          rhs: { edge: { type: "puzzle" } }
        }
      ]
    ]
  };
  
/**
 * Builds a graph object from lists of nodes and edges.
 * @param {Array} nodes - List of node objects with "id" properties.
 * @param {Array} edges - List of edge objects with "id", "src", and "dest" properties.
 * @returns {Object} Graph object with "nodes" and "edges" dictionaries.
 */
function buildGraph(nodes, edges) {
  const graph = {
    nodes: {},
    edges: {}
  };

  for (const node of nodes) {
    graph.nodes[node.id] = node;
  }

  let e = 0;
  for (const edge of edges) {
    edge.id = edge.id || `edge_${++e}`;
    graph.edges[edge.id] = edge;
  }

  return graph;
}

// ------------------------ Initial Graph ------------------------

const initialNodes = [
  { id: "start", label: { type: "start" } },
  { id: "goal", label: { type: "win" } }
];

const initialEdges = [
  { src: "start", dest: "goal", label: { type: "path" } }
];

const initialGraph = buildGraph(initialNodes, initialEdges);


  // ------------------------ Running the Simulator ------------------------

  // Converts the graph to a DOT-format string.
  function graphToDot(graph) {
    let dot = 'digraph G {\n';
    for (const nodeID in graph.nodes) {
      const node = graph.nodes[nodeID];
      dot += `  "${nodeID}" [label="${node.label?.type}"];\n`;
    }
    for (const edgeID in graph.edges) {
      const edge = graph.edges[edgeID];
      dot += `  "${edge.src}" -> "${edge.dest}" [label="${edge.label?.type}"];\n`;
    }
    dot += '}';
    return dot;
  }

  // Command-line argument handling.
  if (require.main === module) {
    const args = process.argv.slice(2);

    // Handle seed option
    const seedArgIndex = args.indexOf('--seed');
    let seed;
    if (seedArgIndex !== -1 && args[seedArgIndex + 1]) {
      seed = args[seedArgIndex + 1];
    } else {
      seed = Math.random().toString(36).substring(2);
    }
    console.log(`Using seed: ${seed} (run with --seed ${seed} to reproduce)`);
    const rng = seedrandom(seed);

    // Override Math.random with the seeded RNG
    Math.random = rng;

    const simulator = new GraphGrammarSimulator(initialGraph, dungeonGrammar.grammar);
    simulator.run(20);
    if (args.includes('-d'))
      console.log(JSON.stringify(simulator.graph, null, 2));

    if (args.includes('-g')) {
      const dotString = graphToDot(simulator.graph);
      fs.writeFileSync('temp.dot', dotString);
      execSync('dot -Tpdf temp.dot -o dot.pdf');
      execSync('open dot.pdf');
      console.log('Graph exported to dot.pdf and opened.');
    }
  }
