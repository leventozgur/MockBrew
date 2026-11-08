package com.example.multi.model

data class Customer(val customerId: String, val email: String, val joinedOn: java.time.LocalDate)

data class Line(val sku: String, val quantity: Int)
