import React, { useMemo, useState, useCallback, useRef } from 'react';
import { Typography, IconButton, Button, TextField } from '@mui/material';
import { Trash2, Edit2, Check } from 'lucide-react';
import { 
  ReactFlow, 
  Background, 
  Position, 
  Handle, 
  MarkerType,
  useNodesState,
  useEdgesState,
  addEdge,
  reconnectEdge
} from '@xyflow/react';
import type { Node, Edge, NodeProps, Connection } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

interface Moment {
  id: string;
  description: string;
  parents?: string[];
  imageUrl?: string | null;
  relevantToCurrentEnvironment?: string;
  currentDetailLevel?: string;
}
interface PlotData {
  currentFPV?: string;
  moments: Moment[];
}
type DeleteMoment = (id: string) => void;
type UpdateMoment = (id: string, description: string) => void;
type MomentGraphNode = Node<{
  moment: Moment;
  onDelete: DeleteMoment;
  onUpdateDescription: UpdateMoment;
}>;

import { useWebSocket } from '@/hooks/useWebSocket';

// Custom node component with edit functionality
const MomentNode = ({ id, data }: NodeProps<MomentGraphNode>) => {
  const moment = data.moment;
  const handleDelete = data.onDelete;
  const handleUpdateDescription = data.onUpdateDescription;
  const [isEditing, setIsEditing] = useState(false);
  const [editedDescription, setEditedDescription] = useState(moment.description);
  
  // Determine node styling based on relevance and detail level
  const isRelevant = moment.relevantToCurrentEnvironment === "yes";
  const isDetailedLevel = moment.currentDetailLevel === "high";
  
  // Set colors based on relevance
  const nodeColor = isRelevant ? '#4CAF50' : '#1A472A';  // Bright green vs dark green
  
  // Set border style based on detail level
  const borderStyle = isDetailedLevel ? 'solid' : 'dashed';
  
  const handleEditToggle = (event: React.MouseEvent) => {
    event.stopPropagation();
    setIsEditing(!isEditing);
    if (!isEditing) {
      // Reset to original value when entering edit mode
      setEditedDescription(moment.description);
    }
  };
  
  const handleSaveEdit = (event: React.SyntheticEvent) => {
    event.stopPropagation();
    if (handleUpdateDescription) {
      handleUpdateDescription(id, editedDescription);
    }
    setIsEditing(false);
  };
  
  const handleTextChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setEditedDescription(event.target.value);
  };

  return (
    <div
      style={{
        width: 220,
        minHeight: 180,
        padding: 16,
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        background: 'rgba(0,0,0,0.4)',
        border: `2px ${borderStyle} ${nodeColor}`,
        color: nodeColor,
        boxShadow: 'none',
        borderRadius: 12,
        position: 'relative',
      }}
    >
      <Handle 
        id={`${id}-target`} 
        type="target" 
        position={Position.Left} 
        style={{ background: nodeColor }} 
      />
      <Handle 
        id={`${id}-source`} 
        type="source" 
        position={Position.Right} 
        style={{ background: nodeColor }} 
      />
      
      {/* Control buttons in top right */}
      <div style={{ position: 'absolute', top: 4, right: 4, display: 'flex' }}>
        {isEditing ? (
          <IconButton
            size="small"
            onClick={handleSaveEdit}
            sx={{ color: nodeColor, background: 'rgba(0,0,0,0.2)', marginRight: '4px' }}
          >
            <Check size={16} />
          </IconButton>
        ) : (
          <IconButton
            size="small"
            onClick={handleEditToggle}
            sx={{ color: nodeColor, background: 'rgba(0,0,0,0.2)', marginRight: '4px' }}
          >
            <Edit2 size={16} />
          </IconButton>
        )}
        <IconButton
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            if (handleDelete) {
              handleDelete(id);
            }
          }}
          sx={{ color: nodeColor, background: 'rgba(0,0,0,0.2)' }}
        >
          <Trash2 size={16} />
        </IconButton>
      </div>
      
      {moment.imageUrl && (
        <img
          src={`/backend/generated/${moment.imageUrl.split('/').pop()}`}
          alt={moment.description}
          style={{
            width: '100%',
            height: 180,
            objectFit: 'cover',
            marginBottom: 12,
            borderRadius: 8,
            border: `1.5px ${borderStyle} ${nodeColor}`,
          }}
        />
      )}
      
      {isEditing ? (
        <TextField
          fullWidth
          multiline
          variant="outlined"
          value={editedDescription}
          onChange={handleTextChange}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Save on Enter + Ctrl/Cmd
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              handleSaveEdit(e);
            }
          }}
          InputProps={{
            style: {
              color: nodeColor,
              fontSize: '0.875rem',
              padding: '8px',
            }
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              '& fieldset': {
                borderColor: `${nodeColor}80`,
                borderStyle: borderStyle,
              },
              '&:hover fieldset': {
                borderColor: nodeColor,
              },
              '&.Mui-focused fieldset': {
                borderColor: nodeColor,
              },
            },
          }}
        />
      ) : (
        <Typography variant="body2" sx={{ color: nodeColor }}>
          {moment.description}
        </Typography>
      )}
      
      {/* Status indicators */}
      <div style={{ 
        position: 'absolute', 
        bottom: 8, 
        left: 8, 
        display: 'flex', 
        gap: '8px',
        fontSize: '11px',
        color: 'rgba(255,255,255,0.7)'
      }}>
        <span style={{ 
          padding: '2px 6px', 
          borderRadius: '14px', 
          background: isRelevant ? 'rgba(76,175,80,0.2)' : 'rgba(26,71,42,0.2)', 
          border: `1px solid ${nodeColor}`
        }}>
          {isRelevant ? 'Relevant' : 'Irrelevant'}
        </span>
        <span style={{ 
          padding: '2px 6px', 
          borderRadius: '14px', 
          background: 'rgba(0,0,0,0.2)', 
          border: `1px ${borderStyle} ${nodeColor}`
        }}>
          {isDetailedLevel ? 'High Detail' : 'Low Detail'}
        </span>
        <span style={{ 
          padding: '2px 6px', 
          borderRadius: '14px', 
          background: 'rgba(0,0,0,0.2)', 
          border: `1px solid ${nodeColor}`
        }}>
          ID: {id}
        </span>
      </div>
    </div>
  );
};

const getInitialNodesAndEdges = (data: PlotData, onDeleteNode: DeleteMoment, onUpdateDescription: UpdateMoment) => {
  // Layout: assign x/y positions for a simple left-to-right, multi-row layout
  const levels: Record<number, Moment[]> = {};
  const idToLevel: Record<string, number> = {};
  let maxLevel = 0;

  function getLevel(moment: Moment) {
    if (!moment.parents || moment.parents.length === 0) return 0;
    const parentLevels = moment.parents.map(pid => idToLevel[pid] ?? 0);
    return Math.max(...parentLevels) + 1;
  }

  data.moments.forEach((moment) => {
    const level = getLevel(moment);
    idToLevel[moment.id] = level;
    if (!levels[level]) levels[level] = [];
    levels[level].push(moment);
    if (level > maxLevel) maxLevel = level;
  });

  const nodes: MomentGraphNode[] = [];
  const ySpacing = 200;
  const xSpacing = 300;

  for (let level = 0; level <= maxLevel; level++) {
    const row = levels[level] || [];
    row.forEach((moment, idx) => {
      nodes.push({
        id: moment.id,
        type: 'momentNode',
        data: {
          moment: moment,
          onDelete: onDeleteNode,
          onUpdateDescription: onUpdateDescription
        },
        position: {
          x: level * xSpacing,
          y: idx * ySpacing,
        },
      });
    });
  }

  const edges: Edge[] = [];

  data.moments.forEach((moment) => {
    if (moment.parents && moment.parents.length > 0) {
      moment.parents.forEach((parentId) => {
        // Determine color for edge based on source and target node relevance
        const parentMoment = data.moments.find(m => m.id === parentId);
        const isSourceRelevant = parentMoment?.relevantToCurrentEnvironment === "yes";
        const isTargetRelevant = moment.relevantToCurrentEnvironment === "yes";
        
        // Use the color of the most relevant node, or darker color if both are low relevance
        const edgeColor = isSourceRelevant || isTargetRelevant ? '#4CAF50' : '#1A472A';
        
        // Set edge style based on detail level
        const isSourceDetailed = parentMoment?.currentDetailLevel === "high";
        const isTargetDetailed = moment.currentDetailLevel === "high";
        
        // If either node has high detail, use solid line, otherwise dashed
        const edgeStyle = isSourceDetailed || isTargetDetailed ? 'solid' : 'dashed';
        
        edges.push({
          id: `${parentId}->${moment.id}`,
          source: parentId,
          target: moment.id,
          sourceHandle: `${parentId}-source`,
          targetHandle: `${moment.id}-target`,
          style: { 
            stroke: edgeColor, 
            strokeWidth: 2,
            strokeDasharray: edgeStyle === 'dashed' ? '5 5' : undefined
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
            color: edgeColor,
          },
        });
      });
    }
  });

  return { nodes, edges };
};

const PlotDemonstration = ({ data }: { data: PlotData }) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<MomentGraphNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { sendMessage } = useWebSocket();
  
  // Track reconnection status
  const edgeReconnectSuccessful = useRef(true);
  
  // Handle node deletion
  const handleDeleteNode = useCallback((nodeId: string) => {
    console.log('Deleting node:', nodeId);
    setNodes((nds) => nds.filter((node) => node.id !== nodeId));
    setEdges((eds) => eds.filter((edge) => 
      edge.source !== nodeId && edge.target !== nodeId
    ));
  }, [setNodes, setEdges]);
  
  // Handle text update
  const handleUpdateDescription = useCallback((nodeId: string, newDescription: string) => {
    console.log('Updating description for node:', nodeId, newDescription);
    setNodes(nodes => 
      nodes.map(node => {
        if (node.id === nodeId) {
          // Create a new object to ensure React detects the change
          const updatedNode = { 
            ...node,
            data: {
              ...node.data,
              moment: {
                ...node.data.moment,
                description: newDescription
              }
            }
          };
          return updatedNode;
        }
        return node;
      })
    );
  }, [setNodes]);
  
  // Initialize nodes and edges with the handlers
  useMemo(() => {
    const { nodes: initialNodes, edges: initialEdges } = getInitialNodesAndEdges(
      data, 
      handleDeleteNode,
      handleUpdateDescription
    );
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [data, handleDeleteNode, handleUpdateDescription, setNodes, setEdges]);
  
  // Connect handler
  const onConnect = useCallback(
    (params: Connection) => {
      // Get source and target node information to determine edge styling
      const sourceNode = nodes.find(n => n.id === params.source);
      const targetNode = nodes.find(n => n.id === params.target);
      
      if (sourceNode && targetNode) {
        const isSourceRelevant = sourceNode.data.moment.relevantToCurrentEnvironment === "yes";
        const isTargetRelevant = targetNode.data.moment.relevantToCurrentEnvironment === "yes";
        const edgeColor = isSourceRelevant || isTargetRelevant ? '#4CAF50' : '#1A472A';
        
        const isSourceDetailed = sourceNode.data.moment.currentDetailLevel === "high";
        const isTargetDetailed = targetNode.data.moment.currentDetailLevel === "high";
        const edgeStyle = isSourceDetailed || isTargetDetailed ? 'solid' : 'dashed';
        
        // Update target node's parents array
        setNodes(nodes => nodes.map(node => {
          if (node.id === params.target) {
            const currentParents = node.data.moment.parents || [];
            // Only add if parent doesn't already exist
            if (!currentParents.includes(params.source)) {
              return {
                ...node,
                data: {
                  ...node.data,
                  moment: {
                    ...node.data.moment,
                    parents: [...currentParents, params.source]
                  }
                }
              };
            }
          }
          return node;
        }));

        setEdges((eds) => addEdge({
          ...params,
          style: { 
            stroke: edgeColor, 
            strokeWidth: 2,
            strokeDasharray: edgeStyle === 'dashed' ? '5 5' : undefined
          },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 20,
            height: 20,
            color: edgeColor,
          },
        }, eds));
      }
    },
    [nodes, setNodes, setEdges]
  );
  
  // Reconnect handlers
  const onReconnectStart = useCallback(() => {
    console.log('Reconnect start');
    edgeReconnectSuccessful.current = false;
  }, []);
  
  const onReconnect = useCallback((oldEdge: Edge, newConnection: Connection) => {
    console.log('Reconnect attempt', oldEdge, newConnection);
    edgeReconnectSuccessful.current = true;
    
    // Get source and target node information to determine edge styling
    const sourceNode = nodes.find(n => n.id === newConnection.source);
    const targetNode = nodes.find(n => n.id === newConnection.target);
    
    if (sourceNode && targetNode) {
      const isSourceRelevant = sourceNode.data.moment.relevantToCurrentEnvironment === "yes";
      const isTargetRelevant = targetNode.data.moment.relevantToCurrentEnvironment === "yes";
      const edgeColor = isSourceRelevant || isTargetRelevant ? '#4CAF50' : '#1A472A';
      
      const isSourceDetailed = sourceNode.data.moment.currentDetailLevel === "high";
      const isTargetDetailed = targetNode.data.moment.currentDetailLevel === "high";
      const edgeStyle = isSourceDetailed || isTargetDetailed ? 'solid' : 'dashed';
      
      // Update target node's parents array
      setNodes(nodes => nodes.map(node => {
        if (node.id === newConnection.target) {
          const parents = node.data.moment.parents || [];
          const newParents = parents.filter(p => p !== oldEdge.source).concat(newConnection.source);
          return {
            ...node,
            data: {
              ...node.data,
              moment: {
                ...node.data.moment,
                parents: newParents
              }
            }
          };
        }
        return node;
      }));
      
      // Need to create new edge with updated styling based on the nodes
      const newEdge = {
        ...oldEdge,
        source: newConnection.source,
        target: newConnection.target,
        sourceHandle: newConnection.sourceHandle,
        targetHandle: newConnection.targetHandle,
        style: { 
          stroke: edgeColor, 
          strokeWidth: 2,
          strokeDasharray: edgeStyle === 'dashed' ? '5 5' : undefined
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 20,
          height: 20,
          color: edgeColor,
        },
      };
      
      setEdges((eds) => {
        const filteredEdges = eds.filter(e => e.id !== oldEdge.id);
        return [...filteredEdges, newEdge];
      });
    } else {
      setEdges((els) => reconnectEdge(oldEdge, newConnection, els));
    }
  }, [nodes, setNodes, setEdges]);
  
  const onReconnectEnd = useCallback((_: MouseEvent | TouchEvent, edge: Edge) => {
    console.log('Reconnect end, successful?', edgeReconnectSuccessful.current);
    if (!edgeReconnectSuccessful.current) {
      console.log('Deleting edge:', edge.id);
      setEdges((eds) => eds.filter((e) => e.id !== edge.id));
      
      // Also update the target node's parents array
      setNodes((nds) => nds.map((node) => {
        if (node.id === edge.target) {
          const parents = node.data.moment.parents || [];
          return {
            ...node,
            data: {
              ...node.data,
              moment: {
                ...node.data.moment,
                parents: parents.filter(p => p !== edge.source)
              }
            }
          };
        }
        return node;
      }));
    }
    edgeReconnectSuccessful.current = true;
  }, [setEdges, setNodes]);
  
  // Node deletion handler for ReactFlow's built-in deletion
  const onNodesDelete = useCallback(
    (deletedNodes: MomentGraphNode[]) => {
      console.log('Deleting nodes via ReactFlow:', deletedNodes);
      // Remove any edges connected to deleted nodes
      setEdges((eds) => eds.filter(edge => 
        !deletedNodes.some(node => 
          node.id === edge.source || node.id === edge.target
        )
      ));
      
      // Update parent references for all remaining nodes
      setNodes((nds) => nds.map(node => {
        const nodeParents = node.data.moment.parents || [];
        const updatedParents = nodeParents.filter(parentId => 
          !deletedNodes.some(deletedNode => deletedNode.id === parentId)
        );
        
        if (updatedParents.length !== nodeParents.length) {
          return {
            ...node,
            data: {
              ...node.data,
              moment: {
                ...node.data.moment,
                parents: updatedParents
              }
            }
          };
        }
        return node;
      }));
    },
    [setEdges, setNodes]
  );

  // Edge deletion handler
  const onEdgesDelete = useCallback(
    (deletedEdges: Edge[]) => {
      console.log('Deleting edges:', deletedEdges);
      // Update parents array for target nodes
      setNodes(nodes => nodes.map(node => {
        const deletedSources = deletedEdges
          .filter(edge => edge.target === node.id)
          .map(edge => edge.source);
        
        if (deletedSources.length > 0) {
          const currentParents = node.data.moment.parents || [];
          const newParents = currentParents.filter(p => !deletedSources.includes(p));
          return {
            ...node,
            data: {
              ...node.data,
              moment: {
                ...node.data.moment,
                parents: newParents
              }
            }
          };
        }
        return node;
      }));
    },
    [setNodes]
  );

  // FIXED: Synchronize node parents with edges before saving
  const synchronizeParentsWithEdges = useCallback(() => {
    // Create a map of target node ID -> array of source node IDs
    const edgeConnections: Record<string, string[]> = {};
    
    // Initialize with empty arrays for all nodes
    nodes.forEach(node => {
      edgeConnections[node.id] = [];
    });
    
    // Fill in the connections based on current edges
    edges.forEach(edge => {
      if (edgeConnections[edge.target]) {
        edgeConnections[edge.target].push(edge.source);
      }
    });
    
    // Update all nodes with synchronized parents
    return nodes.map(node => {
      const currentParents = node.data.moment.parents || [];
      const actualParents = edgeConnections[node.id] || [];
      
      // Check if parents array needs updating
      if (JSON.stringify(currentParents.sort()) !== JSON.stringify(actualParents.sort())) {
        console.log(`Synchronizing parents for node ${node.id}:`, {
          before: currentParents,
          after: actualParents
        });
        
        return {
          ...node,
          data: {
            ...node.data,
            moment: {
              ...node.data.moment,
              parents: actualParents
            }
          }
        };
      }
      
      return node;
    });
  }, [nodes, edges]);

  // Save handler with parent synchronization
  const handleSave = () => {
    // Synchronize parent references with actual edges before saving
    const synchronizedNodes = synchronizeParentsWithEdges();
    
    const plotConnection = {
      nodes: synchronizedNodes.map(n => ({
        id: n.id,
        data: n.data.moment,
        position: n.position,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
    };
    
    // Also update the nodes state with synchronized parents
    setNodes(synchronizedNodes);
    
    sendMessage('save_plot_connection', { plot_connection: plotConnection });
    alert('Plot connections saved successfully!');
  };

  // Reset layout
  const handleResetLayout = () => {
    const { nodes: resetNodes, edges: resetEdges } = getInitialNodesAndEdges(
      data, 
      handleDeleteNode, 
      handleUpdateDescription
    );
    setNodes(resetNodes);
    setEdges(resetEdges);
  };

  const nodeTypes = useMemo(() => ({ momentNode: MomentNode }), []);

  return (
    <div style={{ width: '100%', height: 'calc(var(--craft-stage-height, 100vh) * 0.8)', background: 'transparent' }}>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          color="success"
          onClick={handleSave}
        >
          Save Plot Connections
        </Button>
        <Button
          variant="outlined"
          onClick={handleResetLayout}
          sx={{ color: '#aaa', borderColor: '#666' }}
        >
          Reset Layout
        </Button>
      </div>

      <div className="craft-flow-canvas" style={{ 
        position: 'relative',
        border: '1px solid rgba(255,255,255,0.1)', 
        borderRadius: '12px',
        overflow: 'hidden'
      }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodesDelete={onNodesDelete}
          onEdgesDelete={onEdgesDelete}
          onReconnect={onReconnect}
          onReconnectStart={onReconnectStart}
          onReconnectEnd={onReconnectEnd}
          fitView
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          nodesDraggable={true}
          nodesConnectable={true}
          elementsSelectable={true}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#222" gap={16} />
          {/* <Controls showInteractive={true} style={{ background: 'rgba(0,0,0,0.2)' }} /> */}
          
          <div
            style={{
              position: 'absolute',
              bottom: 16,
              right: 16,
              padding: 12,
              borderRadius: 12,
              background: 'rgba(0,0,0,0.7)',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#aaa',
              fontSize: 14,
              maxWidth: 300
            }}
          >
            <div style={{ marginBottom: 8, fontWeight: 'bold' }}>Visual Legend:</div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ width: 12, height: 12, backgroundColor: '#4CAF50', marginRight: 6 }}></div>
              <span>High Relevance</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ width: 12, height: 12, backgroundColor: '#1A472A', marginRight: 6 }}></div>
              <span>Low Relevance</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ width: 24, height: 2, borderTop: '2px solid #4CAF50', marginRight: 6 }}></div>
              <span>High Detail</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ width: 24, height: 2, borderTop: '2px dashed #4CAF50', marginRight: 6 }}></div>
              <span>Low Detail</span>
            </div>
            {/* <div style={{ marginBottom: 6 }}>• Drag edges by their endpoints</div>
            <div style={{ marginBottom: 6 }}>• Release in empty space to delete</div>
            <div style={{ marginBottom: 6 }}>• Connect nodes by dragging from handles</div>
            <div>• Click the edit button to modify text</div> */}
          </div>
        </ReactFlow>
      </div>
    </div>
  );
};

export default PlotDemonstration;