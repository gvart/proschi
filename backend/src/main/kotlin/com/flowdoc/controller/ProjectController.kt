package com.flowdoc.controller

import com.flowdoc.dto.*
import com.flowdoc.service.ProjectService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/projects")
@CrossOrigin(origins = ["*"])
class ProjectController(
    private val projectService: ProjectService
) {

    @GetMapping
    fun getAllProjects(): ResponseEntity<List<ProjectListResponse>> {
        val projects = projectService.getAllProjects()
        return ResponseEntity.ok(projects)
    }

    @GetMapping("/{id}")
    fun getProjectById(@PathVariable id: String): ResponseEntity<ProjectResponse> {
        val project = projectService.getProjectById(id)
        return ResponseEntity.ok(project)
    }

    @PostMapping
    fun createProject(@Valid @RequestBody request: CreateProjectRequest): ResponseEntity<ProjectResponse> {
        val project = projectService.createProject(request)
        return ResponseEntity.status(HttpStatus.CREATED).body(project)
    }

    @PutMapping("/{id}")
    fun updateProject(
        @PathVariable id: String,
        @Valid @RequestBody request: UpdateProjectRequest
    ): ResponseEntity<ProjectResponse> {
        val project = projectService.updateProject(id, request)
        return ResponseEntity.ok(project)
    }

    @DeleteMapping("/{id}")
    fun deleteProject(@PathVariable id: String): ResponseEntity<Void> {
        projectService.deleteProject(id)
        return ResponseEntity.noContent().build()
    }

    @PatchMapping("/{id}/canvas-state")
    fun updateCanvasState(
        @PathVariable id: String,
        @Valid @RequestBody request: UpdateCanvasStateRequest
    ): ResponseEntity<ProjectResponse> {
        val project = projectService.updateCanvasState(id, request)
        return ResponseEntity.ok(project)
    }

    @GetMapping("/search")
    fun searchProjects(@RequestParam q: String): ResponseEntity<List<ProjectListResponse>> {
        val projects = projectService.searchProjects(q)
        return ResponseEntity.ok(projects)
    }
}
