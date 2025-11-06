package com.flowdoc.repository

import com.flowdoc.model.Project
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository

@Repository
interface ProjectRepository : JpaRepository<Project, String> {

    @Query("SELECT p FROM Project p ORDER BY p.updatedAt DESC")
    fun findAllOrderByUpdatedAtDesc(): List<Project>

    @Query("SELECT p FROM Project p WHERE LOWER(p.name) LIKE LOWER(CONCAT('%', :searchTerm, '%'))")
    fun searchByName(searchTerm: String): List<Project>
}
