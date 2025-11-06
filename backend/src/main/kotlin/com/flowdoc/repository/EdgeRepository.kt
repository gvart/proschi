package com.flowdoc.repository

import com.flowdoc.model.Edge
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository

@Repository
interface EdgeRepository : JpaRepository<Edge, String> {

    @Query("SELECT e FROM Edge e WHERE e.project.id = :projectId")
    fun findByProjectId(projectId: String): List<Edge>

    @Query("SELECT e FROM Edge e WHERE e.source = :nodeId OR e.target = :nodeId")
    fun findBySourceOrTarget(nodeId: String): List<Edge>

    @Query("DELETE FROM Edge e WHERE e.project.id = :projectId")
    fun deleteByProjectId(projectId: String)
}
