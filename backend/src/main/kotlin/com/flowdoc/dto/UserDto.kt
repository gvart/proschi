package com.flowdoc.dto

import com.flowdoc.model.User
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import java.time.Instant

// Request DTOs
data class RegisterRequest(
    @field:Email(message = "Invalid email format")
    @field:NotBlank(message = "Email is required")
    val email: String,

    @field:NotBlank(message = "Name is required")
    @field:Size(min = 2, max = 100, message = "Name must be between 2 and 100 characters")
    val name: String,

    @field:NotBlank(message = "Password is required")
    @field:Size(min = 8, message = "Password must be at least 8 characters")
    val password: String
)

data class LoginRequest(
    @field:Email(message = "Invalid email format")
    @field:NotBlank(message = "Email is required")
    val email: String,

    @field:NotBlank(message = "Password is required")
    val password: String
)

// Response DTOs
data class UserResponse(
    val id: String,
    val email: String,
    val name: String,
    val createdAt: Instant
)

data class AuthResponse(
    val token: String,
    val user: UserResponse
)

// Extension functions
fun User.toResponse(): UserResponse = UserResponse(
    id = this.id!!,
    email = this.email,
    name = this.name,
    createdAt = this.createdAt!!
)
