package com.flowdoc.repository

import com.flowdoc.model.OpenApiSchema
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository

@Repository
interface OpenApiSchemaRepository : JpaRepository<OpenApiSchema, String> {

    @Query("SELECT s FROM OpenApiSchema s WHERE s.serviceId = :serviceId ORDER BY s.uploadedAt DESC")
    fun findByServiceId(serviceId: String): List<OpenApiSchema>

    @Query("SELECT s FROM OpenApiSchema s WHERE s.project.id = :projectId ORDER BY s.uploadedAt DESC")
    fun findByProjectId(projectId: String): List<OpenApiSchema>

    @Query("SELECT s FROM OpenApiSchema s WHERE s.serviceId = :serviceId AND s.version = :version")
    fun findByServiceIdAndVersion(serviceId: String, version: String): OpenApiSchema?

    @Query("DELETE FROM OpenApiSchema s WHERE s.serviceId = :serviceId")
    fun deleteByServiceId(serviceId: String)
}
