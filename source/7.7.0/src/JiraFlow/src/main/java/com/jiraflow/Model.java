package com.jiraflow;

import java.io.Serializable;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class Snapshot implements Serializable {
    private static final long serialVersionUID = -2515524501316619982L;
    final Map<String, Project> projects;
    final Map<String, Issue> issues;
    final Map<String, User> users;
    final Map<String, Notification> notifications;
    final List<AuditEvent> auditEvents;
    final List<ProjectEvent> projectEvents;
    final Map<String, Presence> presence;
    final Map<String, LockInfo> locks;
    final Map<String, PluginDescriptor> plugins;
    final Map<Long, SavedFilter> filters;
    final Map<Long, FilterSubscription> filterSubscriptions;
    final Map<Long, ReportTemplate> reportTemplates;
    final Map<String, AdminEntry> adminEntries;
    Map<String, Map<String, String>> integrationCommands;
    final int nextIssueId;
    final long nextEntityId;

    Snapshot(
            Map<String, Project> projects,
            Map<String, Issue> issues,
            Map<String, User> users,
            Map<String, Notification> notifications,
            List<AuditEvent> auditEvents,
            List<ProjectEvent> projectEvents,
            Map<String, Presence> presence,
            Map<String, LockInfo> locks,
            Map<String, PluginDescriptor> plugins,
            Map<Long, SavedFilter> filters,
            Map<Long, FilterSubscription> filterSubscriptions,
            Map<Long, ReportTemplate> reportTemplates,
            Map<String, AdminEntry> adminEntries,
            Map<String, Map<String, String>> integrationCommands,
            int nextIssueId,
            long nextEntityId) {
        this.projects = new LinkedHashMap<>(projects);
        this.issues = new LinkedHashMap<>(issues);
        this.users = new LinkedHashMap<>(users);
        this.notifications = new LinkedHashMap<>(notifications);
        this.auditEvents = new ArrayList<>(auditEvents);
        this.projectEvents = new ArrayList<>(projectEvents);
        this.presence = new LinkedHashMap<>(presence);
        this.locks = new LinkedHashMap<>(locks);
        this.plugins = new LinkedHashMap<>(plugins);
        this.filters = new LinkedHashMap<>(filters);
        this.filterSubscriptions = new LinkedHashMap<>(filterSubscriptions);
        this.reportTemplates = new LinkedHashMap<>(reportTemplates);
        this.adminEntries = new LinkedHashMap<>(adminEntries);
        this.integrationCommands = new LinkedHashMap<>();
        integrationCommands.forEach((key, value) -> this.integrationCommands.put(key, new LinkedHashMap<>(value)));
        this.nextIssueId = nextIssueId;
        this.nextEntityId = nextEntityId;
    }
}

final class Project implements Serializable {
    private static final long serialVersionUID = 834141723776251700L;
    final String key;
    String name;
    String type;
    String description;
    String lead;
    String url;
    String auditflowProjectId = "";
    final ProjectSettings settings = new ProjectSettings();
    final Map<String, LinkedHashSet<String>> roles = new LinkedHashMap<>();
    final List<WorkflowTransition> workflow = new ArrayList<>();
    final Map<Long, Version> versions = new LinkedHashMap<>();
    /*
     * Project components are kept with the project so old snapshots that
     * predate component support remain readable.  Store.normalizeLoadedState
     * initializes this field when it is absent from a legacy snapshot.
     */
    Map<Long, ProjectComponent> components = new LinkedHashMap<>();

    Project(String key, String name, String type, String description) {
        this.key = key;
        this.name = name;
        this.type = type;
        this.description = description;
        this.lead = "testuser";
        this.settings.projectKey = key;
        this.settings.defaultAssignee = "testuser";
        this.settings.boardColumns.put("BACKLOG", "Backlog");
        this.settings.boardColumns.put("TODO", "待开发");
        this.settings.boardColumns.put("IN_PROGRESS", "处理中");
        this.settings.boardColumns.put("DONE", "完成");
        this.settings.wipLimits.put("IN_PROGRESS", 1);
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("key", key);
        result.put("name", name);
        result.put("type", type);
        result.put("description", description);
        result.put("lead", lead);
        result.put("url", url);
        result.put("auditflowProjectId", auditflowProjectId == null ? "" : auditflowProjectId);
        result.put("roles", rolesJson());
        result.put("settings", settings.json());
        result.put("workflow", workflow.stream().map(WorkflowTransition::json).toList());
        result.put("versions", versions.values().stream().map(Version::json).toList());
        result.put("components", components == null
                ? List.of()
                : components.values().stream().map(ProjectComponent::json).toList());
        return result;
    }

    private Map<String, Object> rolesJson() {
        Map<String, Object> result = new LinkedHashMap<>();
        roles.forEach((role, users) -> result.put(role, new ArrayList<>(users)));
        return result;
    }
}

final class ProjectComponent implements Serializable {
    private static final long serialVersionUID = 1L;
    final long id;
    final String projectKey;
    String name;
    String description = "";
    String lead = "";
    final String createdAt;
    String updatedAt;

    ProjectComponent(long id, String projectKey, String name) {
        this.id = id;
        this.projectKey = projectKey;
        this.name = name;
        this.createdAt = Instant.now().toString();
        this.updatedAt = this.createdAt;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("projectKey", projectKey);
        result.put("name", name);
        result.put("description", description);
        result.put("lead", lead);
        result.put("createdAt", createdAt);
        result.put("updatedAt", updatedAt);
        return result;
    }
}

final class ProjectSettings implements Serializable {
    private static final long serialVersionUID = -4957128457749428376L;
    String projectKey = "";
    String description = "";
    String defaultAssignee = "";
    String notificationScheme = "default";
    String permissionScheme = "default";
    boolean issueTypeScreenEnabled = true;
    final LinkedHashMap<String, String> boardColumns = new LinkedHashMap<>();
    final LinkedHashMap<String, Integer> wipLimits = new LinkedHashMap<>();

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("projectKey", projectKey);
        result.put("description", description);
        result.put("defaultAssignee", defaultAssignee);
        result.put("notificationScheme", notificationScheme);
        result.put("permissionScheme", permissionScheme);
        result.put("issueTypeScreenEnabled", issueTypeScreenEnabled);
        result.put("boardColumns", boardColumns);
        result.put("wipLimits", wipLimits);
        return result;
    }
}

final class Issue implements Serializable {
    private static final long serialVersionUID = -7368891151036976170L;
    final long id;
    final String key;
    final String projectKey;
    String summary;
    String description = "";
    String type;
    String priority;
    String status;
    String resolution = "";
    String environment = "";
    String dueDate = "";
    String swimlane;
    String parentKey = "";
    String assignee = "";
    String reporter = "";
    String creator = "";
    int rank;
    final String createdAt;
    String updatedAt;
    long revision = 1;
    final LinkedHashSet<String> labels = new LinkedHashSet<>();
    LinkedHashSet<String> components = new LinkedHashSet<>();
    final ArrayList<String> fixVersions = new ArrayList<>();
    final ArrayList<String> affectsVersions = new ArrayList<>();
    String analysisDomain = "ASPICE";
    String processArea = "";
    String formalScope = "";
    String evidenceRole = "direct";
    /*
     * Provenance for externally imported issue ledgers.  These fields are
     * deliberately scalar so snapshots written by older JiraFlow releases
     * remain deserializable without a schema migration.
     */
    String sourceSystem = "";
    String sourceKind = "";
    String sourceFile = "";
    String sourceSheet = "";
    int sourceRow = 0;
    String sourceIssueId = "";
    String sourceNcId = "";
    String sourceRevision = "";
    String sourceStatus = "";
    String sourceSeverity = "";
    String sourceIssueType = "";
    String traceOriginalRecordUrl = "";
    String assessmentId = "";
    String findingId = "";
    String ownedBy = "";
    String sourceCellsJson = "";
    String assessmentRating = "";
    String assessorDecision = "pending";
    String asil = "";
    String cybersecurityLevel = "";
    String riskStatement = "";
    String objectiveEvidence = "";
    String verificationMethod = "";
    String closureEvidence = "";
    String reviewStatus = "open";
    ArrayList<String> traceLinks = new ArrayList<>();
    final ArrayList<String> subtasks = new ArrayList<>();
    final ArrayList<Comment> comments = new ArrayList<>();
    ArrayList<Worklog> worklogs = new ArrayList<>();
    final LinkedHashMap<Long, Attachment> attachments = new LinkedHashMap<>();
    final LinkedHashSet<String> watchers = new LinkedHashSet<>();
    final LinkedHashSet<String> voters = new LinkedHashSet<>();
    final ArrayList<IssueLink> links = new ArrayList<>();

    Issue(long id, String key, String projectKey, String summary, String type, String priority, String status, String swimlane) {
        this.id = id;
        this.key = key;
        this.projectKey = projectKey;
        this.summary = summary;
        this.type = type;
        this.priority = priority;
        this.status = status;
        this.swimlane = swimlane;
        this.rank = (int) id;
        this.createdAt = Instant.now().toString();
        this.updatedAt = this.createdAt;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("key", key);
        result.put("projectKey", projectKey);
        result.put("summary", summary);
        result.put("description", description);
        result.put("type", type);
        result.put("priority", priority);
        result.put("status", status);
        result.put("resolution", resolution);
        result.put("environment", environment);
        result.put("dueDate", dueDate);
        result.put("swimlane", swimlane);
        result.put("parentKey", parentKey);
        result.put("assignee", assignee);
        result.put("reporter", reporter);
        result.put("creator", creator);
        result.put("rank", rank);
        result.put("createdAt", createdAt);
        result.put("updatedAt", updatedAt);
        result.put("revision", revision);
        result.put("labels", new ArrayList<>(labels));
        result.put("components", new ArrayList<>(components));
        result.put("fixVersions", new ArrayList<>(fixVersions));
        result.put("affectsVersions", new ArrayList<>(affectsVersions));
        result.put("analysisDomain", analysisDomain);
        result.put("processArea", processArea);
        result.put("formalScope", formalScope);
        result.put("evidenceRole", evidenceRole);
        result.put("sourceSystem", sourceSystem);
        result.put("sourceKind", sourceKind);
        result.put("sourceFile", sourceFile);
        result.put("sourceSheet", sourceSheet);
        result.put("sourceRow", sourceRow);
        result.put("sourceIssueId", sourceIssueId);
        result.put("sourceNcId", sourceNcId);
        result.put("sourceRevision", sourceRevision);
        result.put("sourceStatus", sourceStatus);
        result.put("sourceSeverity", sourceSeverity);
        result.put("sourceIssueType", sourceIssueType);
        result.put("traceOriginalRecordUrl", traceOriginalRecordUrl);
        result.put("assessmentId", assessmentId);
        result.put("findingId", findingId);
        result.put("ownedBy", ownedBy);
        result.put("sourceCellsJson", sourceCellsJson);
        result.put("assessmentRating", assessmentRating);
        result.put("assessorDecision", assessorDecision);
        result.put("asil", asil);
        result.put("cybersecurityLevel", cybersecurityLevel);
        result.put("riskStatement", riskStatement);
        result.put("objectiveEvidence", objectiveEvidence);
        result.put("verificationMethod", verificationMethod);
        result.put("closureEvidence", closureEvidence);
        result.put("reviewStatus", reviewStatus);
        result.put("traceLinks", new ArrayList<>(traceLinks));
        result.put("subtasks", new ArrayList<>(subtasks));
        result.put("comments", comments.stream().map(Comment::json).toList());
        result.put("worklogs", worklogs.stream().map(Worklog::json).toList());
        result.put("attachments", attachments.values().stream().map(Attachment::json).toList());
        result.put("watchers", new ArrayList<>(watchers));
        result.put("voters", new ArrayList<>(voters));
        result.put("links", links.stream().map(IssueLink::json).toList());
        return result;
    }

    private void readObject(ObjectInputStream input) throws IOException, ClassNotFoundException {
        input.defaultReadObject();
        if (environment == null) environment = "";
        if (dueDate == null) dueDate = "";
        if (worklogs == null) worklogs = new ArrayList<>();
        if (analysisDomain == null) analysisDomain = "ASPICE";
        if (processArea == null) processArea = "";
        if (formalScope == null) formalScope = "";
        if (evidenceRole == null) evidenceRole = "direct";
        if (sourceSystem == null) sourceSystem = "";
        if (sourceKind == null) sourceKind = "";
        if (sourceFile == null) sourceFile = "";
        if (sourceSheet == null) sourceSheet = "";
        if (sourceIssueId == null) sourceIssueId = "";
        if (sourceNcId == null) sourceNcId = "";
        if (sourceRevision == null) sourceRevision = "";
        if (sourceStatus == null) sourceStatus = "";
        if (sourceSeverity == null) sourceSeverity = "";
        if (sourceIssueType == null) sourceIssueType = "";
        if (traceOriginalRecordUrl == null) traceOriginalRecordUrl = "";
        if (assessmentId == null) assessmentId = "";
        if (findingId == null) findingId = "";
        if (ownedBy == null) ownedBy = "";
        if (sourceCellsJson == null) sourceCellsJson = "";
        if (assessmentRating == null) assessmentRating = "";
        if (assessorDecision == null) assessorDecision = "pending";
        if (asil == null) asil = "";
        if (cybersecurityLevel == null) cybersecurityLevel = "";
        if (riskStatement == null) riskStatement = "";
        if (objectiveEvidence == null) objectiveEvidence = "";
        if (verificationMethod == null) verificationMethod = "";
        if (closureEvidence == null) closureEvidence = "";
        if (reviewStatus == null) reviewStatus = "open";
        if (traceLinks == null) traceLinks = new ArrayList<>();
    }
}

final class Comment implements Serializable {
    private static final long serialVersionUID = 1767719334654940921L;
    final long id;
    final String author;
    String body;
    final String createdAt;
    String updatedAt;
    boolean pinned;

    Comment(long id, String author, String body) {
        this.id = id;
        this.author = author;
        this.body = body;
        this.createdAt = Instant.now().toString();
        this.updatedAt = this.createdAt;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("author", author);
        result.put("body", body);
        result.put("createdAt", createdAt);
        result.put("updatedAt", updatedAt);
        result.put("pinned", pinned);
        return result;
    }
}

final class Worklog implements Serializable {
    private static final long serialVersionUID = 1L;
    final long id;
    final String author;
    final int minutes;
    final String body;
    final String startedAt;
    final String createdAt;

    Worklog(long id, String author, int minutes, String body, String startedAt) {
        this.id = id;
        this.author = author;
        this.minutes = minutes;
        this.body = body;
        this.startedAt = startedAt == null || startedAt.isBlank() ? Instant.now().toString() : startedAt;
        this.createdAt = Instant.now().toString();
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("author", author);
        result.put("minutes", minutes);
        result.put("body", body);
        result.put("startedAt", startedAt);
        result.put("createdAt", createdAt);
        return result;
    }
}

final class Attachment implements Serializable {
    private static final long serialVersionUID = -8779778358192584728L;
    final long id;
    final String filename;
    final String contentType;
    final long size;
    final String author;
    final String createdAt;
    final String contentBase64;

    Attachment(long id, String filename, String contentType, String author, String contentBase64) {
        this.id = id;
        this.filename = filename;
        this.contentType = contentType;
        this.author = author;
        this.createdAt = Instant.now().toString();
        this.contentBase64 = contentBase64 == null ? "" : contentBase64;
        this.size = decodedSize(this.contentBase64);
    }

    private static long decodedSize(String value) {
        try {
            return Base64.getDecoder().decode(value).length;
        } catch (IllegalArgumentException ignored) {
            return value.getBytes().length;
        }
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("filename", filename);
        result.put("contentType", contentType);
        result.put("size", size);
        result.put("author", author);
        result.put("createdAt", createdAt);
        return result;
    }

    Map<String, Object> downloadJson() {
        Map<String, Object> result = json();
        result.put("contentBase64", contentBase64);
        return result;
    }
}

final class Version implements Serializable {
    private static final long serialVersionUID = -1416842287027995886L;
    final long id;
    String name;
    String description = "";
    String releaseDate = "";
    boolean released;
    boolean archived;
    final String createdAt;

    Version(long id, String name) {
        this.id = id;
        this.name = name;
        this.createdAt = Instant.now().toString();
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("name", name);
        result.put("description", description);
        result.put("releaseDate", releaseDate);
        result.put("released", released);
        result.put("archived", archived);
        result.put("createdAt", createdAt);
        return result;
    }
}

final class WorkflowTransition implements Serializable {
    private static final long serialVersionUID = -3623417869364178274L;
    final long id;
    String name;
    String from;
    String to;
    String validator = "permission:TRANSITION";
    boolean enabled = true;

    WorkflowTransition(long id, String name, String from, String to) {
        this.id = id;
        this.name = name;
        this.from = from;
        this.to = to;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("name", name);
        result.put("from", from);
        result.put("to", to);
        result.put("validator", validator);
        result.put("enabled", enabled);
        return result;
    }
}

final class User implements Serializable {
    private static final long serialVersionUID = -1694390873177793459L;
    final String username;
    String displayName;
    String email;
    boolean active = true;
    final LinkedHashSet<String> globalRoles = new LinkedHashSet<>();

    User(String username, String displayName, String email) {
        this.username = username;
        this.displayName = displayName;
        this.email = email;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("username", username);
        result.put("displayName", displayName);
        result.put("email", email);
        result.put("active", active);
        result.put("globalRoles", new ArrayList<>(globalRoles));
        return result;
    }
}

final class AuditEvent implements Serializable {
    private static final long serialVersionUID = 4659507055199268952L;
    final long id;
    final String timestamp;
    final String actor;
    final String action;
    final String entity;
    final String entityKey;
    final String detail;

    AuditEvent(long id, String actor, String action, String entity, String entityKey, String detail) {
        this.id = id;
        this.timestamp = Instant.now().toString();
        this.actor = actor;
        this.action = action;
        this.entity = entity;
        this.entityKey = entityKey;
        this.detail = detail;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("timestamp", timestamp);
        result.put("actor", actor);
        result.put("action", action);
        result.put("entity", entity);
        result.put("entityKey", entityKey);
        result.put("detail", detail);
        return result;
    }
}

final class ProjectEvent implements Serializable {
    private static final long serialVersionUID = 7406304071238373545L;
    final long id;
    final String eventId;
    final String timestamp;
    final String actor;
    final String projectKey;
    final String type;
    final String issueKey;
    final Map<String, Object> payload;
    final long sourceRevision;
    final String[] changedFields;

    ProjectEvent(long id, String eventId, String actor, String projectKey, String type, String issueKey,
            Map<String, Object> payload, long sourceRevision, String[] changedFields) {
        this.id = id;
        this.eventId = eventId;
        this.timestamp = Instant.now().toString();
        this.actor = actor;
        this.projectKey = projectKey;
        this.type = type;
        this.issueKey = issueKey;
        this.payload = new LinkedHashMap<>(payload);
        this.sourceRevision = sourceRevision;
        this.changedFields = changedFields;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("eventId", eventId);
        result.put("timestamp", timestamp);
        result.put("actor", actor);
        result.put("projectKey", projectKey);
        result.put("type", type);
        result.put("issueKey", issueKey);
        result.put("payload", payload);
        result.put("sourceRevision", sourceRevision);
        result.put("changedFields", List.of(changedFields));
        return result;
    }
}

final class Notification implements Serializable {
    private static final long serialVersionUID = -4360489160684300706L;
    final long id;
    final String username;
    final String kind;
    final String message;
    final String issueKey;
    final String createdAt;
    boolean read;

    Notification(long id, String username, String kind, String message, String issueKey) {
        this.id = id;
        this.username = username;
        this.kind = kind;
        this.message = message;
        this.issueKey = issueKey;
        this.createdAt = Instant.now().toString();
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("username", username);
        result.put("kind", kind);
        result.put("message", message);
        result.put("issueKey", issueKey);
        result.put("createdAt", createdAt);
        result.put("read", read);
        return result;
    }
}

final class Presence implements Serializable {
    private static final long serialVersionUID = -7213573582252260727L;
    final String username;
    String projectKey;
    String route;
    String state;
    String updatedAt;

    Presence(String username, String projectKey, String route, String state) {
        this.username = username;
        this.projectKey = projectKey;
        this.route = route;
        this.state = state;
        this.updatedAt = Instant.now().toString();
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("username", username);
        result.put("projectKey", projectKey);
        result.put("route", route);
        result.put("state", state);
        result.put("updatedAt", updatedAt);
        return result;
    }
}

final class LockInfo implements Serializable {
    private static final long serialVersionUID = 2371089824546528558L;
    final String issueKey;
    final String username;
    final String acquiredAt;
    final String expiresAt;

    LockInfo(String issueKey, String username, String expiresAt) {
        this.issueKey = issueKey;
        this.username = username;
        this.acquiredAt = Instant.now().toString();
        this.expiresAt = expiresAt;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("issueKey", issueKey);
        result.put("username", username);
        result.put("acquiredAt", acquiredAt);
        result.put("expiresAt", expiresAt);
        return result;
    }
}

final class IssueLink implements Serializable {
    private static final long serialVersionUID = -5763345051008433441L;
    final String type;
    final String outward;
    final String inward;

    IssueLink(String type, String outward, String inward) {
        this.type = type;
        this.outward = outward;
        this.inward = inward;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("type", type);
        result.put("outward", outward);
        result.put("inward", inward);
        return result;
    }
}

final class PluginDescriptor implements Serializable {
    private static final long serialVersionUID = -3730753920574778183L;
    final String id;
    String name;
    String version;
    String source;
    boolean enabled;
    final LinkedHashSet<String> hooks = new LinkedHashSet<>();

    PluginDescriptor(String id, String name, String version, String source, boolean enabled) {
        this.id = id;
        this.name = name;
        this.version = version;
        this.source = source;
        this.enabled = enabled;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("name", name);
        result.put("version", version);
        result.put("source", source);
        result.put("enabled", enabled);
        result.put("hooks", new ArrayList<>(hooks));
        return result;
    }
}

/**
 * A Jira-style saved JQL filter.  Sharing is deliberately represented as
 * explicit local usernames so a clean-room installation does not imply an
 * external directory or mail service.
 */
final class SavedFilter implements Serializable {
    private static final long serialVersionUID = 1L;
    final long id;
    final String owner;
    String name;
    String description = "";
    String jql;
    String projectKey = "";
    String visibility = "private";
    boolean favourite;
    final LinkedHashSet<String> sharedWith = new LinkedHashSet<>();
    final String createdAt;
    String updatedAt;

    SavedFilter(long id, String owner, String name, String jql) {
        this.id = id;
        this.owner = owner;
        this.name = name;
        this.jql = jql;
        this.createdAt = Instant.now().toString();
        this.updatedAt = this.createdAt;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("owner", owner);
        result.put("name", name);
        result.put("description", description);
        result.put("jql", jql);
        result.put("projectKey", projectKey);
        result.put("visibility", visibility);
        result.put("favourite", favourite);
        result.put("sharedWith", new ArrayList<>(sharedWith));
        result.put("createdAt", createdAt);
        result.put("updatedAt", updatedAt);
        return result;
    }
}

final class FilterSubscription implements Serializable {
    private static final long serialVersionUID = 1L;
    final long id;
    final long filterId;
    final String username;
    String frequency = "daily";
    boolean enabled = true;
    String lastRunAt = "";
    String nextRunAt = "";
    final String createdAt;

    FilterSubscription(long id, long filterId, String username) {
        this.id = id;
        this.filterId = filterId;
        this.username = username;
        this.createdAt = Instant.now().toString();
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("filterId", filterId);
        result.put("username", username);
        result.put("frequency", frequency);
        result.put("enabled", enabled);
        result.put("lastRunAt", lastRunAt);
        result.put("nextRunAt", nextRunAt);
        result.put("createdAt", createdAt);
        return result;
    }
}

final class ReportTemplate implements Serializable {
    private static final long serialVersionUID = 1L;
    final long id;
    final String key;
    String name;
    String description = "";
    String category = "project";
    String projectKey = "";
    String owner;
    String jql = "";
    String visibility = "private";
    /**
     * Explicit principals allowed to read and execute a shared template.
     * Older snapshots do not contain this field; Store.normalizeLoadedState
     * initializes it when loading those snapshots.
     */
    LinkedHashSet<String> sharedWith = new LinkedHashSet<>();
    boolean builtIn;
    /*
     * This field was non-null and final in the first 2.1 snapshots.  Keeping
     * it mutable lets the loader repair older snapshots that serialized a
     * null parameter map without changing the snapshot class shape.
     */
    LinkedHashMap<String, Object> parameters = new LinkedHashMap<>();
    final String createdAt;
    String updatedAt;

    ReportTemplate(long id, String key, String name, String owner, boolean builtIn) {
        this.id = id;
        this.key = key;
        this.name = name;
        this.owner = owner;
        this.builtIn = builtIn;
        this.createdAt = Instant.now().toString();
        this.updatedAt = this.createdAt;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("key", key);
        result.put("name", name);
        result.put("description", description);
        result.put("category", category);
        result.put("projectKey", projectKey);
        result.put("owner", owner);
        result.put("jql", jql);
        result.put("visibility", visibility);
        result.put("sharedWith", new ArrayList<>(sharedWith));
        result.put("builtIn", builtIn);
        result.put("parameters", new LinkedHashMap<>(parameters));
        result.put("createdAt", createdAt);
        result.put("updatedAt", updatedAt);
        return result;
    }
}

/**
 * Generic management-area entry.  Keeping the catalog data-driven lets the
 * UI expose Jira's administration navigation without pretending to implement
 * Atlassian's private internals.
 */
final class AdminEntry implements Serializable {
    private static final long serialVersionUID = 1L;
    final long id;
    final String category;
    String key;
    String name;
    String description = "";
    boolean system;
    boolean editable = true;
    boolean enabled = true;
    final LinkedHashMap<String, Object> properties = new LinkedHashMap<>();
    final String createdAt;
    String updatedAt;

    AdminEntry(long id, String category, String key, String name) {
        this.id = id;
        this.category = category;
        this.key = key;
        this.name = name;
        this.createdAt = Instant.now().toString();
        this.updatedAt = this.createdAt;
    }

    Map<String, Object> json() {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", id);
        result.put("category", category);
        result.put("key", key);
        result.put("name", name);
        result.put("description", description);
        result.put("system", system);
        result.put("editable", editable);
        result.put("enabled", enabled);
        result.put("properties", new LinkedHashMap<>(properties));
        result.put("createdAt", createdAt);
        result.put("updatedAt", updatedAt);
        return result;
    }
}

final class ProblemException extends RuntimeException {
    final int status;
    final String code;
    final Map<String, Object> details;

    ProblemException(int status, String code, String message) {
        this(status, code, message, Map.of());
    }

    ProblemException(int status, String code, String message, Map<String, Object> details) {
        super(message);
        this.status = status;
        this.code = code;
        this.details = details;
    }
}
