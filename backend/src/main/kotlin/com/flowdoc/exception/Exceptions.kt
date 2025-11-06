package com.flowdoc.exception

class ResourceNotFoundException(message: String) : RuntimeException(message)

class BadRequestException(message: String) : RuntimeException(message)

class ConflictException(message: String) : RuntimeException(message)
