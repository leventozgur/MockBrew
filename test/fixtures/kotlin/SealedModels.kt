import kotlinx.serialization.Serializable
import kotlinx.serialization.SerialName
import kotlinx.serialization.json.JsonClassDiscriminator

@Serializable @JsonClassDiscriminator("kind") sealed class Event {
    @Serializable @SerialName("created")
    data class Created(val createdAt: Instant) : Event()
    @Serializable @SerialName("deleted")
    object Deleted : Event()
}

@Serializable
sealed interface Result
@Serializable @SerialName("ok")
data class Success(val itemName: String) : Result
@Serializable @SerialName("empty") object Empty : Result

data class Feed(val events: List<Event>)
