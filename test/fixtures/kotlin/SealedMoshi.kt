import com.squareup.moshi.JsonClass
@JsonClass(generateAdapter = true, generator = "sealed:category")
sealed class Message
 data class Text(val value: String) : Message()
 object End : Message()
