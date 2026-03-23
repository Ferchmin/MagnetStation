import Foundation
import Security

struct KeychainHelper {

    private static let sessionService = "com.ferchmin.DownloadStation.session"
    private static let credentialService = "com.ferchmin.DownloadStation.credentials"

    // MARK: - Session (sid + url + username + quickConnectId)

    static func saveSession(_ data: [String: String]) -> Bool {
        deleteSession()

        guard let jsonData = try? JSONSerialization.data(withJSONObject: data) else {
            return false
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: sessionService,
            kSecAttrAccount as String: "session",
            kSecAttrSynchronizable as String: true,
            kSecValueData as String: jsonData,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func loadSession() -> [String: String]? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: sessionService,
            kSecAttrAccount as String: "session",
            kSecAttrSynchronizable as String: true,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)

        guard status == errSecSuccess,
              let data = result as? Data,
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String] else {
            return nil
        }
        return dict
    }

    static func deleteSession() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: sessionService,
            kSecAttrAccount as String: "session",
            kSecAttrSynchronizable as String: true
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - Credentials (username + password per server)

    static func saveCredentials(server: String, username: String, password: String) -> Bool {
        deleteCredentials(server: server)

        let credData: [String: String] = ["username": username, "password": password]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: credData) else {
            return false
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: credentialService,
            kSecAttrAccount as String: server,
            kSecAttrSynchronizable as String: true,
            kSecValueData as String: jsonData,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        return SecItemAdd(query as CFDictionary, nil) == errSecSuccess
    }

    static func loadCredentials(server: String) -> [String: String]? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: credentialService,
            kSecAttrAccount as String: server,
            kSecAttrSynchronizable as String: true,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data,
              let dict = try? JSONSerialization.jsonObject(with: data) as? [String: String] else {
            return nil
        }
        return dict
    }

    static func deleteCredentials(server: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: credentialService,
            kSecAttrAccount as String: server,
            kSecAttrSynchronizable as String: true
        ]
        SecItemDelete(query as CFDictionary)
    }
}
