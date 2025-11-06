package com.flowdoc

import org.springframework.boot.autoconfigure.SpringBootApplication
import org.springframework.boot.runApplication

@SpringBootApplication
class FlowDocApplication

fun main(args: Array<String>) {
    runApplication<FlowDocApplication>(*args)
}
