package com.example.unsupported

import kotlinx.serialization.Serializable
import com.google.gson.annotations.JsonAdapter

sealed class Shape {
    data class Circle(val radius: Double) : Shape()
}

open class Animal(val name: String)

data class Dog(val breed: String) : Animal("dog")

data class Strange(
    val ok: String,
    @JsonAdapter(CustomAdapter::class) val custom: String,
    val shape: Shape,
    val missing: NotDeclaredAnywhere
) {
    val lazyValue: String by lazy { "x" }
    val computed: Int get() = 1
}
