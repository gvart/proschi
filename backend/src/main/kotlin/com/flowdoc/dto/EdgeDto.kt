package com.flowdoc.dto

import com.flowdoc.model.Edge
import jakarta.validation.constraints.NotBlank

data class EdgeDto(
    val id: String,
    val source: String,
    val target: String,
    val label: String? = null,
    val labelStyle: Map<String, Any>? = null,
    val labelBgStyle: Map<String, Any>? = null
)

data class CreateEdgeRequest(
    @field:NotBlank(message = "Source node ID is required")
    val source: String,

    @field:NotBlank(message = "Target node ID is required")
    val target: String,

    val label: String? = null,
    val labelStyle: Map<String, Any>? = null,
    val labelBgStyle: Map<String, Any>? = null
)

data class UpdateEdgeRequest(
    val source: String? = null,
    val target: String? = null,
    val label: String? = null,
    val labelStyle: Map<String, Any>? = null,
    val labelBgStyle: Map<String, Any>? = null
)

// Extension functions
fun Edge.toDto(): EdgeDto = EdgeDto(
    id = this.id!!,
    source = this.source,
    target = this.target,
    label = this.label,
    labelStyle = this.labelStyle?.let { parseJsonToMap(it) },
    labelBgStyle = this.labelBgStyle?.let { parseJsonToMap(it) }
)

// Helper function to parse JSON string to Map (will be replaced with proper JSON parsing)
private fun parseJsonToMap(json: String): Map<String, Any>? {
    // TODO: Implement proper JSON parsing with Jackson
    return null
}
