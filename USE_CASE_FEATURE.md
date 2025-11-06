# Use Case Builder Feature

## Overview

The Use Case Builder allows you to define step-by-step flows showing how requests travel through your architecture from service to service. You can then play back these flows with animated visualizations.

## User Flow

1. **Open Project** - Start by opening an existing project with defined architecture
2. **Define Architecture** - Create your architecture diagram with services, databases, etc.
3. **Define Use Cases** - Switch to "Use Cases" mode to create and manage use cases
4. **Playback** - Visualize the flow with animated playback showing request/response at each step

## Features

### Use Case List View
- View all use cases for the current project
- Create new use cases with name and description
- Edit or delete existing use cases
- Quick access to playback mode

### Use Case Editor
- Add steps to define the request flow
- Each step includes:
  - **Step Name** - Descriptive name for the step
  - **From/To Services** - Select source and target services from your architecture
  - **HTTP Method** - GET, POST, PUT, PATCH, DELETE
  - **Endpoint** - API endpoint path
  - **Request Data** - With format selection (JSON, XML, Free Text)
  - **Response Data** - With format selection and status code
  - **Description** - Optional step description
- Reorder steps with move up/down buttons
- Visual step cards showing all details

### Playback Viewer
- **Read-only Architecture View** - Shows your architecture in non-editable mode
- **Animated Flow** - Moving dot travels along edges between services
- **Node Highlighting** - Active services are highlighted during playback
- **Step Information Panel** - Shows current step details, request/response data
- **Playback Controls**:
  - Play/Pause - Auto-play through all steps
  - Step Forward/Back - Navigate one step at a time
  - Skip to Start/End - Jump to beginning or end
  - Progress Bar - Visual progress indicator
- **Tooltips** - Hover over the animated dot to see step information

## Backend API

### Use Case Endpoints

```
GET    /projects/{projectId}/use-cases       - List all use cases for a project
POST   /projects/{projectId}/use-cases       - Create a new use case
GET    /use-cases/{useCaseId}                - Get use case details with steps
PUT    /use-cases/{useCaseId}                - Update use case metadata
DELETE /use-cases/{useCaseId}                - Delete a use case
```

### Flow Step Endpoints

```
POST   /use-cases/{useCaseId}/steps          - Add a new step
PUT    /use-cases/{useCaseId}/steps/{stepId} - Update an existing step
DELETE /use-cases/{useCaseId}/steps/{stepId} - Delete a step
```

## Data Model

### UseCase
```kotlin
{
  id: string
  name: string
  description?: string
  entryServiceId?: string
  projectId: string
  steps: FlowStep[]
  createdAt: timestamp
  updatedAt: timestamp
}
```

### FlowStep
```kotlin
{
  id: string
  stepOrder: int
  stepName: string
  fromServiceId: string
  toServiceId: string
  httpMethod: string
  endpoint: string
  requestFormat: "JSON" | "XML" | "FREE_TEXT"
  requestBody?: string
  responseFormat: "JSON" | "XML" | "FREE_TEXT"
  responseBody?: string
  statusCode?: int
  description?: string
  isParallel: boolean
  isConditional: boolean
  conditionExpression?: string
}
```

## Frontend Components

### UseCaseListView
- Main view for browsing and managing use cases
- Location: `frontend/src/components/UseCases/UseCaseListView.tsx`

### UseCaseEditor
- Step-by-step editor for building use case flows
- Location: `frontend/src/components/UseCases/UseCaseEditor.tsx`

### UseCasePlayback
- Animated playback viewer with controls
- Location: `frontend/src/components/UseCases/UseCasePlayback.tsx`

## Navigation

The application now supports three view modes accessible via the top navigation bar:

1. **Architecture** - Design your system architecture
2. **Use Cases** - Define and edit use case flows
3. **Playback** - Animated visualization (accessed via Play button)

## Configuration

Frontend environment variable:
```
VITE_API_URL=http://localhost:8080
```

Set this in `frontend/.env` to configure the backend API URL.

## Future Enhancements

- Schema selection from OpenAPI definitions for request/response
- Parallel and conditional step execution
- Export use cases as documentation
- Import use cases from API specs
- Timing and performance metrics
- Error scenario flows
- Collaboration features
