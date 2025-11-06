# FlowDoc - Infrastructure Canvas (Frontend)

## Overview

This is the frontend implementation of FlowDoc's **Infrastructure Canvas** feature (Phase 1.1 from the PRD). It provides a visual drag-and-drop interface for creating and managing microservices architecture diagrams.

## Features Implemented

### ✅ Infrastructure Canvas
- **Drag-and-drop component builder** - Click technology buttons to add components to the canvas
- **Component Types**:
  - **Services**: REST API, GraphQL, gRPC, WebSocket
  - **Databases**: PostgreSQL, MySQL, MongoDB, Redis, DynamoDB
  - **Message Queues**: Kafka, RabbitMQ, SQS, Redis Queue
  - **External Systems**: Third Party API, Payment Gateway, Auth Service
  - **Text & Annotations**: Text Note, Sticky Note, Comment (NEW ✨)
  - **Grouping**: Logical Group, Network Boundary, Security Zone, Service Group (NEW ✨)
- **Interactive Canvas**:
  - Zoom and pan controls
  - Mini-map for navigation
  - Dotted grid background
  - Connection lines between components
  - Editable edge labels (NEW ✨)
  - Resizable text and group nodes (NEW ✨)

### ✅ Component Metadata Editor
- Click on any component to edit its properties:
  - Name
  - Owner Team
  - Description
  - **For Text Nodes**: Text content, font size (NEW ✨)
  - **For Group Nodes**: Background color, border color, border style (NEW ✨)
- Delete components
- Real-time updates

### ✅ Edge Editor (NEW ✨)
- Click on any connection to edit its properties:
  - Label (e.g., "HTTP POST", "Event", "Query")
  - Delete connections
- Real-time label updates on the canvas

### ✅ Workspace Management
- Switch between projects
- Create new projects
- Save canvas state
- Mock data with sample e-commerce architecture

### ✅ Canvas Operations
- Pan (drag the background)
- Zoom (mouse wheel or controls)
- Connect components (drag from bottom handle to top handle)
- Select and edit components
- Delete connections and nodes

## Tech Stack

- **React 19** + **TypeScript**
- **Vite** - Build tool
- **ReactFlow** - Canvas and diagram library
- **Zustand** - State management
- **TailwindCSS** - Styling
- **Lucide React** - Icons

## Project Structure

```
src/
├── components/
│   └── Canvas/
│       ├── InfrastructureCanvas.tsx   # Main canvas component
│       ├── ComponentNode.tsx          # Custom node rendering
│       ├── TextNode.tsx               # Text/annotation node (NEW)
│       ├── GroupNode.tsx              # Group/boundary node (NEW)
│       ├── ComponentPalette.tsx       # Component selection panel
│       ├── MetadataEditor.tsx         # Node property editor
│       ├── EdgeEditor.tsx             # Connection label editor (NEW)
│       └── WorkspaceSelector.tsx      # Project switcher
├── services/
│   └── mockApi.ts                     # Mock backend API
├── store/
│   └── canvasStore.ts                 # Zustand state management
├── types/
│   └── canvas.ts                      # TypeScript type definitions
├── utils/
│   └── iconMapping.tsx                # Icon and color mappings
├── App.tsx                            # Main app component
└── index.css                          # Global styles
```

## Getting Started

### Prerequisites
- Node.js 18+ and npm

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173/`

### Build for Production

```bash
npm run build
npm run preview
```

## How to Use

### Adding Components
1. Look at the **Component Palette** on the left side
2. Click on any technology button (e.g., "REST API", "PostgreSQL")
3. The component will be added to the canvas

### Editing Components
1. Click on any component on the canvas
2. The **Metadata Editor** panel appears on the right
3. Edit the name, owner team, and description
4. Changes are saved automatically

### Connecting Components
1. Hover over a component to see the connection handles (top and bottom)
2. Click and drag from the bottom handle of one component
3. Drop on the top handle of another component
4. A connection line will be created

### Editing Connections (NEW ✨)
1. Click on any connection line
2. The **Edge Editor** panel appears on the right
3. Add a label (e.g., "HTTP POST", "Publishes event", "Queries data")
4. Click "Delete Connection" to remove it

### Adding Text Notes (NEW ✨)
1. In the Component Palette, find the **Annotations** category
2. Click "Text Note" or "Sticky Note"
3. A yellow sticky note appears on the canvas
4. Click on it to edit the text content and font size
5. Resize by dragging the corners when selected

### Grouping Components (NEW ✨)
1. In the Component Palette, find the **Grouping** category
2. Click a group type (e.g., "Network Boundary", "Security Zone")
3. A large resizable group box appears
4. Click on the group to customize:
   - Background color
   - Border color
   - Border style (solid, dashed, dotted)
5. Resize the group to encompass related components
6. Name it (e.g., "Private Subnet", "Production Environment")

### Managing Projects
1. Use the **Workspace Selector** at the top to switch between projects
2. Click **New** to create a new project
3. Click **Save** to persist your changes (currently saves to in-memory mock)

### Canvas Controls
- **Pan**: Click and drag the background
- **Zoom**: Use mouse wheel or the +/- controls
- **Fit View**: Click the fit-to-screen button in the controls
- **Mini-map**: Use the mini-map in the bottom-right to navigate large diagrams

## Mock Data

The app comes with sample data:
- **E-Commerce Platform**: Pre-populated with 6 components showing a typical microservices architecture
- **Analytics Pipeline**: Empty project ready for new components

## Next Steps

To turn this into a production app:

1. **Backend Integration**:
   - Replace `mockApi.ts` with real REST API calls
   - Add authentication
   - Implement real data persistence

2. **Additional Features** (from PRD Phase 1):
   - Export to PNG/SVG
   - Undo/Redo functionality
   - Advanced search
   - Real-time collaboration

3. **Phase 2 Features**:
   - Use Case Flow Builder (separate canvas)
   - OpenAPI schema integration
   - Flow validation

## Development Notes

- The app uses **mock API calls** with simulated delays to mimic real backend behavior
- All state is managed through **Zustand** for simplicity and performance
- **ReactFlow** handles the canvas rendering, nodes, edges, and interactions
- Component colors are type-specific (blue=service, green=database, purple=queue, orange=external)

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint

## License

Part of the FlowDoc platform - Internal development project
