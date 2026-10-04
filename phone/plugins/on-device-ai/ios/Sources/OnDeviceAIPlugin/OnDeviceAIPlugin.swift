import Foundation
import Capacitor

/// Exposes Apple's on-device AI and photo reading to the Family Planner web code.
///   availability() -> { available, reason }
///   generate({ instructions, prompt, schemaJson? }) -> { text }   (a JSON Schema as a string; text is JSON when given)
///   scanImage({ base64, only? }) -> { text, barcodes, labels: [{ name, confidence }], colour }
@objc(OnDeviceAIPlugin)
public class OnDeviceAIPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OnDeviceAIPlugin"
    public let jsName = "OnDeviceAI"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "availability", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "generate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "scanImage", returnType: CAPPluginReturnPromise)
    ]

    @objc func availability(_ call: CAPPluginCall) {
        let status = OnDeviceModel.availability()
        call.resolve(["available": status.available, "reason": status.reason])
    }

    @objc func generate(_ call: CAPPluginCall) {
        guard let prompt = call.getString("prompt"), !prompt.isEmpty else {
            call.reject("Missing prompt")
            return
        }
        let instructions = call.getString("instructions") ?? ""
        // The schema comes as a JSON string so it reaches Swift as plain Foundation values.
        let schema = call.getString("schemaJson")
            .flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        Task {
            do {
                let text = try await OnDeviceModel.generate(instructions: instructions, prompt: prompt, schema: schema)
                call.resolve(["text": text])
            } catch let error as OnDeviceModelError {
                call.reject(error.message, error.code)
            } catch {
                call.reject(error.localizedDescription, "failed")
            }
        }
    }

    @objc func scanImage(_ call: CAPPluginCall) {
        guard let base64 = call.getString("base64"),
              let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else {
            call.reject("Missing or invalid image")
            return
        }
        let onlyBarcodes = call.getString("only") == "barcodes"
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let result = try PhotoReader.read(data, onlyBarcodes: onlyBarcodes)
                call.resolve(result)
            } catch {
                call.reject(error.localizedDescription, "scanFailed")
            }
        }
    }
}
