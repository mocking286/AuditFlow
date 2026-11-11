package com.jiraflow;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.ServiceLoader;

final class PluginRegistry {
    private PluginRegistry() {}

    static Map<String, PluginDescriptor> discover(Path dataDir) {
        Map<String, PluginDescriptor> result = new LinkedHashMap<>();
        PluginDescriptor core = new PluginDescriptor(
                "jiraflow.core",
                "JiraFlow core",
                "2.1.0",
                "built-in",
                true);
        core.hooks.addAll(java.util.List.of(
                "issue.created",
                "issue.updated",
                "issue.transitioned",
                "issue.commented",
                "issue.attached",
                "project.changed",
                "notification.created"));
        result.put(core.id, core);

        for (JiraFlowPlugin plugin : ServiceLoader.load(JiraFlowPlugin.class)) {
            PluginDescriptor descriptor = new PluginDescriptor(
                    plugin.id(),
                    plugin.name(),
                    plugin.version(),
                    "service-loader",
                    true);
            descriptor.hooks.addAll(plugin.hooks());
            result.put(descriptor.id, descriptor);
        }

        Path pluginDir = dataDir.resolve("plugins");
        if (Files.isDirectory(pluginDir)) {
            try (var paths = Files.list(pluginDir)) {
                paths.filter(path -> path.getFileName().toString().endsWith(".json"))
                        .sorted()
                        .forEach(path -> loadDescriptor(path, result));
            } catch (IOException ignored) {
                // Discovery is best effort; a broken optional plugin must not stop the server.
            }
        }
        return result;
    }

    private static void loadDescriptor(Path path, Map<String, PluginDescriptor> result) {
        try {
            Map<String, Object> body = Json.parseObject(Files.readString(path));
            String id = text(body, "id");
            if (id.isBlank()) return;
            PluginDescriptor descriptor = new PluginDescriptor(
                    id,
                    defaulted(body, "name", id),
                    defaulted(body, "version", "1.0.0"),
                    defaulted(body, "source", path.toString()),
                    Json.boolValue(body.get("enabled"), true));
            descriptor.hooks.addAll(Json.stringList(body.get("hooks")));
            result.put(descriptor.id, descriptor);
        } catch (Exception ignored) {
            // Invalid optional descriptors are ignored and remain visible only in server logs.
        }
    }

    private static String text(Map<String, Object> body, String key) {
        Object value = body.get(key);
        return value == null ? "" : String.valueOf(value).trim();
    }

    private static String defaulted(Map<String, Object> body, String key, String fallback) {
        String value = text(body, key);
        return value.isBlank() ? fallback : value;
    }
}
