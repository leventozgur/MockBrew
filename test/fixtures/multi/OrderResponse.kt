package com.example.multi.api

import com.example.multi.model.Customer

data class OrderResponse(val orderId: Long, val customer: Customer, val lines: List<com.example.multi.model.Line>)
