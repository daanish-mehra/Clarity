/**
 * Conversation Tree Chatbot with React Flow
 * 
 * Each node contains both prompt and response.
 * Editing prompts creates new branches.
 * Sending new prompts creates connected nodes.
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
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


function ConversationNodeComponent({ data }: NodeProps) {
  const { prompt, isActive, isInActivePath, timestamp, branchLabel, isDarkMode } = data;

  const nodeColors = isDarkMode ? {
    nodeBg: '#2f2f2f',
    promptBg: isActive ? '#3d3d3d' : '#353535',
    border: isActive ? '#3b82f6' : isInActivePath ? '#60a5fa' : '#4a4a4a',
    borderColor: '#4a4a4a',
    textColor: '#ececec',
  } : {
    nodeBg: '#ffffff',
    promptBg: isActive ? '#eff6ff' : '#f8fafc',
    border: isActive ? '#3b82f6' : isInActivePath ? '#60a5fa' : '#cbd5e1',
    borderColor: '#e2e8f0',
    textColor: '#1e293b',
  };

  return (
    <div
      style={{
        borderRadius: '12px',
        border: `2px solid ${nodeColors.border}`,
        backgroundColor: nodeColors.nodeBg,
        boxShadow: isActive ? '0 4px 16px rgba(59, 130, 246, 0.3)' : '0 2px 8px rgba(0,0,0,0.1)',
        overflow: 'hidden',
      }}
    >
      <Handle type="target" position={Position.Top} />
      
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
              color: '#3b82f6',
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
        
        <div style={{ fontSize: '11px', color: isDarkMode ? '#8a8a8a' : '#94a3b8', marginTop: '12px' }}>
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
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [streamingResponses, setStreamingResponses] = useState<Map<string, string>>(new Map());

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

  useEffect(() => {
    const { nodes: layoutedNodes, edges: layoutedEdges } = layoutNodes(treeData);
    const nodesWithTheme = layoutedNodes.map(node => ({
      ...node,
      data: {
        ...node.data,
        isDarkMode,
      },
    }));
    setNodes(nodesWithTheme);
    setEdges(layoutedEdges);
  }, [treeData, isDarkMode]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [treeData.nodes.length, treeData.activeNodeId]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setTreeData((prev) => ({
      ...prev,
      activeNodeId: node.id,
    }));
    focusNode(node.id);
  }, [focusNode]);

  const handleSendPrompt = useCallback(async () => {
    if (!newPrompt.trim() || isLoading) return;

    const promptText = newPrompt.trim();
    setNewPrompt('');
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
  }, [newPrompt, treeData.activeNodeId, treeData.nodes, focusNode, isLoading]);

  const actualLeftWidth = isLeftMinimized ? 0 : isRightMinimized ? 100 : leftWidth;
  const actualRightWidth = isRightMinimized ? 0 : isLeftMinimized ? 100 : (100 - leftWidth);

  const theme = isDarkMode ? {
    chatBg: '#121212',
    graphBg: '#181818',
    containerBg: '#000000',
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
    scrollbarTrack: '#181818',
    scrollbarThumb: '#404040',
    accent: '#60a5fa',
    shadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
  } : {
    chatBg: '#ffffff',
    graphBg: '#fafafa',
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
    scrollbarTrack: '#f5f5f5',
    scrollbarThumb: '#d1d1d1',
    accent: '#007aff',
    shadow: '0 4px 24px rgba(0, 0, 0, 0.08)',
  };

  if (showAnalytics) {
    return (
      <TokenAnalytics
        sessionId="default"
        isDarkMode={isDarkMode}
        onClose={() => setShowAnalytics(false)}
      />
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
      {/* Top Bar */}
      <div style={{
        position: 'absolute',
        top: '12px',
        right: '12px',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        zIndex: 50,
      }}>
        {/* Theme Toggle Switch */}
        {!isRightMinimized && (
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
        )}
        {/* Analytics Button */}
        <button
          onClick={() => setShowAnalytics(true)}
          style={{
            padding: '8px 16px',
            fontSize: '14px',
            fontWeight: 500,
            border: `1px solid ${theme.buttonBorder}`,
            backgroundColor: theme.buttonBg,
            color: theme.buttonText,
            borderRadius: '20px',
            cursor: 'pointer',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            transition: 'all 0.2s',
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
        {/* Minimize Button */}
        <button
          onClick={() => setIsLeftMinimized(true)}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            width: '28px',
            height: '28px',
            padding: '0',
            fontSize: '16px',
            fontWeight: 600,
            border: '1px solid #cbd5e1',
            backgroundColor: '#ffffff',
            color: '#64748b',
            borderRadius: '6px',
            cursor: 'pointer',
            zIndex: 10,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          −
        </button>

        <div
          style={{
            flex: 1,
            padding: '24px',
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
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
              </div>
              <h2 style={{ 
                margin: 0, 
                fontSize: '24px', 
                fontWeight: 600, 
                color: theme.messageText, 
                letterSpacing: '-0.5px',
                fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif',
              }}>
                Start a conversation
              </h2>
              <p style={{ 
                margin: 0, 
                fontSize: '15px', 
                textAlign: 'center', 
                maxWidth: '400px', 
                lineHeight: '1.6', 
                fontWeight: 400,
                color: theme.secondaryText,
              }}>
                Ask me anything, and I'll help you explore different conversation paths
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
                          <span>
                            {streamingResponses.get(node.id) || node.response}
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
                          </span>
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
              placeholder={treeData.nodes.length === 0 ? "Ask Arnav" : "Type a message..."}
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
            top: '10px',
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
        {/* Minimize Button */}
        <button
          onClick={() => setIsRightMinimized(true)}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            width: '28px',
            height: '28px',
            padding: '0',
            fontSize: '16px',
            fontWeight: 600,
            border: '1px solid #cbd5e1',
            backgroundColor: '#ffffff',
            color: '#64748b',
            borderRadius: '6px',
            cursor: 'pointer',
            zIndex: 10,
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          −
        </button>

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
          selectionOnDrag={false}
        >
          <Background color="#94a3b8" gap={16} />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              if (node.data.isActive) return '#3b82f6';
              if (node.data.isInActivePath) return '#60a5fa';
              return '#93c5fd';
            }}
            maskColor="rgba(0, 0, 0, 0.1)"
          />
        </ReactFlow>
      </div>
      </div>

      {/* Show Graph Button (when right is minimized) */}
      {isRightMinimized && (
        <button
          onClick={() => setIsRightMinimized(false)}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
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
    </div>
  );
}


/*
import { ConversationTreeChatbot } from './Context_Tree';

function App() {
  return <ConversationTreeChatbot />;
}
*/
