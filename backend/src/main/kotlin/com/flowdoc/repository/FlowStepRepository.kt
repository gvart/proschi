package com.flowdoc.repository

import com.flowdoc.model.FlowStep
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.stereotype.Repository

@Repository
interface FlowStepRepository : JpaRepository<FlowStep, String> {

    @Query("SELECT fs FROM FlowStep fs WHERE fs.useCase.id = :useCaseId ORDER BY fs.stepOrder ASC")
    fun findByUseCaseId(useCaseId: String): List<FlowStep>

    @Query("DELETE FROM FlowStep fs WHERE fs.useCase.id = :useCaseId")
    fun deleteByUseCaseId(useCaseId: String)
}
