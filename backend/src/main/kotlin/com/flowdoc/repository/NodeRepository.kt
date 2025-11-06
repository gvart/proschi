package com.flowdoc.repository

import com.flowdoc.model.Node
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository

@Repository
interface NodeRepository : JpaRepository<Node, String> {

    @Query("SELECT n FROM Node n WHERE n.project.id = :projectId")
    fun findByProjectId(projectId: String): List<Node>

    @Query("SELECT n FROM Node n WHERE n.project.id = :projectId AND n.type = :type")
    fun findByProjectIdAndType(projectId: String, type: String): List<Node>

    @Query("DELETE FROM Node n WHERE n.project.id = :projectId")
    fun deleteByProjectId(projectId: String)
}
