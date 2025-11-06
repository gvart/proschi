package com.flowdoc.service

import com.flowdoc.dto.OpenApiSchemaDetailResponse
import com.flowdoc.dto.OpenApiSchemaResponse
import com.flowdoc.dto.SchemaValidationResponse
import com.flowdoc.dto.UploadSchemaRequest
import com.flowdoc.dto.toDetailResponse
import com.flowdoc.dto.toResponse
import com.flowdoc.exception.BadRequestException
import com.flowdoc.exception.ResourceNotFoundException
import com.flowdoc.model.OpenApiSchema
import com.flowdoc.repository.NodeRepository
import com.flowdoc.repository.OpenApiSchemaRepository
import com.flowdoc.repository.ProjectRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class OpenApiSchemaService(
    private val openApiSchemaRepository: OpenApiSchemaRepository,
    private val nodeRepository: NodeRepository,
    private val projectRepository: ProjectRepository
) {

    fun getSchemasByServiceId(serviceId: String): List<OpenApiSchemaResponse> {
        return openApiSchemaRepository.findByServiceId(serviceId).map { it.toResponse() }
    }

    fun getSchemasByProjectId(projectId: String): List<OpenApiSchemaResponse> {
        if (!projectRepository.existsById(projectId)) {
            throw ResourceNotFoundException("Project not found with id: $projectId")
        }
        return openApiSchemaRepository.findByProjectId(projectId).map { it.toResponse() }
    }

    fun getSchemaById(schemaId: String): OpenApiSchemaDetailResponse {
        val schema = openApiSchemaRepository.findById(schemaId)
            .orElseThrow { ResourceNotFoundException("Schema not found with id: $schemaId") }
        return schema.toDetailResponse()
    }

    fun uploadSchema(projectId: String, request: UploadSchemaRequest, userId: String): OpenApiSchemaResponse {
        val project = projectRepository.findById(projectId)
            .orElseThrow { ResourceNotFoundException("Project not found with id: $projectId") }

        // Verify that the service exists in the project
        val node = nodeRepository.findById(request.serviceId)
            .orElseThrow { ResourceNotFoundException("Service not found with id: ${request.serviceId}") }

        if (node.project?.id != projectId) {
            throw BadRequestException("Service does not belong to project: $projectId")
        }

        // Check if schema with same version already exists for this service
        val existingSchema = openApiSchemaRepository.findByServiceIdAndVersion(request.serviceId, request.version)
        if (existingSchema != null) {
            throw BadRequestException("Schema with version ${request.version} already exists for this service")
        }

        // Determine content type (YAML or JSON)
        val contentType = if (request.schemaContent.trim().startsWith("{")) {
            "application/json"
        } else {
            "application/yaml"
        }

        val schema = OpenApiSchema(
            serviceId = request.serviceId,
            project = project,
            version = request.version,
            title = request.title,
            description = request.description,
            schemaContent = request.schemaContent,
            contentType = contentType,
            fileSize = request.schemaContent.length.toLong(),
            uploadedByUserId = userId
        )

        val savedSchema = openApiSchemaRepository.save(schema)
        return savedSchema.toResponse()
    }

    fun deleteSchema(schemaId: String) {
        if (!openApiSchemaRepository.existsById(schemaId)) {
            throw ResourceNotFoundException("Schema not found with id: $schemaId")
        }
        openApiSchemaRepository.deleteById(schemaId)
    }

    fun validateSchema(schemaId: String, flowRequest: String): SchemaValidationResponse {
        val schema = openApiSchemaRepository.findById(schemaId)
            .orElseThrow { ResourceNotFoundException("Schema not found with id: $schemaId") }

        // TODO: Implement actual OpenAPI validation using swagger-parser or similar
        // For now, return a basic validation response

        return SchemaValidationResponse(
            isValid = true,
            errors = emptyList(),
            warnings = listOf("Schema validation not yet implemented - always returns valid")
        )
    }
}
