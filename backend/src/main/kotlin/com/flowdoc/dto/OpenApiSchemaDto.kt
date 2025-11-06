package com.flowdoc.dto

import com.flowdoc.model.OpenApiSchema
import jakarta.validation.constraints.NotBlank
import java.time.Instant

// Request DTOs
data class UploadSchemaRequest(
    @field:NotBlank(message = "Service ID is required")
    val serviceId: String,

    @field:NotBlank(message = "Version is required")
    val version: String,

    @field:NotBlank(message = "Title is required")
    val title: String,

    val description: String? = null,

    @field:NotBlank(message = "Schema content is required")
    val schemaContent: String
)

// Response DTOs
data class OpenApiSchemaResponse(
    val id: String,
    val serviceId: String,
    val projectId: String,
    val version: String,
    val title: String,
    val description: String?,
    val fileName: String?,
    val fileSize: Long?,
    val contentType: String?,
    val uploadedAt: Instant,
    val uploadedByUserId: String?
)

data class OpenApiSchemaDetailResponse(
    val id: String,
    val serviceId: String,
    val projectId: String,
    val version: String,
    val title: String,
    val description: String?,
    val fileName: String?,
    val fileSize: Long?,
    val contentType: String?,
    val schemaContent: String?,
    val uploadedAt: Instant,
    val uploadedByUserId: String?
)

data class SchemaValidationResponse(
    val isValid: Boolean,
    val errors: List<String> = emptyList(),
    val warnings: List<String> = emptyList()
)

// Extension functions
fun OpenApiSchema.toResponse(): OpenApiSchemaResponse = OpenApiSchemaResponse(
    id = this.id!!,
    serviceId = this.serviceId,
    projectId = this.project?.id!!,
    version = this.version,
    title = this.title,
    description = this.description,
    fileName = this.fileName,
    fileSize = this.fileSize,
    contentType = this.contentType,
    uploadedAt = this.uploadedAt!!,
    uploadedByUserId = this.uploadedByUserId
)

fun OpenApiSchema.toDetailResponse(): OpenApiSchemaDetailResponse = OpenApiSchemaDetailResponse(
    id = this.id!!,
    serviceId = this.serviceId,
    projectId = this.project?.id!!,
    version = this.version,
    title = this.title,
    description = this.description,
    fileName = this.fileName,
    fileSize = this.fileSize,
    contentType = this.contentType,
    schemaContent = this.schemaContent,
    uploadedAt = this.uploadedAt!!,
    uploadedByUserId = this.uploadedByUserId
)
