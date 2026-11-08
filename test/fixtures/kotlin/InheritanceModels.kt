open class Animal(val name: String) {
    val createdAt: Instant = Instant.now()
}
data class Dog(val breed: String) : Animal("dog")
