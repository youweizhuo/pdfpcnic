import WebKit

/// The page's calls into the app (`window.webkit.messageHandlers.pdfpcnic`),
/// each answered as a promise: with a value, or with an error the page reports.
@MainActor
final class Bridge: NSObject, WKScriptMessageHandlerWithReply {
    typealias Handler = @MainActor ([String: Any]) throws -> Any?
    typealias AsyncHandler = @MainActor ([String: Any]) async throws -> Any?
    private var handlers: [String: Handler] = [:]
    private var asyncHandlers: [String: AsyncHandler] = [:]

    func on(_ op: String, _ handler: @escaping Handler) {
        handlers[op] = handler
    }

    func onAsync(_ op: String, _ handler: @escaping AsyncHandler) {
        asyncHandlers[op] = handler
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let args = message.body as? [String: Any], let op = args["op"] as? String else {
            return replyHandler(nil, "pdfpcnic: the app has no call \(message.body)")
        }
        if let handler = handlers[op] {
            do {
                let answer = try handler(args)
                replyHandler(answer ?? NSNull(), nil)
            } catch {
                replyHandler(nil, error.localizedDescription)
            }
        } else if let handler = asyncHandlers[op] {
            Task { @MainActor in
                do {
                    let answer = try await handler(args)
                    replyHandler(answer ?? NSNull(), nil)
                } catch {
                    replyHandler(nil, error.localizedDescription)
                }
            }
        } else {
            replyHandler(nil, "pdfpcnic: the app has no call \(op)")
        }
    }
}

/// Something that went wrong, said for the presenter.
struct Failure: LocalizedError {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

extension Dictionary where Key == String, Value == Any {
    func int(_ key: String) -> Int { (self[key] as? NSNumber)?.intValue ?? 0 }
    func double(_ key: String) -> Double { (self[key] as? NSNumber)?.doubleValue ?? 0 }
    func bool(_ key: String) -> Bool { (self[key] as? NSNumber)?.boolValue ?? false }
}
