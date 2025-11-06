package com.flowdoc.repository

import com.flowdoc.model.UseCase
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository

@Repository
interface UseCaseRepository : JpaRepository<UseCase, String> {

    @Query("SELECT uc FROM UseCase uc WHERE uc.project.id = :projectId ORDER BY uc.updatedAt DESC")
    fun findByProjectId(projectId: String): List<UseCase>

    @Query("SELECT uc FROM UseCase uc WHERE uc.entryServiceId = :serviceId")
    fun findByEntryServiceId(serviceId: String): List<UseCase>

    @Query("DELETE FROM UseCase uc WHERE uc.project.id = :projectId")
    fun deleteByProjectId(projectId: String)
}
