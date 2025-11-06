# FlowDoc - Project Context for Claude

## What is FlowDoc?

FlowDoc is a SaaS platform that enables teams to create living documentation of their microservices architecture by combining:
1. **Infrastructure topology** visualization (drag-and-drop canvas)
2. **Detailed use case execution flows** (sequence diagrams)
3. **OpenAPI schema integration** (auto-completion and validation)

Think of it as "Miro + Postman + Architecture docs" in one tool.

## Target Users

- Software Architects
- Senior Engineers
- Platform/DevOps Engineers
- Technical Product Managers
- New team members (onboarding)

## Current Project State

### What's Implemented (Phase 1.1 - Infrastructure Canvas)

✅ **Frontend (React + TypeScript)**
- Full drag-and-drop infrastructure canvas using ReactFlow
- Component palette with 4 types: Services, Databases, Queues, External Systems
- 20+ technology options (REST API, GraphQL, PostgreSQL, Kafka, etc.)
- Component metadata editor (name, owner team, description)
- Workspace/project management (create, switch, save)
- Mock API service with sample data
- Zustand for state management
- TailwindCSS styling
- All TypeScript best practices (proper type imports)

### What's NOT Implemented Yet

❌ **Backend** - No Kotlin/Spring Boot backend yet (using mocks)
❌ **Phase 1.2** - Use Case Flow Builder
❌ **Phase 1.3** - OpenAPI Schema Integration
❌ **Phase 1.4** - Project & Access Management (real auth)
❌ **Phase 1.5** - Search & Navigation

## Tech Stack

### Frontend
- **React 19** with TypeScript
- **Vite** - Build tool
- **ReactFlow** - Canvas/diagram library
- **Zustand** - State management
- **TailwindCSS** - Styling
- **Lucide React** - Icons

### Planned Backend (not implemented)
- Kotlin + Spring Boot
- PostgreSQL (relational data)
- DynamoDB (document storage)
- S3 (schema files)
- ElastiCache Redis (sessions)

## Project Structure

```
/home/user/proschi/
├── .claude/              # Claude context files
│   ├── context.md       # This file
│   ├── PLAN.md          # Full PRD/roadmap
│   └── PROGRESS.md      # What's been completed
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   └── Canvas/
│   │   │       ├── InfrastructureCanvas.tsx    # Main canvas
│   │   │       ├── ComponentNode.tsx           # Node rendering
│   │   │       ├── ComponentPalette.tsx        # Component selector
│   │   │       ├── MetadataEditor.tsx          # Property editor
│   │   │       └── WorkspaceSelector.tsx       # Project switcher
│   │   ├── services/
│   │   │   └── mockApi.ts                      # Mock backend
│   │   ├── store/
│   │   │   └── canvasStore.ts                  # State management
│   │   ├── types/
│   │   │   └── canvas.ts                       # Type definitions
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── package.json
│   └── README.md
└── (backend/ - not created yet)
```

## How to Work with This Project

### Running the Frontend

```bash
cd frontend
npm install
npm run dev
# Server runs at http://localhost:5173/
```

### Code Quality Checks

```bash
cd frontend
npm run lint       # ESLint
npx tsc --noEmit  # TypeScript check
```

### Git Workflow

- Main branch: `main`
- Feature branches: Must start with `claude/` and end with session ID
- Example: `claude/add-feature-011CUqdBpzNkuyQeHY62J8WK`
- Always push to the Claude branch, then merge to main

### Key Files to Know

1. **Type Definitions** (`src/types/canvas.ts`)
   - All TypeScript interfaces for the project
   - ComponentType, TechStack, CanvasNode, Project, etc.

2. **State Management** (`src/store/canvasStore.ts`)
   - Zustand store for canvas state
   - Actions: addNode, deleteNode, updateNodeData, etc.

3. **Mock API** (`src/services/mockApi.ts`)
   - Simulates backend API calls
   - Includes sample e-commerce architecture
   - Has 300ms delays to simulate network latency

4. **Canvas** (`src/components/Canvas/InfrastructureCanvas.tsx`)
   - Main ReactFlow component
   - Handles node clicks, connections, zoom/pan

## Development Principles

1. **Type Safety First**: Use `import type` for type-only imports
2. **No Any Types**: All types must be explicit
3. **Mock Data**: Use mockApi for development (no backend yet)
4. **Component Modularity**: Small, focused components
5. **Separation of Concerns**: State in Zustand, UI in React

## Common Tasks

### Adding a New Component Type

1. Add the type to `ComponentType` in `src/types/canvas.ts`
2. Add tech stacks to `TechStack` type
3. Add to `componentOptions` array in `ComponentPalette.tsx`
4. Add icon/color logic in `ComponentNode.tsx`

### Adding New Canvas Features

1. Update `CanvasStore` interface in `canvasStore.ts`
2. Implement action in Zustand store
3. Use action in React components
4. Update mock API if needed

### Working with ReactFlow

- Nodes have: `id`, `type`, `position`, `data`
- Edges have: `id`, `source`, `target`, `label`
- Use `Handle` components for connection points
- Custom node types defined in `nodeTypes` object

## Important Notes

- ⚠️ **No real backend yet** - Everything uses mocks
- ⚠️ **No authentication** - Not implemented
- ⚠️ **No real persistence** - Data is in-memory
- ⚠️ **ESLint is strict** - Fix all warnings before committing

## Next Steps (Priorities)

1. **Backend Setup**: Create Kotlin + Spring Boot backend
2. **Phase 1.2**: Use Case Flow Builder (sequence diagrams)
3. **Phase 1.3**: OpenAPI Schema Integration
4. **Export Features**: PNG/SVG export
5. **Real Persistence**: Database integration

## Questions?

Refer to:
- `.claude/PLAN.md` - Full PRD with all phases
- `.claude/PROGRESS.md` - What's been completed
- `frontend/README.md` - Frontend-specific documentation
