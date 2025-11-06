package com.flowdoc.dto

import com.flowdoc.model.ProjectMember
import com.flowdoc.model.ProjectRole
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import java.time.Instant

// Request DTOs
data class AddProjectMemberRequest(
    @field:Email(message = "Invalid email format")
    @field:NotBlank(message = "Email is required")
    val email: String,

    @field:NotBlank(message = "Role is required")
    val role: String // "OWNER", "EDITOR", "VIEWER"
)

data class UpdateProjectMemberRequest(
    @field:NotBlank(message = "Role is required")
    val role: String // "OWNER", "EDITOR", "VIEWER"
)

// Response DTOs
data class ProjectMemberResponse(
    val id: String,
    val projectId: String,
    val user: UserResponse,
    val role: ProjectRole,
    val addedAt: Instant
)

// Extension functions
fun ProjectMember.toResponse(): ProjectMemberResponse = ProjectMemberResponse(
    id = this.id!!,
    projectId = this.project.id!!,
    user = this.user.toResponse(),
    role = this.role,
    addedAt = this.addedAt!!
)
