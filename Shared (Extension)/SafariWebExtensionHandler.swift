import SafariServices
import os.log

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem

        let message: Any?
        if #available(iOS 15.0, macOS 11.0, *) {
            message = request?.userInfo?[SFExtensionMessageKey]
        } else {
            message = request?.userInfo?["message"]
        }

        os_log(.default, "Received native message: %@", String(describing: message))

        guard let messageDict = message as? [String: Any],
              let action = messageDict["action"] as? String else {
            sendResponse(context: context, data: ["success": false, "error": "Invalid message"])
            return
        }

        switch action {
        case "saveSession":
            var sessionData: [String: String] = [:]
            if let url = messageDict["synologyUrl"] as? String { sessionData["synologyUrl"] = url }
            if let user = messageDict["username"] as? String { sessionData["username"] = user }
            if let sid = messageDict["sid"] as? String { sessionData["sid"] = sid }
            if let qcId = messageDict["quickConnectId"] as? String { sessionData["quickConnectId"] = qcId }

            let ok = KeychainHelper.saveSession(sessionData)
            os_log(.default, "saveSession: %{public}@", ok ? "success" : "failed")
            sendResponse(context: context, data: ["success": ok])

        case "loadSession":
            if let session = KeychainHelper.loadSession() {
                var resp: [String: Any] = ["success": true]
                for (k, v) in session { resp[k] = v }
                sendResponse(context: context, data: resp)
            } else {
                sendResponse(context: context, data: ["success": false, "error": "No saved session"])
            }

        case "deleteSession":
            KeychainHelper.deleteSession()
            sendResponse(context: context, data: ["success": true])

        case "saveCredentials":
            let server = messageDict["server"] as? String ?? ""
            let username = messageDict["username"] as? String ?? ""
            let password = messageDict["password"] as? String ?? ""
            let ok = KeychainHelper.saveCredentials(server: server, username: username, password: password)
            sendResponse(context: context, data: ["success": ok])

        case "loadCredentials":
            let server = messageDict["server"] as? String ?? ""
            if let creds = KeychainHelper.loadCredentials(server: server) {
                sendResponse(context: context, data: [
                    "success": true,
                    "username": creds["username"] ?? "",
                    "password": creds["password"] ?? ""
                ])
            } else {
                sendResponse(context: context, data: ["success": false])
            }

        default:
            sendResponse(context: context, data: ["success": false, "error": "Unknown action: \(action)"])
        }
    }

    private func sendResponse(context: NSExtensionContext, data: [String: Any]) {
        let response = NSExtensionItem()
        if #available(iOS 15.0, macOS 11.0, *) {
            response.userInfo = [SFExtensionMessageKey: data]
        } else {
            response.userInfo = ["message": data]
        }
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
