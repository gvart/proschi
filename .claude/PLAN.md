# FlowDoc - Product Development Plan

## Product Vision

A SaaS platform that enables teams to create living documentation of their microservices architecture by combining infrastructure topology with detailed use case execution flows, bridged with OpenAPI schema integration.

## Value Proposition

Unlike static documentation or code-only approaches, FlowDoc provides:
- **Visual Infrastructure Map**: Clear topology of services, databases, queues
- **Executable Flow Documentation**: Step-by-step visualization of how data flows through the system
- **Schema-Driven Accuracy**: OpenAPI integration keeps flows aligned with actual APIs
- **Living Documentation**: Easy to maintain, actually gets used

---

## Phase 1: MVP (3-4 months)

### 1.1 Infrastructure Canvas ✅ COMPLETED

**Goal**: Visual service topology builder

**Features**:
- ✅ Drag-and-drop interface for adding components:
  - Services (REST APIs, GraphQL, gRPC)
  - Data stores (Databases, Caches)
  - Message queues (Kafka, SQS, RabbitMQ)
  - External systems
- ✅ Connection lines showing relationships
- ✅ Component metadata (name, tech stack, owner team)
- ✅ Workspace management (create/delete/rename)
- ✅ Basic canvas operations (zoom, pan, undo/redo)

**Technical Requirements**:
- ✅ Canvas library: ReactFlow
- ✅ Real-time canvas state persistence (mock)
- ⏳ Export to PNG/SVG (not implemented yet)

### 1.2 Use Case Flow Builder

**Goal**: Define and visualize service interaction flows

**Features**:
- Create named use cases (e.g., "order_placed", "user_login")
- Select entry point service
- Add sequential steps:
  - Service A → Service B (HTTP request)
  - Service → Database (query/write)
  - Service → Queue (publish)
  - Queue → Service (consume)
- Define request/response for each step:
  - HTTP method, endpoint path
  - Request body (JSON editor)
  - Response body/status codes
- Visual flow representation:
  - Sequence diagram style
  - Numbered steps
  - Success/error paths
- Step timing/sequencing (sequential vs parallel)

**Technical Requirements**:
- Flow visualization library (sequence diagrams)
- JSON editor with syntax highlighting
- Flow validation logic

### 1.3 OpenAPI Schema Integration

**Goal**: Import and leverage existing API contracts

**Features**:
- Upload OpenAPI 3.x YAML/JSON files
- Associate OpenAPI spec with a service component
- Auto-complete endpoints when building flows:
  - Select from available endpoints
  - Pre-populate request/response schemas
- Schema validation:
  - Validate flow requests against schemas
  - Highlight mismatches
- Multi-version support (track API versions)

**Technical Requirements**:
- OpenAPI parser (swagger-parser or similar)
- Schema validation engine
- Diff detection for schema changes

### 1.4 Project & Access Management

**Goal**: Multi-tenant workspace with team collaboration

**Features**:
- Projects (workspaces) for different systems/products
- Role-based access:
  - Owner: full access
  - Editor: can modify infra/flows
  - Viewer: read-only
- Invite team members via email
- Project-level settings

**Technical Requirements**:
- Multi-tenant data isolation
- JWT-based authentication
- Email service integration

### 1.5 Basic Search & Navigation

**Goal**: Find flows and components quickly

**Features**:
- Search across:
  - Service names
  - Use case names
  - Endpoints
- Filter flows by service
- Quick navigation sidebar

---

## Phase 2: Enhancement (3-6 months post-MVP)

### 2.1 Advanced Flow Features
- Conditional branching (if/else logic)
- Loop iterations
- Parallel execution visualization
- Timeouts and retries
- Error handling paths
- Variables and data transformation

### 2.2 Collaboration Features
- Real-time collaborative editing (multiplayer)
- Comments and annotations on flows
- Change history and versioning
- Flow approval workflow

### 2.3 Documentation Export
- Generate Markdown documentation from flows
- PDF export with embedded diagrams
- Confluence/Notion integration
- Public documentation URLs (read-only)

### 2.4 Schema Management
- Centralized schema registry
- Track schema evolution over time
- Breaking change detection
- Schema diff viewer

### 2.5 Integration Ecosystem
- GitHub integration (import schemas from repos)
- Slack notifications (flow changes)
- Webhook support for CI/CD
- API for programmatic access

---

## Phase 3: Advanced (6-12 months post-MVP)

### 3.1 Test Case Generation
- Export flows as API test suites
- Generate Postman collections
- Integration with testing frameworks

### 3.2 Impact Analysis
- "What breaks if I change this endpoint?"
- Dependency graph visualization
- Affected flows when schema changes

### 3.3 Performance Insights
- Add expected latency to each step
- Calculate total flow duration
- Bottleneck identification

### 3.4 Auto-Generation Hints
- Suggest flows based on OpenAPI specs
- ML-based flow recommendations
- Template library for common patterns

---

## Technical Architecture

### Frontend Stack
- React 19 + TypeScript ✅
- Vite build tool ✅
- ReactFlow for canvas ✅
- Zustand for state management ✅
- TailwindCSS for styling ✅
- Lucide React for icons ✅
- Monaco Editor for JSON/YAML editing (Phase 1.2)
- WebSocket for real-time collaboration (Phase 2.2)

### Backend Stack (Not Implemented)
- Kotlin + Spring Boot (REST API)
- PostgreSQL (relational data: users, projects, access control)
- DynamoDB (document storage: canvas state, flows)
- S3 (OpenAPI schema files)
- ElastiCache Redis (session management, real-time state)
- AWS Lambda (schema parsing, validation jobs)

### AWS Infrastructure (Not Implemented)
- ECS/Fargate for backend services
- CloudFront + S3 for static frontend hosting
- API Gateway
- Cognito for authentication
- CloudWatch for logging/monitoring
- RDS PostgreSQL with read replicas
- Route53 for DNS management

### Data Model

**PostgreSQL** (Relational):
```sql
users (id, email, name, created_at)
projects (id, name, owner_user_id, created_at)
project_members (project_id, user_id, role)
services (id, project_id, name, type, metadata)
openapi_schemas (id, service_id, version, s3_key)
```

**DynamoDB** (Document):
```
canvas_state (project_id, nodes, edges, viewport)
use_cases (project_id, use_case_id, name, entry_service_id, steps[])
flow_steps (use_case_id, step_id, from_service, to_service, request, response)
```

### API Structure

```
# Authentication
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout

# Projects
GET /api/projects
POST /api/projects
GET /api/projects/{id}
PUT /api/projects/{id}
DELETE /api/projects/{id}
POST /api/projects/{id}/members

# Services (Infrastructure)
GET /api/projects/{projectId}/services
POST /api/projects/{projectId}/services
PUT /api/services/{id}
DELETE /api/services/{id}

# Canvas
GET /api/projects/{projectId}/canvas
PUT /api/projects/{projectId}/canvas

# Use Cases
GET /api/projects/{projectId}/use-cases
POST /api/projects/{projectId}/use-cases
GET /api/use-cases/{id}
PUT /api/use-cases/{id}
DELETE /api/use-cases/{id}

# OpenAPI Schemas
POST /api/services/{serviceId}/schemas (upload)
GET /api/services/{serviceId}/schemas
GET /api/schemas/{id}
POST /api/schemas/{id}/validate (validate flow against schema)
```

---

## Monetization Strategy

### Pricing Tiers

**Free Tier**:
- 1 project
- Up to 5 services
- Up to 10 use cases
- 3 team members
- Community support

**Professional** ($29/user/month):
- Unlimited projects
- Unlimited services
- Unlimited use cases
- Unlimited team members
- OpenAPI integration
- Export to PNG/SVG
- Email support

**Enterprise** ($99/user/month):
- Everything in Professional
- Real-time collaboration
- Advanced access controls
- SSO/SAML integration
- Audit logs
- SLA guarantee
- Priority support
- On-premise option (future)

---

## Target Market

- Tech companies with 10-200 engineers
- Companies with microservices architecture
- Organizations struggling with documentation
- Fast-growing startups scaling their architecture

---

## Development Timeline

### Months 1-2: Foundation ✅ DONE
- ✅ Set up AWS infrastructure (skipped for now - using mocks)
- ✅ Build authentication system (mocked)
- ✅ Implement basic project management
- ✅ Create infrastructure canvas (drag-and-drop)

### Months 3-4: Core Features (CURRENT)
- ⏳ Use case flow builder
- ⏳ OpenAPI schema upload
- ⏳ Schema-driven flow creation
- ⏳ Request/response editor

### Month 5: Polish & Beta
- ⏳ Search and navigation
- ⏳ Export features
- ⏳ Bug fixes and performance optimization
- ⏳ Closed beta with 10-20 companies

### Month 6: Launch
- ⏳ Public launch
- ⏳ Marketing push
- ⏳ Pricing page live
- ⏳ Payment integration (Stripe)

---

## Success Metrics

- User signups
- Activation rate (users who create their first flow)
- Free to paid conversion
- Monthly recurring revenue (MRR)
- Churn rate
- NPS (Net Promoter Score)

---

## Risk Assessment

### Technical Risks
- **Canvas performance**: Large diagrams may lag
  - Mitigation: Virtualization, lazy loading, WebGL rendering
- **Real-time collaboration complexity**: Operational transform is hard
  - Mitigation: Use proven libraries (Yjs, CRDT)
- **Schema parsing edge cases**: OpenAPI specs vary wildly
  - Mitigation: Support common patterns first, expand gradually

### Business Risks
- **Competition**: Similar tools exist (Swagger, Postman, Miro)
  - Mitigation: Focus on unique combination of infra + flows + schemas
- **Market fit**: Will teams pay for this?
  - Mitigation: Early validation with potential customers
- **Adoption**: Documentation tools require behavior change
  - Mitigation: Make it so useful that teams want to use it
