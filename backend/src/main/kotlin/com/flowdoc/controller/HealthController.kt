package com.flowdoc.controller

import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.LocalDateTime

@RestController
@RequestMapping("/api/health")
class HealthController {

    @GetMapping
    fun health(): Map<String, Any> {
        return mapOf(
            "status" to "UP",
            "timestamp" to LocalDateTime.now(),
            "application" to "FlowDoc Backend",
            "version" to "0.0.1-SNAPSHOT"
        )
    }
}
