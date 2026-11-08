package com.example.kx

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.datetime.Instant

@Serializable
data class Order(
    val id: Long,
    @SerialName("customer_ref") val customerRef: String,
    val totalPrice: Double,
    val placedAt: Instant,
    val items: List<OrderItem>,
    val state: OrderState = OrderState.NEW,
    val note: String? = null,
    @Transient val localOnly: Int = 0
)

@Serializable
data class OrderItem(val sku: String, val quantity: Int, val unitPrice: Double)

@Serializable
enum class OrderState {
    NEW,
    @SerialName("in_progress") IN_PROGRESS,
    DONE
}

typealias OrderId = Long

@Serializable
data class OrderRef(val orderId: OrderId, val orderIds: List<OrderId>)
