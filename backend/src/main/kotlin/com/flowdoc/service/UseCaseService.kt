package com.flowdoc.service

import com.flowdoc.dto.*
import com.flowdoc.exception.ResourceNotFoundException
import com.flowdoc.model.FlowStep
import com.flowdoc.model.UseCase
import com.flowdoc.repository.FlowStepRepository
import com.flowdoc.repository.ProjectRepository
import com.flowdoc.repository.UseCaseRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class UseCaseService(
    private val useCaseRepository: UseCaseRepository,
    private val flowStepRepository: FlowStepRepository,
    private val projectRepository: ProjectRepository
) {

    fun getUseCasesByProjectId(projectId: String): List<UseCaseListResponse> {
        if (!projectRepository.existsById(projectId)) {
            throw ResourceNotFoundException("Project not found with id: $projectId")
        }
        return useCaseRepository.findByProjectId(projectId).map { it.toListResponse() }
    }

    fun getUseCaseById(useCaseId: String): UseCaseResponse {
        val useCase = useCaseRepository.findById(useCaseId)
            .orElseThrow { ResourceNotFoundException("Use case not found with id: $useCaseId") }
        return useCase.toResponse()
    }

    fun createUseCase(projectId: String, request: CreateUseCaseRequest): UseCaseResponse {
        val project = projectRepository.findById(projectId)
            .orElseThrow { ResourceNotFoundException("Project not found with id: $projectId") }

        val useCase = UseCase(
            name = request.name,
            description = request.description,
            entryServiceId = request.entryServiceId,
            project = project
        )

        val savedUseCase = useCaseRepository.save(useCase)
        return savedUseCase.toResponse()
    }

    fun updateUseCase(useCaseId: String, request: UpdateUseCaseRequest): UseCaseResponse {
        val useCase = useCaseRepository.findById(useCaseId)
            .orElseThrow { ResourceNotFoundException("Use case not found with id: $useCaseId") }

        useCase.name = request.name
        useCase.description = request.description
        useCase.entryServiceId = request.entryServiceId

        val updatedUseCase = useCaseRepository.save(useCase)
        return updatedUseCase.toResponse()
    }

    fun deleteUseCase(useCaseId: String) {
        if (!useCaseRepository.existsById(useCaseId)) {
            throw ResourceNotFoundException("Use case not found with id: $useCaseId")
        }
        useCaseRepository.deleteById(useCaseId)
    }

    // Flow step operations
    fun addFlowStep(useCaseId: String, request: CreateFlowStepRequest): UseCaseResponse {
        val useCase = useCaseRepository.findById(useCaseId)
            .orElseThrow { ResourceNotFoundException("Use case not found with id: $useCaseId") }

        val step = FlowStep(
            useCase = useCase,
            stepOrder = request.stepOrder,
            fromServiceId = request.fromServiceId,
            toServiceId = request.toServiceId,
            httpMethod = request.httpMethod,
            endpoint = request.endpoint,
            requestBody = request.requestBody,
            responseBody = request.responseBody,
            statusCode = request.statusCode,
            description = request.description,
            isParallel = request.isParallel,
            isConditional = request.isConditional,
            conditionExpression = request.conditionExpression
        )

        useCase.steps.add(step)
        val savedUseCase = useCaseRepository.save(useCase)
        return savedUseCase.toResponse()
    }

    fun updateFlowStep(useCaseId: String, stepId: String, request: CreateFlowStepRequest): UseCaseResponse {
        val step = flowStepRepository.findById(stepId)
            .orElseThrow { ResourceNotFoundException("Flow step not found with id: $stepId") }

        if (step.useCase?.id != useCaseId) {
            throw ResourceNotFoundException("Flow step not found in use case: $useCaseId")
        }

        step.stepOrder = request.stepOrder
        step.fromServiceId = request.fromServiceId
        step.toServiceId = request.toServiceId
        step.httpMethod = request.httpMethod
        step.endpoint = request.endpoint
        step.requestBody = request.requestBody
        step.responseBody = request.responseBody
        step.statusCode = request.statusCode
        step.description = request.description
        step.isParallel = request.isParallel
        step.isConditional = request.isConditional
        step.conditionExpression = request.conditionExpression

        flowStepRepository.save(step)

        val useCase = useCaseRepository.findById(useCaseId).orElseThrow()
        return useCase.toResponse()
    }

    fun deleteFlowStep(useCaseId: String, stepId: String) {
        val step = flowStepRepository.findById(stepId)
            .orElseThrow { ResourceNotFoundException("Flow step not found with id: $stepId") }

        if (step.useCase?.id != useCaseId) {
            throw ResourceNotFoundException("Flow step not found in use case: $useCaseId")
        }

        flowStepRepository.deleteById(stepId)
    }
}
