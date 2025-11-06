package com.flowdoc.dto

import com.flowdoc.model.FlowStep
import com.flowdoc.model.UseCase
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.Instant

// Request DTOs
data class CreateUseCaseRequest(
    @field:NotBlank(message = "Use case name is required")
    @field:Size(min = 1, max = 255, message = "Name must be between 1 and 255 characters")
    val name: String,

    @field:Size(max = 2000, message = "Description must be less than 2000 characters")
    val description: String? = null,

    val entryServiceId: String? = null
)

data class UpdateUseCaseRequest(
    @field:NotBlank(message = "Use case name is required")
    @field:Size(min = 1, max = 255, message = "Name must be between 1 and 255 characters")
    val name: String,

    @field:Size(max = 2000, message = "Description must be less than 2000 characters")
    val description: String? = null,

    val entryServiceId: String? = null
)

data class FlowStepDto(
    val id: String? = null,
    val stepOrder: Int,
    val fromServiceId: String,
    val toServiceId: String,
    val httpMethod: String = "GET",
    val endpoint: String = "/",
    val requestBody: String? = null,
    val responseBody: String? = null,
    val statusCode: Int? = 200,
    val description: String? = null,
    val isParallel: Boolean = false,
    val isConditional: Boolean = false,
    val conditionExpression: String? = null
)

data class CreateFlowStepRequest(
    val stepOrder: Int,
    @field:NotBlank(message = "From service ID is required")
    val fromServiceId: String,

    @field:NotBlank(message = "To service ID is required")
    val toServiceId: String,

    val httpMethod: String = "GET",
    val endpoint: String = "/",
    val requestBody: String? = null,
    val responseBody: String? = null,
    val statusCode: Int? = 200,
    val description: String? = null,
    val isParallel: Boolean = false,
    val isConditional: Boolean = false,
    val conditionExpression: String? = null
)

// Response DTOs
data class UseCaseResponse(
    val id: String,
    val name: String,
    val description: String?,
    val entryServiceId: String?,
    val projectId: String,
    val steps: List<FlowStepDto>,
    val createdAt: Instant,
    val updatedAt: Instant
)

data class UseCaseListResponse(
    val id: String,
    val name: String,
    val description: String?,
    val entryServiceId: String?,
    val projectId: String,
    val stepCount: Int,
    val createdAt: Instant,
    val updatedAt: Instant
)

// Extension functions
fun UseCase.toResponse(): UseCaseResponse = UseCaseResponse(
    id = this.id!!,
    name = this.name,
    description = this.description,
    entryServiceId = this.entryServiceId,
    projectId = this.project?.id!!,
    steps = this.steps.map { it.toDto() },
    createdAt = this.createdAt!!,
    updatedAt = this.updatedAt!!
)

fun UseCase.toListResponse(): UseCaseListResponse = UseCaseListResponse(
    id = this.id!!,
    name = this.name,
    description = this.description,
    entryServiceId = this.entryServiceId,
    projectId = this.project?.id!!,
    stepCount = this.steps.size,
    createdAt = this.createdAt!!,
    updatedAt = this.updatedAt!!
)

fun FlowStep.toDto(): FlowStepDto = FlowStepDto(
    id = this.id,
    stepOrder = this.stepOrder,
    fromServiceId = this.fromServiceId,
    toServiceId = this.toServiceId,
    httpMethod = this.httpMethod,
    endpoint = this.endpoint,
    requestBody = this.requestBody,
    responseBody = this.responseBody,
    statusCode = this.statusCode,
    description = this.description,
    isParallel = this.isParallel,
    isConditional = this.isConditional,
    conditionExpression = this.conditionExpression
)
