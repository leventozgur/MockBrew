import Foundation

struct BaseResponse<T: Codable>: Codable {
    let data: T
    let code: Int
    let message: String?
}

struct Page<Item: Codable>: Codable {
    let items: [Item]
    let page: Int
}

struct Product: Codable {
    let id: Int64
    let title: String
    let price: Double
}

typealias ProductPage = Page<Product>

struct Wrapper: Codable {
    let response: BaseResponse<Page<Product>>
    let alias: ProductPage
}
