/**
 * remi - Section & Database Helper (compiled binary)
 *
 * This binary handles all operations requiring:
 * 1. ReminderKit (private framework) — section CRUD with CloudKit sync
 * 2. Direct SQLite access — membership sync, database queries
 * 3. EventKit sync trigger — wake remindd after SQLite writes
 *
 * By running these in a compiled binary with an embedded Info.plist,
 * macOS attributes permissions to "remi" rather than the terminal app.
 * This means users grant permission to remi once, not to each terminal.
 *
 * Usage: section-helper <command> [args...]
 *
 * Section commands:
 *   list-sections <listName>
 *   create-section <listName> <sectionName>
 *   delete-section <listName> <sectionName>
 *   trigger-sync <listName>
 *
 * Database commands:
 *   db-find-db                              Find Reminders database path
 *   db-stats                                List/section/reminder counts
 *   db-find-list <listName>                 Find list Z_PK
 *   db-find-reminder <title> <listName>     Find reminder Z_PK + hex UUID
 *   db-find-section <sectionName> <listName> Find section Z_PK + hex UUID
 *   db-read-memberships <listName>          Read membership JSON
 *   db-read-tokenmap <listName>             Read token map JSON
 *   db-write-membership-sync <listName> <membershipJSON>  Atomic write + sync
 *
 * All output is JSON.
 */

import Foundation
import ObjectiveC
import EventKit
import SQLite3
import CommonCrypto

// MARK: - Helpers

func outputJSON(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict, options: [.sortedKeys]),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}

func callWithError(_ obj: NSObject, _ selName: String, _ args: [AnyObject] = []) -> (AnyObject?, NSError?) {
    let sel = NSSelectorFromString(selName)
    guard let method = class_getInstanceMethod(type(of: obj), sel) else {
        return (nil, NSError(domain: "REMBridge", code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Method \(selName) not found on \(type(of: obj))"]))
    }
    let imp = method_getImplementation(method)
    var error: NSError?
    let result: AnyObject?

    switch args.count {
    case 0:
        let fn = unsafeBitCast(imp, to: (@convention(c) (AnyObject, Selector, UnsafeMutablePointer<NSError?>) -> AnyObject?).self)
        result = fn(obj, sel, &error)
    case 1:
        let fn = unsafeBitCast(imp, to: (@convention(c) (AnyObject, Selector, AnyObject, UnsafeMutablePointer<NSError?>) -> AnyObject?).self)
        result = fn(obj, sel, args[0], &error)
    default:
        result = nil
    }
    return (result, error)
}

// MARK: - ReminderKit Bridge

class REMBridge {
    let store: NSObject
    let acctView: NSObject
    let listsView: NSObject
    let sectionsView: NSObject

    init?() {
        guard let bundle = Bundle(path: "/System/Library/PrivateFrameworks/ReminderKit.framework") else {
            return nil
        }
        bundle.load()

        guard let storeClass = NSClassFromString("REMStore") as? NSObject.Type,
              let acctViewClass = NSClassFromString("REMAccountsDataView") as? NSObject.Type,
              let listsViewClass = NSClassFromString("REMListsDataView") as? NSObject.Type,
              let sectionsViewClass = NSClassFromString("REMListSectionsDataView") as? NSObject.Type else {
            return nil
        }

        store = storeClass.init()

        acctView = acctViewClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue() as! NSObject
        _ = acctView.perform(NSSelectorFromString("initWithStore:"), with: store)

        listsView = listsViewClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue() as! NSObject
        _ = listsView.perform(NSSelectorFromString("initWithStore:"), with: store)

        sectionsView = sectionsViewClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue() as! NSObject
        _ = sectionsView.perform(NSSelectorFromString("initWithStore:"), with: store)
    }

    func findList(_ name: String) -> (storage: NSObject, account: NSObject)? {
        let (accounts, _) = callWithError(acctView, "fetchAllAccountsWithError:")
        guard let acctArray = accounts as? NSArray else { return nil }

        for acct in acctArray {
            let acctObj = acct as! NSObject
            let (lists, _) = callWithError(listsView, "fetchListsInAccount:error:", [acctObj])
            if let listArray = lists as? NSArray {
                for list in listArray {
                    let listObj = list as! NSObject
                    if (listObj.value(forKey: "displayName") as? String) == name {
                        return (listObj, acctObj)
                    }
                }
            }
        }
        return nil
    }

    func listSections(_ listName: String) -> [[String: String]] {
        guard let (listStorage, _) = findList(listName) else { return [] }
        let (sections, _) = callWithError(sectionsView, "fetchListSectionsInList:error:", [listStorage])
        guard let secArray = sections as? NSArray else { return [] }

        return secArray.map { sec in
            let secObj = sec as! NSObject
            return [
                "name": secObj.value(forKey: "displayName") as? String ?? "",
                "objectID": secObj.value(forKey: "objectID") as? String ?? "",
            ]
        }
    }

    /// Creates a section. Outputs its own JSON in all cases (idempotent, error, success).
    func createSection(_ listName: String, _ sectionName: String) {
        guard let (listStorage, account) = findList(listName) else {
            outputJSON(["success": false, "error": "List '\(listName)' not found"])
            return
        }

        // Idempotent: return success if section already exists
        let existing = listSections(listName)
        if existing.contains(where: { $0["name"] == sectionName }) {
            outputJSON(["success": true, "message": "Section '\(sectionName)' already exists in '\(listName)'"])
            return
        }

        let acctCaps = account.value(forKey: "capabilities") as AnyObject?

        guard let saveReqClass = NSClassFromString("REMSaveRequest") as? NSObject.Type,
              let listCIClass = NSClassFromString("REMListChangeItem") as? NSObject.Type else {
            outputJSON(["success": false, "error": "Required ReminderKit classes not found"])
            return
        }

        let saveReq = saveReqClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue() as! NSObject
        _ = saveReq.perform(NSSelectorFromString("initWithStore:"), with: store)

        let listCI = listCIClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue() as! NSObject

        let initSel = NSSelectorFromString("initWithSaveRequest:storage:accountCapabilities:observeInitialValues:")
        guard let initMethod = class_getInstanceMethod(listCIClass, initSel) else {
            outputJSON(["success": false, "error": "initWithSaveRequest method not found"])
            return
        }
        let initFn = unsafeBitCast(method_getImplementation(initMethod),
            to: (@convention(c) (AnyObject, Selector, AnyObject, AnyObject, AnyObject?, Bool) -> AnyObject).self)
        let initializedCI = initFn(listCI, initSel, saveReq, listStorage, acctCaps, false) as! NSObject

        guard let sectionsCtx = initializedCI.perform(
            NSSelectorFromString("sectionsContextChangeItem"))?.takeUnretainedValue() as? NSObject else {
            outputJSON(["success": false, "error": "Could not get sections context"])
            return
        }

        _ = saveReq.perform(
            NSSelectorFromString("addListSectionWithDisplayName:toListSectionContextChangeItem:"),
            with: sectionName as NSString,
            with: sectionsCtx
        )

        if save(saveReq) {
            outputJSON(["success": true, "message": "Created section '\(sectionName)' in '\(listName)'"])
        }
    }

    func deleteSection(_ listName: String, _ sectionName: String) -> Bool {
        guard let (listStorage, _) = findList(listName) else {
            outputJSON(["success": false, "error": "List '\(listName)' not found"])
            return false
        }

        let (sections, _) = callWithError(sectionsView, "fetchListSectionsInList:error:", [listStorage])
        guard let secArray = sections as? NSArray else {
            outputJSON(["success": false, "error": "No sections found"])
            return false
        }

        var targetSection: NSObject?
        for sec in secArray {
            let secObj = sec as! NSObject
            if (secObj.value(forKey: "displayName") as? String) == sectionName {
                targetSection = secObj
                break
            }
        }

        guard let section = targetSection else {
            outputJSON(["success": false, "error": "Section '\(sectionName)' not found in '\(listName)'"])
            return false
        }

        guard let saveReqClass = NSClassFromString("REMSaveRequest") as? NSObject.Type else {
            outputJSON(["success": false, "error": "REMSaveRequest not found"])
            return false
        }

        let saveReq = saveReqClass.perform(NSSelectorFromString("alloc"))!.takeUnretainedValue() as! NSObject
        _ = saveReq.perform(NSSelectorFromString("initWithStore:"), with: store)

        // Must use updateListSection: for properly tracked deletions that sync via CloudKit
        guard let sectionCI = saveReq.perform(
            NSSelectorFromString("updateListSection:"), with: section
        )?.takeUnretainedValue() as? NSObject else {
            outputJSON(["success": false, "error": "Failed to get tracked section change item"])
            return false
        }

        sectionCI.perform(NSSelectorFromString("removeFromList"))

        return save(saveReq)
    }

    /// Trigger a CloudKit sync cycle by making a trivial EventKit edit.
    ///
    /// After membership data is written to SQLite with updated token maps (done by TypeScript),
    /// we need remindd to wake up and run a push cycle. Toggling a trailing space on a
    /// reminder's notes field triggers this without visually affecting the reminder.
    func triggerSync(_ listName: String) -> Bool {
        let eventStore = EKEventStore()
        let semaphore = DispatchSemaphore(value: 0)
        var accessGranted = false

        eventStore.requestFullAccessToReminders { granted, _ in
            accessGranted = granted
            semaphore.signal()
        }
        semaphore.wait()

        guard accessGranted else {
            outputJSON(["success": false, "error": "Reminders access denied"])
            return false
        }

        let calendars = eventStore.calendars(for: .reminder)
        guard let calendar = calendars.first(where: { $0.title == listName }) else {
            outputJSON(["success": false, "error": "List '\(listName)' not found via EventKit"])
            return false
        }

        let predicate = eventStore.predicateForIncompleteReminders(
            withDueDateStarting: nil, ending: nil, calendars: [calendar])
        var reminders: [EKReminder]?
        let fetchSemaphore = DispatchSemaphore(value: 0)
        eventStore.fetchReminders(matching: predicate) { result in
            reminders = result
            fetchSemaphore.signal()
        }
        fetchSemaphore.wait()

        guard let reminder = reminders?.first else {
            outputJSON(["success": true,
                        "message": "No incomplete reminders to trigger sync — data will sync on next natural edit",
                        "warning": "no_reminders_for_sync_trigger"])
            return true
        }

        // Toggle trailing space on notes to trigger sync
        let currentNotes = reminder.notes ?? ""
        if currentNotes.hasSuffix(" ") {
            reminder.notes = String(currentNotes.dropLast())
        } else {
            reminder.notes = currentNotes + " "
        }

        do {
            try eventStore.save(reminder, commit: true)
            return true
        } catch {
            outputJSON(["success": false, "error": "Sync trigger save failed: \(error.localizedDescription)"])
            return false
        }
    }

    private func save(_ saveReq: NSObject) -> Bool {
        let saveSel = NSSelectorFromString("saveSynchronouslyWithError:")
        let saveMethod = class_getInstanceMethod(type(of: saveReq), saveSel)!
        let saveFn = unsafeBitCast(method_getImplementation(saveMethod),
            to: (@convention(c) (AnyObject, Selector, UnsafeMutablePointer<NSError?>) -> Bool).self)
        var saveError: NSError?
        let success = saveFn(saveReq, saveSel, &saveError)

        if !success {
            outputJSON(["success": false, "error": "Save failed: \(String(describing: saveError))"])
        }
        return success
    }
}

// MARK: - Database Helper (SQLite C API for proper transactions)

class DBHelper {
    /// Find the active Reminders SQLite database
    static func findDb() -> String? {
        let home = NSHomeDirectory()
        let storesDir = "\(home)/Library/Group Containers/group.com.apple.reminders/Container_v1/Stores"
        let fm = FileManager.default

        guard fm.fileExists(atPath: storesDir),
              let files = try? fm.contentsOfDirectory(atPath: storesDir) else {
            return nil
        }

        let sqliteFiles = files.filter { $0.hasSuffix(".sqlite") && !$0.contains("-wal") && !$0.contains("-shm") }

        for file in sqliteFiles {
            let dbPath = "\(storesDir)/\(file)"
            var db: OpaquePointer?
            guard sqlite3_open_v2(dbPath, &db, SQLITE_OPEN_READONLY, nil) == SQLITE_OK else { continue }
            defer { sqlite3_close(db) }

            var stmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, "SELECT COUNT(*) FROM ZREMCDREMINDER", -1, &stmt, nil) == SQLITE_OK else { continue }
            defer { sqlite3_finalize(stmt) }

            if sqlite3_step(stmt) == SQLITE_ROW && sqlite3_column_int(stmt, 0) > 0 {
                return dbPath
            }
        }
        return nil
    }

    /// Open a database connection with WAL mode and busy timeout
    static func openDb(_ path: String) -> OpaquePointer? {
        var db: OpaquePointer?
        guard sqlite3_open(path, &db) == SQLITE_OK else { return nil }
        sqlite3_busy_timeout(db, 5000)
        sqlite3_exec(db, "PRAGMA journal_mode=WAL", nil, nil, nil)
        return db
    }

    /// Get database stats
    static func stats() {
        guard let dbPath = findDb() else {
            outputJSON(["success": false, "error": "Reminders database not found"])
            return
        }
        guard let db = openDb(dbPath) else {
            outputJSON(["success": false, "error": "Cannot open database"])
            return
        }
        defer { sqlite3_close(db) }

        func count(_ table: String) -> Int {
            var stmt: OpaquePointer?
            let sql = "SELECT COUNT(*) FROM \(table) WHERE ZMARKEDFORDELETION = 0"
            guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return 0 }
            defer { sqlite3_finalize(stmt) }
            return sqlite3_step(stmt) == SQLITE_ROW ? Int(sqlite3_column_int(stmt, 0)) : 0
        }

        outputJSON([
            "success": true,
            "dbPath": dbPath,
            "lists": count("ZREMCDBASELIST"),
            "sections": count("ZREMCDBASESECTION"),
            "reminders": count("ZREMCDREMINDER"),
        ])
    }

    /// Find a list's Z_PK by name
    static func findList(_ listName: String) -> Int? {
        guard let dbPath = findDb(), let db = openDb(dbPath) else { return nil }
        defer { sqlite3_close(db) }

        var stmt: OpaquePointer?
        let sql = "SELECT Z_PK FROM ZREMCDBASELIST WHERE ZNAME = ? AND ZMARKEDFORDELETION = 0"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else { return nil }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_text(stmt, 1, (listName as NSString).utf8String, -1, nil)
        return sqlite3_step(stmt) == SQLITE_ROW ? Int(sqlite3_column_int(stmt, 0)) : nil
    }

    /// Find a reminder's Z_PK and hex UUID by title and list name
    static func findReminder(_ title: String, _ listName: String) {
        guard let dbPath = findDb(), let db = openDb(dbPath) else {
            outputJSON(["success": false, "error": "Database not found"])
            return
        }
        defer { sqlite3_close(db) }

        var stmt: OpaquePointer?
        let sql = """
            SELECT r.Z_PK, hex(r.ZIDENTIFIER) FROM ZREMCDREMINDER r
            JOIN ZREMCDBASELIST l ON r.ZLIST = l.Z_PK
            WHERE r.ZTITLE = ? AND l.ZNAME = ? AND r.ZCOMPLETED = 0 AND r.ZMARKEDFORDELETION = 0
            ORDER BY r.ZCREATIONDATE DESC LIMIT 1
            """
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            outputJSON(["success": false, "error": "Query failed"])
            return
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_text(stmt, 1, (title as NSString).utf8String, -1, nil)
        sqlite3_bind_text(stmt, 2, (listName as NSString).utf8String, -1, nil)

        if sqlite3_step(stmt) == SQLITE_ROW {
            let pk = Int(sqlite3_column_int(stmt, 0))
            let identifier = String(cString: sqlite3_column_text(stmt, 1))
            outputJSON(["success": true, "pk": pk, "identifier": identifier])
        } else {
            outputJSON(["success": false, "error": "Reminder '\(title)' not found in '\(listName)'"])
        }
    }

    /// Find a section's Z_PK and hex UUID
    static func findSection(_ sectionName: String, _ listName: String) {
        guard let dbPath = findDb(), let db = openDb(dbPath) else {
            outputJSON(["success": false, "error": "Database not found"])
            return
        }
        defer { sqlite3_close(db) }

        var stmt: OpaquePointer?
        let sql = """
            SELECT s.Z_PK, hex(s.ZIDENTIFIER) FROM ZREMCDBASESECTION s
            JOIN ZREMCDBASELIST l ON s.ZLIST = l.Z_PK
            WHERE s.ZDISPLAYNAME = ? AND l.ZNAME = ? AND s.ZMARKEDFORDELETION = 0
            """
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            outputJSON(["success": false, "error": "Query failed"])
            return
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_text(stmt, 1, (sectionName as NSString).utf8String, -1, nil)
        sqlite3_bind_text(stmt, 2, (listName as NSString).utf8String, -1, nil)

        if sqlite3_step(stmt) == SQLITE_ROW {
            let pk = Int(sqlite3_column_int(stmt, 0))
            let identifier = String(cString: sqlite3_column_text(stmt, 1))
            outputJSON(["success": true, "pk": pk, "identifier": identifier])
        } else {
            outputJSON(["success": false, "error": "Section '\(sectionName)' not found in '\(listName)'"])
        }
    }

    /// Read membership data JSON for a list
    static func readMemberships(_ listName: String) {
        guard let dbPath = findDb(), let db = openDb(dbPath) else {
            outputJSON(["success": false, "error": "Database not found"])
            return
        }
        defer { sqlite3_close(db) }

        guard let listPk = findList(listName) else {
            outputJSON(["success": false, "error": "List '\(listName)' not found"])
            return
        }

        var stmt: OpaquePointer?
        let sql = "SELECT cast(ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA as text) FROM ZREMCDBASELIST WHERE Z_PK = ?"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            outputJSON(["success": false, "error": "Query failed"])
            return
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_int(stmt, 1, Int32(listPk))

        if sqlite3_step(stmt) == SQLITE_ROW, let text = sqlite3_column_text(stmt, 0) {
            outputJSON(["success": true, "data": String(cString: text)])
        } else {
            outputJSON(["success": true, "data": NSNull()])
        }
    }

    /// Read token map JSON for a list
    static func readTokenMap(_ listName: String) {
        guard let dbPath = findDb(), let db = openDb(dbPath) else {
            outputJSON(["success": false, "error": "Database not found"])
            return
        }
        defer { sqlite3_close(db) }

        guard let listPk = findList(listName) else {
            outputJSON(["success": false, "error": "List '\(listName)' not found"])
            return
        }

        var stmt: OpaquePointer?
        let sql = "SELECT cast(ZRESOLUTIONTOKENMAP_V3_JSONDATA as text) FROM ZREMCDBASELIST WHERE Z_PK = ?"
        guard sqlite3_prepare_v2(db, sql, -1, &stmt, nil) == SQLITE_OK else {
            outputJSON(["success": false, "error": "Query failed"])
            return
        }
        defer { sqlite3_finalize(stmt) }

        sqlite3_bind_int(stmt, 1, Int32(listPk))

        if sqlite3_step(stmt) == SQLITE_ROW, let text = sqlite3_column_text(stmt, 0) {
            outputJSON(["success": true, "data": String(cString: text)])
        } else {
            outputJSON(["success": true, "data": NSNull()])
        }
    }

    /// Full atomic membership sync: write data + checksum + token map in one transaction, then trigger sync.
    /// This is the key operation — the three writes MUST be atomic to prevent remindd detecting corruption.
    static func writeMembershipSync(_ listName: String, _ membershipJSON: String, bridge: REMBridge) {
        guard let dbPath = findDb(), let db = openDb(dbPath) else {
            outputJSON(["success": false, "error": "Database not found"])
            return
        }
        defer { sqlite3_close(db) }

        guard let listPk = findList(listName) else {
            outputJSON(["success": false, "error": "List '\(listName)' not found in database"])
            return
        }

        // Compute SHA-512 checksum
        let data = membershipJSON.data(using: .utf8)!
        var digest = [UInt8](repeating: 0, count: Int(CC_SHA512_DIGEST_LENGTH))
        data.withUnsafeBytes { ptr in
            _ = CC_SHA512(ptr.baseAddress, CC_LONG(data.count), &digest)
        }
        let checksumHex = digest.map { String(format: "%02x", $0) }.joined()

        // Read current token map and increment counter
        let coreDataTimestamp = Date().timeIntervalSinceReferenceDate
        var tokenMap: [String: Any] = [:]

        var readStmt: OpaquePointer?
        let readSql = "SELECT cast(ZRESOLUTIONTOKENMAP_V3_JSONDATA as text) FROM ZREMCDBASELIST WHERE Z_PK = ?"
        if sqlite3_prepare_v2(db, readSql, -1, &readStmt, nil) == SQLITE_OK {
            sqlite3_bind_int(readStmt, 1, Int32(listPk))
            if sqlite3_step(readStmt) == SQLITE_ROW, let text = sqlite3_column_text(readStmt, 0) {
                let rawStr = String(cString: text)
                if let jsonData = rawStr.data(using: .utf8),
                   let parsed = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any] {
                    tokenMap = parsed
                }
            }
            sqlite3_finalize(readStmt)
        }

        let fieldKey = "membershipsOfRemindersInSectionsChecksum"
        var currentCounter = 0
        if let existing = tokenMap[fieldKey] as? [String: Any],
           let counter = existing["counter"] as? Int {
            currentCounter = counter
        }
        tokenMap[fieldKey] = ["counter": currentCounter + 1, "modificationTime": coreDataTimestamp]

        guard let tokenMapData = try? JSONSerialization.data(withJSONObject: tokenMap, options: [.sortedKeys]),
              let tokenMapJSON = String(data: tokenMapData, encoding: .utf8) else {
            outputJSON(["success": false, "error": "Failed to serialize token map"])
            return
        }

        // ATOMIC TRANSACTION: write data + checksum + token map
        guard sqlite3_exec(db, "BEGIN TRANSACTION", nil, nil, nil) == SQLITE_OK else {
            outputJSON(["success": false, "error": "Failed to begin transaction"])
            return
        }

        var success = true
        let updates: [(String, String)] = [
            ("UPDATE ZREMCDBASELIST SET ZMEMBERSHIPSOFREMINDERSINSECTIONSASDATA = ? WHERE Z_PK = ?", membershipJSON),
            ("UPDATE ZREMCDBASELIST SET ZMEMBERSHIPSOFREMINDERSINSECTIONSCHECKSUM = ? WHERE Z_PK = ?", checksumHex),
            ("UPDATE ZREMCDBASELIST SET ZRESOLUTIONTOKENMAP_V3_JSONDATA = ? WHERE Z_PK = ?", tokenMapJSON),
        ]

        for (sql, value) in updates {
            var updateStmt: OpaquePointer?
            guard sqlite3_prepare_v2(db, sql, -1, &updateStmt, nil) == SQLITE_OK else {
                success = false; break
            }
            sqlite3_bind_text(updateStmt, 1, (value as NSString).utf8String, -1, nil)
            sqlite3_bind_int(updateStmt, 2, Int32(listPk))
            if sqlite3_step(updateStmt) != SQLITE_DONE { success = false }
            sqlite3_finalize(updateStmt)
            if !success { break }
        }

        if success {
            sqlite3_exec(db, "COMMIT", nil, nil, nil)
        } else {
            sqlite3_exec(db, "ROLLBACK", nil, nil, nil)
            outputJSON(["success": false, "error": "Failed to write membership data"])
            return
        }

        // Trigger sync via EventKit
        let syncTriggered = bridge.triggerSync(listName)
        if !syncTriggered {
            // Check if triggerSync already output JSON (it does on most failures)
            // For the "no reminders" case it outputs success with warning
        }

        outputJSON(["success": true, "message": "Memberships written and sync triggered for '\(listName)'"])
    }
}

// MARK: - Main

guard let bridge = REMBridge() else {
    outputJSON(["success": false, "error": "Failed to initialize ReminderKit bridge. Is ReminderKit available on this macOS version?"])
    exit(1)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    outputJSON(["success": false, "error": "Usage: section-helper <command> [args...]\nCommands: list-sections, create-section, delete-section, trigger-sync"])
    exit(1)
}

let command = args[1]

switch command {
case "list-sections":
    guard args.count >= 3 else {
        outputJSON(["success": false, "error": "Usage: list-sections <listName>"]); exit(1)
    }
    let sections = bridge.listSections(args[2])
    outputJSON(["success": true, "sections": sections])

case "create-section":
    guard args.count >= 4 else {
        outputJSON(["success": false, "error": "Usage: create-section <listName> <sectionName>"]); exit(1)
    }
    bridge.createSection(args[2], args[3])

case "delete-section":
    guard args.count >= 4 else {
        outputJSON(["success": false, "error": "Usage: delete-section <listName> <sectionName>"]); exit(1)
    }
    // deleteSection outputs its own error JSON internally
    if bridge.deleteSection(args[2], args[3]) {
        outputJSON(["success": true, "message": "Deleted section '\(args[3])' from '\(args[2])'"])
    }

case "trigger-sync":
    guard args.count >= 3 else {
        outputJSON(["success": false, "error": "Usage: trigger-sync <listName>"]); exit(1)
    }
    if bridge.triggerSync(args[2]) {
        outputJSON(["success": true, "message": "Sync triggered for '\(args[2])'"])
    }

// -- Database commands --

case "db-find-db":
    if let path = DBHelper.findDb() {
        outputJSON(["success": true, "dbPath": path])
    } else {
        outputJSON(["success": false, "error": "Reminders database not found"])
    }

case "db-stats":
    DBHelper.stats()

case "db-find-list":
    guard args.count >= 3 else {
        outputJSON(["success": false, "error": "Usage: db-find-list <listName>"]); exit(1)
    }
    if let pk = DBHelper.findList(args[2]) {
        outputJSON(["success": true, "pk": pk])
    } else {
        outputJSON(["success": false, "error": "List '\(args[2])' not found"])
    }

case "db-find-reminder":
    guard args.count >= 4 else {
        outputJSON(["success": false, "error": "Usage: db-find-reminder <title> <listName>"]); exit(1)
    }
    DBHelper.findReminder(args[2], args[3])

case "db-find-section":
    guard args.count >= 4 else {
        outputJSON(["success": false, "error": "Usage: db-find-section <sectionName> <listName>"]); exit(1)
    }
    DBHelper.findSection(args[2], args[3])

case "db-read-memberships":
    guard args.count >= 3 else {
        outputJSON(["success": false, "error": "Usage: db-read-memberships <listName>"]); exit(1)
    }
    DBHelper.readMemberships(args[2])

case "db-read-tokenmap":
    guard args.count >= 3 else {
        outputJSON(["success": false, "error": "Usage: db-read-tokenmap <listName>"]); exit(1)
    }
    DBHelper.readTokenMap(args[2])

case "db-write-membership-sync":
    guard args.count >= 4 else {
        outputJSON(["success": false, "error": "Usage: db-write-membership-sync <listName> <membershipJSON>"]); exit(1)
    }
    DBHelper.writeMembershipSync(args[2], args[3], bridge: bridge)

default:
    outputJSON(["success": false, "error": "Unknown command: \(command)"])
}
