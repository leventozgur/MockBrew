class Animal: Codable {
    var name: String
    var createdAt: Date
}
class Dog: Animal {
    var breed: String
}
enum Response: Codable {
    case value(String)
    enum CodingKeys: String, CodingKey { case type }
    init(from decoder: Decoder) throws { fatalError() }
}
