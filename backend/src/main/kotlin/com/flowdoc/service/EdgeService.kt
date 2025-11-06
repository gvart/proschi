package com.flowdoc.service

import com.flowdoc.dto.CreateEdgeRequest
import com.flowdoc.dto.EdgeDto
import com.flowdoc.dto.UpdateEdgeRequest
import com.flowdoc.dto.toDto
import com.flowdoc.exception.ResourceNotFoundException
import com.flowdoc.model.Edge
import com.flowdoc.repository.EdgeRepository
import com.flowdoc.repository.ProjectRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class EdgeService(
    private val edgeRepository: EdgeRepository,
    private val projectRepository: ProjectRepository
) {

    fun getEdgesByProjectId(projectId: String): List<EdgeDto> {
        if (!projectRepository.existsById(projectId)) {
            throw ResourceNotFoundException("Project not found with id: $projectId")
        }
        return edgeRepository.findByProjectId(projectId).map { it.toDto() }
    }

    fun getEdgeById(projectId: String, edgeId: String): EdgeDto {
        val edge = edgeRepository.findById(edgeId)
            .orElseThrow { ResourceNotFoundException("Edge not found with id: $edgeId") }

        if (edge.project?.id != projectId) {
            throw ResourceNotFoundException("Edge not found in project: $projectId")
        }

        return edge.toDto()
    }

    fun createEdge(projectId: String, request: CreateEdgeRequest): EdgeDto {
        val project = projectRepository.findById(projectId)
            .orElseThrow { ResourceNotFoundException("Project not found with id: $projectId") }

        val edge = Edge(
            source = request.source,
            target = request.target,
            label = request.label,
            labelStyle = null, // TODO: Convert Map to JSON string
            labelBgStyle = null, // TODO: Convert Map to JSON string
            project = project
        )

        val savedEdge = edgeRepository.save(edge)
        return savedEdge.toDto()
    }

    fun updateEdge(projectId: String, edgeId: String, request: UpdateEdgeRequest): EdgeDto {
        val edge = edgeRepository.findById(edgeId)
            .orElseThrow { ResourceNotFoundException("Edge not found with id: $edgeId") }

        if (edge.project?.id != projectId) {
            throw ResourceNotFoundException("Edge not found in project: $projectId")
        }

        request.source?.let { edge.source = it }
        request.target?.let { edge.target = it }
        request.label?.let { edge.label = it }
        // TODO: Handle labelStyle and labelBgStyle

        val updatedEdge = edgeRepository.save(edge)
        return updatedEdge.toDto()
    }

    fun deleteEdge(projectId: String, edgeId: String) {
        val edge = edgeRepository.findById(edgeId)
            .orElseThrow { ResourceNotFoundException("Edge not found with id: $edgeId") }

        if (edge.project?.id != projectId) {
            throw ResourceNotFoundException("Edge not found in project: $projectId")
        }

        edgeRepository.deleteById(edgeId)
    }
}
