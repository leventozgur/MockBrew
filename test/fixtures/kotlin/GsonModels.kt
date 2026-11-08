package com.example.gson

import com.google.gson.annotations.SerializedName

data class UserDto(
    @SerializedName("user_id") val id: Long,
    @SerializedName(value = "full_name", alternate = ["name", "fullName"]) val fullName: String,
    val email: String?,
    val tags: List<String> = emptyList(),
    val scores: Map<String, Int>,
    val status: Status,
    @SerializedName("created_at") val createdAt: java.util.Date,
    val address: Address,
    @Transient val cache: String = ""
) {
    data class Settings(val darkMode: Boolean)
}

data class Address(val street: String, val postalCode: String?, val geo: Geo?)

data class Geo(val latitude: Double, val longitude: Double)

enum class Status {
    @SerializedName("active") ACTIVE,
    @SerializedName("gone") DELETED
}

class LegacyBean {
    @SerializedName("a_b") var aB: String = ""
    var counter: Int = 0
}
