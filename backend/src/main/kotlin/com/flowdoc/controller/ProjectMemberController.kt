package com.flowdoc.controller

import com.flowdoc.dto.AddProjectMemberRequest
import com.flowdoc.dto.ProjectMemberResponse
import com.flowdoc.dto.UpdateProjectMemberRequest
import com.flowdoc.service.ProjectMemberService
import jakarta.validation.Valid
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/projects/{projectId}/members")
@CrossOrigin(origins = ["*"])
class ProjectMemberController(
    private val projectMemberService: ProjectMemberService
) {

    @GetMapping
    fun getProjectMembers(@PathVariable projectId: String): ResponseEntity<List<ProjectMemberResponse>> {
        val members = projectMemberService.getProjectMembers(projectId)
        return ResponseEntity.ok(members)
    }

    @PostMapping
    fun addProjectMember(
        @PathVariable projectId: String,
        @Valid @RequestBody request: AddProjectMemberRequest
    ): ResponseEntity<ProjectMemberResponse> {
        val member = projectMemberService.addProjectMember(projectId, request)
        return ResponseEntity.status(HttpStatus.CREATED).body(member)
    }

    @PutMapping("/{memberId}")
    fun updateProjectMember(
        @PathVariable projectId: String,
        @PathVariable memberId: String,
        @Valid @RequestBody request: UpdateProjectMemberRequest
    ): ResponseEntity<ProjectMemberResponse> {
        val member = projectMemberService.updateProjectMember(projectId, memberId, request)
        return ResponseEntity.ok(member)
    }

    @DeleteMapping("/{memberId}")
    fun removeProjectMember(
        @PathVariable projectId: String,
        @PathVariable memberId: String
    ): ResponseEntity<Void> {
        projectMemberService.removeProjectMember(projectId, memberId)
        return ResponseEntity.noContent().build()
    }
}
