#!/usr/bin/env swift
/**
 * remi - Apple Reminders EventKit helper
 *
 * Usage: swift reminders-helper.swift <command> [json-args]
 *
 * Commands:
 *   list-lists                          List all reminder lists
 *   get-reminders <json>                Get reminders with filtering
 *   search <json>                       Search reminders across all lists
 *   create <json>                       Create a reminder
 *   edit <json>                         Edit an existing reminder
 *   complete <json>                     Mark reminder complete
 *   delete <json>                       Delete a reminder
 *   create-list <json>                  Create a new reminder list
 *   delete-list <json>                  Delete a reminder list
 *
 * All output is JSON.
 */

import EventKit
import Foundation

// MARK: - Types

struct ReminderList: Encodable {
    let id: String
    let title: String
    let reminderCount: Int
    let overdueCount: Int
}

struct ReminderItem: Encodable {
    let id: String
    let title: String
    let isCompleted: Bool
    let listID: String
    let listName: String
    let priority: String
    let dueDate: String?
    let completionDate: String?
    let notes: String?
    let isRecurring: Bool
}

struct ResultResponse: Encodable {
    let success: Bool
    let data: AnyCodable?
    let error: String?
}

struct AnyCodable: Encodable {
    let value: Any

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        if let arr = value as? [Encodable] {
            try container.encode(arr.map { AnyEncodableWrapper($0) })
        } else if let str = value as? String {
            try container.encode(str)
        } else if let bool = value as? Bool {
            try container.encode(bool)
        } else if let int = value as? Int {
            try container.encode(int)
        } else {
            try container.encodeNil()
        }
    }
}

struct AnyEncodableWrapper: Encodable {
    let wrapped: Encodable
    init(_ wrapped: Encodable) { self.wrapped = wrapped }
    func encode(to encoder: Encoder) throws { try wrapped.encode(to: encoder) }
}

// MARK: - Helpers

let dateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone.current
    return f
}()

let isoFormatter: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

func priorityString(_ p: Int) -> String {
    switch p {
    case 1...4: return "high"
    case 5: return "medium"
    case 6...9: return "low"
    default: return "none"
    }
}

func priorityInt(_ s: String) -> Int {
    switch s {
    case "high": return 1
    case "medium": return 5
    case "low": return 9
    default: return 0
    }
}

func output(_ result: ResultResponse) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    if let data = try? encoder.encode(result), let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        print("{\"success\":false,\"error\":\"Failed to encode result\"}")
    }
}

func outputList(_ lists: [ReminderList]) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    if let data = try? encoder.encode(lists), let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

func outputReminders(_ items: [ReminderItem]) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .sortedKeys
    if let data = try? encoder.encode(items), let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

func reminderToItem(_ r: EKReminder) -> ReminderItem {
    var dueDateStr: String? = nil
    if let due = r.dueDateComponents, let year = due.year, let month = due.month, let day = due.day {
        dueDateStr = String(format: "%04d-%02d-%02d", year, month, day)
    }
    var completionStr: String? = nil
    if let cd = r.completionDate {
        completionStr = isoFormatter.string(from: cd)
    }

    return ReminderItem(
        id: r.calendarItemIdentifier,
        title: r.title ?? "",
        isCompleted: r.isCompleted,
        listID: r.calendar.calendarIdentifier,
        listName: r.calendar.title,
        priority: priorityString(Int(r.priority)),
        dueDate: dueDateStr,
        completionDate: completionStr,
        notes: r.notes,
        isRecurring: (r.recurrenceRules ?? []).count > 0
    )
}

// MARK: - Commands

func listLists(_ store: EKEventStore) {
    let calendars = store.calendars(for: .reminder)
    var results: [ReminderList] = []
    let group = DispatchGroup()

    for cal in calendars {
        group.enter()
        let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: [cal])
        store.fetchReminders(matching: pred) { reminders in
            let items = reminders ?? []
            let now = Date()
            let overdue = items.filter { r in
                guard let due = r.dueDateComponents,
                      let year = due.year, let month = due.month, let day = due.day else { return false }
                var comps = DateComponents()
                comps.year = year; comps.month = month; comps.day = day
                guard let dueDate = Calendar.current.date(from: comps) else { return false }
                return dueDate < now
            }.count

            results.append(ReminderList(
                id: cal.calendarIdentifier,
                title: cal.title,
                reminderCount: items.count,
                overdueCount: overdue
            ))
            group.leave()
        }
    }

    group.wait()
    outputList(results.sorted { $0.title < $1.title })
}

struct GetRemindersArgs: Decodable {
    let filter: String?
    let list: String?
    let days: Int?
}

func getReminders(_ store: EKEventStore, _ args: GetRemindersArgs) {
    let filter = args.filter ?? "upcoming"
    let calendars: [EKCalendar]

    if let listName = args.list {
        calendars = store.calendars(for: .reminder).filter { $0.title == listName }
        if calendars.isEmpty {
            output(ResultResponse(success: false, data: nil, error: "List '\(listName)' not found"))
            return
        }
    } else {
        calendars = store.calendars(for: .reminder)
    }

    let sem = DispatchSemaphore(value: 0)
    let pred: NSPredicate

    switch filter {
    case "completed":
        pred = store.predicateForCompletedReminders(withCompletionDateStarting: nil, ending: nil, calendars: calendars)
    case "all":
        let pred1 = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
        let pred2 = store.predicateForCompletedReminders(withCompletionDateStarting: nil, ending: nil, calendars: calendars)
        var allItems: [ReminderItem] = []
        let group = DispatchGroup()

        group.enter()
        store.fetchReminders(matching: pred1) { reminders in
            allItems.append(contentsOf: (reminders ?? []).map(reminderToItem))
            group.leave()
        }
        group.enter()
        store.fetchReminders(matching: pred2) { reminders in
            allItems.append(contentsOf: (reminders ?? []).map(reminderToItem))
            group.leave()
        }
        group.wait()
        outputReminders(allItems)
        return
    default:
        pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
    }

    store.fetchReminders(matching: pred) { reminders in
        var items = (reminders ?? []).map(reminderToItem)

        let cal = Calendar.current
        let now = Date()

        switch filter {
        case "today":
            items = items.filter { item in
                guard let ds = item.dueDate, let d = dateFormatter.date(from: ds) else { return false }
                return cal.isDateInToday(d)
            }
        case "tomorrow":
            items = items.filter { item in
                guard let ds = item.dueDate, let d = dateFormatter.date(from: ds) else { return false }
                return cal.isDateInTomorrow(d)
            }
        case "week":
            let weekEnd = cal.date(byAdding: .day, value: 7, to: now)!
            items = items.filter { item in
                guard let ds = item.dueDate, let d = dateFormatter.date(from: ds) else { return false }
                return d <= weekEnd
            }
        case "upcoming":
            let days = args.days ?? 7
            let upcomingEnd = cal.date(byAdding: .day, value: days, to: now)!
            items = items.filter { item in
                guard let ds = item.dueDate, let d = dateFormatter.date(from: ds) else { return false }
                return d <= upcomingEnd
            }
        case "overdue":
            let startOfToday = cal.startOfDay(for: now)
            items = items.filter { item in
                guard let ds = item.dueDate, let d = dateFormatter.date(from: ds) else { return false }
                return d < startOfToday
            }
        default:
            // Try parsing as date
            if let targetDate = dateFormatter.date(from: filter) {
                items = items.filter { item in
                    guard let ds = item.dueDate, let d = dateFormatter.date(from: ds) else { return false }
                    return cal.isDate(d, inSameDayAs: targetDate)
                }
            }
        }

        outputReminders(items)
        sem.signal()
    }
    sem.wait()
}

struct SearchArgs: Decodable {
    let query: String
}

func searchReminders(_ store: EKEventStore, _ args: SearchArgs) {
    let query = args.query.lowercased()
    let calendars = store.calendars(for: .reminder)

    let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: calendars)
    let sem = DispatchSemaphore(value: 0)

    store.fetchReminders(matching: pred) { reminders in
        let items = (reminders ?? [])
            .map(reminderToItem)
            .filter { item in
                item.title.lowercased().contains(query) ||
                (item.notes?.lowercased().contains(query) ?? false)
            }
        outputReminders(items)
        sem.signal()
    }
    sem.wait()
}

struct CreateArgs: Decodable {
    let title: String
    let listName: String
    let due: String?
    let notes: String?
    let priority: String?
}

func createReminder(_ store: EKEventStore, _ args: CreateArgs) {
    let calendars = store.calendars(for: .reminder).filter { $0.title == args.listName }
    guard let cal = calendars.first else {
        output(ResultResponse(success: false, data: nil, error: "List '\(args.listName)' not found"))
        return
    }

    let reminder = EKReminder(eventStore: store)
    reminder.title = args.title
    reminder.calendar = cal

    if let notes = args.notes { reminder.notes = notes }
    if let p = args.priority { reminder.priority = Int(priorityInt(p)) }

    if let dueStr = args.due, let dueDate = dateFormatter.date(from: dueStr) {
        let comps = Calendar.current.dateComponents([.year, .month, .day], from: dueDate)
        reminder.dueDateComponents = comps
    }

    do {
        try store.save(reminder, commit: true)
        output(ResultResponse(success: true, data: AnyCodable(value: reminder.calendarItemIdentifier), error: nil))
    } catch {
        output(ResultResponse(success: false, data: nil, error: "Save failed: \(error.localizedDescription)"))
    }
}

struct EditArgs: Decodable {
    let id: String
    let title: String?
    let listName: String?
    let due: String?
    let clearDue: Bool?
    let notes: String?
    let priority: String?
}

func editReminder(_ store: EKEventStore, _ args: EditArgs) {
    let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
    let sem = DispatchSemaphore(value: 0)

    store.fetchReminders(matching: pred) { reminders in
        guard let reminder = (reminders ?? []).first(where: {
            $0.calendarItemIdentifier.uppercased().hasPrefix(args.id.uppercased())
        }) else {
            output(ResultResponse(success: false, data: nil, error: "Reminder '\(args.id)' not found"))
            sem.signal()
            return
        }

        if let title = args.title { reminder.title = title }
        if let notes = args.notes { reminder.notes = notes }
        if let p = args.priority { reminder.priority = Int(priorityInt(p)) }

        if args.clearDue == true {
            reminder.dueDateComponents = nil
        } else if let dueStr = args.due, let dueDate = dateFormatter.date(from: dueStr) {
            let comps = Calendar.current.dateComponents([.year, .month, .day], from: dueDate)
            reminder.dueDateComponents = comps
        }

        if let listName = args.listName {
            let cals = store.calendars(for: .reminder).filter { $0.title == listName }
            if let cal = cals.first {
                reminder.calendar = cal
            }
        }

        do {
            try store.save(reminder, commit: true)
            output(ResultResponse(success: true, data: AnyCodable(value: reminder.title ?? ""), error: nil))
        } catch {
            output(ResultResponse(success: false, data: nil, error: "Save failed: \(error.localizedDescription)"))
        }
        sem.signal()
    }
    sem.wait()
}

struct IdArgs: Decodable {
    let id: String
}

func completeReminder(_ store: EKEventStore, _ args: IdArgs) {
    let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
    let sem = DispatchSemaphore(value: 0)

    store.fetchReminders(matching: pred) { reminders in
        guard let reminder = (reminders ?? []).first(where: {
            $0.calendarItemIdentifier.uppercased().hasPrefix(args.id.uppercased())
        }) else {
            output(ResultResponse(success: false, data: nil, error: "Reminder '\(args.id)' not found"))
            sem.signal()
            return
        }

        reminder.isCompleted = true
        reminder.completionDate = Date()

        do {
            try store.save(reminder, commit: true)
            output(ResultResponse(success: true, data: AnyCodable(value: reminder.title ?? ""), error: nil))
        } catch {
            output(ResultResponse(success: false, data: nil, error: "Complete failed: \(error.localizedDescription)"))
        }
        sem.signal()
    }
    sem.wait()
}

func deleteReminder(_ store: EKEventStore, _ args: IdArgs) {
    let pred = store.predicateForIncompleteReminders(withDueDateStarting: nil, ending: nil, calendars: nil)
    let pred2 = store.predicateForCompletedReminders(withCompletionDateStarting: nil, ending: nil, calendars: nil)
    let group = DispatchGroup()
    var allReminders: [EKReminder] = []

    group.enter()
    store.fetchReminders(matching: pred) { r in allReminders.append(contentsOf: r ?? []); group.leave() }
    group.enter()
    store.fetchReminders(matching: pred2) { r in allReminders.append(contentsOf: r ?? []); group.leave() }
    group.wait()

    guard let reminder = allReminders.first(where: {
        $0.calendarItemIdentifier.uppercased().hasPrefix(args.id.uppercased())
    }) else {
        output(ResultResponse(success: false, data: nil, error: "Reminder '\(args.id)' not found"))
        return
    }

    let title = reminder.title ?? ""
    do {
        try store.remove(reminder, commit: true)
        output(ResultResponse(success: true, data: AnyCodable(value: title), error: nil))
    } catch {
        output(ResultResponse(success: false, data: nil, error: "Delete failed: \(error.localizedDescription)"))
    }
}

struct CreateListArgs: Decodable {
    let name: String
}

func createList(_ store: EKEventStore, _ args: CreateListArgs) {
    // Check if list already exists (idempotent)
    let existing = store.calendars(for: .reminder).filter { $0.title == args.name }
    if let cal = existing.first {
        output(ResultResponse(success: true, data: AnyCodable(value: cal.calendarIdentifier), error: nil))
        return
    }

    let cal = EKCalendar(for: .reminder, eventStore: store)
    cal.title = args.name

    // Use the default reminder source (iCloud if available)
    if let defaultCal = store.defaultCalendarForNewReminders() {
        cal.source = defaultCal.source
    } else {
        output(ResultResponse(success: false, data: nil, error: "No reminder source available"))
        return
    }

    do {
        try store.saveCalendar(cal, commit: true)
        output(ResultResponse(success: true, data: AnyCodable(value: cal.calendarIdentifier), error: nil))
    } catch {
        output(ResultResponse(success: false, data: nil, error: "Create list failed: \(error.localizedDescription)"))
    }
}

struct DeleteListArgs: Decodable {
    let name: String
}

func deleteList(_ store: EKEventStore, _ args: DeleteListArgs) {
    let calendars = store.calendars(for: .reminder).filter { $0.title == args.name }
    guard let cal = calendars.first else {
        output(ResultResponse(success: false, data: nil, error: "List '\(args.name)' not found"))
        return
    }

    do {
        try store.removeCalendar(cal, commit: true)
        output(ResultResponse(success: true, data: AnyCodable(value: args.name), error: nil))
    } catch {
        output(ResultResponse(success: false, data: nil, error: "Delete list failed: \(error.localizedDescription)"))
    }
}

// MARK: - Main

let store = EKEventStore()
let sem = DispatchSemaphore(value: 0)

store.requestFullAccessToReminders { granted, error in
    guard granted else {
        output(ResultResponse(success: false, data: nil, error: "Reminders access denied. Grant in System Settings > Privacy & Security > Reminders."))
        sem.signal()
        return
    }

    let args = CommandLine.arguments
    guard args.count >= 2 else {
        output(ResultResponse(success: false, data: nil, error: "Usage: reminders-helper.swift <command> [json-args]"))
        sem.signal()
        return
    }

    let command = args[1]
    let jsonArg = args.count > 2 ? args[2] : "{}"

    switch command {
    case "list-lists":
        listLists(store)

    case "get-reminders":
        guard let data = jsonArg.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(GetRemindersArgs.self, from: data) else {
            output(ResultResponse(success: false, data: nil, error: "Invalid JSON for get-reminders"))
            break
        }
        getReminders(store, parsed)

    case "search":
        guard let data = jsonArg.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(SearchArgs.self, from: data) else {
            output(ResultResponse(success: false, data: nil, error: "Invalid JSON for search"))
            break
        }
        searchReminders(store, parsed)

    case "create":
        guard let data = jsonArg.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(CreateArgs.self, from: data) else {
            output(ResultResponse(success: false, data: nil, error: "Invalid JSON for create"))
            break
        }
        createReminder(store, parsed)

    case "edit":
        guard let data = jsonArg.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(EditArgs.self, from: data) else {
            output(ResultResponse(success: false, data: nil, error: "Invalid JSON for edit"))
            break
        }
        editReminder(store, parsed)

    case "complete":
        guard let data = jsonArg.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(IdArgs.self, from: data) else {
            output(ResultResponse(success: false, data: nil, error: "Invalid JSON for complete"))
            break
        }
        completeReminder(store, parsed)

    case "delete":
        guard let data = jsonArg.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(IdArgs.self, from: data) else {
            output(ResultResponse(success: false, data: nil, error: "Invalid JSON for delete"))
            break
        }
        deleteReminder(store, parsed)

    case "create-list":
        guard let data = jsonArg.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(CreateListArgs.self, from: data) else {
            output(ResultResponse(success: false, data: nil, error: "Invalid JSON for create-list"))
            break
        }
        createList(store, parsed)

    case "delete-list":
        guard let data = jsonArg.data(using: .utf8),
              let parsed = try? JSONDecoder().decode(DeleteListArgs.self, from: data) else {
            output(ResultResponse(success: false, data: nil, error: "Invalid JSON for delete-list"))
            break
        }
        deleteList(store, parsed)

    default:
        output(ResultResponse(success: false, data: nil, error: "Unknown command: \(command). Available: list-lists, get-reminders, search, create, edit, complete, delete, create-list, delete-list"))
    }

    sem.signal()
}

sem.wait()
