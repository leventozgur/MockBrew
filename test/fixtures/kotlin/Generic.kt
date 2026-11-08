package com.example.generic

import kotlinx.serialization.Serializable

@Serializable
data class BaseResponse<T>(val data: T, val code: Int, val message: String?)

@Serializable
data class Page<T>(val items: List<T>, val page: Int, val total: Int)

@Serializable
data class Product(val id: Long, val title: String, val price: Double, val tags: List<String>)

@Serializable
data class Wrapper(val response: BaseResponse<Page<Product>>)

@Serializable
data class Tree(val value: String, val children: List<Tree>, val parent: Tree?)
