import { CHANNELS, type Workflow } from "./types.js";

const REVIEW_NODE: Workflow["nodes"][number] = {
  id: "reviews",
  type: "metricool",
  label: "Traer reseñas",
  enabled: true,
  position: { x: 657, y: 500 },
  config: { resource: "reviews", provider: "GMB" },
};

const REVIEW_EDGES: Workflow["edges"] = [
  { id: "loop-reviews", source: "loop", target: "reviews", connectorType: "smoothstep" },
  { id: "reviews-merge", source: "reviews", target: "merge", connectorType: "smoothstep" },
];

export function ensureMetricoolInboxCoverage(workflow: Workflow): Workflow {
  const accounts = workflow.nodes.find((node) => node.id === "accounts");
  if (accounts) accounts.config.channels = [...CHANNELS];
  if (!workflow.nodes.some((node) => node.id === REVIEW_NODE.id)) {
    workflow.nodes.push(structuredClone(REVIEW_NODE));
  }
  for (const edge of REVIEW_EDGES) {
    if (!workflow.edges.some((current) => current.id === edge.id)) {
      workflow.edges.push({ ...edge });
    }
  }
  for (const edge of workflow.edges) {
    if (!edge.connectorType || !["smoothstep", "bezier", "straight"].includes(edge.connectorType)) {
      edge.connectorType = "smoothstep";
    }
  }
  const merge = workflow.nodes.find((node) => node.id === "merge");
  if (merge?.label === "Mensajes + comentarios") merge.label = "Unificar interacciones";
  return workflow;
}
