package com.jiraflow;

import java.util.Set;

/**
 * Small extension point for install-time integrations.
 *
 * <p>Plugins are intentionally side-effect free at discovery time. A plugin can
 * advertise hooks and the REST/UI layer can expose them without loading Jira
 * implementation classes or requiring a third-party runtime.</p>
 */
public interface JiraFlowPlugin {
    String id();

    String name();

    String version();

    default Set<String> hooks() {
        return Set.of();
    }
}
