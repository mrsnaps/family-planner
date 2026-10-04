import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

struct OnDeviceModelError: Error {
    let code: String
    let message: String
}

/// Apple's on-device language model (Apple Intelligence, iOS 26+). Each call is a fresh,
/// single-turn session. When a JSON Schema is given, guided generation makes the model
/// return JSON in exactly that shape; if the schema can't be expressed, the schema is
/// put in the prompt instead.
enum OnDeviceModel {
    static func availability() -> (available: Bool, reason: String) {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            switch SystemLanguageModel.default.availability {
            case .available:
                return (true, "available")
            case .unavailable(.deviceNotEligible):
                return (false, "deviceNotEligible")
            case .unavailable(.appleIntelligenceNotEnabled):
                return (false, "appleIntelligenceNotEnabled")
            case .unavailable(.modelNotReady):
                return (false, "modelNotReady")
            default:
                return (false, "unknown")
            }
        }
        return (false, "osTooOld")
        #else
        return (false, "osTooOld")
        #endif
    }

    static func generate(instructions: String, prompt: String, schema: [String: Any]?) async throws -> String {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            guard availability().available else {
                throw OnDeviceModelError(code: "unavailable", message: "Apple Intelligence isn't available on this iPhone.")
            }
            let session = LanguageModelSession(instructions: instructions)
            do {
                if let schema = schema, let guided = try? GuidedSchema.make(from: schema) {
                    do {
                        let response = try await session.respond(to: prompt, schema: guided)
                        return response.content.jsonString
                    } catch LanguageModelSession.GenerationError.decodingFailure {
                        // Fall through to a plain request below.
                    }
                }
                var text = prompt
                if let schema = schema,
                   let data = try? JSONSerialization.data(withJSONObject: schema),
                   let json = String(data: data, encoding: .utf8) {
                    text += "\n\nReply with only a JSON object matching this JSON Schema:\n\(json)"
                }
                let plain = LanguageModelSession(instructions: instructions)
                return try await plain.respond(to: text).content
            } catch let error as LanguageModelSession.GenerationError {
                switch error {
                case .exceededContextWindowSize:
                    throw OnDeviceModelError(code: "contextTooLong", message: "That's too much for the iPhone's built-in AI.")
                case .guardrailViolation:
                    throw OnDeviceModelError(code: "guardrail", message: "The iPhone's built-in AI declined this.")
                default:
                    throw OnDeviceModelError(code: "failed", message: error.localizedDescription)
                }
            }
        }
        #endif
        throw OnDeviceModelError(code: "unavailable", message: "Needs iOS 26 or newer with Apple Intelligence.")
    }
}

#if canImport(FoundationModels)
/// Turns the subset of JSON Schema the app uses (objects, arrays, strings, numbers,
/// integers, booleans and string enums) into a Foundation Models generation schema.
@available(iOS 26.0, *)
enum GuidedSchema {
    struct Unsupported: Error {}

    static func make(from schema: [String: Any]) throws -> GenerationSchema {
        var counter = 0
        let root = try convert(schema, name: "Result", counter: &counter)
        return try GenerationSchema(root: root, dependencies: [])
    }

    private static func convert(_ s: [String: Any], name: String, counter: inout Int) throws -> DynamicGenerationSchema {
        counter += 1
        let unique = "\(name)_\(counter)"
        if let choices = s["enum"] as? [String], !choices.isEmpty {
            return DynamicGenerationSchema(name: unique, anyOf: choices)
        }
        switch s["type"] as? String {
        case "object":
            let props = s["properties"] as? [String: Any] ?? [:]
            let requiredList = s["required"] as? [String] ?? []
            let required = Set(requiredList)
            // The model writes properties in order, so keep the schema's order: JSON objects
            // lose it, but "required" lists the fields in the order they were written.
            let order = requiredList.filter { props[$0] != nil } + props.keys.filter { !required.contains($0) }.sorted()
            var properties: [DynamicGenerationSchema.Property] = []
            for key in order {
                guard let child = props[key] as? [String: Any] else { throw Unsupported() }
                properties.append(DynamicGenerationSchema.Property(
                    name: key,
                    description: child["description"] as? String,
                    schema: try convert(child, name: key, counter: &counter),
                    isOptional: !requiredList.isEmpty && !required.contains(key)))
            }
            return DynamicGenerationSchema(name: unique, description: s["description"] as? String, properties: properties)
        case "array":
            guard let items = s["items"] as? [String: Any] else { throw Unsupported() }
            return DynamicGenerationSchema(
                arrayOf: try convert(items, name: "\(name)Item", counter: &counter),
                minimumElements: s["minItems"] as? Int,
                maximumElements: s["maxItems"] as? Int)
        case "string":
            return DynamicGenerationSchema(type: String.self)
        case "integer":
            return DynamicGenerationSchema(type: Int.self)
        case "number":
            return DynamicGenerationSchema(type: Double.self)
        case "boolean":
            return DynamicGenerationSchema(type: Bool.self)
        default:
            throw Unsupported()
        }
    }
}
#endif
