package com.flowdoc.dto

import com.flowdoc.model.Project
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.Instant

// Request DTOs
data class CreateProjectRequest(
    @field:NotBlank(message = "Project name is required")
    @field:Size(min = 1, max = 255, message = "Project name must be between 1 and 255 characters")
    val name: String,

    @field:Size(max = 2000, message = "Description must be less than 2000 characters")
    val description: String? = null
)

data class UpdateProjectRequest(
    @field:NotBlank(message = "Project name is required")
    @field:Size(min = 1, max = 255, message = "Project name must be between 1 and 255 characters")
    val name: String,

    @field:Size(max = 2000, message = "Description must be less than 2000 characters")
    val description: String? = null
)

data class UpdateCanvasStateRequest(
    val nodes: List<NodeDto>? = null,
    val edges: List<EdgeDto>? = null,
    val viewport: ViewportDto? = null
)

// Response DTOs
data class ProjectResponse(
    val id: String,
    val name: String,
    val description: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
    val canvasState: CanvasStateDto
)

data class ProjectListResponse(
    val id: String,
    val name: String,
    val description: String?,
    val createdAt: Instant,
    val updatedAt: Instant
)

data class CanvasStateDto(
    val nodes: List<NodeDto>,
    val edges: List<EdgeDto>,
    val viewport: ViewportDto
)

data class ViewportDto(
    val x: Double = 0.0,
    val y: Double = 0.0,
    val zoom: Double = 1.0
)

// Extension functions for mapping
fun Project.toResponse(): ProjectResponse = ProjectResponse(
    id = this.id!!,
    name = this.name,
    description = this.description,
    createdAt = this.createdAt!!,
    updatedAt = this.updatedAt!!,
    canvasState = CanvasStateDto(
        nodes = this.nodes.map { it.toDto() },
        edges = this.edges.map { it.toDto() },
        viewport = ViewportDto(
            x = this.viewport.x,
            y = this.viewport.y,
            zoom = this.viewport.zoom
        )
    )
)

fun Project.toListResponse(): ProjectListResponse = ProjectListResponse(
    id = this.id!!,
    name = this.name,
    description = this.description,
    createdAt = this.createdAt!!,
    updatedAt = this.updatedAt!!
)
