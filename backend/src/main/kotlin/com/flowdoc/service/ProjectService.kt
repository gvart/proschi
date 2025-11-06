package com.flowdoc.service

import com.flowdoc.dto.*
import com.flowdoc.exception.ResourceNotFoundException
import com.flowdoc.model.*
import com.flowdoc.repository.EdgeRepository
import com.flowdoc.repository.NodeRepository
import com.flowdoc.repository.ProjectRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class ProjectService(
    private val projectRepository: ProjectRepository,
    private val nodeRepository: NodeRepository,
    private val edgeRepository: EdgeRepository
) {

    fun getAllProjects(): List<ProjectListResponse> {
        return projectRepository.findAllOrderByUpdatedAtDesc()
            .map { it.toListResponse() }
    }

    fun getProjectById(id: String): ProjectResponse {
        val project = projectRepository.findById(id)
            .orElseThrow { ResourceNotFoundException("Project not found with id: $id") }
        return project.toResponse()
    }

    fun createProject(request: CreateProjectRequest): ProjectResponse {
        val project = Project(
            name = request.name,
            description = request.description
        )
        val savedProject = projectRepository.save(project)
        return savedProject.toResponse()
    }

    fun updateProject(id: String, request: UpdateProjectRequest): ProjectResponse {
        val project = projectRepository.findById(id)
            .orElseThrow { ResourceNotFoundException("Project not found with id: $id") }

        project.name = request.name
        project.description = request.description

        val updatedProject = projectRepository.save(project)
        return updatedProject.toResponse()
    }

    fun deleteProject(id: String) {
        if (!projectRepository.existsById(id)) {
            throw ResourceNotFoundException("Project not found with id: $id")
        }
        projectRepository.deleteById(id)
    }

    fun updateCanvasState(projectId: String, request: UpdateCanvasStateRequest): ProjectResponse {
        val project = projectRepository.findById(projectId)
            .orElseThrow { ResourceNotFoundException("Project not found with id: $projectId") }

        // Update viewport if provided
        request.viewport?.let {
            project.viewport = Viewport(x = it.x, y = it.y, zoom = it.zoom)
        }

        // Update nodes if provided
        request.nodes?.let { nodeDtos ->
            // Clear existing nodes
            project.nodes.clear()

            // Add new nodes
            nodeDtos.forEach { nodeDto ->
                val node = Node(
                    id = if (nodeDto.id.isBlank()) null else nodeDto.id,
                    type = nodeDto.type,
                    position = Position(x = nodeDto.position.x, y = nodeDto.position.y),
                    componentMetadata = ComponentMetadata(
                        componentId = nodeDto.data.id,
                        name = nodeDto.data.name,
                        componentType = nodeDto.data.type,
                        techStack = nodeDto.data.techStack,
                        ownerTeam = nodeDto.data.ownerTeam,
                        description = nodeDto.data.description,
                        textContent = nodeDto.data.textContent,
                        fontSize = nodeDto.data.fontSize,
                        backgroundColor = nodeDto.data.backgroundColor,
                        borderColor = nodeDto.data.borderColor,
                        borderStyle = nodeDto.data.borderStyle
                    ),
                    project = project
                )
                project.nodes.add(node)
            }
        }

        // Update edges if provided
        request.edges?.let { edgeDtos ->
            // Clear existing edges
            project.edges.clear()

            // Add new edges
            edgeDtos.forEach { edgeDto ->
                val edge = Edge(
                    id = if (edgeDto.id.isBlank()) null else edgeDto.id,
                    source = edgeDto.source,
                    target = edgeDto.target,
                    label = edgeDto.label,
                    labelStyle = null, // TODO: Convert Map to JSON string
                    labelBgStyle = null, // TODO: Convert Map to JSON string
                    project = project
                )
                project.edges.add(edge)
            }
        }

        val updatedProject = projectRepository.save(project)
        return updatedProject.toResponse()
    }

    fun searchProjects(searchTerm: String): List<ProjectListResponse> {
        return projectRepository.searchByName(searchTerm)
            .map { it.toListResponse() }
    }
}
