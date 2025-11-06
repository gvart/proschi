package com.flowdoc.service

import com.flowdoc.dto.*
import com.flowdoc.exception.ResourceNotFoundException
import com.flowdoc.model.ComponentMetadata
import com.flowdoc.model.Node
import com.flowdoc.model.Position
import com.flowdoc.repository.NodeRepository
import com.flowdoc.repository.ProjectRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class NodeService(
    private val nodeRepository: NodeRepository,
    private val projectRepository: ProjectRepository
) {

    fun getNodesByProjectId(projectId: String): List<NodeDto> {
        if (!projectRepository.existsById(projectId)) {
            throw ResourceNotFoundException("Project not found with id: $projectId")
        }
        return nodeRepository.findByProjectId(projectId).map { it.toDto() }
    }

    fun getNodeById(projectId: String, nodeId: String): NodeDto {
        val node = nodeRepository.findById(nodeId)
            .orElseThrow { ResourceNotFoundException("Node not found with id: $nodeId") }

        if (node.project?.id != projectId) {
            throw ResourceNotFoundException("Node not found in project: $projectId")
        }

        return node.toDto()
    }

    fun createNode(projectId: String, request: CreateNodeRequest): NodeDto {
        val project = projectRepository.findById(projectId)
            .orElseThrow { ResourceNotFoundException("Project not found with id: $projectId") }

        val node = Node(
            type = request.type,
            position = Position(x = request.position.x, y = request.position.y),
            componentMetadata = ComponentMetadata(
                componentId = request.data.id,
                name = request.data.name,
                componentType = request.data.type,
                techStack = request.data.techStack,
                ownerTeam = request.data.ownerTeam,
                description = request.data.description,
                textContent = request.data.textContent,
                fontSize = request.data.fontSize,
                backgroundColor = request.data.backgroundColor,
                borderColor = request.data.borderColor,
                borderStyle = request.data.borderStyle
            ),
            project = project
        )

        val savedNode = nodeRepository.save(node)
        return savedNode.toDto()
    }

    fun updateNode(projectId: String, nodeId: String, request: UpdateNodeRequest): NodeDto {
        val node = nodeRepository.findById(nodeId)
            .orElseThrow { ResourceNotFoundException("Node not found with id: $nodeId") }

        if (node.project?.id != projectId) {
            throw ResourceNotFoundException("Node not found in project: $projectId")
        }

        request.type?.let { node.type = it }
        request.position?.let {
            node.position = Position(x = it.x, y = it.y)
        }
        request.data?.let { data ->
            node.componentMetadata = ComponentMetadata(
                componentId = data.id,
                name = data.name,
                componentType = data.type,
                techStack = data.techStack,
                ownerTeam = data.ownerTeam,
                description = data.description,
                textContent = data.textContent,
                fontSize = data.fontSize,
                backgroundColor = data.backgroundColor,
                borderColor = data.borderColor,
                borderStyle = data.borderStyle
            )
        }

        val updatedNode = nodeRepository.save(node)
        return updatedNode.toDto()
    }

    fun deleteNode(projectId: String, nodeId: String) {
        val node = nodeRepository.findById(nodeId)
            .orElseThrow { ResourceNotFoundException("Node not found with id: $nodeId") }

        if (node.project?.id != projectId) {
            throw ResourceNotFoundException("Node not found in project: $projectId")
        }

        nodeRepository.deleteById(nodeId)
    }
}
