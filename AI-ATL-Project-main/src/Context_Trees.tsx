/**
 * Front End
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  ControlButton,
  MiniMap,
  Node,
  Edge,
  NodeChange,
  EdgeChange,
  applyNodeChanges,
  applyEdgeChanges,
  MarkerType,
  Position,
  NodeProps,
  Handle,
  ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import './custom_scrollbar.css';
import { TokenAnalytics } from './TokenAnalytics';
import ReactMarkdown from 'react-markdown';


interface ConversationNode {
  id: string;
  parentId: string | null;
  prompt: string;
  response: string;
  timestamp: Date;
  branchLabel?: string;
}

interface TreeData {
  nodes: ConversationNode[];
  activeNodeId: string | null;
}

const nodeWidth = 380;
const nodeHeight = 140;
const verticalSpacing = 180;
const horizontalSpacing = 450;
const minHorizontalGap = 50;

const lockedPositions = new Map<string, { x: number; y: number }>();

function wouldOverlap(pos1: { x: number; y: number }, pos2: { x: number; y: number }): boolean {
  const horizontalOverlap = Math.abs(pos1.x - pos2.x) < (nodeWidth + minHorizontalGap);
  const verticalOverlap = Math.abs(pos1.y - pos2.y) < (nodeHeight + 20);
  return horizontalOverlap && verticalOverlap;
}

function getAllDescendants(nodeId: string, allNodes: ConversationNode[]): string[] {
  const descendants: string[] = [];
  const children = allNodes.filter(n => n.parentId === nodeId);
  
  children.forEach(child => {
    descendants.push(child.id);
    descendants.push(...getAllDescendants(child.id, allNodes));
  });
  
  return descendants;
}

// This method shifts a node to the right along with its entire branch
function shiftBranchRight(nodeId: string, shiftAmount: number, allNodes: ConversationNode[]): void {
  const nodesToShift = [nodeId, ...getAllDescendants(nodeId, allNodes)];
  
  nodesToShift.forEach(id => {
    const pos = lockedPositions.get(id);
    if (pos) {
      pos.x += shiftAmount;
    }
  });
}

// This method shifts a node to the left along with its entire branch
function shiftBranchLeft(nodeId: string, shiftAmount: number, allNodes: ConversationNode[]): void {
  const nodesToShift = [nodeId, ...getAllDescendants(nodeId, allNodes)];
  
  nodesToShift.forEach(id => {
    const pos = lockedPositions.get(id);
    if (pos) {
      pos.x -= shiftAmount;
    }
  });
}

function shiftNodesRight(fromX: number, atY: number, shiftAmount: number, exceptNodeId: string, allNodes: ConversationNode[]): void {
  const nodesToCheck = Array.from(lockedPositions.entries())
    .filter(([nodeId, pos]) => 
      nodeId !== exceptNodeId && 
      pos.x >= fromX && 
      Math.abs(pos.y - atY) < nodeHeight + 20
    );
  
  nodesToCheck.forEach(([nodeId]) => {
    shiftBranchRight(nodeId, shiftAmount, allNodes);
  });
}

function getRightmostDescendantX(nodeId: string, allNodes: ConversationNode[]): number {
  const descendants = getAllDescendants(nodeId, allNodes);
  let rightmostX = lockedPositions.get(nodeId)?.x ?? 0;
  
  descendants.forEach(descId => {
    const pos = lockedPositions.get(descId);
    if (pos && pos.x > rightmostX) {
      rightmostX = pos.x;
    }
  });
  
  return rightmostX;
}

// This method shifts all ancestor siblings to the right, but only those that are to the right of the branching parent
function shiftAllAncestorSiblings(nodeId: string, allNodes: ConversationNode[]): void {
  const node = allNodes.find(n => n.id === nodeId);
  if (!node || !node.parentId) return;
  
  const parent = allNodes.find(n => n.id === node.parentId);
  if (!parent) return;
  
  const parentPos = lockedPositions.get(parent.id);
  if (!parentPos) return;
  
  let currentNode = node;
  
  while (currentNode.parentId) {
    const ancestor = allNodes.find(n => n.id === currentNode.parentId);
    if (!ancestor) break;
    
    const ancestorSiblings = allNodes.filter(n => 
      n.parentId === ancestor.parentId && n.id !== ancestor.id
    );
    
    ancestorSiblings.forEach(sibling => {
      const siblingPos = lockedPositions.get(sibling.id);
      if (siblingPos && siblingPos.x > parentPos.x) {
        shiftBranchRight(sibling.id, horizontalSpacing, allNodes);
      }
    });
    
    currentNode = ancestor;
  }
}

function layoutNodes(treeData: TreeData): { nodes: Node[]; edges: Edge[] } {
  const sortedNodes = [...treeData.nodes].sort((a, b) => 
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const edges: Edge[] = [];
  sortedNodes.forEach((node) => {
    if (node.parentId) {
      edges.push({
        id: `${node.parentId}-${node.id}`,
        source: node.parentId,
        target: node.id,
        type: 'smoothstep',
        animated: treeData.activeNodeId === node.id,
        markerEnd: { type: MarkerType.ArrowClosed },
        style: {
          strokeWidth: 2,
          stroke: treeData.activeNodeId === node.id ? '#3b82f6' : '#94a3b8',
        },
      });
    }
  });

  sortedNodes.forEach((node) => {
    if (!lockedPositions.has(node.id)) {
      if (!node.parentId) {
        lockedPositions.set(node.id, { x: 0, y: 0 });
      } else {
        const parentPos = lockedPositions.get(node.parentId);
        if (parentPos) {
          const siblings = sortedNodes.filter(n => n.parentId === node.parentId);
          const siblingIndex = siblings.findIndex(n => n.id === node.id);
          
          let desiredPos: { x: number; y: number };
          
          if (siblingIndex === 0) {
            desiredPos = {
              x: parentPos.x,
              y: parentPos.y + verticalSpacing,
            };
            
            let hasOverlap = true;
            let maxIterations = 50;
            let iterations = 0;
            
            while (hasOverlap && iterations < maxIterations) {
              hasOverlap = false;
              iterations++;
              
              for (const [existingNodeId, existingPos] of lockedPositions.entries()) {
                if (existingNodeId !== node.id && wouldOverlap(desiredPos, existingPos)) {
                  shiftBranchRight(existingNodeId, horizontalSpacing, sortedNodes);
                  hasOverlap = true;
                }
              }
            }
          } else {
            const parent = sortedNodes.find(n => n.id === node.parentId);
            const rightmostDescendantX = parent ? getRightmostDescendantX(parent.id, sortedNodes) : parentPos.x;
            
            const minBranchX = Math.max(
              parentPos.x + (siblingIndex * horizontalSpacing),
              rightmostDescendantX + horizontalSpacing
            );
            
            desiredPos = {
              x: minBranchX,
              y: parentPos.y + verticalSpacing,
            };
            
            shiftAllAncestorSiblings(node.id, sortedNodes);
            
            let hasOverlap = true;
            let maxIterations = 50;
            let iterations = 0;
            
            while (hasOverlap && iterations < maxIterations) {
              hasOverlap = false;
              iterations++;
              
              for (const [existingNodeId, existingPos] of lockedPositions.entries()) {
                if (existingNodeId !== node.id && wouldOverlap(desiredPos, existingPos)) {
                  shiftBranchRight(existingNodeId, horizontalSpacing, sortedNodes);
                  hasOverlap = true;
                }
              }
            }
          }
          
          lockedPositions.set(node.id, desiredPos);
        }
      }
    }
  });

  const nodes: Node[] = sortedNodes.map((node) => {
    const position = lockedPositions.get(node.id) || { x: 0, y: 0 };
    const isActive = node.id === treeData.activeNodeId;
    const isInActivePath = isNodeInActivePath(node.id, treeData);

    return {
      id: node.id,
      type: 'conversationNode',
      position: {
        x: position.x - nodeWidth / 2,
        y: position.y,
      },
      data: {
        ...node,
        isActive,
        isInActivePath,
      },
      style: {
        width: nodeWidth,
      },
    };
  });

  return { nodes, edges };
}

function isNodeInActivePath(nodeId: string, treeData: TreeData): boolean {
  if (!treeData.activeNodeId) return false;
  
  let currentId: string | null = treeData.activeNodeId;
  const nodeMap = new Map(treeData.nodes.map(n => [n.id, n]));
  
  while (currentId) {
    if (currentId === nodeId) return true;
    const node = nodeMap.get(currentId);
    currentId = node?.parentId || null;
  }
  
  return false;
}


function ConversationNodeComponent({ data, id }: NodeProps) {
  const { prompt, response, isActive, isInActivePath, timestamp, branchLabel, isDarkMode, isHighlighted, onDelete, isHovered } = data;

  const nodeColors = isDarkMode ? {
    nodeBg: isHighlighted ? '#1e3a5f' : '#1a2f4f',
    promptBg: isActive ? '#253a5f' : isHighlighted ? '#2a4569' : '#1f3454',
    border: isHighlighted ? '#60a5fa' : isActive ? '#3b82f6' : isInActivePath ? '#60a5fa' : '#2a4569',
    borderColor: '#2a4569',
    textColor: '#e0f2fe',
  } : {
    nodeBg: isHighlighted ? '#e6f2ff' : '#f0f7ff',
    promptBg: isActive ? '#d6ebff' : isHighlighted ? '#cce7ff' : '#e6f2ff',
    border: isHighlighted ? '#007aff' : isActive ? '#0051d5' : isInActivePath ? '#007aff' : '#b3d9ff',
    borderColor: '#cce7ff',
    textColor: '#003d7a',
  };

  return (
    <div
      style={{
        borderRadius: '12px',
        border: `2px solid ${nodeColors.border}`,
        backgroundColor: nodeColors.nodeBg,
        boxShadow: isHighlighted 
          ? (isDarkMode 
              ? '0 4px 20px rgba(96, 165, 250, 0.4)' 
              : '0 4px 20px rgba(0, 122, 255, 0.3)')
          : isActive 
          ? (isDarkMode
              ? '0 4px 16px rgba(59, 130, 246, 0.3)'
              : '0 4px 16px rgba(0, 81, 213, 0.25)')
          : (isDarkMode
              ? '0 2px 8px rgba(0, 0, 0, 0.3)'
              : '0 2px 8px rgba(0, 122, 255, 0.1)'),
        overflow: 'hidden',
        position: 'relative',
        transition: 'all 0.2s ease',
      }}
      onMouseEnter={() => data.onMouseEnter?.(id)}
      onMouseLeave={() => data.onMouseLeave?.()}
    >
      <Handle type="target" position={Position.Top} />
      
      {/* Delete Button - Show on hover */}
      {isHovered && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete(id);
          }}
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '24px',
            height: '24px',
            borderRadius: '6px',
            border: 'none',
            backgroundColor: isDarkMode ? 'rgba(239, 68, 68, 0.9)' : '#ef4444',
            color: '#ffffff',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '14px',
            fontWeight: 600,
            zIndex: 10,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.1)';
            e.currentTarget.style.backgroundColor = '#dc2626';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(239, 68, 68, 0.9)' : '#ef4444';
          }}
        >
          ×
        </button>
      )}
      
      {/* Prompt Section */}
      <div
        style={{
          padding: '16px',
          backgroundColor: nodeColors.promptBg,
          borderBottom: `1px solid ${nodeColors.borderColor}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: isHighlighted 
                ? (isDarkMode ? '#60a5fa' : '#007aff')
                : (isDarkMode ? '#3b82f6' : '#0051d5'),
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            Prompt
          </span>
        </div>
        
          <div
            style={{
              fontSize: '14px',
              lineHeight: '1.5',
              color: nodeColors.textColor,
              maxHeight: '100px',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              textOverflow: 'ellipsis',
            }}
          >
            {prompt}
        </div>
        
        <div style={{ 
          fontSize: '11px', 
          color: isDarkMode ? '#93c5fd' : '#5a9bd4', 
          marginTop: '12px' 
        }}>
          {new Date(timestamp).toLocaleString(undefined, { 
            year: 'numeric', 
            month: 'numeric', 
            day: 'numeric', 
            hour: 'numeric', 
            minute: '2-digit' 
          })}
        </div>
      </div>
      
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = {
  conversationNode: ConversationNodeComponent,
};


export function ConversationTreeChatbot() {
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);
  const [treeData, setTreeData] = useState<TreeData>({
    nodes: [],
    activeNodeId: null,
  });

  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [newPrompt, setNewPrompt] = useState('');
  const [leftWidth, setLeftWidth] = useState(40); // percentage
  const [isLeftMinimized, setIsLeftMinimized] = useState(false);
  const [isRightMinimized, setIsRightMinimized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [streamingResponses, setStreamingResponses] = useState<Map<string, string>>(new Map());
  const [examplePrompt, setExamplePrompt] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [nodeToDelete, setNodeToDelete] = useState<string | null>(null);
  const [isGraphLocked, setIsGraphLocked] = useState(true);

  // Initialize ReactFlow instance
  const onInit = useCallback((instance: ReactFlowInstance) => {
    reactFlowInstance.current = instance;
  }, []);

  // Handle divider dragging
  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging && !isLeftMinimized && !isRightMinimized) {
      const newWidth = (e.clientX / window.innerWidth) * 100;
      if (newWidth >= 0 && newWidth <= 100) {
        setLeftWidth(newWidth);
      }
    }
  }, [isDragging, isLeftMinimized, isRightMinimized]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const focusNode = useCallback((nodeId: string) => {
    setTimeout(() => {
      if (reactFlowInstance.current) {
        const node = reactFlowInstance.current.getNode(nodeId);
        if (node) {
          reactFlowInstance.current.setCenter(
            node.position.x + nodeWidth / 2,
            node.position.y + nodeHeight / 2,
            { zoom: 1, duration: 800 }
          );
        }
      }
    }, 100);
  }, []);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Update lockedPositions when nodes are dragged
      changes.forEach(change => {
        if (change.type === 'position' && change.position) {
          // Node is being moved or has been moved
          const nodeId = change.id;
          const newPosition = change.position;
          // Update the locked position (add nodeWidth/2 back since we subtract it in layoutNodes)
          lockedPositions.set(nodeId, {
            x: newPosition.x + nodeWidth / 2,
            y: newPosition.y,
          });
        }
      });
      
      setNodes((nds) => applyNodeChanges(changes, nds));
    },
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const matchesSearch = useCallback((node: ConversationNode, query: string): boolean => {
    if (!query.trim()) return false;
    const lowerQuery = query.toLowerCase();
    return node.prompt.toLowerCase().includes(lowerQuery) || 
           node.response.toLowerCase().includes(lowerQuery);
  }, []);

  const getAllDescendants = useCallback((nodeId: string, allNodes: ConversationNode[]): string[] => {
    const children = allNodes.filter(n => n.parentId === nodeId).map(n => n.id);
    const descendants: string[] = [];
    for (const childId of children) {
      descendants.push(childId);
      descendants.push(...getAllDescendants(childId, allNodes));
    }
    return descendants;
  }, []);

  const handleDeleteNode = useCallback((nodeId: string) => {
    setTreeData((prev) => {
      const nodeToDelete = prev.nodes.find(n => n.id === nodeId);
      if (!nodeToDelete) return prev;
      
      const descendants = getAllDescendants(nodeId, prev.nodes);
      const idsToDelete = new Set([nodeId, ...descendants]);
      const remainingNodes = prev.nodes.filter(n => !idsToDelete.has(n.id));
      
      // Remove deleted nodes from lockedPositions
      idsToDelete.forEach(id => {
        lockedPositions.delete(id);
      });
      
      // Clear all locked positions except the root node to force reorganization
      const rootNode = remainingNodes.find(n => !n.parentId);
      const rootId = rootNode?.id;
      
      // Store root position if it exists
      const rootPosition = rootId ? lockedPositions.get(rootId) : null;
      
      // Clear all positions
      lockedPositions.clear();
      
      // Restore root position if it existed
      if (rootId && rootPosition) {
        lockedPositions.set(rootId, rootPosition);
      }
      
      let newActiveNodeId = prev.activeNodeId;
      if (idsToDelete.has(prev.activeNodeId || '')) {
        newActiveNodeId = remainingNodes.length > 0 ? remainingNodes[remainingNodes.length - 1].id : null;
      }
      
      return {
        ...prev,
        nodes: remainingNodes,
        activeNodeId: newActiveNodeId,
      };
    });
  }, [getAllDescendants]);

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setTreeData((prev) => ({
      ...prev,
      activeNodeId: node.id,
    }));
    focusNode(node.id);
  }, [focusNode]);

  useEffect(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = layoutNodes(treeData);
    const nodesWithTheme = layoutedNodes.map(node => {
      const conversationNode = treeData.nodes.find(n => n.id === node.id);
      const isHighlighted = conversationNode && searchQuery.trim() 
        ? matchesSearch(conversationNode, searchQuery)
        : false;
      
      return {
        ...node,
        data: {
          ...node.data,
          isDarkMode,
          isHighlighted,
          onDelete: setNodeToDelete,
          onMouseEnter: (nodeId: string) => setHoveredNodeId(nodeId),
          onMouseLeave: () => setHoveredNodeId(null),
          isHovered: hoveredNodeId === node.id,
        },
      };
    });
    setNodes(nodesWithTheme);
    setEdges(layoutedEdges);
  }, [treeData, isDarkMode, searchQuery, matchesSearch, hoveredNodeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [treeData.nodes.length, treeData.activeNodeId]);

  const examplePrompts = [
    "What is a neural network?",
    "I want to learn about machine learning",
    "What is AI?",
    "What is deep learning?",
    "What is natural language processing?",
    "I want to understand transformers",
    "I am curious about computer vision",
    "I want to learn about reinforcement learning",
  ];

  useEffect(() => {
    if (treeData.nodes.length > 0) {
      setExamplePrompt('');
      return;
    }

    let typingTimeout: ReturnType<typeof setTimeout>;
    let nextPromptTimeout: ReturnType<typeof setTimeout>;
    let currentText = '';
    let isDeleting = false;
    let promptIndex = 0;

    const typeText = () => {
      const targetText = examplePrompts[promptIndex];
      
      if (isDeleting) {
        if (currentText.length > 0) {
          currentText = currentText.slice(0, -1);
          setExamplePrompt(currentText);
          typingTimeout = setTimeout(typeText, 30);
        } else {
          isDeleting = false;
          promptIndex = (promptIndex + 1) % examplePrompts.length;
          nextPromptTimeout = setTimeout(typeText, 200);
        }
      } else {
        if (currentText.length < targetText.length) {
          currentText = targetText.slice(0, currentText.length + 1);
          setExamplePrompt(currentText);
          typingTimeout = setTimeout(typeText, 50);
        } else {
          nextPromptTimeout = setTimeout(() => {
            isDeleting = true;
            typeText();
          }, 5000);
        }
      }
    };

    typeText();

    return () => {
      clearTimeout(typingTimeout);
      clearTimeout(nextPromptTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData.nodes.length]);

  const handleSendPrompt = useCallback(async () => {
    let promptText = newPrompt.trim();
    
    if (treeData.nodes.length === 0 && (promptText.toLowerCase() === 'yes' || promptText.toLowerCase() === 'y') && examplePrompt) {
      promptText = examplePrompt;
    } else if (!promptText || isLoading) {
      return;
    }
    
    setNewPrompt('');
    setExamplePrompt('');
    setIsLoading(true);
    
    const tempNodeId = `temp_${Date.now()}`;
    setTreeData((prev) => ({
      ...prev,
      nodes: [
        ...prev.nodes,
        {
          id: tempNodeId,
          parentId: prev.activeNodeId,
          prompt: promptText,
          response: 'Thinking...',
          timestamp: new Date(),
        },
      ],
      activeNodeId: tempNodeId,
    }));

    try {
      const nodesForAPI = treeData.nodes.map(node => ({
        node_id: node.id,
        parent_id: node.parentId,
        prompt: node.prompt,
        response: node.response,
        timestamp: node.timestamp.toISOString(),
      }));

      const response = await fetch('http://localhost:8000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: 'default', // You might want to make this dynamic
          user_message: promptText,
          parent_node_id: treeData.activeNodeId,
          tree: {
            session_id: 'default',
            nodes: nodesForAPI,
          },
        }),
      });

      if (!response.ok) {
        let errorMessage = 'Failed to get response';
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorMessage;
        } catch {
          errorMessage = `HTTP ${response.status}: ${response.statusText}`;
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      const fullResponse = data.response;
      const nodeId = data.node_id;
      
      let currentText = '';
      const streamInterval = setInterval(() => {
        if (currentText.length < fullResponse.length) {
          currentText = fullResponse.substring(0, currentText.length + 3);
          setStreamingResponses(prev => {
            const newMap = new Map(prev);
            newMap.set(tempNodeId, currentText);
            return newMap;
          });
        } else {
          clearInterval(streamInterval);
          
          // Transfer the locked position from tempNodeId to actual nodeId
          const tempPosition = lockedPositions.get(tempNodeId);
          if (tempPosition) {
            lockedPositions.set(nodeId, tempPosition);
            lockedPositions.delete(tempNodeId);
          }
          
          setTreeData((prev) => ({
            ...prev,
            nodes: prev.nodes.map(node =>
              node.id === tempNodeId
                ? {
                    ...node,
                    id: nodeId,
                    response: fullResponse,
                  }
                : node
            ),
            activeNodeId: nodeId,
          }));
          setStreamingResponses(prev => {
            const newMap = new Map(prev);
            newMap.delete(tempNodeId);
            return newMap;
          });
        }
      }, 20);

      focusNode(nodeId);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to get response';
      
      if (errorMessage.includes('fetch') || errorMessage.includes('Failed to fetch')) {
        setTreeData((prev) => ({
          ...prev,
          nodes: prev.nodes.map(node =>
            node.id === tempNodeId
              ? {
                  ...node,
                  response: `Connection Error: Make sure the backend server is running on http://localhost:8000`,
                }
              : node
          ),
        }));
      } else {
        setTreeData((prev) => ({
          ...prev,
          nodes: prev.nodes.map(node =>
            node.id === tempNodeId
              ? {
                  ...node,
                  response: `Error: ${errorMessage}`,
                }
              : node
          ),
        }));
      }
    } finally {
      setIsLoading(false);
    }
  }, [newPrompt, treeData.activeNodeId, treeData.nodes, treeData.nodes.length, focusNode, isLoading, examplePrompt]);

  const actualLeftWidth = isLeftMinimized ? 0 : isRightMinimized ? 100 : leftWidth;
  const actualRightWidth = isRightMinimized ? 0 : isLeftMinimized ? 100 : (100 - leftWidth);

  const theme = isDarkMode ? {
    chatBg: '#0f172a',
    graphBg: '#1e293b',
    containerBg: '#0a1220',
    messageBg: 'rgba(255, 255, 255, 0.08)',
    messageText: '#ffffff',
    userMessageBg: 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)',
    userMessageText: '#000000',
    inputBg: 'rgba(255, 255, 255, 0.1)',
    inputText: '#ffffff',
    inputBorder: 'rgba(255, 255, 255, 0.2)',
    divider: 'rgba(255, 255, 255, 0.1)',
    dividerHandle: '#60a5fa',
    secondaryText: '#b3b3b3',
    buttonBg: 'rgba(255, 255, 255, 0.1)',
    buttonText: '#ffffff',
    buttonBorder: 'rgba(255, 255, 255, 0.2)',
    hoverBg: 'rgba(255, 255, 255, 0.15)',
    avatarBg: '#60a5fa',
    scrollbarTrack: '#1e293b',
    scrollbarThumb: '#475569',
    accent: '#60a5fa',
    shadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  } : {
    chatBg: '#f0f7ff',
    graphBg: '#e6f2ff',
    containerBg: '#ffffff',
    messageBg: 'rgba(0, 0, 0, 0.04)',
    messageText: '#1d1d1f',
    userMessageBg: 'linear-gradient(135deg, #007aff 0%, #0051d5 100%)', // Apple blue
    userMessageText: '#ffffff',
    inputBg: 'rgba(0, 0, 0, 0.04)',
    inputText: '#1d1d1f',
    inputBorder: 'rgba(0, 0, 0, 0.1)',
    divider: 'rgba(0, 0, 0, 0.08)',
    dividerHandle: '#007aff',
    secondaryText: '#86868b',
    buttonBg: 'rgba(0, 0, 0, 0.04)',
    buttonText: '#1d1d1f',
    buttonBorder: 'rgba(0, 0, 0, 0.1)',
    hoverBg: 'rgba(0, 0, 0, 0.06)',
    avatarBg: '#007aff',
    scrollbarTrack: '#e6f2ff',
    scrollbarThumb: '#b3d9ff',
    accent: '#007aff',
    shadow: '0 4px 24px rgba(0, 0, 0, 0.08)',
  };

  if (showAnalytics) {
  return (
      <TokenAnalytics
        sessionId="default"
        tree={treeData}
        activeNodeId={treeData.activeNodeId}
        isDarkMode={isDarkMode}
        onClose={() => setShowAnalytics(false)}
      />
    );
  }

  if (showHowItWorks) {
    return (
      <div style={{
        padding: '48px',
        backgroundColor: theme.chatBg,
        minHeight: '100vh',
        height: '100vh',
        overflowY: 'auto',
        color: theme.messageText,
        fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
      }}>
        <div style={{
          maxWidth: '800px',
          margin: '0 auto',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '48px',
          }}>
            <h1 style={{
              margin: 0,
              fontSize: '48px',
              fontWeight: 600,
              color: theme.messageText,
              letterSpacing: '-1px',
              lineHeight: '1.1',
            }}>
              How It Works
            </h1>
        <button
              onClick={() => setShowHowItWorks(false)}
          style={{
                padding: '8px 16px',
                backgroundColor: 'transparent',
                color: theme.secondaryText,
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                fontWeight: 400,
            fontSize: '15px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = theme.hoverBg;
                e.currentTarget.style.color = theme.messageText;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.color = theme.secondaryText;
              }}
            >
              Close
            </button>
          </div>

          <div style={{
            backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
            padding: '32px',
            borderRadius: '16px',
            marginBottom: '32px',
            border: `1px solid ${theme.inputBorder}`,
          }}>
            <h2 style={{
              marginTop: 0,
              marginBottom: '16px',
              fontSize: '28px',
            fontWeight: 600,
              color: theme.messageText,
              letterSpacing: '-0.5px',
            }}>
              About Clarity
            </h2>
            <p style={{
              fontSize: '17px',
              lineHeight: '1.7',
              color: theme.secondaryText,
              marginBottom: '16px',
            }}>
              Clarity is an AI conversation tool that reduces token costs by 60-80% by storing conversation history as images instead of text. This innovative approach leverages vision models' efficient image processing to dramatically cut down on API costs.
            </p>
            <p style={{
              fontSize: '17px',
              lineHeight: '1.7',
              color: theme.secondaryText,
              marginBottom: 0,
            }}>
              Instead of sending all previous messages as text (which can cost thousands of tokens), Clarity converts your conversation history into a compact image. Vision tokens are much cheaper than text tokens, resulting in significant savings.
            </p>
          </div>

          <div style={{
            backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
            padding: '32px',
            borderRadius: '16px',
            marginBottom: '32px',
            border: `1px solid ${theme.inputBorder}`,
          }}>
            <h2 style={{
              marginTop: 0,
              marginBottom: '24px',
              fontSize: '28px',
              fontWeight: 600,
              color: theme.messageText,
              letterSpacing: '-0.5px',
            }}>
              Token Savings Formula
            </h2>
            <div style={{
              backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.05)',
              padding: '24px',
              borderRadius: '12px',
              marginBottom: '24px',
              fontFamily: 'monospace',
            }}>
              <div style={{
                fontSize: '18px',
                color: theme.messageText,
                marginBottom: '12px',
                fontWeight: 600,
              }}>
                Token Savings = Text Equivalent - (Vision Tokens + Text Tokens)
              </div>
            </div>

            <h3 style={{
              marginTop: '32px',
              marginBottom: '16px',
              fontSize: '20px',
              fontWeight: 600,
              color: theme.messageText,
            }}>
              Text Equivalent Tokens
            </h3>
            <div style={{
              backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.05)',
              padding: '20px',
              borderRadius: '12px',
              marginBottom: '24px',
              fontFamily: 'monospace',
              fontSize: '15px',
              color: theme.secondaryText,
            }}>
              Text Equivalent = (Total Characters + Overhead) ÷ 4
              <div style={{ marginTop: '8px', fontSize: '13px', opacity: 0.8 }}>
                Overhead = Number of Messages × 10
              </div>
            </div>
            <p style={{
              fontSize: '15px',
              lineHeight: '1.6',
              color: theme.secondaryText,
              marginBottom: '24px',
            }}>
              This represents what it would cost to send all conversation history as text tokens. We estimate ~4 characters per token, plus a small overhead for message formatting.
            </p>

            <h3 style={{
              marginTop: '32px',
              marginBottom: '16px',
              fontSize: '20px',
              fontWeight: 600,
              color: theme.messageText,
            }}>
              Vision Tokens
            </h3>
            <div style={{
              backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.05)',
              padding: '20px',
              borderRadius: '12px',
              marginBottom: '24px',
              fontFamily: 'monospace',
              fontSize: '15px',
              color: theme.secondaryText,
            }}>
              Vision Tokens = Tiles × 258
              <div style={{ marginTop: '8px', fontSize: '13px', opacity: 0.8 }}>
                Tiles = ⌈Width ÷ 768⌉ × ⌈Height ÷ 768⌉
              </div>
            </div>
            <p style={{
              fontSize: '15px',
              lineHeight: '1.6',
              color: theme.secondaryText,
              marginBottom: '24px',
            }}>
              Gemini processes images in 768×768 pixel tiles. Each tile costs 258 tokens. Our system optimizes images to fit in a single horizontal tile (768px wide) to minimize costs. The image height can extend as needed, but each additional 768px of height adds another tile.
            </p>

            <h3 style={{
              marginTop: '32px',
              marginBottom: '16px',
              fontSize: '20px',
              fontWeight: 600,
              color: theme.messageText,
            }}>
              Text Tokens
            </h3>
            <div style={{
              backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.05)',
              padding: '20px',
              borderRadius: '12px',
              marginBottom: '24px',
              fontFamily: 'monospace',
              fontSize: '15px',
              color: theme.secondaryText,
            }}>
              Text Tokens = Prompt Text Length ÷ 4
            </div>
            <p style={{
              fontSize: '15px',
              lineHeight: '1.6',
              color: theme.secondaryText,
              marginBottom: 0,
            }}>
              The tokens used for your current prompt (user message + system instructions). This is the same whether using text or image context.
            </p>
          </div>

          <div style={{
            backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
            padding: '32px',
            borderRadius: '16px',
            marginBottom: '32px',
            border: `1px solid ${theme.inputBorder}`,
          }}>
            <h2 style={{
              marginTop: 0,
              marginBottom: '16px',
              fontSize: '28px',
              fontWeight: 600,
              color: theme.messageText,
              letterSpacing: '-0.5px',
            }}>
              Example Calculation
            </h2>
            <div style={{
              backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.05)',
              padding: '24px',
              borderRadius: '12px',
              marginBottom: '16px',
            }}>
              <div style={{
                fontSize: '15px',
                color: theme.secondaryText,
                marginBottom: '12px',
                lineHeight: '1.8',
              }}>
                <strong style={{ color: theme.messageText }}>Scenario:</strong> 10-message conversation
                <br />
                <strong style={{ color: theme.messageText }}>Text Equivalent:</strong> 3,000 tokens
                <br />
                <strong style={{ color: theme.messageText }}>Vision Tokens:</strong> 516 tokens (2 tiles)
                <br />
                <strong style={{ color: theme.messageText }}>Text Tokens:</strong> 50 tokens
                <br />
                <br />
                <strong style={{ color: theme.accent, fontSize: '17px' }}>Savings = 3,000 - (516 + 50) = 2,434 tokens (81%)</strong>
              </div>
            </div>
            <p style={{
              fontSize: '15px',
              lineHeight: '1.6',
              color: theme.secondaryText,
              marginBottom: 0,
            }}>
              As conversations get longer, the savings increase dramatically. Short conversations (1-3 messages) save 0-30%, while long conversations (10+ messages) can save 60-80%.
            </p>
          </div>

          <div style={{
            backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)',
            padding: '32px',
            borderRadius: '16px',
            marginBottom: '32px',
            border: `1px solid ${theme.inputBorder}`,
          }}>
            <h2 style={{
              marginTop: 0,
              marginBottom: '16px',
              fontSize: '28px',
              fontWeight: 600,
              color: theme.messageText,
              letterSpacing: '-0.5px',
            }}>
              Why Short Conversations Show Low Savings
            </h2>
            <p style={{
              fontSize: '15px',
              lineHeight: '1.7',
              color: theme.secondaryText,
              marginBottom: '16px',
            }}>
              If you're seeing low savings (e.g., 6%), it's likely because your conversations are short. Here's why:
            </p>
            <div style={{
              backgroundColor: isDarkMode ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.05)',
              padding: '20px',
              borderRadius: '12px',
              marginBottom: '16px',
            }}>
              <div style={{
                fontSize: '15px',
                color: theme.secondaryText,
                lineHeight: '1.8',
              }}>
                <strong style={{ color: theme.messageText }}>Short Conversation (2 messages):</strong>
                <br />
                • Text Equivalent: ~400 tokens
                <br />
                • Vision Tokens: 258 tokens (1 tile minimum)
                <br />
                • Text Tokens: ~30 tokens (minimal prompt)
                <br />
                • <strong style={{ color: theme.accent }}>Savings: ~112 tokens (28%)</strong>
                <br />
                <br />
                <strong style={{ color: theme.messageText }}>Long Conversation (10+ messages):</strong>
                <br />
                • Text Equivalent: ~3,000 tokens
                <br />
                • Vision Tokens: 258-516 tokens (1-2 tiles)
                <br />
                • Text Tokens: ~30 tokens
                <br />
                • <strong style={{ color: theme.accent }}>Savings: ~2,400+ tokens (80%+)</strong>
              </div>
            </div>
            <p style={{
              fontSize: '15px',
              lineHeight: '1.7',
              color: theme.secondaryText,
              marginBottom: 0,
            }}>
              <strong style={{ color: theme.messageText }}>Key Insight:</strong> Images cost a minimum of 258 tokens per tile. To see significant savings, you need enough conversation history to justify that fixed cost. The more messages you have, the better the savings ratio becomes!
            </p>
          </div>

          <div style={{
            backgroundColor: isDarkMode ? 'rgba(96, 165, 250, 0.1)' : 'rgba(0, 122, 255, 0.08)',
            padding: '24px',
            borderRadius: '16px',
            marginBottom: '32px',
            border: `1px solid ${isDarkMode ? 'rgba(96, 165, 250, 0.2)' : 'rgba(0, 122, 255, 0.15)'}`,
          }}>
            <h3 style={{
              marginTop: 0,
              marginBottom: '12px',
              fontSize: '20px',
              fontWeight: 600,
              color: theme.accent,
            }}>
              💡 Tips to Increase Savings
            </h3>
            <ul style={{
              fontSize: '15px',
              lineHeight: '1.8',
              color: theme.secondaryText,
              margin: 0,
              paddingLeft: '20px',
            }}>
              <li><strong style={{ color: theme.messageText }}>Have longer conversations:</strong> Continue chatting instead of starting fresh</li>
              <li><strong style={{ color: theme.messageText }}>Build context:</strong> Ask follow-up questions to extend the conversation</li>
              <li><strong style={{ color: theme.messageText }}>Use branches:</strong> Explore different conversation paths from the same context</li>
              <li><strong style={{ color: theme.messageText }}>Monitor progress:</strong> Check analytics to see savings improve as conversations lengthen</li>
            </ul>
          </div>

          <div style={{
            display: 'flex',
            gap: '16px',
            marginTop: '48px',
          }}>
            <button
              onClick={() => {
                setShowHowItWorks(false);
                setShowAnalytics(true);
              }}
              style={{
                padding: '12px 24px',
                backgroundColor: theme.accent,
                color: '#ffffff',
                border: 'none',
                borderRadius: '10px',
            cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 500,
                transition: 'all 0.2s ease',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = '0 6px 16px rgba(0, 0, 0, 0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
              }}
            >
              View Analytics
            </button>
            <button
              onClick={() => setShowHowItWorks(false)}
              style={{
                padding: '12px 24px',
                backgroundColor: 'transparent',
                color: theme.messageText,
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '10px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 500,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = theme.hoverBg;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              Back to Chat
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'flex', 
      flexDirection: 'row', 
      position: 'relative', 
      backgroundColor: theme.containerBg,
      fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
    }}>
      {/* Top Right Controls: Dark Mode, Download, Minimize/Maximize */}
      <div style={{
        position: 'absolute',
        top: '12px',
        right: '12px',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        zIndex: 50,
        flexDirection: 'row',
      }}>
        {/* Dark Mode Toggle */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{
            fontSize: '13px',
            color: theme.secondaryText,
            fontWeight: 500,
          }}>
            {isDarkMode ? 'Dark' : 'Light'}
          </span>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            style={{
              width: '44px',
              height: '24px',
              borderRadius: '12px',
              border: 'none',
              backgroundColor: isDarkMode ? theme.accent : theme.buttonBg,
              cursor: 'pointer',
              position: 'relative',
              transition: 'background-color 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            }}
            title={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            <div style={{
              width: '20px',
              height: '20px',
              borderRadius: '50%',
              backgroundColor: '#ffffff',
              position: 'absolute',
              top: '2px',
              left: isDarkMode ? '22px' : '2px',
              transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
            }} />
          </button>
        </div>

        {/* Download Buttons */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
        }}>
          <button
            onClick={async () => {
              if (treeData.nodes.length === 0) {
                alert('No conversation to download. Start a conversation first.');
                return;
              }
              
              try {
                const response = await fetch('http://localhost:8000/api/download/json', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    session_id: 'default',
                    tree: {
                      session_id: 'default',
                      nodes: treeData.nodes.map(node => ({
                        node_id: node.id,
                        parent_id: node.parentId,
                        prompt: node.prompt,
                        response: node.response,
                        timestamp: typeof node.timestamp === 'string' ? node.timestamp : node.timestamp.toISOString(),
                      })),
                    },
                  }),
                });
                
                if (!response.ok) {
                  throw new Error('Failed to download JSON');
                }
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
                a.download = `conversation_tree_${timestamp}.json`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
              } catch (error) {
                console.error('Error downloading JSON:', error);
                alert('Failed to download JSON. Please try again.');
              }
            }}
            disabled={treeData.nodes.length === 0}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              fontWeight: 500,
              border: `1px solid ${theme.buttonBorder}`,
              backgroundColor: treeData.nodes.length === 0 ? theme.buttonBg : theme.buttonBg,
              color: treeData.nodes.length === 0 ? theme.secondaryText : theme.buttonText,
              borderRadius: '6px',
              cursor: treeData.nodes.length === 0 ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              transition: 'all 0.2s ease',
              opacity: treeData.nodes.length === 0 ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (treeData.nodes.length > 0) {
                e.currentTarget.style.backgroundColor = theme.hoverBg;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.buttonBg;
            }}
            title={treeData.nodes.length === 0 ? 'No conversation to download' : 'Download as JSON'}
          >
            JSON
          </button>
          <button
            onClick={async () => {
              if (treeData.nodes.length === 0) {
                alert('No conversation to download. Start a conversation first.');
                return;
              }
              
              try {
                const response = await fetch('http://localhost:8000/api/download/pdf', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    session_id: 'default',
                    tree: {
                      session_id: 'default',
                      nodes: treeData.nodes.map(node => ({
                        node_id: node.id,
                        parent_id: node.parentId,
                        prompt: node.prompt,
                        response: node.response,
                        timestamp: typeof node.timestamp === 'string' ? node.timestamp : node.timestamp.toISOString(),
                      })),
                    },
                  }),
                });
                
                if (!response.ok) {
                  const errorText = await response.text();
                  throw new Error(errorText || 'Failed to download PDF');
                }
                
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
                a.download = `conversation_tree_${timestamp}.pdf`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
              } catch (error) {
                console.error('Error downloading PDF:', error);
                alert(`Failed to download PDF: ${error instanceof Error ? error.message : 'Unknown error'}. Make sure reportlab is installed: pip install reportlab`);
              }
            }}
            disabled={treeData.nodes.length === 0}
            style={{
              padding: '6px 12px',
              fontSize: '13px',
              fontWeight: 500,
              border: `1px solid ${theme.buttonBorder}`,
              backgroundColor: treeData.nodes.length === 0 ? theme.buttonBg : theme.buttonBg,
              color: treeData.nodes.length === 0 ? theme.secondaryText : theme.buttonText,
              borderRadius: '6px',
              cursor: treeData.nodes.length === 0 ? 'not-allowed' : 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              transition: 'all 0.2s ease',
              opacity: treeData.nodes.length === 0 ? 0.5 : 1,
            }}
            onMouseEnter={(e) => {
              if (treeData.nodes.length > 0) {
                e.currentTarget.style.backgroundColor = theme.hoverBg;
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = theme.buttonBg;
            }}
            title={treeData.nodes.length === 0 ? 'No conversation to download' : 'Download as PDF'}
          >
            PDF
          </button>
        </div>

        {/* Right Panel Minimize/Maximize Toggle */}
        <button
          onClick={() => setIsRightMinimized(!isRightMinimized)}
          style={{
            width: '28px',
            height: '28px',
            padding: '0',
            fontSize: '16px',
            fontWeight: 600,
            border: `1px solid ${theme.buttonBorder}`,
            backgroundColor: theme.buttonBg,
            color: theme.buttonText,
            borderRadius: '6px',
            cursor: 'pointer',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.hoverBg;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = theme.buttonBg;
          }}
          title={isRightMinimized ? 'Show Graph' : 'Hide Graph'}
        >
          {isRightMinimized ? '+' : '−'}
        </button>
      </div>

      {/* Left Side: Chatbot */}
      <div
        style={{
          width: `${actualLeftWidth}%`,
          height: '100vh',
          display: isLeftMinimized ? 'none' : 'flex',
          flexDirection: 'column',
          backgroundColor: theme.chatBg,
          position: 'relative',
        }}
      >
        {/* Top Bar with Buttons - Non-transparent */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '50px',
            backgroundColor: theme.chatBg,
            borderBottom: `1px solid ${theme.divider}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 10px',
            zIndex: 10,
            backdropFilter: 'blur(10px)',
          }}
        >
          {/* Left side buttons group */}
          <div style={{
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
          }}>
            {/* How It Works Button */}
            <button
              onClick={() => setShowHowItWorks(true)}
              style={{
                padding: '8px 14px',
                fontSize: '14px',
                fontWeight: 500,
                border: `1px solid ${theme.inputBorder}`,
                backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
                color: theme.messageText,
                borderRadius: '8px',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = theme.hoverBg;
                e.currentTarget.style.transform = 'translateY(-1px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = isDarkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              How It Works
            </button>

            {/* Analytics Button */}
            <button
              onClick={() => setShowAnalytics(true)}
              style={{
                padding: '8px 14px',
                fontSize: '14px',
                fontWeight: 500,
                border: `1px solid ${theme.buttonBorder}`,
                backgroundColor: theme.buttonBg,
                color: theme.buttonText,
                borderRadius: '8px',
                cursor: 'pointer',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = theme.hoverBg;
                e.currentTarget.style.transform = 'translateY(-1px)';
                e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.15)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = theme.buttonBg;
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
              }}
              title="View Token Analytics"
            >
              📊 Analytics
            </button>
          </div>

          {/* Minimize Button */}
          <button
            onClick={() => setIsLeftMinimized(true)}
            style={{
              width: '28px',
              height: '28px',
              padding: '0',
              fontSize: '16px',
              fontWeight: 600,
              border: `1px solid ${theme.buttonBorder}`,
              backgroundColor: theme.buttonBg,
              color: theme.buttonText,
              borderRadius: '6px',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            −
          </button>
        </div>

        <div
          style={{
            flex: 1,
            padding: '24px',
            paddingTop: '74px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            backgroundColor: theme.chatBg,
            scrollbarWidth: 'thin',
            scrollbarColor: `${theme.scrollbarThumb} ${theme.scrollbarTrack}`,
            position: 'relative',
          }}
          className="chat-messages-container"
        >
          {treeData.nodes.length === 0 && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              gap: '16px',
              color: theme.secondaryText,
            }}>
              <div style={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                background: isDarkMode 
                  ? 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)' 
                  : 'linear-gradient(135deg, #007aff 0%, #0051d5 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '8px',
                boxShadow: theme.shadow,
                animation: 'floatSlow 3s ease-in-out infinite',
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <div style={{
                fontSize: '20px',
                fontWeight: 500,
                color: theme.messageText,
                marginBottom: '8px',
                letterSpacing: '-0.3px',
                minHeight: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
                maxWidth: '500px',
              }}>
                {examplePrompt}
                <span style={{
                  display: 'inline-block',
                  width: '2px',
                  height: '24px',
                  backgroundColor: theme.accent,
                  marginLeft: '4px',
                  animation: 'blink 1s infinite',
                }}></span>
              </div>
              <p style={{ 
                margin: 0, 
                fontSize: '14px', 
                textAlign: 'center', 
                maxWidth: '400px', 
                lineHeight: '1.6', 
                fontWeight: 400,
                color: theme.secondaryText,
                opacity: 0.7,
              }}>
                Type "yes" to ask this question, or type your own
              </p>
            </div>
          )}

          {treeData.nodes
            .filter(node => isNodeInActivePath(node.id, treeData) || node.id === treeData.activeNodeId)
            .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
            .map((node, index, array) => {
              const isLastUserMessage = index === array.length - 1 && node.response === 'Thinking...';
              return (
                <div key={node.id} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-end',
                    alignItems: 'flex-start',
                    gap: '12px',
                    animation: 'fadeIn 0.3s ease-out',
                  }}>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-end',
                      maxWidth: '75%',
                      gap: '4px',
                    }}>
                  <div
                    style={{
                      padding: '12px 16px',
                          background: typeof theme.userMessageBg === 'string' && theme.userMessageBg.includes('gradient')
                            ? theme.userMessageBg
                            : theme.userMessageBg,
                          backgroundColor: typeof theme.userMessageBg === 'string' && !theme.userMessageBg.includes('gradient')
                            ? theme.userMessageBg
                            : undefined,
                          color: theme.userMessageText,
                          borderRadius: '20px 20px 6px 20px',
                          fontSize: '15px',
                      lineHeight: '1.5',
                          wordWrap: 'break-word',
                          whiteSpace: 'pre-wrap',
                          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                          fontWeight: 500,
                          maxWidth: '100%',
                          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
                          backdropFilter: 'blur(10px)',
                    }}
                  >
                    {node.prompt}
                  </div>
                      <div style={{
                        fontSize: '11px',
                        color: theme.secondaryText,
                        paddingRight: '8px',
                        fontWeight: 500,
                        letterSpacing: '0.2px',
                      }}>
                        {new Date(node.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                    </div>
                  </div>

                  <div style={{ 
                    display: 'flex', 
                    justifyContent: 'flex-start',
                    alignItems: 'flex-start',
                    gap: '12px',
                    animation: 'fadeIn 0.3s ease-out',
                  }}>
                    <div style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '12px',
                      background: isDarkMode
                        ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
                        : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '16px',
                      flexShrink: 0,
                      marginTop: '2px',
                      fontWeight: 600,
                      color: '#ffffff',
                      boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
                    }}>
                      AI
                    </div>
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      maxWidth: '75%',
                      gap: '4px',
                    }}>
                  <div
                    style={{
                      padding: '12px 16px',
                      backgroundColor: theme.messageBg,
                      color: theme.messageText,
                          borderRadius: '6px 20px 20px 20px',
                          fontSize: '15px',
                      lineHeight: '1.5',
                          wordWrap: 'break-word',
                          whiteSpace: 'pre-wrap',
                          position: 'relative',
                          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                          fontWeight: 400,
                          maxWidth: '100%',
                          backdropFilter: 'blur(10px)',
                          border: `1px solid ${isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)'}`,
                        }}
                      >
                        {node.response === 'Thinking...' ? (
                          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                            <div style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: theme.accent,
                              animation: 'pulse 1.4s ease-in-out infinite',
                            }} />
                            <div style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: theme.accent,
                              animation: 'pulse 1.4s ease-in-out 0.2s infinite',
                            }} />
                            <div style={{
                              width: '8px',
                              height: '8px',
                              borderRadius: '50%',
                              backgroundColor: theme.accent,
                              animation: 'pulse 1.4s ease-in-out 0.4s infinite',
                            }} />
                            <span style={{ marginLeft: '8px', color: theme.secondaryText }}>Thinking...</span>
                  </div>
                        ) : node.response.startsWith('Error:') ? (
                          <div style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>⚠️</span>
                            <span>{node.response}</span>
                </div>
                        ) : (
                          <div style={{ position: 'relative' }}>
                            <ReactMarkdown
                              components={{
                                p: ({children}) => <p style={{ margin: '0.5em 0', lineHeight: '1.6' }}>{children}</p>,
                                h1: ({children}) => <h1 style={{ fontSize: '1.4em', fontWeight: 600, margin: '0.6em 0 0.3em 0' }}>{children}</h1>,
                                h2: ({children}) => <h2 style={{ fontSize: '1.2em', fontWeight: 600, margin: '0.5em 0 0.3em 0' }}>{children}</h2>,
                                h3: ({children}) => <h3 style={{ fontSize: '1.1em', fontWeight: 600, margin: '0.4em 0 0.2em 0' }}>{children}</h3>,
                                code: ({node, inline, className, children, ...props}: any) => (
                                  <code style={{
                                    backgroundColor: isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
                                    padding: inline ? '2px 6px' : '10px 12px',
                                    borderRadius: '4px',
                                    fontFamily: 'monospace',
                                    fontSize: '0.9em',
                                    display: inline ? 'inline' : 'block',
                                    margin: inline ? '0' : '0.5em 0',
                                    overflowX: 'auto',
                                  }} {...props}>
                                    {children}
                                  </code>
                                ),
                                ul: ({children}) => <ul style={{ margin: '0.5em 0', paddingLeft: '1.5em', listStyleType: 'disc' }}>{children}</ul>,
                                ol: ({children}) => <ol style={{ margin: '0.5em 0', paddingLeft: '1.5em', listStyleType: 'decimal' }}>{children}</ol>,
                                li: ({children}) => <li style={{ margin: '0.2em 0' }}>{children}</li>,
                                blockquote: ({children}) => (
                                  <blockquote style={{
                                    borderLeft: `3px solid ${theme.accent}`,
                                    paddingLeft: '1em',
                                    margin: '0.5em 0',
                                    fontStyle: 'italic',
                                    opacity: 0.9,
                                  }}>
                                    {children}
                                  </blockquote>
                                ),
                                a: ({href, children}) => (
                                  <a href={href} target="_blank" rel="noopener noreferrer" style={{
                                    color: theme.accent,
                                    textDecoration: 'underline',
                                  }}>
                                    {children}
                                  </a>
                                ),
                                strong: ({children}) => <strong style={{ fontWeight: 600 }}>{children}</strong>,
                                em: ({children}) => <em style={{ fontStyle: 'italic' }}>{children}</em>,
                              }}
                            >
                              {streamingResponses.get(node.id) || node.response}
                            </ReactMarkdown>
                            {(streamingResponses.has(node.id) || (node.response === 'Thinking...' && streamingResponses.size > 0)) && (
                              <span style={{
                                display: 'inline-block',
                                width: '2px',
                                height: '18px',
                                backgroundColor: theme.accent,
                                marginLeft: '2px',
                                animation: 'blink 1s infinite',
                                verticalAlign: 'middle',
                              }} />
                            )}
                          </div>
                        )}
              </div>
                      <div style={{
                        fontSize: '11px',
                        color: theme.secondaryText,
                        paddingLeft: '6px',
                        fontWeight: 400,
                      }}>
                        {node.response !== 'Thinking...' && new Date(node.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          <div ref={messagesEndRef} />
        </div>

        <div
          style={{
            padding: '12px 16px 16px 16px',
            backgroundColor: theme.chatBg,
            borderTop: `1px solid ${theme.divider}`,
            backdropFilter: 'blur(20px)',
          }}
        >
          <div 
            id="chat-input-container"
            style={{
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-end',
              backgroundColor: theme.inputBg,
              border: `1.5px solid ${theme.inputBorder}`,
              borderRadius: '24px',
              padding: '8px 14px 8px 18px',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              maxWidth: '100%',
              position: 'relative',
              backdropFilter: 'blur(20px)',
            }}
          >
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendPrompt();
                }
              }}
              onFocus={(e) => {
                const container = e.currentTarget.closest('#chat-input-container') as HTMLElement;
                if (container) {
                  container.style.borderColor = theme.accent;
                  container.style.boxShadow = `0 0 0 3px ${isDarkMode ? 'rgba(96, 165, 250, 0.2)' : 'rgba(0, 122, 255, 0.15)'}`;
                  container.style.backgroundColor = isDarkMode 
                    ? 'rgba(255, 255, 255, 0.15)' 
                    : 'rgba(0, 0, 0, 0.02)';
                  container.style.transform = 'scale(1.01)';
                }
              }}
              onBlur={(e) => {
                const container = e.currentTarget.closest('#chat-input-container') as HTMLElement;
                if (container) {
                  container.style.borderColor = theme.inputBorder;
                  container.style.boxShadow = 'none';
                  container.style.backgroundColor = theme.inputBg;
                  container.style.transform = 'scale(1)';
                }
              }}
              placeholder={treeData.nodes.length === 0 ? "Type your message..." : "Type a message..."}
              rows={1}
              style={{
                flex: 1,
                padding: '2px 0',
                fontSize: '15px',
                border: 'none',
                outline: 'none',
                backgroundColor: 'transparent',
                color: theme.inputText,
                resize: 'none',
                maxHeight: '100px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
                lineHeight: '1.5',
                fontWeight: 400,
              }}
              onInput={(e) => {
                const target = e.target as HTMLTextAreaElement;
                target.style.height = 'auto';
                target.style.height = `${Math.min(target.scrollHeight, 100)}px`;
              }}
            />
            <button
              onClick={handleSendPrompt}
              disabled={!newPrompt.trim() || isLoading}
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '50%',
                border: 'none',
                background: (newPrompt.trim() && !isLoading) 
                  ? (isDarkMode 
                      ? 'linear-gradient(135deg, #60a5fa 0%, #3b82f6 100%)' 
                      : 'linear-gradient(135deg, #007aff 0%, #0051d5 100%)')
                  : 'transparent',
                backgroundColor: (!newPrompt.trim() || isLoading) ? 'transparent' : undefined,
                color: (newPrompt.trim() && !isLoading) ? '#ffffff' : theme.secondaryText,
                cursor: (newPrompt.trim() && !isLoading) ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                flexShrink: 0,
                opacity: (newPrompt.trim() && !isLoading) ? 1 : 0.4,
                boxShadow: (newPrompt.trim() && !isLoading) 
                  ? '0 3px 10px rgba(0, 0, 0, 0.2)' 
                  : 'none',
              }}
              onMouseEnter={(e) => {
                if (newPrompt.trim() && !isLoading) {
                  e.currentTarget.style.transform = 'scale(1.1) rotate(5deg)';
                  e.currentTarget.style.boxShadow = '0 5px 16px rgba(0, 0, 0, 0.3)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'scale(1) rotate(0deg)';
                e.currentTarget.style.boxShadow = (newPrompt.trim() && !isLoading) 
                  ? '0 3px 10px rgba(0, 0, 0, 0.2)' 
                  : 'none';
              }}
              title="Send message"
            >
              {isLoading ? (
                <div style={{
                  width: '16px',
                  height: '16px',
                  border: '2.5px solid currentColor',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"></line>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                </svg>
              )}
            </button>
          </div>
          {treeData.nodes.length > 0 && (
            <div style={{
              marginTop: '8px',
              fontSize: '11px',
              color: theme.secondaryText,
              textAlign: 'center',
              fontWeight: 500,
              letterSpacing: '0.3px',
            }}>
              {treeData.nodes.length} message{treeData.nodes.length !== 1 ? 's' : ''}
              {treeData.activeNodeId && ' • Click nodes to branch'}
          </div>
          )}
        </div>
      </div>

      {/* Resizable Divider */}
      {!isLeftMinimized && !isRightMinimized && (
        <div
          onMouseDown={handleMouseDown}
          style={{
            width: '8px',
            height: '100vh',
            backgroundColor: isDragging ? '#3b82f6' : theme.divider,
            cursor: 'col-resize',
            flexShrink: 0,
            transition: isDragging ? 'none' : 'background-color 0.2s',
            position: 'relative',
            zIndex: 20,
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: '4px',
              height: '40px',
              backgroundColor: isDragging ? '#ffffff' : theme.dividerHandle,
              borderRadius: '2px',
              pointerEvents: 'none',
            }}
          />
        </div>
      )}

      {/* Show Chat Button (when left is minimized) */}
      {isLeftMinimized && (
        <button
          onClick={() => setIsLeftMinimized(false)}
          style={{
            position: 'absolute',
            top: '60px',
            left: '10px',
            width: '28px',
            height: '28px',
            padding: '0',
            fontSize: '16px',
            fontWeight: 600,
            border: '1px solid #3b82f6',
            backgroundColor: '#ffffff',
            color: '#3b82f6',
            borderRadius: '6px',
            cursor: 'pointer',
            zIndex: 30,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          +
        </button>
      )}

      {/* Right Side: Graph */}
      <div
        style={{
          width: `${actualRightWidth}%`,
          height: '100vh',
          display: isRightMinimized ? 'none' : 'flex',
          flexDirection: 'column',
          backgroundColor: theme.graphBg,
          position: 'relative',
          backdropFilter: 'blur(20px)',
        }}
      >
      {/* Search Bar */}
      <div style={{
        padding: '8px 12px',
        paddingRight: '50px',
        borderBottom: `1px solid ${theme.divider}`,
        backgroundColor: theme.graphBg,
        position: 'relative',
        flexShrink: 0,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          maxWidth: '280px',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={theme.secondaryText} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, opacity: 0.6 }}>
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
          <input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '4px 8px',
              fontSize: '11px',
              border: `1px solid ${theme.inputBorder}`,
              borderRadius: '4px',
              backgroundColor: theme.inputBg,
              color: theme.inputText,
              outline: 'none',
              fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
              transition: 'all 0.2s ease',
              height: '24px',
            }}
            onFocus={(e) => {
              e.target.style.borderColor = theme.accent;
              e.target.style.boxShadow = `0 0 0 2px ${isDarkMode ? 'rgba(96, 165, 250, 0.1)' : 'rgba(0, 122, 255, 0.1)'}`;
            }}
            onBlur={(e) => {
              e.target.style.borderColor = theme.inputBorder;
              e.target.style.boxShadow = 'none';
            }}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              style={{
                padding: '2px 6px',
                fontSize: '10px',
                border: 'none',
                borderRadius: '3px',
                backgroundColor: theme.buttonBg,
                color: theme.buttonText,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                flexShrink: 0,
                height: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = theme.hoverBg;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = theme.buttonBg;
              }}
            >
              ×
            </button>
          )}
        </div>
        {searchQuery && (
          <div style={{
            marginTop: '4px',
            fontSize: '10px',
            color: theme.secondaryText,
            paddingLeft: '18px',
          }}>
            {nodes.filter(n => n.data.isHighlighted).length} found
          </div>
        )}
      </div>

      {/* React Flow Canvas */}
      <div 
        style={{ 
          flex: 1, 
          position: 'relative',
          overflow: 'auto',
        }}
        className="react-flow-container"
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onInit={onInit}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-right"
          defaultEdgeOptions={{
            type: 'smoothstep',
            markerEnd: { type: MarkerType.ArrowClosed },
          }}
          minZoom={0.2}
          maxZoom={1.5}
          panOnScroll={true}
          panOnDrag={false}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={true}
          selectionOnDrag={false}
          nodesDraggable={!isGraphLocked}
          nodesConnectable={false}
        >
          <Background 
            color={isDarkMode ? "#2a4569" : "#b3d9ff"} 
            gap={16} 
          />
          <Controls showInteractive={false}>
            <ControlButton 
              onClick={() => setIsGraphLocked(!isGraphLocked)}
              title={isGraphLocked ? 'Locked: Nodes cannot be moved. Click to unlock.' : 'Unlocked: Nodes can be dragged. Click to lock.'}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                width="16"
                height="16"
              >
                {isGraphLocked ? (
                  // Locked icon
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>
                ) : (
                  // Unlocked icon
                  <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6h1.9c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/>
                )}
              </svg>
            </ControlButton>
          </Controls>
          <MiniMap
            nodeColor={(node) => {
              if (node.data.isHighlighted) return isDarkMode ? '#60a5fa' : '#007aff';
              if (node.data.isActive) return isDarkMode ? '#3b82f6' : '#0051d5';
              if (node.data.isInActivePath) return isDarkMode ? '#60a5fa' : '#007aff';
              return isDarkMode ? '#4a6fa5' : '#93c5fd';
            }}
            maskColor={isDarkMode ? "rgba(0, 0, 0, 0.3)" : "rgba(0, 0, 0, 0.1)"}
          />
        </ReactFlow>
      </div>
      </div>

      {/* Custom Delete Confirmation Modal */}
      {nodeToDelete && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
          onClick={() => setNodeToDelete(null)}
        >
          <div
            style={{
              backgroundColor: theme.chatBg,
              borderRadius: '16px',
              padding: '32px',
              maxWidth: '400px',
              width: '90%',
              boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4)',
              border: `1px solid ${theme.divider}`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              marginBottom: '24px',
            }}>
              <div style={{
                fontSize: '24px',
                fontWeight: 600,
                color: theme.messageText,
                marginBottom: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}>
                <span style={{
                  fontSize: '32px',
                }}>⚠️</span>
                Delete Node?
              </div>
              <p style={{
                margin: 0,
                fontSize: '16px',
                lineHeight: '1.6',
                color: theme.secondaryText,
              }}>
                Are you sure you want to delete this node and all its children? This action cannot be undone.
              </p>
            </div>

            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end',
            }}>
              <button
                onClick={() => setNodeToDelete(null)}
                style={{
                  padding: '12px 24px',
                  fontSize: '15px',
                  fontWeight: 500,
                  border: `1px solid ${theme.inputBorder}`,
                  backgroundColor: theme.buttonBg,
                  color: theme.buttonText,
                  borderRadius: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = theme.hoverBg;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = theme.buttonBg;
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  handleDeleteNode(nodeToDelete);
                  setNodeToDelete(null);
                }}
                style={{
                  padding: '12px 24px',
                  fontSize: '15px',
                  fontWeight: 500,
                  border: 'none',
                  backgroundColor: '#ef4444',
                  color: '#ffffff',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  boxShadow: '0 4px 12px rgba(239, 68, 68, 0.3)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#dc2626';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                  e.currentTarget.style.boxShadow = '0 6px 16px rgba(239, 68, 68, 0.4)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = '#ef4444';
                  e.currentTarget.style.transform = 'translateY(0)';
                  e.currentTarget.style.boxShadow = '0 4px 12px rgba(239, 68, 68, 0.3)';
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/*
import { ConversationTreeChatbot } from './Context_Tree';

function App() {
  return <ConversationTreeChatbot />;
}
*/
