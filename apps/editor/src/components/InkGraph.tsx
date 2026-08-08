/**
 * L4 WU-03: React Flow graph for Ink knots. Positions write back into source
 * via `setInkNodePosition` (layout comments). Edges are visual-only.
 */

import {
  Background,
  Controls,
  type Edge,
  MarkerType,
  type Node,
  type OnNodeDrag,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { buildInkGraphModel, setInkNodePosition } from '@threemaker/narrative';
import { useCallback, useEffect, useMemo } from 'react';

export interface InkGraphProps {
  readonly source: string;
  /** Called when a node is dragged — receives full ink source with layout comments. */
  readonly onSourceChange: (nextSource: string) => void;
  readonly ariaLabel: string;
}

function toFlowNodes(source: string): Node[] {
  const model = buildInkGraphModel(source);
  return model.nodes.map((n) => ({
    id: n.knot,
    position: { x: n.x, y: n.y },
    data: { label: n.knot },
    // END and other undeclared targets stay draggable so layout can still pin them.
    style: {
      padding: '6px 10px',
      fontSize: 12,
      borderRadius: 6,
      border: '1px solid #555',
      background: n.knot === 'END' ? '#2a2a2a' : '#1e1e1e',
      color: '#eee',
      minWidth: 72,
      textAlign: 'center' as const,
    },
  }));
}

function toFlowEdges(source: string): Edge[] {
  const model = buildInkGraphModel(source);
  return model.edges.map((e, i) => ({
    id: `${e.from}->${e.to}-${i}`,
    source: e.from,
    target: e.to,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { stroke: '#888' },
  }));
}

function InkGraphInner({ source, onSourceChange, ariaLabel }: InkGraphProps) {
  const initialNodes = useMemo(() => toFlowNodes(source), [source]);
  const initialEdges = useMemo(() => toFlowEdges(source), [source]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Rebuild when the text source changes (not from our own drag write-back path
  // alone — parent still passes new source after drag, which is correct).
  useEffect(() => {
    setNodes(toFlowNodes(source));
    setEdges(toFlowEdges(source));
  }, [source, setNodes, setEdges]);

  const onNodeDragStop = useCallback<OnNodeDrag>(
    (_event, node) => {
      const next = setInkNodePosition(source, node.id, node.position.x, node.position.y);
      onSourceChange(next);
    },
    [source, onSourceChange],
  );

  return (
    <section
      aria-label={ariaLabel}
      style={{ width: '100%', height: 260, border: '1px solid #444', borderRadius: 4 }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={onNodeDragStop}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable
        deleteKeyCode={null}
      >
        <Background gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </section>
  );
}

/** Provider wrapper — required by React Flow for internal store. */
export function InkGraph(props: InkGraphProps) {
  return (
    <ReactFlowProvider>
      <InkGraphInner {...props} />
    </ReactFlowProvider>
  );
}
