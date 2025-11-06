package com.flowdoc.model

import jakarta.persistence.*

@Entity
@Table(name = "edges")
data class Edge(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: String? = null,

    @Column(nullable = false)
    var source: String, // Source node ID

    @Column(nullable = false)
    var target: String, // Target node ID

    @Column
    var label: String? = null, // Connection label (e.g., "HTTP", "GraphQL")

    @Column(name = "label_style", columnDefinition = "TEXT")
    var labelStyle: String? = null, // JSON string for React CSSProperties

    @Column(name = "label_bg_style", columnDefinition = "TEXT")
    var labelBgStyle: String? = null, // JSON string for React CSSProperties

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    var project: Project? = null
)
