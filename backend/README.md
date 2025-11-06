# FlowDoc Backend

Kotlin Spring Boot backend for the FlowDoc platform.

## Tech Stack

- **Kotlin 2.0.21** - Programming language
- **Spring Boot 3.4.0** - Application framework
- **Gradle 8.11+** - Build tool
- **Java 21** - Runtime (LTS)
- **PostgreSQL** - Primary database
- **Spring Data JPA** - Data access layer

## Project Structure

```
backend/
├── src/
│   ├── main/
│   │   ├── kotlin/
│   │   │   └── com/flowdoc/
│   │   │       ├── FlowDocApplication.kt    # Main application
│   │   │       ├── config/                  # Configuration classes
│   │   │       ├── controller/              # REST controllers
│   │   │       ├── service/                 # Business logic
│   │   │       ├── repository/              # Data access
│   │   │       ├── model/                   # Domain entities
│   │   │       ├── dto/                     # Data transfer objects
│   │   │       └── exception/               # Custom exceptions
│   │   └── resources/
│   │       ├── application.yml              # Main configuration
│   │       ├── application-dev.yml          # Development config
│   │       └── application-prod.yml         # Production config
│   └── test/
│       └── kotlin/                          # Test files
├── build.gradle.kts                         # Gradle build configuration
├── settings.gradle.kts                      # Gradle settings
├── gradlew                                  # Gradle wrapper (Unix)
├── gradlew.bat                              # Gradle wrapper (Windows)
└── .gitignore                               # Git ignore rules

```

## Prerequisites

- Java 21 (JDK)
- PostgreSQL 14+ (for development)

## Setup

### 1. Install Java 21

Ensure you have Java 21 installed:

```bash
java -version
```

### 2. Setup PostgreSQL

Create a development database:

```sql
CREATE DATABASE flowdoc_dev;
CREATE USER flowdoc WITH PASSWORD 'flowdoc';
GRANT ALL PRIVILEGES ON DATABASE flowdoc_dev TO flowdoc;
```

### 3. Configure Application

The default configuration in `application.yml` expects PostgreSQL running on `localhost:5432`.

For custom configuration, create `application-local.yml` (already in .gitignore):

```yaml
spring:
  datasource:
    url: jdbc:postgresql://localhost:5432/your_database
    username: your_username
    password: your_password
```

## Running the Application

### Development Mode with Docker Compose

The application now uses Spring Boot Docker Compose support to automatically manage PostgreSQL, Redis, and pgAdmin containers.

```bash
# Using Gradle wrapper (recommended)
# This will automatically start the required Docker containers
./gradlew bootRun

# Or with a specific profile
./gradlew bootRun --args='--spring.profiles.active=dev'
```

The application will start on `http://localhost:8080/api`

Docker containers will be available at:
- **PostgreSQL**: `localhost:5432` (user: flowdoc, password: flowdoc, database: flowdoc_dev)
- **Redis**: `localhost:6379`
- **pgAdmin**: `http://localhost:5050` (user: admin@flowdoc.com, password: admin)

### Manual Docker Compose

You can also manually manage the containers:

```bash
# Start containers
docker compose up -d

# Stop containers
docker compose down

# View logs
docker compose logs -f

# Rebuild containers
docker compose up -d --build
```

### Build

```bash
# Build without tests
./gradlew build -x test

# Build with tests
./gradlew build
```

### Run Tests

```bash
./gradlew test
```

## API Endpoints

### Health Check

```
GET /api/health
```

Response:
```json
{
  "status": "UP",
  "timestamp": "2025-11-06T17:00:00",
  "application": "FlowDoc Backend",
  "version": "0.0.1-SNAPSHOT"
}
```

### Projects

#### Get All Projects
```
GET /api/projects
```

#### Get Project by ID
```
GET /api/projects/{id}
```

#### Create Project
```
POST /api/projects
Content-Type: application/json

{
  "name": "My Project",
  "description": "Project description"
}
```

#### Update Project
```
PUT /api/projects/{id}
Content-Type: application/json

{
  "name": "Updated Project",
  "description": "Updated description"
}
```

#### Delete Project
```
DELETE /api/projects/{id}
```

#### Update Canvas State
```
PATCH /api/projects/{id}/canvas-state
Content-Type: application/json

{
  "nodes": [...],
  "edges": [...],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

#### Search Projects
```
GET /api/projects/search?q=keyword
```

### Nodes

#### Get All Nodes for Project
```
GET /api/projects/{projectId}/nodes
```

#### Get Node by ID
```
GET /api/projects/{projectId}/nodes/{nodeId}
```

#### Create Node
```
POST /api/projects/{projectId}/nodes
Content-Type: application/json

{
  "type": "componentNode",
  "position": { "x": 100, "y": 100 },
  "data": {
    "id": "node-1",
    "name": "PostgreSQL",
    "type": "database",
    "techStack": "PostgreSQL",
    "description": "Main database"
  }
}
```

#### Update Node
```
PUT /api/projects/{projectId}/nodes/{nodeId}
Content-Type: application/json

{
  "position": { "x": 150, "y": 150 }
}
```

#### Delete Node
```
DELETE /api/projects/{projectId}/nodes/{nodeId}
```

### Edges

#### Get All Edges for Project
```
GET /api/projects/{projectId}/edges
```

#### Get Edge by ID
```
GET /api/projects/{projectId}/edges/{edgeId}
```

#### Create Edge
```
POST /api/projects/{projectId}/edges
Content-Type: application/json

{
  "source": "node-1",
  "target": "node-2",
  "label": "HTTP"
}
```

#### Update Edge
```
PUT /api/projects/{projectId}/edges/{edgeId}
Content-Type: application/json

{
  "label": "gRPC"
}
```

#### Delete Edge
```
DELETE /api/projects/{projectId}/edges/{edgeId}
```

## Environment Profiles

- **default** - Base configuration
- **dev** - Development (creates/drops tables, verbose logging)
- **prod** - Production (validates schema, minimal logging)

Activate a profile:
```bash
./gradlew bootRun --args='--spring.profiles.active=dev'
```

## Database Configuration

### Development
- Uses `create-drop` for schema (resets on restart)
- SQL logging enabled
- Local PostgreSQL on port 5432

### Production
- Uses `validate` for schema (requires migrations)
- SQL logging disabled
- Configuration via environment variables

## Development Tips

### IDE Setup

**IntelliJ IDEA** (recommended):
1. Open the `backend` folder as a project
2. IDEA will auto-detect Gradle and import dependencies
3. Enable Kotlin plugin
4. Right-click `FlowDocApplication.kt` > Run

**VS Code**:
1. Install "Extension Pack for Java"
2. Install "Kotlin Language"
3. Run: `./gradlew bootRun`

### Hot Reload

Spring Boot DevTools is included for automatic restarts during development.

### Database Migrations

For production deployments, use Flyway or Liquibase for schema migrations (to be added).

## Troubleshooting

### Port Already in Use

Change the port in `application.yml`:
```yaml
server:
  port: 8081
```

### PostgreSQL Connection Failed

1. Verify PostgreSQL is running: `pg_isready`
2. Check connection details in `application.yml`
3. Ensure the database exists: `psql -l`

### Gradle Build Failed

```bash
# Clean build
./gradlew clean build

# Refresh dependencies
./gradlew build --refresh-dependencies
```

## Next Steps

1. Implement domain models (Project, Service, UseCase, etc.)
2. Create JPA repositories
3. Build REST controllers for CRUD operations
4. Add authentication/authorization
5. Integrate with DynamoDB for canvas state
6. Add S3 integration for OpenAPI schemas

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Run tests: `./gradlew test`
4. Run linting: `./gradlew ktlintCheck`
5. Submit a pull request

## License

Proprietary - All rights reserved
