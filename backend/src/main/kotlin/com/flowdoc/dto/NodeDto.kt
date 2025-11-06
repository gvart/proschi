package com.flowdoc.dto

import com.flowdoc.model.Node
import jakarta.validation.constraints.NotBlank

data class NodeDto(
    val id: String,
    val type: String,
    val position: PositionDto,
    val data: ComponentMetadataDto
)

data class PositionDto(
    val x: Double,
    val y: Double
)

data class ComponentMetadataDto(
    val id: String,
    val name: String,
    val type: String,
    val techStack: String,
    val ownerTeam: String? = null,
    val description: String? = null,
    val textContent: String? = null,
    val fontSize: Int? = null,
    val backgroundColor: String? = null,
    val borderColor: String? = null,
    val borderStyle: String? = null
)

data class CreateNodeRequest(
    @field:NotBlank(message = "Node type is required")
    val type: String,

    val position: PositionDto,
    val data: ComponentMetadataDto
)

data class UpdateNodeRequest(
    val type: String? = null,
    val position: PositionDto? = null,
    val data: ComponentMetadataDto? = null
)

// Extension functions
fun Node.toDto(): NodeDto = NodeDto(
    id = this.id!!,
    type = this.type,
    position = PositionDto(
        x = this.position.x,
        y = this.position.y
    ),
    data = ComponentMetadataDto(
        id = this.componentMetadata.componentId,
        name = this.componentMetadata.name,
        type = this.componentMetadata.componentType,
        techStack = this.componentMetadata.techStack,
        ownerTeam = this.componentMetadata.ownerTeam,
        description = this.componentMetadata.description,
        textContent = this.componentMetadata.textContent,
        fontSize = this.componentMetadata.fontSize,
        backgroundColor = this.componentMetadata.backgroundColor,
        borderColor = this.componentMetadata.borderColor,
        borderStyle = this.componentMetadata.borderStyle
    )
)
