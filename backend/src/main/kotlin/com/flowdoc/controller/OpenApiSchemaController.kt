package com.flowdoc.controller

import com.flowdoc.dto.OpenApiSchemaDetailResponse
import com.flowdoc.dto.OpenApiSchemaResponse
import com.flowdoc.dto.SchemaValidationResponse
import com.flowdoc.dto.UploadSchemaRequest
import com.flowdoc.service.OpenApiSchemaService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/projects/{projectId}/schemas")
@CrossOrigin(origins = ["*"])
class OpenApiSchemaController(
    private val openApiSchemaService: OpenApiSchemaService
) {

    @GetMapping
    fun getSchemasByProjectId(@PathVariable projectId: String): ResponseEntity<List<OpenApiSchemaResponse>> {
        val schemas = openApiSchemaService.getSchemasByProjectId(projectId)
        return ResponseEntity.ok(schemas)
    }

    @PostMapping
    fun uploadSchema(
        @PathVariable projectId: String,
        @Valid @RequestBody request: UploadSchemaRequest,
        @RequestHeader("User-Id") userId: String // Simplified auth - use proper JWT in production
    ): ResponseEntity<OpenApiSchemaResponse> {
        val schema = openApiSchemaService.uploadSchema(projectId, request, userId)
        return ResponseEntity.status(HttpStatus.CREATED).body(schema)
    }
}

@RestController
@RequestMapping("/schemas")
@CrossOrigin(origins = ["*"])
class SchemaDetailController(
    private val openApiSchemaService: OpenApiSchemaService
) {

    @GetMapping("/{schemaId}")
    fun getSchemaById(@PathVariable schemaId: String): ResponseEntity<OpenApiSchemaDetailResponse> {
        val schema = openApiSchemaService.getSchemaById(schemaId)
        return ResponseEntity.ok(schema)
    }

    @DeleteMapping("/{schemaId}")
    fun deleteSchema(@PathVariable schemaId: String): ResponseEntity<Void> {
        openApiSchemaService.deleteSchema(schemaId)
        return ResponseEntity.noContent().build()
    }

    @PostMapping("/{schemaId}/validate")
    fun validateSchema(
        @PathVariable schemaId: String,
        @RequestBody flowRequest: String
    ): ResponseEntity<SchemaValidationResponse> {
        val validationResult = openApiSchemaService.validateSchema(schemaId, flowRequest)
        return ResponseEntity.ok(validationResult)
    }
}

@RestController
@RequestMapping("/services/{serviceId}/schemas")
@CrossOrigin(origins = ["*"])
class ServiceSchemaController(
    private val openApiSchemaService: OpenApiSchemaService
) {

    @GetMapping
    fun getSchemasByServiceId(@PathVariable serviceId: String): ResponseEntity<List<OpenApiSchemaResponse>> {
        val schemas = openApiSchemaService.getSchemasByServiceId(serviceId)
        return ResponseEntity.ok(schemas)
    }
}
