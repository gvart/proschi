package com.flowdoc.controller

import com.flowdoc.dto.CreateNodeRequest
import com.flowdoc.dto.NodeDto
import com.flowdoc.dto.UpdateNodeRequest
import com.flowdoc.service.NodeService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/projects/{projectId}/nodes")
@CrossOrigin(origins = ["*"])
class NodeController(
    private val nodeService: NodeService
) {

    @GetMapping
    fun getNodesByProjectId(@PathVariable projectId: String): ResponseEntity<List<NodeDto>> {
        val nodes = nodeService.getNodesByProjectId(projectId)
        return ResponseEntity.ok(nodes)
    }

    @GetMapping("/{nodeId}")
    fun getNodeById(
        @PathVariable projectId: String,
        @PathVariable nodeId: String
    ): ResponseEntity<NodeDto> {
        val node = nodeService.getNodeById(projectId, nodeId)
        return ResponseEntity.ok(node)
    }

    @PostMapping
    fun createNode(
        @PathVariable projectId: String,
        @Valid @RequestBody request: CreateNodeRequest
    ): ResponseEntity<NodeDto> {
        val node = nodeService.createNode(projectId, request)
        return ResponseEntity.status(HttpStatus.CREATED).body(node)
    }

    @PutMapping("/{nodeId}")
    fun updateNode(
        @PathVariable projectId: String,
        @PathVariable nodeId: String,
        @Valid @RequestBody request: UpdateNodeRequest
    ): ResponseEntity<NodeDto> {
        val node = nodeService.updateNode(projectId, nodeId, request)
        return ResponseEntity.ok(node)
    }

    @DeleteMapping("/{nodeId}")
    fun deleteNode(
        @PathVariable projectId: String,
        @PathVariable nodeId: String
    ): ResponseEntity<Void> {
        nodeService.deleteNode(projectId, nodeId)
        return ResponseEntity.noContent().build()
    }
}
