package com.flowdoc.model

import jakarta.persistence.*
import org.hibernate.annotations.CreationTimestamp
import org.hibernate.annotations.UpdateTimestamp
import java.time.Instant

@Entity
@Table(name = "use_cases")
data class UseCase(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: String? = null,

    @Column(nullable = false)
    var name: String,

    @Column(columnDefinition = "TEXT")
    var description: String? = null,

    @Column(name = "entry_service_id")
    var entryServiceId: String? = null, // Reference to a Node ID

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    var project: Project? = null,

    @OneToMany(mappedBy = "useCase", cascade = [CascadeType.ALL], orphanRemoval = true, fetch = FetchType.LAZY)
    @OrderBy("stepOrder ASC")
    val steps: MutableList<FlowStep> = mutableListOf(),

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    val createdAt: Instant? = null,

    @UpdateTimestamp
    @Column(nullable = false)
    val updatedAt: Instant? = null
)

@Entity
@Table(name = "flow_steps")
data class FlowStep(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: String? = null,

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "use_case_id", nullable = false)
    var useCase: UseCase? = null,

    @Column(nullable = false)
    var stepOrder: Int,

    @Column(name = "step_name", nullable = false)
    var stepName: String = "Step",

    @Column(name = "from_service_id", nullable = false)
    var fromServiceId: String, // Reference to Node ID

    @Column(name = "to_service_id", nullable = false)
    var toServiceId: String, // Reference to Node ID

    @Column(nullable = false)
    var protocol: String = "REST", // REST, GRPC, SOAP, GRAPHQL, MESSAGING, OTHER

    @Column(nullable = false)
    var httpMethod: String = "GET", // For REST: GET, POST, PUT, DELETE, etc.

    @Column(nullable = false)
    var endpoint: String = "/", // For REST/SOAP: endpoint, For gRPC: service.method

    @Column(name = "request_format", nullable = false)
    var requestFormat: String = "JSON", // JSON, XML, FREE_TEXT

    @Column(name = "request_body", columnDefinition = "TEXT")
    var requestBody: String? = null,

    @Column(name = "response_format", nullable = false)
    var responseFormat: String = "JSON", // JSON, XML, FREE_TEXT

    @Column(name = "response_body", columnDefinition = "TEXT")
    var responseBody: String? = null,

    @Column
    var statusCode: Int? = 200,

    @Column(columnDefinition = "TEXT")
    var description: String? = null,

    @Column(name = "execution_type", nullable = false)
    var executionType: String = "SYNC_REQUEST_RESPONSE", // SYNC_REQUEST_RESPONSE, ASYNC_FIRE_AND_FORGET, ASYNC_REQUEST_RESPONSE

    @Column(name = "parallel_group")
    var parallelGroup: Int? = null, // Steps with same parallelGroup execute simultaneously

    @Column(name = "is_parallel")
    var isParallel: Boolean = false,

    @Column(name = "is_conditional")
    var isConditional: Boolean = false,

    @Column(name = "condition_expression", columnDefinition = "TEXT")
    var conditionExpression: String? = null
)
