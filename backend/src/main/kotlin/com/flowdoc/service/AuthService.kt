package com.flowdoc.service

import com.flowdoc.dto.AuthResponse
import com.flowdoc.dto.LoginRequest
import com.flowdoc.dto.RegisterRequest
import com.flowdoc.dto.toResponse
import com.flowdoc.exception.BadRequestException
import com.flowdoc.exception.ResourceNotFoundException
import com.flowdoc.model.User
import com.flowdoc.repository.UserRepository
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional
import java.util.*

@Service
@Transactional
class AuthService(
    private val userRepository: UserRepository
) {
    private val passwordEncoder = BCryptPasswordEncoder()

    fun register(request: RegisterRequest): AuthResponse {
        // Check if user already exists
        if (userRepository.existsByEmail(request.email)) {
            throw BadRequestException("User with email ${request.email} already exists")
        }

        // Create user
        val user = User(
            email = request.email,
            name = request.name,
            passwordHash = passwordEncoder.encode(request.password)
        )

        val savedUser = userRepository.save(user)

        // Generate token (simplified - in production use proper JWT)
        val token = generateToken(savedUser)

        return AuthResponse(
            token = token,
            user = savedUser.toResponse()
        )
    }

    fun login(request: LoginRequest): AuthResponse {
        // Find user
        val user = userRepository.findByEmail(request.email)
            .orElseThrow { ResourceNotFoundException("User not found") }

        // Verify password
        if (!passwordEncoder.matches(request.password, user.passwordHash)) {
            throw BadRequestException("Invalid credentials")
        }

        // Generate token
        val token = generateToken(user)

        return AuthResponse(
            token = token,
            user = user.toResponse()
        )
    }

    fun logout(token: String) {
        // In a real implementation, invalidate the token
        // For now, this is a no-op as we're using stateless JWT
    }

    fun getUserByToken(token: String): User {
        // In a real implementation, decode and validate JWT
        // For now, extract user ID from token (simplified)
        val userId = extractUserIdFromToken(token)
        return userRepository.findById(userId)
            .orElseThrow { ResourceNotFoundException("User not found") }
    }

    // Simplified token generation - in production use proper JWT library
    private fun generateToken(user: User): String {
        val userId = user.id!!
        val timestamp = System.currentTimeMillis()
        // This is a simplified token format
        // In production, use proper JWT with signature
        return Base64.getEncoder().encodeToString("$userId:$timestamp".toByteArray())
    }

    private fun extractUserIdFromToken(token: String): String {
        // Simplified token extraction
        val decoded = String(Base64.getDecoder().decode(token))
        return decoded.split(":")[0]
    }
}
