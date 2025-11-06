package com.flowdoc.service

import com.flowdoc.dto.AddProjectMemberRequest
import com.flowdoc.dto.ProjectMemberResponse
import com.flowdoc.dto.UpdateProjectMemberRequest
import com.flowdoc.dto.toResponse
import com.flowdoc.exception.BadRequestException
import com.flowdoc.exception.ResourceNotFoundException
import com.flowdoc.model.ProjectMember
import com.flowdoc.model.ProjectRole
import com.flowdoc.repository.ProjectMemberRepository
import com.flowdoc.repository.ProjectRepository
import com.flowdoc.repository.UserRepository
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional
class ProjectMemberService(
    private val projectMemberRepository: ProjectMemberRepository,
    private val projectRepository: ProjectRepository,
    private val userRepository: UserRepository
) {

    fun getProjectMembers(projectId: String): List<ProjectMemberResponse> {
        if (!projectRepository.existsById(projectId)) {
            throw ResourceNotFoundException("Project not found with id: $projectId")
        }
        return projectMemberRepository.findByProjectId(projectId).map { it.toResponse() }
    }

    fun addProjectMember(projectId: String, request: AddProjectMemberRequest): ProjectMemberResponse {
        val project = projectRepository.findById(projectId)
            .orElseThrow { ResourceNotFoundException("Project not found with id: $projectId") }

        val user = userRepository.findByEmail(request.email)
            .orElseThrow { ResourceNotFoundException("User not found with email: ${request.email}") }

        // Check if member already exists
        val existingMember = projectMemberRepository.findByProjectIdAndUserId(projectId, user.id!!)
        if (existingMember != null) {
            throw BadRequestException("User is already a member of this project")
        }

        val role = try {
            ProjectRole.valueOf(request.role.uppercase())
        } catch (e: IllegalArgumentException) {
            throw BadRequestException("Invalid role: ${request.role}. Must be one of: OWNER, EDITOR, VIEWER")
        }

        val member = ProjectMember(
            project = project,
            user = user,
            role = role
        )

        val savedMember = projectMemberRepository.save(member)
        return savedMember.toResponse()
    }

    fun updateProjectMember(projectId: String, memberId: String, request: UpdateProjectMemberRequest): ProjectMemberResponse {
        val member = projectMemberRepository.findById(memberId)
            .orElseThrow { ResourceNotFoundException("Member not found with id: $memberId") }

        if (member.project.id != projectId) {
            throw ResourceNotFoundException("Member not found in project: $projectId")
        }

        val role = try {
            ProjectRole.valueOf(request.role.uppercase())
        } catch (e: IllegalArgumentException) {
            throw BadRequestException("Invalid role: ${request.role}. Must be one of: OWNER, EDITOR, VIEWER")
        }

        member.role = role
        val updatedMember = projectMemberRepository.save(member)
        return updatedMember.toResponse()
    }

    fun removeProjectMember(projectId: String, memberId: String) {
        val member = projectMemberRepository.findById(memberId)
            .orElseThrow { ResourceNotFoundException("Member not found with id: $memberId") }

        if (member.project.id != projectId) {
            throw ResourceNotFoundException("Member not found in project: $projectId")
        }

        projectMemberRepository.deleteById(memberId)
    }
}
