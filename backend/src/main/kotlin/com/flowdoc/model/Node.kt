package com.flowdoc.model

import jakarta.persistence.*

@Entity
@Table(name = "nodes")
data class Node(
    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    val id: String? = null,

    @Column(nullable = false)
    var type: String, // 'componentNode', 'textNode', 'groupNode'

    @Embedded
    var position: Position = Position(),

    @Embedded
    var componentMetadata: ComponentMetadata = ComponentMetadata(),

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "project_id", nullable = false)
    var project: Project? = null
)

@Embeddable
data class Position(
    @Column(nullable = false)
    var x: Double = 0.0,

    @Column(nullable = false)
    var y: Double = 0.0
)

@Embeddable
data class ComponentMetadata(
    @Column(name = "component_id", nullable = false)
    var componentId: String = "",

    @Column(nullable = false)
    var name: String = "",

    @Column(nullable = false)
    var componentType: String = "", // 'service', 'database', 'queue', etc.

    @Column(nullable = false)
    var techStack: String = "", // 'PostgreSQL', 'REST API', etc.

    @Column(name = "owner_team")
    var ownerTeam: String? = null,

    @Column(columnDefinition = "TEXT")
    var description: String? = null,

    // For text nodes (annotations)
    @Column(columnDefinition = "TEXT")
    var textContent: String? = null,

    @Column(name = "font_size")
    var fontSize: Int? = null,

    // For group nodes
    @Column(name = "background_color")
    var backgroundColor: String? = null,

    @Column(name = "border_color")
    var borderColor: String? = null,

    @Column(name = "border_style")
    var borderStyle: String? = null // 'solid', 'dashed', 'dotted'
)
