import Foundation

struct UserResponse: Codable {
    let id: Int
    let name: String
    var nickname: String?
    let tags: [String]
    let scores: [String: Int]
    let createdAt: Date
    let status: Status
    let address: Address
    let website: URL
    let ref: UUID
    let balance: Decimal
    let bigNumber: Int64
    let fixed = 5
    var computed: String { "x" }
    static let shared = 1

    enum CodingKeys: String, CodingKey {
        case id = "user_id"
        case name, nickname, tags, scores
        case createdAt = "created_at"
        case status, address, website, ref, balance, bigNumber
    }
}

struct Address: Codable, Equatable {
    var street: String
    var geo: Geo?
}

struct Geo: Codable {
    let latitude: Double
    let longitude: Double
}

enum Status: String, Codable {
    case active
    case deleted = "gone"
}

enum Priority: Int, Codable {
    case low = 1
    case high
}

final class TreeNode: Codable {
    var title: String
    var children: [TreeNode]
    var parent: TreeNode?
}
