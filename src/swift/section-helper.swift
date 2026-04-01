/**
 * remi - Apple Reminders Section Helper (ReminderKit private framework)
 *
 * Sections are not exposed via EventKit. This compiled helper uses the private
 * ReminderKit framework for section CRUD (which properly syncs via CloudKit)
 * and provides an EventKit sync trigger for membership changes.
 *
 * Usage: section-helper <command> [args...]
 *
 * Commands:
 *   list-sections <listName>                List sections in a list
 *   create-section <listName> <sectionName> Create a new section (idempotent)
 *   delete-section <listName> <sectionName> Delete a section
 *   trigger-sync <listName>                 Trigger CloudKit sync via EventKit edit
 *
 * All output is JSON.
 *
 * Must be compiled with:
 *   swiftc -framework Foundation -framework EventKit \
 *     -F /System/Library/PrivateFrameworks -framework ReminderKit \
 *     -O -o section-helper section-helper.swift
 */

import Foundation
import ObjectiveC
import EventKit

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

default:
    outputJSON(["success": false, "error": "Unknown command: \(command). Available: list-sections, create-section, delete-section, trigger-sync"])
}
