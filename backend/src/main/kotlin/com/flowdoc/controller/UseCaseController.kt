package com.flowdoc.controller

import com.flowdoc.dto.*
import com.flowdoc.service.UseCaseService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/projects/{projectId}/use-cases")
@CrossOrigin(origins = ["*"])
class UseCaseController(
    private val useCaseService: UseCaseService
) {

    @GetMapping
    fun getUseCasesByProjectId(@PathVariable projectId: String): ResponseEntity<List<UseCaseListResponse>> {
        val useCases = useCaseService.getUseCasesByProjectId(projectId)
        return ResponseEntity.ok(useCases)
    }

    @PostMapping
    fun createUseCase(
        @PathVariable projectId: String,
        @Valid @RequestBody request: CreateUseCaseRequest
    ): ResponseEntity<UseCaseResponse> {
        val useCase = useCaseService.createUseCase(projectId, request)
        return ResponseEntity.status(HttpStatus.CREATED).body(useCase)
    }
}

@RestController
@RequestMapping("/use-cases")
@CrossOrigin(origins = ["*"])
class UseCaseDetailController(
    private val useCaseService: UseCaseService
) {

    @GetMapping("/{useCaseId}")
    fun getUseCaseById(@PathVariable useCaseId: String): ResponseEntity<UseCaseResponse> {
        val useCase = useCaseService.getUseCaseById(useCaseId)
        return ResponseEntity.ok(useCase)
    }

    @PutMapping("/{useCaseId}")
    fun updateUseCase(
        @PathVariable useCaseId: String,
        @Valid @RequestBody request: UpdateUseCaseRequest
    ): ResponseEntity<UseCaseResponse> {
        val useCase = useCaseService.updateUseCase(useCaseId, request)
        return ResponseEntity.ok(useCase)
    }

    @DeleteMapping("/{useCaseId}")
    fun deleteUseCase(@PathVariable useCaseId: String): ResponseEntity<Void> {
        useCaseService.deleteUseCase(useCaseId)
        return ResponseEntity.noContent().build()
    }

    // Flow step operations
    @PostMapping("/{useCaseId}/steps")
    fun addFlowStep(
        @PathVariable useCaseId: String,
        @Valid @RequestBody request: CreateFlowStepRequest
    ): ResponseEntity<UseCaseResponse> {
        val useCase = useCaseService.addFlowStep(useCaseId, request)
        return ResponseEntity.status(HttpStatus.CREATED).body(useCase)
    }

    @PutMapping("/{useCaseId}/steps/{stepId}")
    fun updateFlowStep(
        @PathVariable useCaseId: String,
        @PathVariable stepId: String,
        @Valid @RequestBody request: CreateFlowStepRequest
    ): ResponseEntity<UseCaseResponse> {
        val useCase = useCaseService.updateFlowStep(useCaseId, stepId, request)
        return ResponseEntity.ok(useCase)
    }

    @DeleteMapping("/{useCaseId}/steps/{stepId}")
    fun deleteFlowStep(
        @PathVariable useCaseId: String,
        @PathVariable stepId: String
    ): ResponseEntity<Void> {
        useCaseService.deleteFlowStep(useCaseId, stepId)
        return ResponseEntity.noContent().build()
    }
}
