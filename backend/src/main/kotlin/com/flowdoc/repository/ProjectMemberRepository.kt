package com.flowdoc.repository

import com.flowdoc.model.ProjectMember
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository

@Repository
interface ProjectMemberRepository : JpaRepository<ProjectMember, String> {

    @Query("SELECT pm FROM ProjectMember pm WHERE pm.project.id = :projectId")
    fun findByProjectId(projectId: String): List<ProjectMember>

    @Query("SELECT pm FROM ProjectMember pm WHERE pm.user.id = :userId")
    fun findByUserId(userId: String): List<ProjectMember>

    @Query("SELECT pm FROM ProjectMember pm WHERE pm.project.id = :projectId AND pm.user.id = :userId")
    fun findByProjectIdAndUserId(projectId: String, userId: String): ProjectMember?

    @Query("DELETE FROM ProjectMember pm WHERE pm.project.id = :projectId")
    fun deleteByProjectId(projectId: String)
}
