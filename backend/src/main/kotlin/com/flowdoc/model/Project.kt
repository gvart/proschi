package com.flowdoc.model

import jakarta.persistence.*
import org.hibernate.annotations.CreationTimestamp
import org.hibernate.annotations.UpdateTimestamp
import java.time.Instant

@Entity
@Table(name = "projects")
data class Project(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: String? = null,

    @Column(nullable = false)
    var name: String,

    @Column(columnDefinition = "TEXT")
    var description: String? = null,

    @CreationTimestamp
    @Column(nullable = false, updatable = false)
    val createdAt: Instant? = null,

    @UpdateTimestamp
    @Column(nullable = false)
    val updatedAt: Instant? = null,

    @OneToMany(mappedBy = "project", cascade = [CascadeType.ALL], orphanRemoval = true, fetch = FetchType.LAZY)
    val nodes: MutableList<Node> = mutableListOf(),

    @OneToMany(mappedBy = "project", cascade = [CascadeType.ALL], orphanRemoval = true, fetch = FetchType.LAZY)
    val edges: MutableList<Edge> = mutableListOf(),

    @Embedded
    var viewport: Viewport = Viewport()
)

@Embeddable
data class Viewport(
    @Column(nullable = false)
    var x: Double = 0.0,

    @Column(nullable = false)
    var y: Double = 0.0,

    @Column(nullable = false)
    var zoom: Double = 1.0
)
