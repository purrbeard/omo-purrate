import SwiftUI
import OmoKit

@MainActor final class RemoteModel: ObservableObject {
    @Published var store = ConversationStore()
    @Published var macName: String?
    @Published var pendingMacName: String?
    var trustedMacName: String? { transport.trustedMacName }
    @Published var bridgeState = "waiting"
    @Published var errorMessage: String?
    @Published var busyThreads: Set<String> = []
    @Published var refreshing = false
    /// The model/list failure, shown by the model picker; sending continues without a model.
    @Published var modelsError: String?
    @Published var skillsError: String?
    private let transport = USBListener()
    private lazy var rpc = RPCClient(transport: transport)
    private var generation = 0
    private var refreshTask: Task<Void, Never>?
    private var started = false
    var ready: Bool { macName != nil && bridgeState == "connected" }

    init() {
        transport.onTrustRequest = { [weak self] in self?.pendingMacName = $0 }
        rpc.onEvent = { [weak self] in self?.receive($0) }
        rpc.onDisconnect = { [weak self] error in
            guard let self else { return }
            self.generation += 1
            self.refreshTask?.cancel(); self.refreshTask = nil
            self.refreshing = false
            self.macName = nil; self.bridgeState = "waiting"
            self.store.disconnect()
            if let error { self.errorMessage = error.localizedDescription }
        }
    }
    func start() {
        guard !started else { return }
        do { try transport.start(); started = true }
        catch { errorMessage = error.localizedDescription }
    }
    func stop() {
        started = false
        transport.stop()
        rpc.disconnect()
    }
    private func receive(_ message: BridgeMessage) {
        switch message {
        case let .hello(version, name, state, _):
            guard version == 1 else {
                errorMessage = String(localized: "unsupported_bridge")
                stop(); return
            }
            macName = name; bridgeState = state
            if ready { scheduleRefresh() }
        case .bridgeStatus(let state):
            bridgeState = state
            if ready { scheduleRefresh() }
            else {
                generation += 1
                refreshTask?.cancel(); refreshTask = nil
                refreshing = false
                rpc.disconnect(); store.disconnect()
            }
        case let .notification(method, params): store.apply(method: method, params: params)
        case let .serverRequest(id, method, params): store.receiveServerRequest(id: id, method: method, params: params)
        default: break
        }
    }
    func resolveMacTrust(approve: Bool) { transport.resolveTrust(approve: approve) }
    private func scheduleRefresh() {
        guard refreshTask == nil else { return }
        let epoch = generation
        refreshTask = Task { [weak self] in
            guard let self, self.generation == epoch else { return }
            await self.refresh()
            await self.loadModels()
            if self.generation == epoch { self.refreshTask = nil }
        }
    }
    func refresh() async {
        guard ready, !refreshing else { return }
        refreshing = true
        let epoch = generation
        defer { if epoch == generation { refreshing = false } }
        do {
            var cursor: JSONValue = .null
            repeat {
                let result = try await rpc.call("thread/list", params: .object(["cursor": cursor, "limit": .number(100)]))
                guard epoch == generation, ready else { return }
                store.mergeList(result)
                cursor = result["nextCursor"]
            } while cursor.string != nil
        } catch { if epoch == generation, !Task.isCancelled { errorMessage = error.localizedDescription } }
    }
    func open(_ id: String) async {
        guard ready, !busyThreads.contains(id) else { return }
        busyThreads.insert(id)
        let epoch = generation
        defer { busyThreads.remove(id) }
        do {
            let resumed = try await rpc.call("thread/resume", params: .object(["threadId": .string(id)]))
            guard epoch == generation else { return }
            store.load(resumed["thread"])
            let read = try await rpc.call("thread/read", params: .object(["threadId": .string(id), "includeTurns": .bool(true)]))
            guard epoch == generation else { return }
            store.load(read["thread"])
        } catch { if epoch == generation { errorMessage = error.localizedDescription } }
        if epoch == generation, let cwd = store.threads[id]?.cwd { await loadSkills(cwd: cwd) }
    }
    func loadModels() async {
        guard ready else { return }
        let epoch = generation
        do {
            let result = try await rpc.call("model/list")
            guard epoch == generation else { return }
            store.setModels(result); modelsError = nil
        } catch { if epoch == generation { modelsError = error.localizedDescription } }
    }
    func loadSkills(cwd: String) async {
        guard ready else { return }
        let epoch = generation
        do {
            let result = try await rpc.call("skills/list", params: .object(["cwds": .array([.string(cwd)])]))
            guard epoch == generation else { return }
            store.setSkills(result, cwd: cwd); skillsError = nil
        } catch { if epoch == generation { skillsError = error.localizedDescription } }
    }
    func select(model: String?, effort: String?) { store.select(model: model, effort: effort) }
    /// Sends the serverAnswer for a pending request once; a second answer for the same id does nothing.
    func answer(requestID: JSONValue, result: JSONValue) async {
        guard ready, let request = store.resolveServerRequest(requestID) else { return }
        do { try await transport.send(.serverAnswer(id: requestID, result: result)) }
        catch {
            // The bridge never received it; restore the request so the user can answer again.
            store.receiveServerRequest(id: request.requestID, method: request.method, params: request.params)
            errorMessage = error.localizedDescription
        }
    }
    /// Renames optimistically; a rejected rename restores the previous name.
    @discardableResult func rename(threadID: String, name: String) async -> Bool {
        guard ready, let thread = store.threads[threadID] else { return false }
        let previous = thread.name
        let epoch = generation
        store.rename(threadID: threadID, name: name)
        do {
            _ = try await rpc.call("thread/name/set", params: .object(["threadId": .string(threadID), "name": .string(name)]))
            return true
        } catch {
            if store.threads[threadID]?.name == name { store.rename(threadID: threadID, name: previous) }
            if epoch == generation { errorMessage = error.localizedDescription }
            return false
        }
    }
    /// Removes the thread only after the Mac confirms; a rejected delete keeps it.
    @discardableResult func delete(threadID: String) async -> Bool {
        guard ready, store.threads[threadID] != nil else { return false }
        let epoch = generation
        do {
            _ = try await rpc.call("thread/delete", params: .object(["threadId": .string(threadID)]))
            store.remove(threadID: threadID)
            return true
        } catch {
            if epoch == generation { errorMessage = error.localizedDescription }
            return false
        }
    }
    func create(cwd: String) async -> String? {
        guard ready else { return nil }
        let epoch = generation
        do {
            let result = try await rpc.call("thread/start", params: .object(["cwd": .string(cwd)]))
            guard epoch == generation else { return nil }
            store.load(result["thread"])
            return result["thread"]["id"].string
        } catch { if epoch == generation { errorMessage = error.localizedDescription }; return nil }
    }
    /// Returns false on failure so the composer preserves the user's draft.
    func send(threadID: String, text: String) async -> Bool {
        guard ready, !busyThreads.contains(threadID) else { return false }
        busyThreads.insert(threadID)
        let epoch = generation
        let request = store.request(threadID: threadID, text: text)
        let echoID = store.echo(threadID: threadID, text: text)
        defer { busyThreads.remove(threadID) }
        do {
            let result = try await rpc.call(request.method, params: request.params)
            guard epoch == generation else { store.removeEcho(threadID: threadID, id: echoID); return false }
            if request.method == "turn/start", result["turn"]["id"].string != nil {
                // A notification may already have streamed this turn. Only seed it if absent.
                let turnID = result["turn"]["id"].string!
                if store.threads[threadID]?.turns.contains(where: { $0.id == turnID }) != true {
                    store.apply(method: "turn/started", params: .object(["threadId": .string(threadID), "turn": result["turn"]]))
                }
            }
            return true
        } catch {
            store.removeEcho(threadID: threadID, id: echoID)
            if epoch == generation { errorMessage = error.localizedDescription }
            return false
        }
    }
    func interrupt(_ id: String) async {
        guard ready, let turn = store.threads[id]?.activeTurnID else { return }
        do { _ = try await rpc.call("turn/interrupt", params: .object(["threadId": .string(id), "turnId": .string(turn)])) }
        catch {
            store.interrupt(threadID: id)
            errorMessage = error.localizedDescription
        }
    }
}
