package com.flowdoc.model

import jakarta.persistence.*
import org.hibernate.annotations.CreationTimestamp
import java.time.Instant

@Entity
@Table(name = "openapi_schemas")
data class OpenApiSchema(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: String? = null,

    @Column(name = "service_id", nullable = false)
    var serviceId: String, // Reference to Node ID (the service this schema belongs to)

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    var project: Project? = null,

    @Column(nullable = false)
    var version: String = "1.0.0",

    @Column(nullable = false)
    var title: String,

    @Column(columnDefinition = "TEXT")
    var description: String? = null,

    @Column(name = "s3_key")
    var s3Key: String? = null, // S3 location of the uploaded schema file

    @Column(name = "file_name")
    var fileName: String? = null,

    @Column(name = "file_size")
    var fileSize: Long? = null,

    @Column(name = "content_type")
    var contentType: String? = null, // application/yaml or application/json

    @Column(columnDefinition = "TEXT")
    var schemaContent: String? = null, // Store small schemas inline, large ones in S3

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    val uploadedAt: Instant? = null,

    @Column(name = "uploaded_by_user_id")
    var uploadedByUserId: String? = null
)
