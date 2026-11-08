import Foundation

enum Shape: Codable {
    case circle(radius: Double)
    case square(side: Double)
}

enum Plain: Codable {
    case a
    case b
}

struct Custom: Decodable {
    let a: Int
    init(from decoder: Decoder) throws { a = 1 }
}

struct Wrapped: Codable {
    @Default var value: Int
    let shape: Shape
    let missing: NotDeclaredAnywhere
    let tuple: (Int, Int)
}
