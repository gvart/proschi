package com.flowdoc.controller

import com.flowdoc.dto.CreateEdgeRequest
import com.flowdoc.dto.EdgeDto
import com.flowdoc.dto.UpdateEdgeRequest
import com.flowdoc.service.EdgeService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/projects/{projectId}/edges")
@CrossOrigin(origins = ["*"])
class EdgeController(
    private val edgeService: EdgeService
) {

    @GetMapping
    fun getEdgesByProjectId(@PathVariable projectId: String): ResponseEntity<List<EdgeDto>> {
        val edges = edgeService.getEdgesByProjectId(projectId)
        return ResponseEntity.ok(edges)
    }

    @GetMapping("/{edgeId}")
    fun getEdgeById(
        @PathVariable projectId: String,
        @PathVariable edgeId: String
    ): ResponseEntity<EdgeDto> {
        val edge = edgeService.getEdgeById(projectId, edgeId)
        return ResponseEntity.ok(edge)
    }

    @PostMapping
    fun createEdge(
        @PathVariable projectId: String,
        @Valid @RequestBody request: CreateEdgeRequest
    ): ResponseEntity<EdgeDto> {
        val edge = edgeService.createEdge(projectId, request)
        return ResponseEntity.status(HttpStatus.CREATED).body(edge)
    }

    @PutMapping("/{edgeId}")
    fun updateEdge(
        @PathVariable projectId: String,
        @PathVariable edgeId: String,
        @Valid @RequestBody request: UpdateEdgeRequest
    ): ResponseEntity<EdgeDto> {
        val edge = edgeService.updateEdge(projectId, edgeId, request)
        return ResponseEntity.ok(edge)
    }

    @DeleteMapping("/{edgeId}")
    fun deleteEdge(
        @PathVariable projectId: String,
        @PathVariable edgeId: String
    ): ResponseEntity<Void> {
        edgeService.deleteEdge(projectId, edgeId)
        return ResponseEntity.noContent().build()
    }
}
