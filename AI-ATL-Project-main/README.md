# Conversation Tree Chatbot

A React-based application that visualizes conversations as an interactive tree graph, allowing users to create and navigate branching conversation paths.

## What It Does

This application provides a split-screen interface with:
- **Left Panel**: Traditional chat interface for sending messages
- **Right Panel**: Visual tree showing all conversation branches

When you send a message, it creates a node in the tree. You can click any previous node and send a new message from that point, creating a branch. This allows exploring multiple conversation paths without losing any context.

## Code Structure

### Main Components

**`main.tsx`** - Entry point that renders the React app

**`App.tsx`** - Simple wrapper component that renders the main chatbot

**`Context_Trees.tsx`** - Main application containing:
- Conversation state management (nodes, active path)
- Tree layout algorithm that positions nodes and prevents overlaps
- Custom React Flow node component for rendering messages
- Chat interface with input/send functionality
- Resizable panels with dark/light theme support

**`custom_scrollbar.css`** - Custom scrollbar styling for the tree view

### Key Data Structure

```typescript
interface ConversationNode {
  id: string;              // Unique identifier
  parentId: string | null; // Links to parent node (null for root)
  prompt: string;          // User's message
  response: string;        // Bot's response (currently hardcoded)
  timestamp: Date;         // Creation time
}
```

### How the Tree Layout Works

1. **Root node** starts at position (0, 0)
2. **First child** of any node continues straight down (same X position)
3. **Additional children** create branches to the right
4. **Position locking**: Once placed, nodes never move
5. **Collision prevention**: If nodes would overlap, existing branches shift right automatically
6. **Branch grouping**: When a node moves, its entire subtree moves with it

The layout algorithm in `layoutNodes()` processes nodes in chronological order, calculating positions and ensuring no overlaps.

### State Management

- `treeData`: Stores all conversation nodes and tracks active node
- `nodes`/`edges`: React Flow visualization data (positions, connections)
- Panel states: Width, minimization, theme, drag handling

### User Interactions

- **Send message**: Creates new node connected to currently active node
- **Click node**: Switches active branch, updates chat view to show that path
- **Drag divider**: Resizes left/right panels
- **Theme toggle**: Switches between dark and light modes

## Tech Stack

- **React 19.2.0** - UI framework
- **TypeScript 5.9.3** - Type safety
- **React Flow 11.11.4** - Interactive node graph visualization
- **Vite 7.2.2** - Build tool and dev server

## Running the App

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173` (typically)
