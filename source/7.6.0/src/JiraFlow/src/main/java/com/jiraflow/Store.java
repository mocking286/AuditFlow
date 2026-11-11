package com.jiraflow;

import java.math.BigDecimal;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.UUID;

final class Store {
    static final String VERSION = "2.1.0";
    private static final List<String> STATUSES = List.of("BACKLOG", "TODO", "IN_PROGRESS", "DONE");
    private static final List<String> PERMISSIONS = List.of(
            "BROWSE", "CREATE", "EDIT", "TRANSITION", "COMMENT", "ATTACH",
            "ASSIGN", "ADMINISTER", "WORKLOG", "VOTE", "WATCH", "LINK", "DELETE");
    private static final Set<String> REPORT_PARAMETER_METADATA = Set.of("supportsJql", "supportsFilter");
    private static final Set<String> REPORT_PARAMETER_TYPES = Set.of("string", "enum", "number", "date");
    private static final Pattern REPORT_PARAMETER_PLACEHOLDER =
            Pattern.compile("\\{\\{\\s*([A-Za-z][A-Za-z0-9_]*)\\s*\\}\\}");
    private static final Pattern REPORT_PARAMETER_TOKEN = Pattern.compile(
            "^-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?$");

    private final Path dataDir;
    private final Path dataFile;
    private final Map<String, Project> projects = new LinkedHashMap<>();
    private final Map<String, Issue> issues = new LinkedHashMap<>();
    private final Map<String, User> users = new LinkedHashMap<>();
    private final Map<String, Notification> notifications = new LinkedHashMap<>();
    private final List<AuditEvent> auditEvents = new ArrayList<>();
    private final List<ProjectEvent> projectEvents = new ArrayList<>();
    private final Map<String, Presence> presence = new LinkedHashMap<>();
    private final Map<String, LockInfo> locks = new LinkedHashMap<>();
    private final Map<String, PluginDescriptor> plugins = new LinkedHashMap<>();
    private final Map<Long, SavedFilter> filters = new LinkedHashMap<>();
    private final Map<Long, FilterSubscription> filterSubscriptions = new LinkedHashMap<>();
    private final Map<Long, ReportTemplate> reportTemplates = new LinkedHashMap<>();
    private final Map<String, AdminEntry> adminEntries = new LinkedHashMap<>();
    private final Map<String, Map<String, String>> integrationCommands = new LinkedHashMap<>();
    private int nextIssueId = 1;
    private long nextEntityId = 1;

    Store(Path dataDir) {
        this.dataDir = dataDir.toAbsolutePath().normalize();
        this.dataFile = this.dataDir.resolve("store.bin");
    }

    synchronized void load() throws IOException {
        boolean loaded = false;
        if (Files.exists(dataFile)) {
            try (ObjectInputStream input = new ObjectInputStream(Files.newInputStream(dataFile))) {
                Snapshot snapshot = (Snapshot) input.readObject();
                projects.putAll(snapshot.projects);
                issues.putAll(snapshot.issues);
                users.putAll(snapshot.users);
                notifications.putAll(snapshot.notifications);
                auditEvents.addAll(snapshot.auditEvents);
                projectEvents.addAll(snapshot.projectEvents);
                presence.putAll(snapshot.presence);
                locks.putAll(snapshot.locks);
                plugins.putAll(snapshot.plugins);
                if (snapshot.filters != null) filters.putAll(snapshot.filters);
                if (snapshot.filterSubscriptions != null) filterSubscriptions.putAll(snapshot.filterSubscriptions);
                if (snapshot.reportTemplates != null) reportTemplates.putAll(snapshot.reportTemplates);
                if (snapshot.adminEntries != null) adminEntries.putAll(snapshot.adminEntries);
                if (snapshot.integrationCommands != null) snapshot.integrationCommands.forEach(
                        (key, value) -> integrationCommands.put(key, new LinkedHashMap<>(value)));
                nextIssueId = snapshot.nextIssueId;
                nextEntityId = snapshot.nextEntityId;
                normalizeLoadedState();
                loaded = true;
            } catch (Exception error) {
                throw new IOException("Existing JiraFlow data could not be loaded without data loss", error);
            }
        }
        if (!loaded || projects.isEmpty() || users.isEmpty()) {
            clearState();
            seed();
        }
        plugins.putAll(PluginRegistry.discover(dataDir));
        save();
    }

    private void normalizeLoadedState() {
        projects.values().forEach(project -> {
            if (project.auditflowProjectId == null) project.auditflowProjectId = "";
            if (project.roles == null) {
                throw new ProblemException(500, "invalid_snapshot", "Project roles are missing from the stored snapshot");
            }
            if (project.workflow == null) {
                throw new ProblemException(500, "invalid_snapshot", "Project workflow is missing from the stored snapshot");
            }
            if (project.versions == null) {
                throw new ProblemException(500, "invalid_snapshot", "Project versions are missing from the stored snapshot");
            }
            if (project.components == null) {
                project.components = new LinkedHashMap<>();
            }
            project.components.values().removeIf(component -> component == null);
            project.components.values().forEach(component -> {
                if (component.description == null) component.description = "";
                if (component.lead == null) component.lead = "";
                if (component.updatedAt == null) component.updatedAt =
                        component.createdAt == null ? Instant.now().toString() : component.createdAt;
            });
            if (project.settings.boardColumns.isEmpty()) {
                project.settings.boardColumns.put("BACKLOG", "Backlog");
                project.settings.boardColumns.put("TODO", "待开发");
                project.settings.boardColumns.put("IN_PROGRESS", "处理中");
                project.settings.boardColumns.put("DONE", "完成");
            }
        });
        issues.values().forEach(issue -> {
            if (issue.components == null) {
                issue.components = new LinkedHashSet<>();
            }
            if (issue.environment == null) issue.environment = "";
            if (issue.dueDate == null) issue.dueDate = "";
            if (issue.worklogs == null) issue.worklogs = new ArrayList<>();
            if (issue.analysisDomain == null) issue.analysisDomain = "ASPICE";
            if (issue.processArea == null) issue.processArea = "";
            if (issue.formalScope == null) issue.formalScope = "";
            if (issue.evidenceRole == null) issue.evidenceRole = "direct";
            if (issue.sourceSystem == null) issue.sourceSystem = "";
            if (issue.sourceKind == null) issue.sourceKind = "";
            if (issue.sourceFile == null) issue.sourceFile = "";
            if (issue.sourceSheet == null) issue.sourceSheet = "";
            if (issue.sourceIssueId == null) issue.sourceIssueId = "";
            if (issue.ownedBy == null) issue.ownedBy = "";
            if (issue.sourceCellsJson == null) issue.sourceCellsJson = "";
            if (issue.assessmentRating == null) issue.assessmentRating = "";
            if (issue.assessorDecision == null) issue.assessorDecision = "pending";
            if (issue.asil == null) issue.asil = "";
            if (issue.cybersecurityLevel == null) issue.cybersecurityLevel = "";
            if (issue.riskStatement == null) issue.riskStatement = "";
            if (issue.objectiveEvidence == null) issue.objectiveEvidence = "";
            if (issue.verificationMethod == null) issue.verificationMethod = "";
            if (issue.closureEvidence == null) issue.closureEvidence = "";
            if (issue.reviewStatus == null) issue.reviewStatus = "open";
            if (issue.traceLinks == null) issue.traceLinks = new ArrayList<>();
        });
        /*
         * Component support was added after the first persisted snapshots.
         * Materialize legacy string references into project components while
         * preserving the issue's visible component names.
         */
        projects.values().forEach(project -> {
            for (Issue issue : issues.values()) {
                if (!project.key.equals(issue.projectKey)) continue;
                for (String rawName : new ArrayList<>(issue.components)) {
                    String name = rawName == null ? "" : rawName.trim();
                    if (name.isBlank()) {
                        issue.components.remove(rawName);
                        continue;
                    }
                    ProjectComponent existing = findComponentByName(project, name);
                    if (existing == null) {
                        ProjectComponent component = new ProjectComponent(nextId(), project.key, name);
                        project.components.put(component.id, component);
                    }
                }
            }
        });
        filters.values().forEach(filter -> {
            if (filter.description == null) filter.description = "";
            if (filter.jql == null) filter.jql = "";
            if (filter.projectKey == null) filter.projectKey = "";
            if (filter.visibility == null || filter.visibility.isBlank()) filter.visibility = "private";
            if (filter.updatedAt == null) filter.updatedAt = filter.createdAt;
        });
        filterSubscriptions.values().forEach(subscription -> {
            if (subscription.frequency == null || subscription.frequency.isBlank()) subscription.frequency = "daily";
            if (subscription.lastRunAt == null) subscription.lastRunAt = "";
            if (subscription.nextRunAt == null) subscription.nextRunAt = "";
        });
        reportTemplates.values().forEach(template -> {
            if (template.description == null) template.description = "";
            if (template.category == null || template.category.isBlank()) template.category = "project";
            if (template.projectKey == null) template.projectKey = "";
            if (template.owner == null) template.owner = "testuser";
            if (template.jql == null) template.jql = "";
            if (template.visibility == null || template.visibility.isBlank()) template.visibility = "private";
            if (template.sharedWith == null) template.sharedWith = new LinkedHashSet<>();
            if (template.updatedAt == null) template.updatedAt = template.createdAt;
            if (template.parameters == null) template.parameters = new LinkedHashMap<>();
        });
        adminEntries.values().forEach(entry -> {
            if (entry.description == null) entry.description = "";
            if (entry.updatedAt == null) entry.updatedAt = entry.createdAt;
        });
        seedCatalogIfMissing();
    }

    private void clearState() {
        projects.clear();
        issues.clear();
        users.clear();
        notifications.clear();
        auditEvents.clear();
        projectEvents.clear();
        presence.clear();
        locks.clear();
        plugins.clear();
        filters.clear();
        filterSubscriptions.clear();
        reportTemplates.clear();
        adminEntries.clear();
        integrationCommands.clear();
        nextIssueId = 1;
        nextEntityId = 1;
    }

    private void seed() {
        User testuser = new User("testuser", "Test User", "testuser@example.invalid");
        testuser.globalRoles.add("administrators");
        testuser.globalRoles.add("developers");
        testuser.globalRoles.add("reporters");
        User alice = new User("alice", "Alice Developer", "alice@example.invalid");
        User bob = new User("bob", "Bob Reporter", "bob@example.invalid");
        User guest = new User("guest", "Guest Viewer", "guest@example.invalid");
        users.put(testuser.username, testuser);
        users.put(alice.username, alice);
        users.put(bob.username, bob);
        users.put(guest.username, guest);

        Project project = new Project("KTEST", "KsimpleKanbanProj", "software", "KTEST board");
        project.settings.description = "A clean-room Jira-style project for issue and Kanban workflows.";
        project.roles.put("administrators", new LinkedHashSet<>(List.of("testuser")));
        project.roles.put("developers", new LinkedHashSet<>(List.of("testuser", "alice")));
        project.roles.put("reporters", new LinkedHashSet<>(List.of("testuser", "bob")));
        project.roles.put("viewers", new LinkedHashSet<>(List.of("testuser", "alice", "bob", "guest")));
        addWorkflow(project, "Start work", "BACKLOG", "TODO");
        addWorkflow(project, "Start development", "BACKLOG", "IN_PROGRESS");
        addWorkflow(project, "Resolve", "BACKLOG", "DONE");
        addWorkflow(project, "Send back", "TODO", "BACKLOG");
        addWorkflow(project, "Start development", "TODO", "IN_PROGRESS");
        addWorkflow(project, "Resolve", "TODO", "DONE");
        addWorkflow(project, "Pause", "IN_PROGRESS", "TODO");
        addWorkflow(project, "Resolve", "IN_PROGRESS", "DONE");
        addWorkflow(project, "Reopen", "DONE", "IN_PROGRESS");
        Version released = new Version(nextId(), "1.0.0");
        released.description = "Initial clean-room release";
        released.releaseDate = LocalDate.now().minusDays(14).toString();
        released.released = true;
        project.versions.put(released.id, released);
        Version current = new Version(nextId(), "2.1.0");
        current.description = "ASPICE, cybersecurity and functional-safety assessment workflows with Jira-style collaboration";
        project.versions.put(current.id, current);
        projects.put(project.key, project);

        addSeedIssue("KTEST-1",
                "Kanban cards represent work items >> Click the \"KTEST-1\" link at the top of this card to show the Detail view - there's more on Kanban in the 'Description' section",
                "Task", "Highest", "BACKLOG", "Expedite");
        Issue first = issues.get("KTEST-1");
        first.description = """
                *About Kanban*

                [Kanban|http://en.wikipedia.org/wiki/Kanban_(development)] is part of the Toyota Lean Manufacturing methodology but was popularised for use in IT by David Anderson. Broadly speaking it aims to optimize outcomes by:

                - Prioritizing items that are added to the potential work list then only commencing work on items when capacity exists to take them on
                - Tracking items in progress so that items that have started are completed before new work is taken on
                - Ensuring that items that are in progress do not get blocked indefinitely at any particular stage of the work

                You can check out many Kanban resources at http://agilemanagement.net/
                """;
        first.labels.add("kanban");

        addSeedIssue("KTEST-2",
                "Kanban boards are often divided into streams of work, aka Swimlanes. By default, Kanban boards include an \"Expedite\" swimlane for items marked with the highest priority (like this one)",
                "Task", "Highest", "TODO", "Expedite");
        addSeedIssue("KTEST-3",
                "Add work items with \"+ Create Issue\" at the top right of the screen >> Try adding a new card now",
                "Bug", "Medium", "BACKLOG", "Other");
        addSeedIssue("KTEST-4",
                "Work items are ranked in priority order (from top to bottom) >> Try dragging this card over the card below to rank its priority lower",
                "Bug", "Medium", "BACKLOG", "Other");
        Issue ranked = issues.get("KTEST-4");
        ranked.comments.add(new Comment(nextId(), "testuser",
                "Created 12 days ago Backlog to Selected for Development 3 days 2 hours 5 minutes ago"));
        addSeedIssue("KTEST-5",
                "Work items flow through different stages from left to right >> Try dragging this card to \"Selected for Development\"",
                "Bug", "Medium", "BACKLOG", "Other");
        addSeedIssue("KTEST-6",
                "Work In Progress (WIP) limits highlight delays. This column's limit is 1...",
                "Bug", "Medium", "IN_PROGRESS", "Other");
        addSeedIssue("KTEST-7",
                "... so 2 work items violate the limit and cause the column to be highlighted",
                "Bug", "Medium", "IN_PROGRESS", "Other");
        addSeedIssue("KTEST-8",
                "Filters at the top of the board allow you to quickly cut down the shown items >> Try clicking the \"Recently Updated\" to hide work items not updated in the past day",
                "Bug", "Medium", "DONE", "Other");
        addSeedIssue("KTEST-9",
                "As teams develop with Kanban they get better at reducing average resolution time (aka Cycle time). The Control Chart in the Reports shows this information",
                "Bug", "Medium", "DONE", "Other");
        addSeedIssue("KTEST-10",
                "Instructions for deleting this sample board and project are in the description for this issue >> Click the \"KTEST-10\" link and read the description tab of the detail view for more",
                "Story", "Medium", "DONE", "Other");
        addSeedIssue("KTEST-11",
                "Issues like this one that are marked as fixed in a released version do not show up in Work mode but are included in the reports",
                "Task", "Medium", "DONE", "Other");
        addSeedIssue("KTEST-12",
                "Issues like this one that are marked as fixed in a released version do not show up in Work mode but are included in the reports",
                "Task", "Medium", "DONE", "Other");
        addSeedIssue("KTEST-13",
                "Issues like this one that are marked as fixed in a released version do not show up in Work mode but are included in the reports",
                "Task", "Medium", "DONE", "Other");
        addSeedIssue("KTEST-14",
                "Issues like this one that are marked as fixed in a released version do not show up in Work mode but are included in the reports",
                "Task", "Medium", "DONE", "Other");
        addSeedIssue("KTEST-15",
                "Issues like this one that are marked as fixed in a released version do not show up in Work mode but are included in the reports",
                "Task", "Medium", "DONE", "Other");
        addSeedIssue("KTEST-16",
                "Issues like this one that are marked as fixed in a released version do not show up in Work mode but are included in the reports",
                "Task", "Medium", "DONE", "Other");
        seedCatalogIfMissing();
    }

    private void addWorkflow(Project project, String name, String from, String to) {
        project.workflow.add(new WorkflowTransition(nextId(), name, from, to));
    }

    private void addSeedIssue(String key, String summary, String type, String priority, String status, String swimlane) {
        long id = nextIssueId;
        nextIssueId++;
        Issue issue = new Issue(id, key, "KTEST", summary, type, priority, status, swimlane);
        issue.assignee = "testuser";
        issue.reporter = "testuser";
        issue.creator = "testuser";
        issue.rank = (int) id;
        issues.put(key, issue);
    }

    /**
     * Seed the Jira-style catalog used by the local UI.  Entries are additive:
     * loading an older snapshot never replaces user-created filters, reports or
     * administration records.
     */
    private void seedCatalogIfMissing() {
        if (filters.isEmpty() && users.containsKey("testuser")) {
            SavedFilter allOpen = new SavedFilter(nextId(), "testuser", "All open issues",
                    "project = KTEST AND status != DONE ORDER BY priority DESC");
            allOpen.description = "All issues that are not complete in the KTEST project.";
            allOpen.projectKey = "KTEST";
            allOpen.visibility = "global";
            allOpen.favourite = true;
            filters.put(allOpen.id, allOpen);

            SavedFilter myIssues = new SavedFilter(nextId(), "testuser", "My unfinished issues",
                    "assignee = currentUser() AND status != DONE ORDER BY rank ASC");
            myIssues.description = "Issues assigned to the current user that still need work.";
            myIssues.projectKey = "KTEST";
            myIssues.visibility = "global";
            filters.put(myIssues.id, myIssues);
        }

        Map<String, String[]> reportDefinitions = Map.ofEntries(
                Map.entry("summary", new String[]{"Summary", "Status, priority, issue type and assessment totals.", "project"}),
                Map.entry("status", new String[]{"Status report", "Issue counts grouped by workflow status.", "project"}),
                Map.entry("priority", new String[]{"Priority report", "Issue counts grouped by priority.", "project"}),
                Map.entry("issue-type", new String[]{"Issue type report", "Issue counts grouped by issue type.", "project"}),
                Map.entry("control-chart", new String[]{"Control chart", "Cycle time observations for completed issues.", "agile"}),
                Map.entry("cumulative-flow", new String[]{"Cumulative flow", "Workflow distribution over the current issue set.", "agile"}),
                Map.entry("pie", new String[]{"Pie chart", "Configurable issue distribution by a JiraFlow field.", "visualization"}),
                Map.entry("word-group", new String[]{"Word grouping", "Frequent words extracted from issue text for review triage.", "visualization"}),
                Map.entry("issue-duration", new String[]{"Issue duration", "Open and completed issue duration distribution.", "visualization"}),
                Map.entry("created-vs-resolved", new String[]{"Created vs resolved", "Created and completed issue totals.", "agile"}),
                Map.entry("sprint-burndown", new String[]{"Sprint burndown", "Remaining work by workflow state.", "agile"}),
                Map.entry("filter-results", new String[]{"Filter results", "The issue list produced by a saved filter or JQL.", "issue"}),
                Map.entry("aspice-coverage", new String[]{"ASPICE coverage", "Assessment and evidence coverage by process area.", "assessment"}),
                Map.entry("cybersecurity-risk", new String[]{"Cybersecurity risk", "Cybersecurity level and review status distribution.", "assessment"}),
                Map.entry("functional-safety", new String[]{"Functional safety", "ASIL and assessor decision distribution.", "assessment"}));
        for (Map.Entry<String, String[]> definition : reportDefinitions.entrySet()) {
            if (reportTemplates.values().stream().noneMatch(template -> template.key.equals(definition.getKey()))) {
                ReportTemplate template = new ReportTemplate(
                        nextId(), definition.getKey(), definition.getValue()[0], "testuser", true);
                template.description = definition.getValue()[1];
                template.category = definition.getValue()[2];
                template.visibility = "global";
                template.projectKey = "KTEST";
                template.parameters.put("supportsJql", true);
                template.parameters.put("supportsFilter", true);
                addBuiltInReportParameters(template);
                reportTemplates.put(template.id, template);
            }
        }

        // Snapshots created before the visualization reports were introduced
        // already contain the built-in templates. Keep those templates
        // discoverable and upgrade their parameter metadata in place.
        reportTemplates.values().stream()
                .filter(template -> template.builtIn)
                .forEach(this::addBuiltInReportParameters);

        String[][] adminDefinitions = {
                {"application", "jira-software", "Applications", "Application versions and license metadata."},
                {"projects", "projects", "Projects", "Browse and maintain local projects."},
                {"issues", "issues", "Issues", "Issue configuration entry point."},
                {"addons", "addons", "Manage apps", "Installed local application extensions."},
                {"users", "users", "User management", "Users, groups and global roles."},
                {"upgrade-reports", "upgrade-reports", "Latest upgrade reports", "Upgrade and migration diagnostics."},
                {"system", "system", "System", "System properties and runtime settings."},
                {"issue-types", "issue-types", "Issue types", "Standard and sub-task issue types."},
                {"issue-type-schemes", "issue-type-schemes", "Issue type schemes", "Map issue types to projects."},
                {"subtasks", "subtasks", "Sub-tasks", "Enable and configure sub-task issue types."},
                {"archived-issues", "archived-issues", "Archived issues", "Browse archived issues."},
                {"workflows", "workflows", "Workflows", "Workflow definitions and transitions."},
                {"workflow-schemes", "workflow-schemes", "Workflow schemes", "Map workflows to projects."},
                {"screens", "screens", "Screens", "Issue create, edit and view screens."},
                {"field-screen-schemes", "field-screen-schemes", "Field screen schemes", "Screen mappings by operation."},
                {"issue-type-screen-schemes", "issue-type-screen-schemes", "Issue type screen schemes", "Screen mappings by issue type."},
                {"custom-fields", "custom-fields", "Custom fields", "Additional fields available to issues."},
                {"system-fields", "system-fields", "System fields", "Built-in JiraFlow fields."},
                {"field-configurations", "field-configurations", "Field configurations", "Required and hidden field settings."},
                {"field-configuration-schemes", "field-configuration-schemes", "Field configuration schemes", "Field configuration mappings."},
                {"priorities", "priorities", "Priorities", "Priority values used by issues."},
                {"priority-schemes", "priority-schemes", "Priority schemes", "Priority mappings by project."},
                {"time-tracking", "time-tracking", "Time tracking", "Worklog and estimation settings."},
                {"issue-links", "issue-links", "Issue links", "Relationships between issues."},
                {"statuses", "statuses", "Statuses", "Workflow status values."},
                {"resolutions", "resolutions", "Resolutions", "Resolution values for completed issues."},
                {"issue-security-schemes", "issue-security-schemes", "Issue security schemes", "Visibility rules for issues."},
                {"notification-schemes", "notification-schemes", "Notification schemes", "Local notification preferences."},
                {"permission-schemes", "permission-schemes", "Permission schemes", "Project permission mappings."}
        };
        for (String[] definition : adminDefinitions) {
            String storageKey = adminStorageKey(definition[0], definition[1]);
            if (!adminEntries.containsKey(storageKey)) {
                AdminEntry entry = new AdminEntry(nextId(), definition[0], definition[1], definition[2]);
                entry.description = definition[3];
                entry.system = true;
                entry.editable = !Set.of("application", "system", "upgrade-reports").contains(definition[0]);
                entry.properties.put("route", "/admin/" + definition[0]);
                entry.properties.put("scope", "global");
                adminEntries.put(storageKey, entry);
            }
        }
    }

    synchronized void save() throws IOException {
        Files.createDirectories(dataDir);
        Path temp = dataFile.resolveSibling("store.bin.tmp");
        try (ObjectOutputStream output = new ObjectOutputStream(Files.newOutputStream(temp))) {
            output.writeObject(new Snapshot(
                    projects,
                    issues,
                    users,
                    notifications,
                    auditEvents,
                    projectEvents,
                    presence,
                    locks,
                    plugins,
                    filters,
                    filterSubscriptions,
                    reportTemplates,
                    adminEntries,
                    integrationCommands,
                    nextIssueId,
                    nextEntityId));
        }
        Files.move(temp, dataFile, StandardCopyOption.REPLACE_EXISTING);
    }

    synchronized Map<String, Object> session(String actor) {
        User user = requireUser(actor);
        Project project = projects.get("KTEST");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("version", VERSION);
        result.put("user", user.json());
        result.put("permissions", PERMISSIONS.stream()
                .filter(permission -> project != null && hasPermission(project, actor, permission))
                .toList());
        result.put("projects", projects.values().stream().map(Project::json).toList());
        result.put("unreadNotifications", notifications.values().stream()
                .filter(notification -> notification.username.equals(actor) && !notification.read)
                .count());
        return result;
    }

    synchronized List<Map<String, Object>> users(String actor) {
        ensureGlobalAdmin(actor);
        return users.values().stream().map(User::json).toList();
    }

    synchronized Map<String, Object> createUser(String actor, Map<String, Object> body) throws IOException {
        ensureGlobalAdmin(actor);
        String username = text(body, "username").trim();
        if (username.isBlank() || !username.matches("[A-Za-z0-9._-]{2,64}")) {
            throw new ProblemException(400, "invalid_username", "Username must contain 2-64 letters, numbers, dots, underscores or hyphens");
        }
        if (users.containsKey(username)) {
            throw new ProblemException(409, "user_exists", "User already exists");
        }
        User user = new User(
                username,
                defaulted(body, "displayName", username),
                defaulted(body, "email", username + "@example.invalid"));
        user.active = Json.boolValue(body.get("active"), true);
        user.globalRoles.addAll(Json.stringList(body.get("globalRoles")));
        users.put(username, user);
        audit(actor, "user.created", "user", username, "Created local user");
        save();
        return user.json();
    }

    synchronized Map<String, Object> updateUser(String actor, String username, Map<String, Object> body) throws IOException {
        ensureGlobalAdmin(actor);
        User user = users.get(username);
        if (user == null) throw new ProblemException(404, "user_not_found", "User not found");
        if (body.containsKey("displayName")) user.displayName = text(body, "displayName").trim();
        if (body.containsKey("email")) user.email = text(body, "email").trim();
        if (body.containsKey("active")) {
            boolean active = Json.boolValue(body.get("active"), user.active);
            if (!active && username.equals(actor)) {
                throw new ProblemException(409, "cannot_deactivate_self", "An administrator cannot deactivate their own account");
            }
            user.active = active;
        }
        if (body.containsKey("globalRoles")) {
            Set<String> roles = new LinkedHashSet<>(Json.stringList(body.get("globalRoles")));
            if (user.globalRoles.contains("administrators") && !roles.contains("administrators")
                    && users.values().stream().filter(candidate -> candidate.active
                    && candidate.globalRoles.contains("administrators")).count() <= 1) {
                throw new ProblemException(409, "last_admin_required", "At least one active administrator must remain");
            }
            user.globalRoles.clear();
            user.globalRoles.addAll(roles);
        }
        audit(actor, "user.updated", "user", username, "Updated local user profile and roles");
        save();
        return user.json();
    }

    synchronized List<Map<String, Object>> projects() {
        return projects.values().stream().map(Project::json).toList();
    }

    synchronized List<Map<String, Object>> auditflowProjects(String actor) {
        requireUser(actor);
        return projects.values().stream()
                .filter(project -> !project.auditflowProjectId.isBlank())
                .filter(project -> hasPermission(project, actor, "BROWSE"))
                .map(project -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("key", project.key);
                    item.put("name", project.name);
                    item.put("auditflowProjectId", project.auditflowProjectId);
                    return item;
                })
                .toList();
    }

    synchronized Map<String, Object> ensureAuditflowProject(String actor, Map<String, Object> body)
            throws IOException {
        requireUser(actor);
        String id = text(body, "auditflowProjectId").trim();
        String key = text(body, "key").trim().toUpperCase(Locale.ROOT);
        String name = text(body, "name").trim();
        if (id.isBlank() || id.length() > 120 || !key.matches("[A-Z][A-Z0-9]{1,31}")
                || name.isBlank() || name.length() > 300) {
            throw new ProblemException(400, "invalid_auditflow_project", "A valid project id, key and name are required");
        }
        Project existing = projects.values().stream()
                .filter(project -> id.equals(project.auditflowProjectId)).findFirst().orElse(null);
        if (existing != null) {
            ensurePermission(existing, actor, "BROWSE");
            return Map.of("project", existing.json(), "created", false);
        }
        ensureGlobalAdmin(actor);
        if (projects.containsKey(key)) {
            throw new ProblemException(409, "auditflow_project_key_collision",
                    "The automatic project key belongs to another project");
        }
        Project project = new Project(key, name, "software", "AuditFlow NC / Finding follow-up for " + id);
        project.auditflowProjectId = id;
        project.settings.description = project.description;
        for (String role : List.of("administrators", "developers", "reporters", "viewers")) {
            project.roles.put(role, new LinkedHashSet<>(Set.of(actor)));
        }
        addWorkflow(project, "Plan", "BACKLOG", "TODO");
        addWorkflow(project, "Start work", "BACKLOG", "IN_PROGRESS");
        addWorkflow(project, "Resolve", "BACKLOG", "DONE");
        addWorkflow(project, "Send back", "TODO", "BACKLOG");
        addWorkflow(project, "Start work", "TODO", "IN_PROGRESS");
        addWorkflow(project, "Resolve", "TODO", "DONE");
        addWorkflow(project, "Pause", "IN_PROGRESS", "TODO");
        addWorkflow(project, "Resolve", "IN_PROGRESS", "DONE");
        addWorkflow(project, "Reopen", "DONE", "IN_PROGRESS");
        projects.put(key, project);
        audit(actor, "project.auditflow-created", "project", key, "Automatic AuditFlow mapping " + id);
        event(actor, key, "project.auditflow-created", "", Map.of("auditflowProjectId", id));
        save();
        return Map.of("project", project.json(), "created", true);
    }

    synchronized Map<String, Object> upsertAuditflowIssue(String actor, Map<String, Object> body)
            throws IOException {
        Project project = requireMappedProject(text(body, "auditflowProjectId").trim(), actor);
        ensurePermission(project, actor, "CREATE");
        String sourceId = text(body, "sourceIssueId").trim();
        String summary = text(body, "summary").trim();
        if (sourceId.isBlank() || sourceId.length() > 300 || summary.isBlank() || summary.length() > 1000) {
            throw new ProblemException(400, "invalid_auditflow_issue", "A valid NC id and summary are required");
        }
        Map<String, Object> source = new LinkedHashMap<>();
        source.put("summary", summary);
        source.put("description", text(body, "description"));
        source.put("processArea", text(body, "processArea").trim());
        source.put("dueDate", text(body, "dueDate").trim());
        source.put("sourceRecordId", text(body, "sourceRecordId").trim());
        source.put("sourceNcId", sourceId);
        source.put("sourceStatus", text(body, "sourceStatus").trim());
        long sourceRevision = Json.longValue(body.get("sourceRevision"), 0);
        source.put("sourceRevision", sourceRevision);
        String sourceJson = Json.stringify(source);
        Issue existing = issues.values().stream()
                .filter(issue -> project.key.equals(issue.projectKey))
                .filter(issue -> "JEAuditFlow".equals(issue.sourceSystem) && "nc".equals(issue.sourceKind))
                .filter(issue -> sourceId.equals(issue.sourceIssueId))
                .findFirst().orElse(null);
        if (existing == null && !text(body, "externalTicket").isBlank()) {
            Issue linked = requireIssue(text(body, "externalTicket").trim());
            if (!project.key.equals(linked.projectKey)) {
                throw new ProblemException(409, "auditflow_issue_project_mismatch",
                        "The linked issue belongs to another project");
            }
            if ("JEAuditFlow".equals(linked.sourceSystem) && !sourceId.equals(linked.sourceIssueId)) {
                throw new ProblemException(409, "auditflow_issue_source_mismatch",
                        "The linked issue belongs to another NC");
            }
            return Map.of("issue", linked.json(), "outcome", "linked");
        }
        if (existing == null) {
            String priority = importPriority(text(body, "severity"));
            Issue issue = new Issue(nextIssueId, project.key + "-" + nextIssueId++, project.key,
                    summary, "Bug", priority, "BACKLOG",
                    "Highest".equalsIgnoreCase(priority) ? "Expedite" : "Other");
            issue.description = text(source, "description");
            issue.processArea = text(source, "processArea");
            issue.dueDate = text(source, "dueDate");
            issue.creator = actor;
            issue.reporter = actor;
            issue.assignee = project.settings.defaultAssignee;
            issue.sourceSystem = "JEAuditFlow";
            issue.sourceKind = "nc";
            issue.sourceIssueId = sourceId;
            issue.ownedBy = "jiraflow";
            issue.sourceCellsJson = sourceJson;
            issue.evidenceRole = "issue-ledger";
            issue.labels.add("auditflow-nc");
            issues.put(issue.key, issue);
            audit(actor, "issue.auditflow-linked", "issue", issue.key, "Source NC " + sourceId);
            event(actor, project.key, "issue.auditflow-linked", issue.key, Map.of("sourceIssueId", sourceId));
            save();
            return Map.of("issue", issue.json(), "outcome", "created");
        }
        ensurePermission(project, actor, "EDIT");
        Map<String, Object> previous = Json.parseObject(existing.sourceCellsJson);
        long previousRevision = Json.longValue(previous.get("sourceRevision"), 0);
        Map<String, Object> previousFields = new LinkedHashMap<>(previous);
        Map<String, Object> sourceFields = new LinkedHashMap<>(source);
        previousFields.remove("sourceRevision");
        sourceFields.remove("sourceRevision");
        if (sourceRevision < previousRevision || previousFields.equals(sourceFields)) {
            return Map.of("issue", existing.json(), "outcome", "unchanged");
        }
        ensureUnlocked(existing, actor);
        // Refresh source changes only while JiraFlow's editable value still matches
        // the last exported value. Workflow and assessment decisions are independent.
        if (existing.summary.equals(text(previous, "summary"))) existing.summary = summary;
        if (existing.description.equals(text(previous, "description"))) {
            existing.description = text(source, "description");
        }
        if (existing.dueDate.equals(text(previous, "dueDate"))) existing.dueDate = text(source, "dueDate");
        existing.processArea = text(source, "processArea");
        existing.sourceCellsJson = sourceJson;
        touch(existing);
        audit(actor, "issue.auditflow-updated", "issue", existing.key, "Updated source NC " + sourceId);
        event(actor, project.key, "issue.auditflow-updated", existing.key, Map.of("sourceIssueId", sourceId));
        save();
        return Map.of("issue", existing.json(), "outcome", "updated");
    }

    synchronized Map<String, Object> mapAuditflowProject(String key, String actor, Map<String, Object> body)
            throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        String id = text(body, "auditflowProjectId").trim();
        if (id.isBlank() || id.length() > 120) {
            throw new ProblemException(400, "auditflow_project_id_required", "A valid AuditFlow project id is required");
        }
        if (!project.auditflowProjectId.isBlank() && !project.auditflowProjectId.equals(id)) {
            throw new ProblemException(409, "auditflow_project_already_mapped", "JiraFlow project is already mapped");
        }
        boolean duplicate = projects.values().stream()
                .anyMatch(candidate -> candidate != project && id.equals(candidate.auditflowProjectId));
        if (duplicate) throw new ProblemException(409, "auditflow_project_already_mapped", "AuditFlow project is already mapped");
        project.auditflowProjectId = id;
        audit(actor, "project.auditflow-mapped", "project", project.key, "Mapped AuditFlow project " + id);
        event(actor, project.key, "project.auditflow-mapped", "", Map.of("auditflowProjectId", id));
        save();
        return project.json();
    }

    synchronized Map<String, Object> auditflowEvents(String actor, String auditflowProjectId, long afterRevision, int limit) {
        Project project = requireMappedProject(auditflowProjectId, actor);
        List<Map<String, Object>> events = projectEvents.stream()
                .filter(event -> project.key.equalsIgnoreCase(event.projectKey))
                .filter(event -> event.id > afterRevision)
                .sorted(Comparator.comparingLong(event -> event.id))
                .limit(Math.max(1, Math.min(limit, 200)))
                .map(event -> {
                    Map<String, Object> result = new LinkedHashMap<>(event.json());
                    result.put("auditflowProjectId", project.auditflowProjectId);
                    return result;
                })
                .toList();
        long next = events.isEmpty() ? afterRevision : Json.longValue(events.get(events.size() - 1).get("id"), afterRevision);
        return Map.of("auditflowProjectId", project.auditflowProjectId, "events", events, "nextRevision", next,
                "hasMore", projectEvents.stream().anyMatch(event -> project.key.equalsIgnoreCase(event.projectKey)
                        && event.id > next));
    }

    synchronized Map<String, Object> auditflowTransition(String actor, Map<String, Object> body) throws IOException {
        String projectId = text(body, "auditflowProjectId").trim();
        String issueKey = text(body, "issueKey").trim();
        String commandId = text(body, "idempotencyKey").trim();
        String targetStatus = text(body, "targetStatus").trim();
        long expected = Json.longValue(body.get("expectedRevision"), 0);
        if (commandId.isBlank() || commandId.length() > 160) {
            throw new ProblemException(400, "idempotency_key_required", "A valid idempotencyKey is required");
        }
        Project project = requireMappedProject(projectId, actor);
        Issue issue = requireIssue(issueKey);
        if (!project.key.equalsIgnoreCase(issue.projectKey)) {
            throw new ProblemException(404, "issue_not_found", "Issue not found in the mapped project");
        }
        String commandKey = projectId + ":" + commandId;
        String normalizedTarget = normalizeStatus(targetStatus);
        Map<String, String> previous = integrationCommands.get(commandKey);
        if (previous != null) {
            if (!issue.key.equals(previous.get("issueKey"))
                    || !normalizedTarget.equals(previous.get("targetStatus"))
                    || expected != Json.longValue(previous.get("expectedRevision"), 0)) {
                throw new ProblemException(409, "idempotency_key_reused", "Idempotency key was already used for another command");
            }
            Map<String, Object> result = new LinkedHashMap<>();
            String previousOutcome = previous.getOrDefault("outcome", "applied");
            result.put("outcome", "applied".equals(previousOutcome) ? "duplicate" : previousOutcome);
            result.put("issue", issue.json());
            result.put("idempotencyKey", commandId);
            result.put("currentRevision", Json.longValue(previous.get("currentRevision"), issue.revision));
            if ("conflict".equals(previousOutcome)) {
                result.put("expectedRevision", Json.longValue(previous.get("expectedRevision"), expected));
            }
            return result;
        }
        if (expected <= 0 || expected != issue.revision) {
            rememberIntegrationCommand(commandKey, issue.key, normalizedTarget, expected, issue.revision, "conflict");
            save();
            return Map.of("outcome", "conflict", "idempotencyKey", commandId,
                    "expectedRevision", expected, "currentRevision", issue.revision,
                    "issue", issue.json());
        }
        try {
            Map<String, Object> updated = transition(actor, issue.key, targetStatus, expected, false);
            long currentRevision = Json.longValue(updated.get("revision"), expected);
            rememberIntegrationCommand(commandKey, issue.key, normalizedTarget, expected, currentRevision, "applied");
            save();
            return Map.of("outcome", "applied", "idempotencyKey", commandId,
                    "currentRevision", currentRevision, "issue", updated);
        } catch (ProblemException error) {
            if ("revision_conflict".equals(error.code)) {
                rememberIntegrationCommand(commandKey, issue.key, normalizedTarget, expected, issue.revision, "conflict");
                save();
                Map<String, Object> result = new LinkedHashMap<>();
                result.put("outcome", "conflict");
                result.put("idempotencyKey", commandId);
                result.put("expectedRevision", expected);
                result.put("currentRevision", issue.revision);
                result.put("issue", issue.json());
                return result;
            }
            if ("invalid_transition".equals(error.code)) {
                rememberIntegrationCommand(commandKey, issue.key, normalizedTarget, expected, issue.revision, "rejected");
                save();
                return Map.of("outcome", "rejected", "idempotencyKey", commandId,
                        "currentRevision", issue.revision, "issue", issue.json());
            }
            throw error;
        }
    }

    private void rememberIntegrationCommand(
            String commandKey, String issueKey, String targetStatus, long expectedRevision,
            long currentRevision, String outcome) {
        Map<String, String> command = new LinkedHashMap<>();
        command.put("issueKey", issueKey);
        command.put("targetStatus", targetStatus);
        command.put("expectedRevision", Long.toString(expectedRevision));
        command.put("currentRevision", Long.toString(currentRevision));
        command.put("outcome", outcome);
        integrationCommands.put(commandKey, command);
    }

    private Project requireMappedProject(String auditflowProjectId, String actor) {
        if (auditflowProjectId == null || auditflowProjectId.isBlank()) {
            throw new ProblemException(400, "auditflow_project_id_required", "An AuditFlow project id is required");
        }
        Project project = projects.values().stream()
                .filter(candidate -> auditflowProjectId.equals(candidate.auditflowProjectId))
                .findFirst()
                .orElseThrow(() -> new ProblemException(404, "project_not_found", "Mapped project not found"));
        ensurePermission(project, actor, "BROWSE");
        return project;
    }

    synchronized Map<String, Object> project(String key, String actor) {
        Project project = requireProject(key);
        ensurePermission(project, actor, "BROWSE");
        return project.json();
    }

    synchronized Map<String, Object> projectSettings(String key, String actor) {
        Project project = requireProject(key);
        ensurePermission(project, actor, "BROWSE");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("project", project.json());
        result.put("settings", project.settings.json());
        result.put("permissions", permissionsFor(project, actor));
        return result;
    }

    synchronized Map<String, Object> dashboard(String actor) {
        return dashboard(actor, "");
    }

    synchronized Map<String, Object> dashboard(String actor, String projectKey) {
        requireUser(actor);
        Project selected = projectKey == null || projectKey.isBlank() ? null : requireProject(projectKey);
        if (selected != null) ensurePermission(selected, actor, "BROWSE");
        List<Issue> visible = issues.values().stream()
                .filter(issue -> selected == null || selected.key.equals(issue.projectKey))
                .filter(issue -> hasPermission(requireProject(issue.projectKey), actor, "BROWSE"))
                .toList();
        List<Map<String, Object>> assigned = visible.stream()
                .filter(issue -> actor.equals(issue.assignee) && !"DONE".equals(issue.status))
                .sorted(Comparator.comparingInt(issue -> issue.rank))
                .limit(10)
                .map(Issue::json)
                .toList();
        Set<String> visibleIssueKeys = visible.stream().map(issue -> issue.key).collect(java.util.stream.Collectors.toSet());
        List<Map<String, Object>> activity = auditEvents.stream()
                .filter(event -> {
                    if ("issue".equals(event.entity)) return visibleIssueKeys.contains(event.entityKey);
                    if ("project".equals(event.entity)) {
                        Project project = projectForAudit(event.entityKey);
                        return project != null && (selected == null || selected.key.equals(project.key))
                                && hasPermission(project, actor, "BROWSE");
                    }
                    return false;
                })
                .sorted(Comparator.comparingLong((AuditEvent event) -> event.id).reversed())
                .limit(12)
                .map(AuditEvent::json)
                .toList();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("user", requireUser(actor).json());
        result.put("assignedIssues", assigned);
        result.put("activity", activity);
        result.put("unreadNotifications", notifications.values().stream()
                .filter(item -> item.username.equals(actor) && !item.read)
                .filter(item -> selected == null || visibleIssueKeys.contains(item.issueKey))
                .sorted(Comparator.comparingLong((Notification item) -> item.id).reversed())
                .limit(6)
                .map(Notification::json)
                .toList());
        result.put("issueCount", visible.size());
        result.put("openCount", visible.stream().filter(issue -> !"DONE".equals(issue.status)).count());
        result.put("inProgressCount", visible.stream().filter(issue -> "IN_PROGRESS".equals(issue.status)).count());
        result.put("completedCount", visible.stream().filter(issue -> "DONE".equals(issue.status)).count());
        result.put("projects", projects.values().stream()
                .filter(project -> selected == null || selected.key.equals(project.key))
                .filter(project -> hasPermission(project, actor, "BROWSE"))
                .map(Project::json)
                .toList());
        return result;
    }

    synchronized List<Map<String, Object>> auditLog(String actor, String projectKey, int limit) {
        ensureGlobalAdmin(actor);
        return auditEvents.stream()
                .filter(item -> projectKey == null || projectKey.isBlank()
                        || auditProjectKey(item).equalsIgnoreCase(projectKey))
                .sorted(Comparator.comparingLong((AuditEvent item) -> item.id).reversed())
                .limit(Math.max(1, Math.min(limit, 500)))
                .map(AuditEvent::json)
                .toList();
    }

    private Project projectForAudit(String key) {
        Project project = projects.get(key.toUpperCase(Locale.ROOT));
        if (project != null) return project;
        Issue issue = issues.get(key.toUpperCase(Locale.ROOT));
        return issue == null ? null : projects.get(issue.projectKey);
    }

    private String auditProjectKey(AuditEvent item) {
        if ("project".equals(item.entity)) return item.entityKey;
        if ("issue".equals(item.entity)) {
            Issue issue = issues.get(item.entityKey);
            return issue == null ? "" : issue.projectKey;
        }
        return "";
    }

    synchronized Map<String, Object> updateProjectSettings(String key, String actor, Map<String, Object> body) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        if (body.containsKey("name")) project.name = text(body, "name");
        if (body.containsKey("description")) project.description = text(body, "description");
        if (body.containsKey("lead")) project.lead = text(body, "lead");
        if (body.containsKey("url")) project.url = text(body, "url");
        if (body.containsKey("defaultAssignee")) project.settings.defaultAssignee = text(body, "defaultAssignee");
        if (body.containsKey("notificationScheme")) project.settings.notificationScheme = text(body, "notificationScheme");
        if (body.containsKey("permissionScheme")) project.settings.permissionScheme = text(body, "permissionScheme");
        if (body.containsKey("boardColumns") && body.get("boardColumns") instanceof Map<?, ?> columns) {
            project.settings.boardColumns.clear();
            columns.forEach((column, label) -> {
                String status = normalizeStatus(String.valueOf(column));
                String name = String.valueOf(label).trim();
                if (!status.matches("[A-Z][A-Z0-9_]{1,39}") || name.isBlank()) {
                    throw new ProblemException(400, "invalid_board_status", "Board status and column name are invalid");
                }
                project.settings.boardColumns.put(status, name);
            });
            if (project.settings.boardColumns.isEmpty()) {
                throw new ProblemException(400, "board_status_required", "At least one board status is required");
            }
        }
        if (body.containsKey("wipLimits") && body.get("wipLimits") instanceof Map<?, ?> limits) {
            project.settings.wipLimits.clear();
            limits.forEach((column, limit) -> project.settings.wipLimits.put(
                    String.valueOf(column), (int) Json.longValue(limit, 0)));
        }
        if (body.containsKey("roles") && body.get("roles") instanceof Map<?, ?> roles) {
            roles.forEach((role, members) -> project.roles.put(
                    String.valueOf(role),
                    new LinkedHashSet<>(Json.stringList(members))));
        }
        audit(actor, "project.updated", "project", key, "Project settings changed");
        event(actor, key, "project.updated", "", project.settings.json());
        save();
        return projectSettings(key, actor);
    }

    synchronized Map<String, Object> addBoardStatus(String key, String actor, Map<String, Object> body) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        String label = text(body, "name").trim();
        if (label.isBlank()) throw new ProblemException(400, "status_name_required", "Status name is required");
        String status = text(body, "key").trim();
        if (status.isBlank()) {
            status = label.toUpperCase(Locale.ROOT).replaceAll("[^A-Z0-9]+", "_").replaceAll("^_|_$", "");
        } else {
            status = normalizeStatus(status);
        }
        if (!status.matches("[A-Z][A-Z0-9_]{1,39}")) {
            throw new ProblemException(400, "invalid_board_status", "Status key must contain 2-40 letters, numbers or underscores");
        }
        if (project.settings.boardColumns.containsKey(status)) {
            throw new ProblemException(409, "status_exists", "Status already exists");
        }
        project.settings.boardColumns.put(status, label);
        audit(actor, "board.status.created", "project", key, status + ": " + label);
        event(actor, key, "board.status.created", "", Map.of("key", status, "name", label));
        save();
        return Map.of("key", status, "name", label, "settings", project.settings.json());
    }

    synchronized List<Map<String, Object>> components(String actor, String key) {
        Project project = requireProject(key);
        ensurePermission(project, actor, "BROWSE");
        ensureProjectComponents(project);
        return project.components.values().stream().map(ProjectComponent::json).toList();
    }

    synchronized Map<String, Object> createComponent(
            String actor, String key, Map<String, Object> body) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        ensureProjectComponents(project);
        String name = text(body, "name").trim();
        if (name.isBlank()) {
            throw new ProblemException(400, "component_name_required", "Component name is required");
        }
        if (name.length() > 255) {
            throw new ProblemException(400, "component_name_too_long", "Component name must be at most 255 characters");
        }
        if (findComponentByName(project, name) != null) {
            throw new ProblemException(409, "component_exists", "Component already exists in this project");
        }
        ProjectComponent component = new ProjectComponent(nextId(), project.key, name);
        component.description = text(body, "description");
        component.lead = componentLead(body.get("lead"));
        project.components.put(component.id, component);
        audit(actor, "project.component.created", "component", String.valueOf(component.id), project.key + ": " + name);
        event(actor, project.key, "project.component.created", "", component.json());
        save();
        return component.json();
    }

    synchronized Map<String, Object> updateComponent(
            String actor, String key, long id, Map<String, Object> body) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        ensureProjectComponents(project);
        ProjectComponent component = project.components.get(id);
        if (component == null) {
            throw new ProblemException(404, "component_not_found", "Component not found");
        }
        String previousName = component.name;
        if (body.containsKey("name")) {
            String name = text(body, "name").trim();
            if (name.isBlank()) {
                throw new ProblemException(400, "component_name_required", "Component name is required");
            }
            if (name.length() > 255) {
                throw new ProblemException(400, "component_name_too_long", "Component name must be at most 255 characters");
            }
            ProjectComponent existing = findComponentByName(project, name);
            if (existing != null && existing.id != component.id) {
                throw new ProblemException(409, "component_exists", "Component already exists in this project");
            }
            component.name = name;
        }
        if (body.containsKey("description")) component.description = text(body, "description");
        if (body.containsKey("lead")) component.lead = componentLead(body.get("lead"));
        component.updatedAt = Instant.now().toString();
        if (!previousName.equals(component.name)) {
            for (Issue issue : issues.values()) {
                if (!project.key.equals(issue.projectKey) || issue.components == null) continue;
                LinkedHashSet<String> renamed = new LinkedHashSet<>();
                for (String issueComponent : issue.components) {
                    renamed.add(previousName.equals(issueComponent) ? component.name : issueComponent);
                }
                issue.components = renamed;
            }
        }
        audit(actor, "project.component.updated", "component", String.valueOf(component.id), project.key + ": " + component.name);
        event(actor, project.key, "project.component.updated", "", component.json());
        save();
        return component.json();
    }

    synchronized void deleteComponent(String actor, String key, long id) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        ensureProjectComponents(project);
        ProjectComponent component = project.components.remove(id);
        if (component == null) {
            throw new ProblemException(404, "component_not_found", "Component not found");
        }
        for (Issue issue : issues.values()) {
            if (!project.key.equals(issue.projectKey) || issue.components == null) continue;
            issue.components.removeIf(name -> component.name.equals(name));
        }
        audit(actor, "project.component.deleted", "component", String.valueOf(id), project.key + ": " + component.name);
        event(actor, project.key, "project.component.deleted", "", component.json());
        save();
    }

    synchronized List<Map<String, Object>> jiraComponents(String actor, String key) {
        return components(actor, key).stream()
                .map(item -> jiraComponent(requireProject(key), requireProjectComponent(requireProject(key),
                        Json.longValue(item.get("id"), 0))))
                .toList();
    }

    synchronized Map<String, Object> createJiraComponent(
            String actor, String key, Map<String, Object> body) throws IOException {
        return jiraComponent(requireProject(key),
                requireProjectComponent(requireProject(key), Json.longValue(
                        createComponent(actor, key, body).get("id"), 0)));
    }

    synchronized Map<String, Object> jiraComponentById(String actor, long id) {
        Map.Entry<Project, ProjectComponent> entry = componentEntry(id);
        ensurePermission(entry.getKey(), actor, "BROWSE");
        return jiraComponent(entry.getKey(), entry.getValue());
    }

    synchronized Map<String, Object> updateJiraComponent(
            String actor, long id, Map<String, Object> body) throws IOException {
        Map.Entry<Project, ProjectComponent> entry = componentEntry(id);
        ensurePermission(entry.getKey(), actor, "ADMINISTER");
        Map<String, Object> updated = updateComponent(actor, entry.getKey().key, id, body);
        return jiraComponent(requireProject(entry.getKey().key),
                requireProjectComponent(requireProject(entry.getKey().key), Json.longValue(updated.get("id"), 0)));
    }

    synchronized void deleteJiraComponent(String actor, long id) throws IOException {
        Map.Entry<Project, ProjectComponent> entry = componentEntry(id);
        deleteComponent(actor, entry.getKey().key, id);
    }

    private void ensureProjectComponents(Project project) {
        if (project.components == null) project.components = new LinkedHashMap<>();
    }

    private ProjectComponent requireProjectComponent(Project project, long id) {
        ensureProjectComponents(project);
        ProjectComponent component = project.components.get(id);
        if (component == null) {
            throw new ProblemException(404, "component_not_found", "Component not found");
        }
        return component;
    }

    private ProjectComponent findComponentByName(Project project, String name) {
        if (project.components == null || name == null) return null;
        return project.components.values().stream()
                .filter(component -> component != null && component.name != null
                        && component.name.equalsIgnoreCase(name.trim()))
                .findFirst()
                .orElse(null);
    }

    private Map.Entry<Project, ProjectComponent> componentEntry(long id) {
        for (Project project : projects.values()) {
            if (project.components == null) continue;
            ProjectComponent component = project.components.get(id);
            if (component != null) return Map.entry(project, component);
        }
        throw new ProblemException(404, "component_not_found", "Component not found");
    }

    private LinkedHashSet<String> normalizeComponentNames(Project project, Object raw) {
        ensureProjectComponents(project);
        LinkedHashSet<String> names = new LinkedHashSet<>();
        if (raw == null) return names;
        if (raw instanceof String textValue) {
            for (String item : textValue.split(",")) {
                addComponentReference(project, names, item.trim());
            }
            return names;
        }
        if (raw instanceof Iterable<?> iterable) {
            for (Object item : iterable) addComponentReference(project, names, item);
            return names;
        }
        addComponentReference(project, names, raw);
        return names;
    }

    private void addComponentReference(Project project, Set<String> names, Object candidate) {
        if (candidate == null) return;
        if (candidate instanceof String textValue && textValue.trim().isBlank()) return;
        String name = componentReferenceName(project, candidate);
        if (!name.isBlank()) names.add(name);
    }

    private String componentReferenceName(Project project, Object candidate) {
        if (candidate instanceof Map<?, ?> map) {
            ProjectComponent byId = null;
            ProjectComponent byName = null;
            Object rawId = map.get("id");
            if (rawId != null && !String.valueOf(rawId).isBlank()) {
                long id = parseComponentId(rawId);
                byId = requireProjectComponent(project, id);
            }
            Object rawName = map.get("name");
            if (rawName != null && !String.valueOf(rawName).trim().isBlank()) {
                byName = findComponentByName(project, String.valueOf(rawName).trim());
                if (byName == null) {
                    throw new ProblemException(400, "component_not_found",
                            "Component is not defined in this project");
                }
            }
            if (byId == null && byName == null) {
                throw new ProblemException(400, "invalid_component_reference",
                        "Component references require an id or name");
            }
            if (byId != null && byName != null && byId.id != byName.id) {
                throw new ProblemException(400, "component_reference_mismatch",
                        "Component id and name refer to different components");
            }
            return (byId == null ? byName : byId).name;
        }
        if (candidate instanceof Number
                || String.valueOf(candidate).trim().matches("^-?(?:0|[1-9][0-9]*)(?:\\.0+)?$")) {
            return requireProjectComponent(project, parseComponentId(candidate)).name;
        }
        ProjectComponent component = findComponentByName(project, String.valueOf(candidate).trim());
        if (component == null) {
            throw new ProblemException(400, "component_not_found",
                    "Component is not defined in this project: " + candidate);
        }
        return component.name;
    }

    private long parseComponentId(Object candidate) {
        try {
            String value = String.valueOf(candidate).trim();
            return new BigDecimal(value).stripTrailingZeros().longValueExact();
        } catch (Exception error) {
            throw new ProblemException(400, "invalid_component_id", "Component id must be an exact integer");
        }
    }

    private String componentLead(Object raw) {
        if (raw instanceof Map<?, ?> map) {
            Object name = map.get("name");
            if (name == null) name = map.get("key");
            return name == null ? "" : String.valueOf(name).trim();
        }
        return raw == null ? "" : String.valueOf(raw).trim();
    }

    private Map<String, Object> jiraComponent(Project project, ProjectComponent component) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", String.valueOf(component.id));
        result.put("name", component.name);
        result.put("description", component.description);
        result.put("lead", component.lead.isBlank() ? null : userJsonNullable(component.lead));
        result.put("project", project.key);
        result.put("projectId", project.key.hashCode());
        result.put("assigneeType", "PROJECT_LEAD");
        return result;
    }

    private Map<String, Object> jiraIssueComponent(Project project, String name) {
        ProjectComponent component = findComponentByName(project, name);
        if (component != null) {
            return jiraComponent(project, component);
        }
        /*
         * A legacy snapshot can contain a component name before the
         * normalization pass has materialized it. Keep the issue readable in
         * Jira's response shape while avoiding a fabricated project component.
         */
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("name", name);
        result.put("description", "");
        result.put("project", project.key);
        return result;
    }

    synchronized Map<String, Object> workflow(String key, String actor) {
        Project project = requireProject(key);
        ensurePermission(project, actor, "BROWSE");
        return Map.of("projectKey", key, "transitions", project.workflow.stream().map(WorkflowTransition::json).toList());
    }

    synchronized Map<String, Object> addWorkflowTransition(String key, String actor, Map<String, Object> body) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        String name = defaulted(body, "name", "Custom transition");
        String from = normalizeStatus(defaulted(body, "from", "TODO"));
        String to = normalizeStatus(defaulted(body, "to", "IN_PROGRESS"));
        if (!isProjectStatus(project, from) || !isProjectStatus(project, to)) {
            throw new ProblemException(400, "invalid_workflow", "Unknown workflow status");
        }
        WorkflowTransition transition = new WorkflowTransition(nextId(), name, from, to);
        transition.validator = defaulted(body, "validator", "permission:TRANSITION");
        project.workflow.add(transition);
        audit(actor, "workflow.transition.created", "project", key, name + ": " + from + " -> " + to);
        event(actor, key, "workflow.changed", "", transition.json());
        save();
        return transition.json();
    }

    synchronized Map<String, Object> updateWorkflowTransition(
            String key, String actor, long id, Map<String, Object> body) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        WorkflowTransition transition = project.workflow.stream()
                .filter(item -> item.id == id).findFirst()
                .orElseThrow(() -> new ProblemException(404, "transition_not_found", "Workflow transition not found"));
        if (body.containsKey("name")) transition.name = text(body, "name").trim();
        if (body.containsKey("from")) transition.from = normalizeStatus(text(body, "from"));
        if (body.containsKey("to")) transition.to = normalizeStatus(text(body, "to"));
        if (body.containsKey("validator")) transition.validator = text(body, "validator").trim();
        if (body.containsKey("enabled")) transition.enabled = Json.boolValue(body.get("enabled"), transition.enabled);
        if (!isProjectStatus(project, transition.from) || !isProjectStatus(project, transition.to)) {
            throw new ProblemException(400, "invalid_workflow", "Unknown workflow status");
        }
        audit(actor, "workflow.transition.updated", "project", key, transition.name);
        event(actor, key, "workflow.changed", "", transition.json());
        save();
        return transition.json();
    }

    synchronized void deleteWorkflowTransition(String key, String actor, long id) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        WorkflowTransition transition = project.workflow.stream()
                .filter(item -> item.id == id).findFirst()
                .orElseThrow(() -> new ProblemException(404, "transition_not_found", "Workflow transition not found"));
        project.workflow.remove(transition);
        audit(actor, "workflow.transition.deleted", "project", key, transition.name);
        event(actor, key, "workflow.changed", "", Map.of("deletedTransitionId", id));
        save();
    }

    synchronized Map<String, Object> board(String key, String actor, String filter, String jql) {
        Project project = requireProject(key);
        ensurePermission(project, actor, "BROWSE");
        Predicate<Issue> predicate = issue -> issue.projectKey.equals(key);
        if (jql != null && !jql.isBlank()) {
            Jql.Query query = Jql.parse(jql, actor);
            predicate = predicate.and(query.predicate);
        }
        String needle = filter == null ? "" : filter.trim().toLowerCase(Locale.ROOT);
        Predicate<Issue> search = predicate;
        if (!needle.isBlank()) {
            search = search.and(issue -> issue.key.toLowerCase(Locale.ROOT).contains(needle)
                    || issue.summary.toLowerCase(Locale.ROOT).contains(needle)
                    || issue.assignee.toLowerCase(Locale.ROOT).contains(needle));
        }
        List<Issue> visible = issues.values().stream()
                .filter(search)
                .sorted(Comparator.comparingInt(issue -> issue.rank))
                .toList();
        List<Map<String, Object>> columns = new ArrayList<>();
        project.settings.boardColumns.forEach((status, label) -> {
            List<Issue> columnIssues = visible.stream().filter(issue -> issue.status.equals(status)).toList();
            Map<String, Object> column = new LinkedHashMap<>();
            column.put("id", status);
            column.put("name", label);
            column.put("issues", columnIssues.stream().map(Issue::json).toList());
            column.put("wipLimit", project.settings.wipLimits.getOrDefault(status, 0));
            column.put("wipExceeded", project.settings.wipLimits.getOrDefault(status, 0) > 0
                    && columnIssues.size() > project.settings.wipLimits.get(status));
            columns.add(column);
        });
        Map<String, Object> board = new LinkedHashMap<>();
        board.put("id", key);
        board.put("name", project.name + " board");
        board.put("projectKey", key);
        board.put("columns", columns);
        board.put("quickFilters", List.of(
                Map.of("id", "mine", "name", "仅我的问题", "jql", "assignee = currentUser()"),
                Map.of("id", "recent", "name", "最近的更新", "jql", "updated >= -1d")));
        board.put("swimlanes", List.of(
                Map.of("id", "Expedite", "name", "加速"),
                Map.of("id", "Other", "name", "其他")));
        return Map.of("board", board);
    }

    synchronized Map<String, Object> search(String actor, String projectKey, String jql, int startAt, int maxResults) {
        return search(actor, projectKey, jql, 0, startAt, maxResults);
    }

    synchronized Map<String, Object> search(
            String actor, String projectKey, String jql, long filterId, int startAt, int maxResults) {
        String effectiveProjectKey = projectKey == null ? "" : projectKey.trim().toUpperCase(Locale.ROOT);
        if (!effectiveProjectKey.isBlank()) ensurePermission(requireProject(effectiveProjectKey), actor, "BROWSE");
        String effectiveJql = jql == null ? "" : jql.trim();
        if (filterId > 0) {
            SavedFilter filter = visibleFilter(actor, filterId);
            if (effectiveJql.isBlank()) effectiveJql = filter.jql;
            if (effectiveProjectKey.isBlank() && !filter.projectKey.isBlank()) effectiveProjectKey = filter.projectKey;
        }
        if (!effectiveProjectKey.isBlank()) ensurePermission(requireProject(effectiveProjectKey), actor, "BROWSE");
        String finalProjectKey = effectiveProjectKey;
        Jql.Query query = Jql.parse(effectiveJql, actor);
        List<Issue> matches = issues.values().stream()
                .filter(issue -> finalProjectKey.isBlank() || issue.projectKey.equalsIgnoreCase(finalProjectKey))
                .filter(query.predicate)
                .filter(issue -> hasPermission(requireProject(issue.projectKey), actor, "BROWSE"))
                .sorted(query.comparator)
                .toList();
        int safeStart = Math.max(0, startAt);
        int safeMax = Math.max(1, Math.min(maxResults <= 0 ? 50 : maxResults, 200));
        List<Map<String, Object>> page = matches.stream()
                .skip(safeStart)
                .limit(safeMax)
                .map(Issue::json)
                .toList();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("startAt", safeStart);
        result.put("maxResults", safeMax);
        result.put("total", matches.size());
        result.put("jql", effectiveJql);
        if (filterId > 0) result.put("filterId", filterId);
        result.put("issues", page);
        result.put("names", List.of("summary", "description", "issuetype", "priority", "status", "assignee", "reporter"));
        return result;
    }

    synchronized List<Map<String, Object>> filters(String actor, String projectKey, String query) {
        requireUser(actor);
        String normalizedProject = projectKey == null ? "" : projectKey.trim().toUpperCase(Locale.ROOT);
        String needle = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        return filters.values().stream()
                .filter(filter -> canViewFilter(filter, actor))
                .filter(filter -> normalizedProject.isBlank() || filter.projectKey.isBlank()
                        || normalizedProject.equals(filter.projectKey))
                .filter(filter -> needle.isBlank()
                        || filter.name.toLowerCase(Locale.ROOT).contains(needle)
                        || filter.jql.toLowerCase(Locale.ROOT).contains(needle))
                .sorted(Comparator.comparing((SavedFilter filter) -> !filter.favourite)
                        .thenComparing(filter -> filter.name.toLowerCase(Locale.ROOT)))
                .map(SavedFilter::json)
                .toList();
    }

    synchronized Map<String, Object> filter(String actor, long id) {
        return visibleFilter(actor, id).json();
    }

    synchronized Map<String, Object> createFilter(String actor, Map<String, Object> body) throws IOException {
        requireUser(actor);
        String name = text(body, "name").trim();
        if (name.isBlank()) throw new ProblemException(400, "filter_name_required", "Filter name is required");
        String jql = text(body, "jql").trim();
        validateJql(jql, actor);
        String projectKey = text(body, "projectKey").trim().toUpperCase(Locale.ROOT);
        if (!projectKey.isBlank()) ensurePermission(requireProject(projectKey), actor, "BROWSE");
        SavedFilter filter = new SavedFilter(nextId(), actor, name, jql);
        filter.description = text(body, "description");
        filter.projectKey = projectKey;
        filter.visibility = normalizeVisibility(text(body, "visibility"), "private");
        filter.favourite = Json.boolValue(body.get("favourite"), false);
        filter.sharedWith.addAll(validUsernames(body.get("sharedWith")));
        if ("private".equals(filter.visibility)) filter.sharedWith.clear();
        filters.put(filter.id, filter);
        audit(actor, "filter.created", "filter", String.valueOf(filter.id), filter.name);
        save();
        return filter.json();
    }

    synchronized Map<String, Object> updateFilter(String actor, long id, Map<String, Object> body) throws IOException {
        SavedFilter filter = editableFilter(actor, id);
        if (body.containsKey("name")) {
            String name = text(body, "name").trim();
            if (name.isBlank()) throw new ProblemException(400, "filter_name_required", "Filter name is required");
            filter.name = name;
        }
        if (body.containsKey("jql")) {
            String jql = text(body, "jql").trim();
            validateJql(jql, actor);
            filter.jql = jql;
        }
        if (body.containsKey("description")) filter.description = text(body, "description");
        if (body.containsKey("projectKey")) {
            String projectKey = text(body, "projectKey").trim().toUpperCase(Locale.ROOT);
            if (!projectKey.isBlank()) ensurePermission(requireProject(projectKey), actor, "BROWSE");
            filter.projectKey = projectKey;
        }
        if (body.containsKey("visibility")) filter.visibility = normalizeVisibility(text(body, "visibility"), filter.visibility);
        if (body.containsKey("favourite")) filter.favourite = Json.boolValue(body.get("favourite"), filter.favourite);
        if (body.containsKey("sharedWith")) filter.sharedWith.clear();
        if (body.containsKey("sharedWith")) filter.sharedWith.addAll(validUsernames(body.get("sharedWith")));
        if ("private".equals(filter.visibility)) filter.sharedWith.clear();
        filter.updatedAt = Instant.now().toString();
        audit(actor, "filter.updated", "filter", String.valueOf(id), filter.name);
        save();
        return filter.json();
    }

    synchronized void deleteFilter(String actor, long id) throws IOException {
        SavedFilter filter = editableFilter(actor, id);
        filters.remove(filter.id);
        filterSubscriptions.values().removeIf(subscription -> subscription.filterId == filter.id);
        audit(actor, "filter.deleted", "filter", String.valueOf(id), filter.name);
        save();
    }

    synchronized List<Map<String, Object>> filterSubscriptions(String actor, long filterId) {
        SavedFilter filter = visibleFilter(actor, filterId);
        return filterSubscriptions.values().stream()
                .filter(subscription -> subscription.filterId == filter.id)
                .filter(subscription -> hasGlobalAdmin(actor)
                        || filter.owner.equals(actor)
                        || subscription.username.equals(actor))
                .sorted(Comparator.comparingLong(subscription -> subscription.id))
                .map(FilterSubscription::json)
                .toList();
    }

    synchronized Map<String, Object> createFilterSubscription(
            String actor, long filterId, Map<String, Object> body) throws IOException {
        SavedFilter filter = visibleFilter(actor, filterId);
        String username = defaulted(body, "username", actor).trim();
        if (!username.equals(actor) && !hasGlobalAdmin(actor) && !filter.owner.equals(actor)) {
            throw new ProblemException(403, "subscription_owner_required", "Only the filter owner or administrator may subscribe another user");
        }
        requireUser(username);
        if (filterSubscriptions.values().stream()
                .anyMatch(subscription -> subscription.filterId == filter.id && subscription.username.equals(username))) {
            throw new ProblemException(409, "subscription_exists", "Filter subscription already exists");
        }
        FilterSubscription subscription = new FilterSubscription(nextId(), filter.id, username);
        subscription.frequency = normalizeFrequency(text(body, "frequency"));
        subscription.enabled = Json.boolValue(body.get("enabled"), true);
        subscription.nextRunAt = nextRunFor(subscription.frequency);
        filterSubscriptions.put(subscription.id, subscription);
        audit(actor, "filter.subscription.created", "filter", String.valueOf(filter.id), username);
        save();
        return subscription.json();
    }

    synchronized Map<String, Object> updateFilterSubscription(
            String actor, long filterId, long subscriptionId, Map<String, Object> body) throws IOException {
        SavedFilter filter = visibleFilter(actor, filterId);
        FilterSubscription subscription = requireSubscription(filter, subscriptionId);
        if (!hasGlobalAdmin(actor) && !filter.owner.equals(actor) && !subscription.username.equals(actor)) {
            throw new ProblemException(403, "subscription_owner_required", "Only the subscription owner may update it");
        }
        if (body.containsKey("frequency")) subscription.frequency = normalizeFrequency(text(body, "frequency"));
        if (body.containsKey("enabled")) subscription.enabled = Json.boolValue(body.get("enabled"), subscription.enabled);
        subscription.nextRunAt = subscription.enabled ? nextRunFor(subscription.frequency) : "";
        audit(actor, "filter.subscription.updated", "filter", String.valueOf(filter.id), String.valueOf(subscription.id));
        save();
        return subscription.json();
    }

    synchronized void deleteFilterSubscription(String actor, long filterId, long subscriptionId) throws IOException {
        SavedFilter filter = visibleFilter(actor, filterId);
        FilterSubscription subscription = requireSubscription(filter, subscriptionId);
        if (!hasGlobalAdmin(actor) && !filter.owner.equals(actor) && !subscription.username.equals(actor)) {
            throw new ProblemException(403, "subscription_owner_required", "Only the subscription owner may delete it");
        }
        filterSubscriptions.remove(subscription.id);
        audit(actor, "filter.subscription.deleted", "filter", String.valueOf(filter.id), String.valueOf(subscription.id));
        save();
    }

    synchronized Map<String, Object> issue(String key, String actor) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "BROWSE");
        return issue.json();
    }

    /**
     * Import the external CEP issue ledger into JiraFlow's issue store.
     *
     * CEP records are deliberately kept in JiraFlow as normal issues with
     * explicit provenance.  They never enter the ASPICE evidence/finding
     * collections, which keeps the issue ledger separate from assessment data.
     * The operation is idempotent on the source issue id (or external issue
     * key when no source id is available) so retrying an upload updates the
     * existing ledger row instead of creating duplicates.
     */
    synchronized Map<String, Object> importCepIssues(
            String actor, Map<String, Object> body) throws IOException {
        ensureGlobalAdmin(actor);
        Object rawIssues = body == null ? null : body.get("issues");
        if (!(rawIssues instanceof List<?> records)) {
            throw new ProblemException(400, "issues_array_required", "Import body must contain an issues array");
        }

        String projectKey = defaulted(body, "projectKey", "CEP").trim().toUpperCase(Locale.ROOT);
        if (projectKey.isBlank() || !projectKey.matches("[A-Z][A-Z0-9_]{1,19}")) {
            throw new ProblemException(400, "invalid_project_key", "Project key must contain 2-20 uppercase letters, numbers or underscores");
        }
        Project project = ensureImportedProject(projectKey);
        String defaultSourceKind = defaulted(body, "sourceKind", "jira-issue-import");
        String defaultSourceFile = text(body, "sourceFile").trim();

        int created = 0;
        int updated = 0;
        List<Map<String, Object>> imported = new ArrayList<>();
        for (int index = 0; index < records.size(); index++) {
            Object rawRecord = records.get(index);
            if (!(rawRecord instanceof Map<?, ?> rawMap)) {
                throw new ProblemException(400, "invalid_issue_record",
                        "Each imported issue must be a JSON object", Map.of("index", index));
            }
            Map<String, Object> record = new LinkedHashMap<>();
            rawMap.forEach((key, value) -> record.put(String.valueOf(key), value));

            String sourceIssueId = text(record, "issueId").trim();
            String suppliedIssueKey = text(record, "issueKey").trim();
            if (sourceIssueId.isBlank() && suppliedIssueKey.isBlank()) {
                throw new ProblemException(400, "issue_identifier_required",
                        "Each imported issue must contain issueId or issueKey",
                        Map.of("index", index));
            }
            if (sourceIssueId.isBlank()) sourceIssueId = suppliedIssueKey;
            String externalKey = suppliedIssueKey.isBlank()
                    ? projectKey + "-" + sourceIssueId.replaceAll("[^A-Za-z0-9_-]+", "-")
                    : suppliedIssueKey;
            externalKey = externalKey.trim().toUpperCase(Locale.ROOT);
            if (externalKey.isBlank() || !externalKey.matches("[A-Z][A-Z0-9_]{1,19}-[A-Z0-9][A-Z0-9_-]{0,79}")) {
                throw new ProblemException(400, "invalid_issue_key",
                        "Imported issue key is invalid", Map.of("index", index, "issueKey", externalKey));
            }

            Issue existing = findImportedIssue(projectKey, sourceIssueId, externalKey);
            if (existing == null) {
                Issue keyCollision = issues.get(externalKey);
                if (keyCollision != null && !projectKey.equalsIgnoreCase(keyCollision.projectKey)) {
                    throw new ProblemException(409, "issue_key_conflict",
                            "Imported issue key belongs to another project",
                            Map.of("issueKey", externalKey, "projectKey", keyCollision.projectKey));
                }
            }

            String summary = defaulted(record, "title", defaulted(record, "summary", externalKey)).trim();
            if (summary.isBlank()) summary = externalKey;
            String type = defaulted(record, "type", "Bug").trim();
            String priority = importPriority(text(record, "severity"));
            String status = importStatus(text(record, "status"));
            String process = text(record, "process").trim();
            String category = text(record, "category").trim();
            String owner = text(record, "owner").trim();
            String assignee = users.containsKey(owner) && users.get(owner).active
                    ? owner
                    : project.settings.defaultAssignee;
            String description = importedDescription(record);
            String sourceKind = defaulted(record, "sourceKind", defaultSourceKind);
            String sourceFile = defaulted(record, "sourceFile", defaultSourceFile);
            String sourceSheet = text(record, "sourceSheet").trim();
            int sourceRow = importedSourceRow(record.get("sourceRow"));
            String sourceCellsJson = record.containsKey("sourceCells")
                    ? Json.stringify(record.get("sourceCells"))
                    : "";

            if (existing == null) {
                Issue issue = new Issue(
                        nextIssueId++,
                        externalKey,
                        projectKey,
                        summary,
                        type,
                        priority,
                        status,
                        "Highest".equalsIgnoreCase(priority) ? "Expedite" : "Other");
                applyImportedFields(
                        issue, record, actor, project, assignee, description, process, category,
                        sourceKind, sourceFile, sourceSheet, sourceRow, sourceIssueId, sourceCellsJson);
                issues.put(issue.key, issue);
                audit(actor, "issue.imported", "issue", issue.key, "Imported CEP issue ledger record");
                event(actor, projectKey, "issue.imported", issue.key, importedEventPayload(issue));
                imported.add(issue.json());
                created++;
            } else {
                applyImportedFields(
                        existing, record, existing.creator.isBlank() ? actor : existing.creator, project,
                        assignee, description, process, category, sourceKind, sourceFile, sourceSheet,
                        sourceRow, sourceIssueId, sourceCellsJson);
                touch(existing);
                audit(actor, "issue.import.updated", "issue", existing.key, "Updated CEP issue ledger record");
                event(actor, projectKey, "issue.import.updated", existing.key, importedEventPayload(existing));
                imported.add(existing.json());
                updated++;
            }
        }
        save();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("project", project.json());
        result.put("created", created);
        result.put("updated", updated);
        result.put("total", records.size());
        result.put("issues", imported);
        return result;
    }

    private Project ensureImportedProject(String projectKey) {
        Project project = projects.get(projectKey);
        if (project == null) {
            project = new Project(projectKey, "CEP Audit Issue Ledger", "software",
                    "External CEP/TUV audit issue ledger imported from the tracking workbook.");
            project.settings.description = project.description;
            project.settings.defaultAssignee = users.containsKey("testuser") ? "testuser" : users.keySet().stream()
                    .findFirst().orElse("");
            project.roles.put("administrators", new LinkedHashSet<>(Set.of("testuser")));
            project.roles.put("developers", new LinkedHashSet<>(Set.of("testuser")));
            project.roles.put("reporters", new LinkedHashSet<>(Set.of("testuser")));
            project.roles.put("viewers", new LinkedHashSet<>(Set.of("testuser")));
            addWorkflow(project, "Start work", "BACKLOG", "TODO");
            addWorkflow(project, "Start development", "BACKLOG", "IN_PROGRESS");
            addWorkflow(project, "Resolve", "BACKLOG", "DONE");
            addWorkflow(project, "Send back", "TODO", "BACKLOG");
            addWorkflow(project, "Start development", "TODO", "IN_PROGRESS");
            addWorkflow(project, "Resolve", "TODO", "DONE");
            addWorkflow(project, "Pause", "IN_PROGRESS", "TODO");
            addWorkflow(project, "Resolve", "IN_PROGRESS", "DONE");
            addWorkflow(project, "Reopen", "DONE", "IN_PROGRESS");
            projects.put(project.key, project);
        } else {
            project.roles.computeIfAbsent("administrators", ignored -> new LinkedHashSet<>()).add("testuser");
            project.roles.computeIfAbsent("developers", ignored -> new LinkedHashSet<>()).add("testuser");
            project.roles.computeIfAbsent("reporters", ignored -> new LinkedHashSet<>()).add("testuser");
            project.roles.computeIfAbsent("viewers", ignored -> new LinkedHashSet<>()).add("testuser");
            if (project.settings.defaultAssignee == null || project.settings.defaultAssignee.isBlank()) {
                project.settings.defaultAssignee = users.containsKey("testuser") ? "testuser" : users.keySet().stream()
                        .findFirst().orElse("");
            }
        }
        return project;
    }

    private Issue findImportedIssue(String projectKey, String sourceIssueId, String externalKey) {
        if (!sourceIssueId.isBlank()) {
            Issue bySource = issues.values().stream()
                    .filter(issue -> projectKey.equalsIgnoreCase(issue.projectKey))
                    .filter(issue -> sourceIssueId.equals(issue.sourceIssueId))
                    .findFirst()
                    .orElse(null);
            if (bySource != null) return bySource;
        }
        Issue byKey = issues.get(externalKey);
        if (byKey != null && projectKey.equalsIgnoreCase(byKey.projectKey)) return byKey;
        return null;
    }

    private void applyImportedFields(
            Issue issue,
            Map<String, Object> record,
            String actor,
            Project project,
            String assignee,
            String description,
            String process,
            String category,
            String sourceKind,
            String sourceFile,
            String sourceSheet,
            int sourceRow,
            String sourceIssueId,
            String sourceCellsJson) {
        issue.summary = defaulted(record, "title", defaulted(record, "summary", issue.summary)).trim();
        issue.description = description;
        issue.type = defaulted(record, "type", "Bug").trim();
        issue.priority = importPriority(text(record, "severity"));
        issue.status = importStatus(text(record, "status"));
        issue.swimlane = "Highest".equalsIgnoreCase(issue.priority) ? "Expedite" : "Other";
        issue.assignee = assignee;
        if (issue.reporter == null || issue.reporter.isBlank()) issue.reporter = actor;
        if (issue.creator == null || issue.creator.isBlank()) issue.creator = actor;
        issue.dueDate = text(record, "dueDate").trim();
        issue.analysisDomain = "CEP";
        issue.evidenceRole = "issue-ledger";
        issue.processArea = process;
        issue.formalScope = category;
        issue.sourceSystem = "TUV";
        issue.sourceKind = sourceKind;
        issue.sourceFile = sourceFile;
        issue.sourceSheet = sourceSheet;
        issue.sourceRow = sourceRow;
        issue.sourceIssueId = sourceIssueId;
        issue.ownedBy = "jiraflow";
        issue.sourceCellsJson = sourceCellsJson;
        issue.labels.clear();
        issue.labels.add("cep");
        if (!process.isBlank()) issue.labels.add(process.toLowerCase(Locale.ROOT));
        issue.labels.add(issue.priority.toLowerCase(Locale.ROOT));
        issue.labels.addAll(Json.stringList(record.get("labels")));
    }

    private static Map<String, Object> importedEventPayload(Issue issue) {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("key", issue.key);
        payload.put("sourceIssueId", issue.sourceIssueId);
        payload.put("sourceFile", issue.sourceFile);
        payload.put("sourceSheet", issue.sourceSheet);
        payload.put("sourceRow", issue.sourceRow);
        payload.put("analysisDomain", issue.analysisDomain);
        return payload;
    }

    private static String importedDescription(Map<String, Object> record) {
        StringBuilder description = new StringBuilder(text(record, "description").trim());
        appendImportedDescription(description, "Internal comment", text(record, "internalComment"));
        appendImportedDescription(description, "Root cause", text(record, "rootCause"));
        appendImportedDescription(description, "Improvement measures", text(record, "improvementMeasures"));
        appendImportedDescription(description, "Helix description", text(record, "helixDescription"));
        appendImportedDescription(description, "Reference example", text(record, "referenceExample"));
        return description.toString();
    }

    private static void appendImportedDescription(StringBuilder description, String label, String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.isBlank()) return;
        if (description.length() > 0) description.append("\n\n");
        description.append(label).append(":\n").append(normalized);
    }

    private static String importPriority(String severity) {
        return switch (severity == null ? "" : severity.trim().toLowerCase(Locale.ROOT)) {
            case "critical", "blocker" -> "Highest";
            case "major" -> "High";
            case "minor" -> "Medium";
            case "trivial" -> "Low";
            default -> "Medium";
        };
    }

    private static String importStatus(String status) {
        return switch (status == null ? "" : status.trim().toLowerCase(Locale.ROOT)) {
            case "in progress", "in_progress", "处理中" -> "IN_PROGRESS";
            case "closed", "resolved", "done", "完成" -> "DONE";
            case "open", "new", "backlog", "待开发" -> "BACKLOG";
            default -> "BACKLOG";
        };
    }

    private static int importedSourceRow(Object value) {
        long row = Json.longValue(value, 0);
        if (row <= 0) return 0;
        return (int) Math.min(Integer.MAX_VALUE, row);
    }

    synchronized Map<String, Object> createIssue(String actor, Map<String, Object> body) throws IOException {
        String projectKey = defaulted(body, "projectKey", "KTEST").toUpperCase(Locale.ROOT);
        Project project = requireProject(projectKey);
        ensurePermission(project, actor, "CREATE");
        String summary = text(body, "summary").trim();
        if (summary.isBlank()) throw new ProblemException(400, "summary_required", "Summary is required");
        String type = defaulted(body, "type", "Task");
        String priority = defaulted(body, "priority", "Medium");
        String status = normalizeStatus(defaulted(body, "status", "BACKLOG"));
        if (!isProjectStatus(project, status)) throw new ProblemException(400, "invalid_status", "Unsupported status");
        String key = projectKey + "-" + nextIssueId;
        Issue issue = new Issue(nextIssueId++, key, projectKey, summary, type, priority, status,
                "Highest".equalsIgnoreCase(priority) ? "Expedite" : "Other");
        issue.description = text(body, "description");
        issue.environment = text(body, "environment");
        issue.dueDate = text(body, "dueDate");
        issue.creator = actor;
        issue.reporter = defaulted(body, "reporter", actor);
        issue.assignee = defaulted(body, "assignee", project.settings.defaultAssignee);
        issue.labels.addAll(Json.stringList(body.get("labels")));
        issue.components.addAll(normalizeComponentNames(project, body.get("components")));
        issue.fixVersions.addAll(Json.stringList(body.get("fixVersions")));
        issue.affectsVersions.addAll(Json.stringList(body.get("affectsVersions")));
        applyAssessmentFields(issue, body, null);
        if (body.containsKey("parentKey")) {
            String parentKey = text(body, "parentKey");
            Issue parent = requireIssue(parentKey);
            if (!parent.projectKey.equals(projectKey)) throw new ProblemException(400, "invalid_parent", "Parent issue is in another project");
            issue.parentKey = parent.key;
            parent.subtasks.add(issue.key);
            parent.revision++;
            parent.updatedAt = Instant.now().toString();
        }
        issues.put(issue.key, issue);
        audit(actor, "issue.created", "issue", issue.key, "Created " + issue.type);
        event(actor, projectKey, "issue.created", issue.key,
                Map.of("summary", issue.summary, "type", issue.type, "status", issue.status));
        save();
        return issue.json();
    }

    synchronized Map<String, Object> updateIssue(String actor, String key, Map<String, Object> body, long expectedRevision) throws IOException {
        Issue issue = editableIssue(actor, key);
        ensureRevision(issue, expectedRevision);
        ensureUnlocked(issue, actor);
        List<String> changed = new ArrayList<>();
        if (body.containsKey("summary")) {
            issue.summary = text(body, "summary").trim();
            changed.add("summary");
        }
        if (body.containsKey("description")) {
            issue.description = text(body, "description");
            changed.add("description");
        }
        if (body.containsKey("environment")) {
            issue.environment = text(body, "environment");
            changed.add("environment");
        }
        if (body.containsKey("dueDate")) {
            issue.dueDate = text(body, "dueDate");
            changed.add("dueDate");
        }
        if (body.containsKey("resolution")) {
            issue.resolution = text(body, "resolution");
            changed.add("resolution");
        }
        if (body.containsKey("priority")) {
            issue.priority = text(body, "priority");
            issue.swimlane = "Highest".equalsIgnoreCase(issue.priority) ? "Expedite" : "Other";
            changed.add("priority");
        }
        if (body.containsKey("type")) {
            issue.type = text(body, "type");
            changed.add("type");
        }
        if (body.containsKey("assignee")) {
            ensurePermission(requireProject(issue.projectKey), actor, "ASSIGN");
            issue.assignee = text(body, "assignee");
            changed.add("assignee");
        }
        if (body.containsKey("reporter")) {
            issue.reporter = text(body, "reporter");
            changed.add("reporter");
        }
        if (body.containsKey("labels")) {
            issue.labels.clear();
            issue.labels.addAll(Json.stringList(body.get("labels")));
            changed.add("labels");
        }
        if (body.containsKey("components")) {
            issue.components.clear();
            issue.components.addAll(normalizeComponentNames(requireProject(issue.projectKey), body.get("components")));
            changed.add("components");
        }
        if (body.containsKey("fixVersions")) {
            issue.fixVersions.clear();
            issue.fixVersions.addAll(Json.stringList(body.get("fixVersions")));
            changed.add("fixVersions");
        }
        if (body.containsKey("affectsVersions")) {
            issue.affectsVersions.clear();
            issue.affectsVersions.addAll(Json.stringList(body.get("affectsVersions")));
            changed.add("affectsVersions");
        }
        applyAssessmentFields(issue, body, changed);
        if (changed.isEmpty()) return issue.json();
        touch(issue);
        audit(actor, "issue.updated", "issue", issue.key, String.join(", ", changed));
        event(actor, issue.projectKey, "issue.updated", issue.key, Map.of("fields", changed));
        notifyWatchers(issue, actor, "issue.updated", actor + " updated " + issue.key);
        save();
        return issue.json();
    }

    synchronized Map<String, Object> assessment(String actor, String key) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "BROWSE");
        return assessmentJson(issue);
    }

    synchronized Map<String, Object> updateAssessment(String actor, String key, Map<String, Object> body,
            long expectedRevision) throws IOException {
        Issue issue = editableIssue(actor, key);
        ensureRevision(issue, expectedRevision);
        ensureUnlocked(issue, actor);
        List<String> changed = new ArrayList<>();
        applyAssessmentFields(issue, body, changed);
        if (changed.isEmpty()) return assessmentJson(issue);
        touch(issue);
        audit(actor, "issue.assessment.updated", "issue", issue.key, String.join(", ", changed));
        event(actor, issue.projectKey, "issue.assessment.updated", issue.key, Map.of("fields", changed));
        notifyWatchers(issue, actor, "issue.assessment.updated", actor + " updated assessment for " + issue.key);
        save();
        return assessmentJson(issue);
    }

    private static Map<String, Object> assessmentJson(Issue issue) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("issueKey", issue.key);
        result.put("revision", issue.revision);
        result.put("analysisDomain", issue.analysisDomain);
        result.put("processArea", issue.processArea);
        result.put("formalScope", issue.formalScope);
        result.put("evidenceRole", issue.evidenceRole);
        result.put("assessmentRating", issue.assessmentRating);
        result.put("assessorDecision", issue.assessorDecision);
        result.put("asil", issue.asil);
        result.put("cybersecurityLevel", issue.cybersecurityLevel);
        result.put("riskStatement", issue.riskStatement);
        result.put("objectiveEvidence", issue.objectiveEvidence);
        result.put("verificationMethod", issue.verificationMethod);
        result.put("closureEvidence", issue.closureEvidence);
        result.put("reviewStatus", issue.reviewStatus);
        result.put("traceLinks", new ArrayList<>(issue.traceLinks));
        return result;
    }

    private static void applyAssessmentFields(Issue issue, Map<String, Object> body, List<String> changed) {
        if (body.containsKey("analysisDomain")) { issue.analysisDomain = normalizedDomain(text(body, "analysisDomain")); addChanged(changed, "analysisDomain"); }
        if (body.containsKey("processArea")) { issue.processArea = text(body, "processArea").trim(); addChanged(changed, "processArea"); }
        if (body.containsKey("formalScope")) { issue.formalScope = text(body, "formalScope").trim(); addChanged(changed, "formalScope"); }
        if (body.containsKey("evidenceRole")) { issue.evidenceRole = normalizedEvidenceRole(text(body, "evidenceRole")); addChanged(changed, "evidenceRole"); }
        if (body.containsKey("assessmentRating")) { issue.assessmentRating = text(body, "assessmentRating").trim(); addChanged(changed, "assessmentRating"); }
        if (body.containsKey("assessorDecision")) { issue.assessorDecision = text(body, "assessorDecision").trim(); addChanged(changed, "assessorDecision"); }
        if (body.containsKey("asil")) { issue.asil = text(body, "asil").trim(); addChanged(changed, "asil"); }
        if (body.containsKey("cybersecurityLevel")) { issue.cybersecurityLevel = text(body, "cybersecurityLevel").trim(); addChanged(changed, "cybersecurityLevel"); }
        if (body.containsKey("riskStatement")) { issue.riskStatement = text(body, "riskStatement"); addChanged(changed, "riskStatement"); }
        if (body.containsKey("objectiveEvidence")) { issue.objectiveEvidence = text(body, "objectiveEvidence"); addChanged(changed, "objectiveEvidence"); }
        if (body.containsKey("verificationMethod")) { issue.verificationMethod = text(body, "verificationMethod"); addChanged(changed, "verificationMethod"); }
        if (body.containsKey("closureEvidence")) { issue.closureEvidence = text(body, "closureEvidence"); addChanged(changed, "closureEvidence"); }
        if (body.containsKey("reviewStatus")) { issue.reviewStatus = text(body, "reviewStatus").trim(); addChanged(changed, "reviewStatus"); }
        if (body.containsKey("traceLinks")) { issue.traceLinks = new ArrayList<>(Json.stringList(body.get("traceLinks"))); addChanged(changed, "traceLinks"); }
    }

    private static void addChanged(List<String> changed, String field) {
        if (changed != null) changed.add(field);
    }

    private static String normalizedDomain(String value) {
        String domain = value == null ? "" : value.trim().toUpperCase(Locale.ROOT);
        return switch (domain) {
            case "ASPICE", "CYBERSECURITY", "FUNCTIONAL_SAFETY" -> domain;
            default -> domain.isBlank() ? "ASPICE" : domain;
        };
    }

    private static String normalizedEvidenceRole(String value) {
        String role = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        return switch (role) {
            case "direct", "corroborating", "index-only" -> role;
            default -> role.isBlank() ? "direct" : role;
        };
    }

    synchronized void deleteIssue(String actor, String key) throws IOException {
        Issue issue = requireIssue(key);
        Project project = requireProject(issue.projectKey);
        ensurePermission(project, actor, "DELETE");
        ensureUnlocked(issue, actor);
        if (!issue.parentKey.isBlank()) {
            Issue parent = issues.get(issue.parentKey);
            if (parent != null) {
                parent.subtasks.remove(issue.key);
                touch(parent);
            }
        }
        for (String childKey : issue.subtasks) {
            Issue child = issues.get(childKey);
            if (child != null) child.parentKey = "";
        }
        issues.values().forEach(other -> other.links.removeIf(link ->
                link.outward.equals(issue.key) || link.inward.equals(issue.key)));
        audit(actor, "issue.deleted", "issue", issue.key, issue.summary);
        event(actor, issue.projectKey, "issue.deleted", issue.key, Map.of("summary", issue.summary));
        issues.remove(issue.key);
        save();
    }

    synchronized Map<String, Object> transition(String actor, String key, String target, long expectedRevision) throws IOException {
        return transition(actor, key, target, expectedRevision, true);
    }

    private Map<String, Object> transition(
            String actor, String key, String target, long expectedRevision, boolean persist) throws IOException {
        Issue issue = editableIssue(actor, key);
        ensureRevision(issue, expectedRevision);
        ensureUnlocked(issue, actor);
        String status = normalizeStatus(target);
        Project project = requireProject(issue.projectKey);
        if (!isProjectStatus(project, status)) throw new ProblemException(400, "invalid_status", "Unsupported status");
        boolean allowed = status.equals(issue.status) || project.workflow.stream()
                .anyMatch(transition -> transition.enabled
                        && transition.from.equals(issue.status)
                        && transition.to.equals(status));
        if (!allowed) throw new ProblemException(409, "invalid_transition", "Workflow does not allow this transition");
        String before = issue.status;
        issue.status = status;
        issue.resolution = "DONE".equals(status) ? "Done" : "";
        touch(issue);
        audit(actor, "issue.transitioned", "issue", issue.key, before + " -> " + status);
        event(actor, issue.projectKey, "issue.transitioned", issue.key, Map.of("from", before, "to", status));
        notifyWatchers(issue, actor, "issue.transitioned", actor + " moved " + issue.key + " to " + status);
        if (persist) save();
        return issue.json();
    }

    synchronized List<Map<String, Object>> comments(String actor, String key) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "BROWSE");
        return issue.comments.stream().map(Comment::json).toList();
    }

    synchronized Map<String, Object> addComment(String actor, String key, Map<String, Object> body) throws IOException {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "COMMENT");
        ensureUnlocked(issue, actor);
        String value = text(body, "body").trim();
        if (value.isBlank()) throw new ProblemException(400, "comment_required", "Comment body is required");
        Comment comment = new Comment(nextId(), actor, value);
        issue.comments.add(comment);
        touch(issue);
        audit(actor, "comment.created", "issue", issue.key, "Comment " + comment.id);
        event(actor, issue.projectKey, "issue.commented", issue.key, Map.of("commentId", comment.id));
        notifyWatchers(issue, actor, "comment.created", actor + " commented on " + issue.key);
        save();
        return comment.json();
    }

    synchronized Map<String, Object> updateComment(
            String actor, String key, long commentId, Map<String, Object> body) throws IOException {
        Issue issue = requireIssue(key);
        Project project = requireProject(issue.projectKey);
        ensurePermission(project, actor, "COMMENT");
        Comment comment = issue.comments.stream().filter(item -> item.id == commentId).findFirst()
                .orElseThrow(() -> new ProblemException(404, "comment_not_found", "Comment not found"));
        if (!comment.author.equals(actor) && !hasPermission(project, actor, "ADMINISTER")) {
            throw new ProblemException(403, "comment_owner_required", "Only the comment author or project administrator may edit it");
        }
        String value = text(body, "body").trim();
        if (value.isBlank()) throw new ProblemException(400, "comment_required", "Comment body is required");
        comment.body = value;
        comment.updatedAt = Instant.now().toString();
        touch(issue);
        audit(actor, "comment.updated", "issue", issue.key, "Comment " + comment.id);
        event(actor, issue.projectKey, "issue.comment.updated", issue.key, Map.of("commentId", comment.id));
        save();
        return comment.json();
    }

    synchronized void deleteComment(String actor, String key, long commentId) throws IOException {
        Issue issue = requireIssue(key);
        Project project = requireProject(issue.projectKey);
        ensurePermission(project, actor, "COMMENT");
        Comment comment = issue.comments.stream().filter(item -> item.id == commentId).findFirst()
                .orElseThrow(() -> new ProblemException(404, "comment_not_found", "Comment not found"));
        if (!comment.author.equals(actor) && !hasPermission(project, actor, "ADMINISTER")) {
            throw new ProblemException(403, "comment_owner_required", "Only the comment author or project administrator may delete it");
        }
        issue.comments.remove(comment);
        touch(issue);
        audit(actor, "comment.deleted", "issue", issue.key, "Comment " + comment.id);
        event(actor, issue.projectKey, "issue.comment.deleted", issue.key, Map.of("commentId", comment.id));
        save();
    }

    synchronized Map<String, Object> pinComment(
            String actor, String key, long commentId, boolean pinned) throws IOException {
        Issue issue = requireIssue(key);
        Project project = requireProject(issue.projectKey);
        ensurePermission(project, actor, "COMMENT");
        Comment comment = issue.comments.stream().filter(item -> item.id == commentId).findFirst()
                .orElseThrow(() -> new ProblemException(404, "comment_not_found", "Comment not found"));
        if (!comment.author.equals(actor) && !hasPermission(project, actor, "ADMINISTER")) {
            throw new ProblemException(403, "comment_owner_required", "Only the comment author or project administrator may pin it");
        }
        if (pinned && !comment.pinned && issue.comments.stream().filter(item -> item.pinned).count() >= 5) {
            throw new ProblemException(409, "pin_limit_reached", "At most five comments may be pinned");
        }
        comment.pinned = pinned;
        touch(issue);
        audit(actor, pinned ? "comment.pinned" : "comment.unpinned", "issue", issue.key, "Comment " + comment.id);
        save();
        return comment.json();
    }

    synchronized List<Map<String, Object>> worklogs(String actor, String key) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "BROWSE");
        return issue.worklogs.stream().map(Worklog::json).toList();
    }

    synchronized Map<String, Object> addWorklog(String actor, String key, Map<String, Object> body) throws IOException {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "WORKLOG");
        int minutes = (int) Json.longValue(body.get("minutes"), 0);
        if (minutes <= 0 || minutes > 100_000) {
            throw new ProblemException(400, "invalid_worklog_duration", "Worklog minutes must be between 1 and 100000");
        }
        Worklog worklog = new Worklog(nextId(), actor, minutes, text(body, "body"), text(body, "startedAt"));
        issue.worklogs.add(worklog);
        touch(issue);
        audit(actor, "worklog.created", "issue", issue.key, minutes + " minutes");
        event(actor, issue.projectKey, "issue.worklogged", issue.key, worklog.json());
        notifyWatchers(issue, actor, "worklog.created", actor + " logged work on " + issue.key);
        save();
        return worklog.json();
    }

    synchronized Map<String, Object> createSubtask(String actor, String parentKey, Map<String, Object> body) throws IOException {
        Issue parent = requireIssue(parentKey);
        ensurePermission(requireProject(parent.projectKey), actor, "CREATE");
        String summary = text(body, "summary").trim();
        if (summary.isBlank()) throw new ProblemException(400, "summary_required", "Subtask summary is required");
        Map<String, Object> payload = new LinkedHashMap<>(body);
        payload.put("projectKey", parent.projectKey);
        payload.put("parentKey", parent.key);
        payload.put("type", "Sub-task");
        payload.putIfAbsent("priority", "Medium");
        Map<String, Object> child = createIssue(actor, payload);
        return child;
    }

    synchronized List<Map<String, Object>> attachments(String actor, String key) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "BROWSE");
        return issue.attachments.values().stream().map(Attachment::json).toList();
    }

    synchronized Map<String, Object> addAttachment(String actor, String key, Map<String, Object> body) throws IOException {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "ATTACH");
        ensureUnlocked(issue, actor);
        String filename = text(body, "filename").trim();
        String content = text(body, "contentBase64");
        if (filename.isBlank() || content.isBlank()) {
            throw new ProblemException(400, "attachment_required", "filename and contentBase64 are required");
        }
        try {
            Base64.getDecoder().decode(content);
        } catch (IllegalArgumentException error) {
            throw new ProblemException(400, "attachment_invalid", "contentBase64 is not valid");
        }
        if (content.length() > 14_000_000) throw new ProblemException(413, "attachment_too_large", "Attachment exceeds the 10 MB limit");
        Attachment attachment = new Attachment(
                nextId(),
                filename,
                defaulted(body, "contentType", "application/octet-stream"),
                actor,
                content);
        issue.attachments.put(attachment.id, attachment);
        touch(issue);
        audit(actor, "attachment.created", "issue", issue.key, filename);
        event(actor, issue.projectKey, "issue.attached", issue.key, attachment.json());
        notifyWatchers(issue, actor, "attachment.created", actor + " attached " + filename + " to " + issue.key);
        save();
        return attachment.json();
    }

    synchronized Map<String, Object> downloadAttachment(String actor, String key, long attachmentId) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "BROWSE");
        Attachment attachment = issue.attachments.get(attachmentId);
        if (attachment == null) throw new ProblemException(404, "attachment_not_found", "Attachment not found");
        return attachment.downloadJson();
    }

    synchronized void deleteAttachment(String actor, String key, long attachmentId) throws IOException {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "ATTACH");
        ensureUnlocked(issue, actor);
        Attachment attachment = issue.attachments.remove(attachmentId);
        if (attachment == null) {
            throw new ProblemException(404, "attachment_not_found", "Attachment not found");
        }
        touch(issue);
        audit(actor, "attachment.deleted", "issue", issue.key, attachment.filename);
        event(actor, issue.projectKey, "issue.attachment.deleted", issue.key, Map.of("attachmentId", attachmentId));
        save();
    }

    synchronized List<Map<String, Object>> history(String actor, String key) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "BROWSE");
        return auditEvents.stream()
                .filter(event -> "issue".equals(event.entity) && event.entityKey.equals(issue.key))
                .sorted(Comparator.comparingLong(event -> event.id))
                .map(AuditEvent::json)
                .toList();
    }

    synchronized Map<String, Object> watch(String actor, String key, boolean enabled) throws IOException {
        return setWatcher(actor, key, actor, enabled);
    }

    synchronized Map<String, Object> setWatcher(String actor, String key, String username, boolean enabled)
            throws IOException {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "WATCH");
        requireUser(username);
        if (enabled) issue.watchers.add(username);
        else issue.watchers.remove(username);
        touch(issue);
        audit(actor, enabled ? "watch.created" : "watch.deleted", "issue", issue.key, username);
        save();
        return issue.json();
    }

    synchronized Map<String, Object> vote(String actor, String key, boolean enabled) throws IOException {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "VOTE");
        if (enabled) issue.voters.add(actor);
        else issue.voters.remove(actor);
        touch(issue);
        audit(actor, enabled ? "vote.created" : "vote.deleted", "issue", issue.key, actor);
        save();
        return issue.json();
    }

    synchronized Map<String, Object> linkIssue(String actor, String key, Map<String, Object> body) throws IOException {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "LINK");
        String linkedKey = defaulted(body, "linkedIssueKey", defaulted(body, "issueKey", ""));
        if (linkedKey.isBlank()) throw new ProblemException(400, "linked_issue_required", "linkedIssueKey is required");
        Issue linked = requireIssue(linkedKey);
        if (!issue.projectKey.equals(linked.projectKey)) {
            throw new ProblemException(400, "cross_project_link", "Cross-project links are not enabled in this local slice");
        }
        String type = defaulted(body, "type", "relates to");
        issue.links.add(new IssueLink(type, issue.key, linked.key));
        linked.links.add(new IssueLink(type, linked.key, issue.key));
        touch(issue);
        touch(linked);
        audit(actor, "issue.linked", "issue", issue.key, type + " " + linked.key);
        event(actor, issue.projectKey, "issue.linked", issue.key, Map.of("type", type, "linkedIssueKey", linked.key));
        save();
        return issue.json();
    }

    synchronized List<Map<String, Object>> issueLinks(String actor, String key) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "BROWSE");
        return issue.links.stream().map(IssueLink::json).toList();
    }

    synchronized void deleteIssueLink(String actor, String key, Map<String, Object> body) throws IOException {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "LINK");
        String linkedKey = defaulted(body, "linkedIssueKey", defaulted(body, "issueKey", ""));
        String type = defaulted(body, "type", "");
        Issue linked = requireIssue(linkedKey);
        boolean removed = issue.links.removeIf(link -> matchesLink(link, issue.key, linked.key, type));
        linked.links.removeIf(link -> matchesLink(link, linked.key, issue.key, type));
        if (!removed) throw new ProblemException(404, "link_not_found", "Issue link not found");
        touch(issue);
        touch(linked);
        audit(actor, "issue.unlinked", "issue", issue.key, linked.key);
        event(actor, issue.projectKey, "issue.unlinked", issue.key, Map.of("linkedIssueKey", linked.key, "type", type));
        save();
    }

    private boolean matchesLink(IssueLink link, String outward, String inward, String type) {
        return link.outward.equals(outward) && link.inward.equals(inward)
                && (type.isBlank() || link.type.equals(type));
    }

    synchronized Map<String, Object> rankIssue(String actor, String key, Map<String, Object> body, long expectedRevision)
            throws IOException {
        Issue issue = editableIssue(actor, key);
        ensureRevision(issue, expectedRevision);
        ensureUnlocked(issue, actor);
        int requestedRank = (int) Json.longValue(body.get("rank"), issue.rank);
        issue.rank = Math.max(1, requestedRank);
        touch(issue);
        audit(actor, "issue.ranked", "issue", issue.key, "rank=" + issue.rank);
        event(actor, issue.projectKey, "issue.ranked", issue.key, Map.of("rank", issue.rank));
        save();
        return issue.json();
    }

    synchronized Map<String, Object> lock(String actor, String key, boolean acquire) throws IOException {
        Issue issue = editableIssue(actor, key);
        cleanupExpiredLocks();
        LockInfo existing = locks.get(issue.key);
        if (acquire) {
            if (existing != null && !existing.username.equals(actor)) {
                throw new ProblemException(409, "issue_locked", "Issue is locked by " + existing.username,
                        Map.of("lock", existing.json()));
            }
            LockInfo lock = new LockInfo(issue.key, actor, Instant.now().plus(Duration.ofMinutes(15)).toString());
            locks.put(issue.key, lock);
            audit(actor, "lock.created", "issue", issue.key, "15 minute collaboration lock");
            save();
            return lock.json();
        }
        if (existing != null && !existing.username.equals(actor)) {
            throw new ProblemException(403, "lock_owner_required", "Only the lock owner can release this lock");
        }
        locks.remove(issue.key);
        audit(actor, "lock.deleted", "issue", issue.key, actor);
        save();
        return Map.of("issueKey", issue.key, "locked", false);
    }

    synchronized List<Map<String, Object>> projectEvents(String actor, String key, long since) {
        ensurePermission(requireProject(key), actor, "BROWSE");
        return projectEvents.stream()
                .filter(event -> event.projectKey.equals(key) && event.id > since)
                .map(ProjectEvent::json)
                .toList();
    }

    synchronized List<Map<String, Object>> projectPresence(String actor, String key) {
        ensurePermission(requireProject(key), actor, "BROWSE");
        cleanupPresence();
        return presence.values().stream()
                .filter(item -> key.equals(item.projectKey))
                .map(Presence::json)
                .toList();
    }

    synchronized Map<String, Object> updatePresence(String actor, String key, Map<String, Object> body) throws IOException {
        ensurePermission(requireProject(key), actor, "BROWSE");
        Presence item = new Presence(actor, key, defaulted(body, "route", "issues"), defaulted(body, "state", "active"));
        presence.put(actor, item);
        save();
        return item.json();
    }

    synchronized List<Map<String, Object>> notifications(String actor, boolean unreadOnly) {
        return notifications.values().stream()
                .filter(item -> item.username.equals(actor))
                .filter(item -> !unreadOnly || !item.read)
                .sorted(Comparator.comparingLong(item -> -item.id))
                .map(Notification::json)
                .toList();
    }

    synchronized Map<String, Object> updateNotification(String actor, long id, Map<String, Object> body) throws IOException {
        Notification notification = notifications.get(String.valueOf(id));
        if (notification == null) {
            for (Notification candidate : notifications.values()) {
                if (candidate.id == id) {
                    notification = candidate;
                    break;
                }
            }
        }
        if (notification == null || !notification.username.equals(actor)) {
            throw new ProblemException(404, "notification_not_found", "Notification not found");
        }
        if (body.containsKey("read")) notification.read = Json.boolValue(body.get("read"), notification.read);
        save();
        return notification.json();
    }

    synchronized int markNotificationsRead(String actor) throws IOException {
        requireUser(actor);
        int changed = 0;
        for (Notification notification : notifications.values()) {
            if (notification.username.equals(actor) && !notification.read) {
                notification.read = true;
                changed++;
            }
        }
        if (changed > 0) save();
        return changed;
    }

    synchronized List<Map<String, Object>> versions(String actor, String key) {
        ensurePermission(requireProject(key), actor, "BROWSE");
        return requireProject(key).versions.values().stream().map(Version::json).toList();
    }

    synchronized Map<String, Object> createVersion(String actor, String key, Map<String, Object> body) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        String name = text(body, "name").trim();
        if (name.isBlank()) throw new ProblemException(400, "version_name_required", "Version name is required");
        Version version = new Version(nextId(), name);
        version.description = text(body, "description");
        version.releaseDate = text(body, "releaseDate");
        project.versions.put(version.id, version);
        audit(actor, "version.created", "project", key, name);
        event(actor, key, "version.created", "", version.json());
        save();
        return version.json();
    }

    synchronized Map<String, Object> updateVersion(String actor, String key, long id, Map<String, Object> body) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        Version version = project.versions.get(id);
        if (version == null) throw new ProblemException(404, "version_not_found", "Version not found");
        if (body.containsKey("name")) version.name = text(body, "name");
        if (body.containsKey("description")) version.description = text(body, "description");
        if (body.containsKey("releaseDate")) version.releaseDate = text(body, "releaseDate");
        if (body.containsKey("archived")) version.archived = Json.boolValue(body.get("archived"), version.archived);
        audit(actor, "version.updated", "project", key, version.name);
        event(actor, key, "version.updated", "", version.json());
        save();
        return version.json();
    }

    synchronized Map<String, Object> releaseVersion(String actor, String key, long id) throws IOException {
        Project project = requireProject(key);
        ensurePermission(project, actor, "ADMINISTER");
        Version version = project.versions.get(id);
        if (version == null) throw new ProblemException(404, "version_not_found", "Version not found");
        version.released = true;
        if (version.releaseDate.isBlank()) version.releaseDate = LocalDate.now().toString();
        audit(actor, "version.released", "project", key, version.name);
        event(actor, key, "version.released", "", version.json());
        save();
        return version.json();
    }

    synchronized Map<String, Object> reports(String actor, String key, String type) {
        return reports(actor, key, type, 0, 0, "", Map.of());
    }

    synchronized Map<String, Object> reports(
            String actor, String key, String type, long filterId, long templateId, String jql) {
        return reports(actor, key, type, filterId, templateId, jql, Map.of());
    }

    synchronized Map<String, Object> reports(
            String actor,
            String key,
            String type,
            long filterId,
            long templateId,
            String jql,
            Map<String, Object> parameterValues) {
        Project project = requireProject(key);
        ensurePermission(project, actor, "BROWSE");
        String reportType = type == null || type.isBlank() ? "summary" : type.trim().toLowerCase(Locale.ROOT);
        String effectiveJql = jql == null ? "" : jql.trim();
        Map<String, Object> normalizedParameters = Map.of();
        if (filterId > 0) {
            SavedFilter filter = visibleFilter(actor, filterId);
            if (effectiveJql.isBlank()) effectiveJql = filter.jql;
            if (!filter.projectKey.isBlank() && !key.equalsIgnoreCase(filter.projectKey)) {
                throw new ProblemException(400, "filter_project_mismatch", "Filter is scoped to another project");
            }
        }
        if (templateId > 0) {
            ReportTemplate template = visibleReportTemplate(actor, templateId);
            if (!template.projectKey.isBlank() && !key.equalsIgnoreCase(template.projectKey)) {
                throw new ProblemException(400, "template_project_mismatch", "Report template is scoped to another project");
            }
            if (type == null || type.isBlank()) reportType = template.key;
            normalizedParameters = resolveReportParameters(template, parameterValues, actor);
            String templateJql = substituteReportParameters(
                    template.jql, normalizedParameters, reportParameterSchema(template.parameters));
            if (effectiveJql.isBlank()) effectiveJql = templateJql;
        } else if (parameterValues != null && !parameterValues.isEmpty()) {
            normalizedParameters = resolveBuiltInReportParameters(reportType, parameterValues);
        }
        validateJql(effectiveJql, actor);
        Predicate<Issue> predicate = effectiveJql.isBlank()
                ? issue -> true
                : Jql.parse(effectiveJql, actor).predicate;
        List<Issue> projectIssues = issues.values().stream()
                .filter(issue -> issue.projectKey.equals(key))
                .filter(predicate)
                .toList();
        Map<String, Integer> statusCounts = countBy(projectIssues, issue -> issue.status);
        Map<String, Integer> priorityCounts = countBy(projectIssues, issue -> issue.priority);
        Map<String, Integer> typeCounts = countBy(projectIssues, issue -> issue.type);
        Map<String, Integer> analysisDomainCounts = countBy(projectIssues, issue -> issue.analysisDomain);
        Map<String, Integer> processAreaCounts = countBy(projectIssues, issue -> issue.processArea.isBlank() ? "Unmapped" : issue.processArea);
        Map<String, Integer> evidenceRoleCounts = countBy(projectIssues, issue -> issue.evidenceRole);
        Map<String, Integer> assessmentRatingCounts = countBy(projectIssues, issue -> issue.assessmentRating.isBlank() ? "Unrated" : issue.assessmentRating);
        Map<String, Integer> reviewStatusCounts = countBy(projectIssues, issue -> issue.reviewStatus);
        int done = (int) projectIssues.stream().filter(issue -> "DONE".equals(issue.status)).count();
        int inProgress = (int) projectIssues.stream().filter(issue -> "IN_PROGRESS".equals(issue.status)).count();
        int assessed = (int) projectIssues.stream().filter(issue -> !issue.assessmentRating.isBlank()).count();
        int closedAssessments = (int) projectIssues.stream().filter(issue -> "closed".equalsIgnoreCase(issue.reviewStatus)
                || "accepted".equalsIgnoreCase(issue.assessorDecision)).count();
        double averageCycleDays = projectIssues.stream()
                .filter(issue -> "DONE".equals(issue.status))
                .mapToDouble(issue -> Math.max(0.0, Duration.between(parseTimestamp(issue.createdAt), parseTimestamp(issue.updatedAt)).toHours() / 24.0))
                .average()
                .orElse(0.0);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("projectKey", key);
        result.put("type", reportType);
        result.put("issueCount", projectIssues.size());
        result.put("completedCount", done);
        result.put("inProgressCount", inProgress);
        result.put("statusCounts", statusCounts);
        result.put("priorityCounts", priorityCounts);
        result.put("typeCounts", typeCounts);
        result.put("analysisDomainCounts", analysisDomainCounts);
        result.put("processAreaCounts", processAreaCounts);
        result.put("evidenceRoleCounts", evidenceRoleCounts);
        result.put("assessmentRatingCounts", assessmentRatingCounts);
        result.put("reviewStatusCounts", reviewStatusCounts);
        result.put("assessedCount", assessed);
        result.put("closedAssessmentCount", closedAssessments);
        result.put("assessmentCoverage", projectIssues.isEmpty() ? 0.0
                : Math.round(assessed * 10000.0 / projectIssues.size()) / 100.0);
        result.put("wipLimit", project.settings.wipLimits.getOrDefault("IN_PROGRESS", 0));
        result.put("wipExceeded", project.settings.wipLimits.getOrDefault("IN_PROGRESS", 0) > 0
                && inProgress > project.settings.wipLimits.get("IN_PROGRESS"));
        result.put("averageCycleDays", Math.round(averageCycleDays * 100.0) / 100.0);
        result.put("versions", project.versions.values().stream().map(Version::json).toList());
        if (!effectiveJql.isBlank()) result.put("jql", effectiveJql);
        if (filterId > 0) result.put("filterId", filterId);
        if (templateId > 0) result.put("templateId", templateId);
        if (templateId > 0) result.put("parameters", normalizedParameters);
        result.put("payload", reportPayload(
                reportType, projectIssues, statusCounts, priorityCounts, typeCounts, normalizedParameters, key));
        if (!normalizedParameters.isEmpty()) result.put("parameters", normalizedParameters);
        return result;
    }

    synchronized List<Map<String, Object>> reportTypes() {
        List<Map<String, Object>> result = new ArrayList<>();
        reportTemplates.values().stream()
                .filter(template -> template.builtIn)
                .sorted(Comparator.comparing(template -> template.key))
                .forEach(template -> {
                    Map<String, Object> item = new LinkedHashMap<>();
                    item.put("key", template.key);
                    item.put("name", template.name);
                    item.put("description", template.description);
                    item.put("category", template.category);
                    item.put("parameters", new LinkedHashMap<>(template.parameters));
                    result.add(item);
                });
        return result;
    }

    synchronized List<Map<String, Object>> reportTemplates(String actor, String projectKey, String query) {
        requireUser(actor);
        String normalizedProject = projectKey == null ? "" : projectKey.trim().toUpperCase(Locale.ROOT);
        String needle = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        return reportTemplates.values().stream()
                .filter(template -> canViewReportTemplate(template, actor))
                .filter(template -> normalizedProject.isBlank() || template.projectKey.isBlank()
                        || normalizedProject.equals(template.projectKey))
                .filter(template -> needle.isBlank()
                        || template.name.toLowerCase(Locale.ROOT).contains(needle)
                        || template.key.toLowerCase(Locale.ROOT).contains(needle))
                .sorted(Comparator.comparing((ReportTemplate template) -> !template.builtIn)
                        .thenComparing(template -> template.name.toLowerCase(Locale.ROOT)))
                .map(ReportTemplate::json)
                .toList();
    }

    synchronized Map<String, Object> reportTemplate(String actor, long id) {
        return visibleReportTemplate(actor, id).json();
    }

    synchronized Map<String, Object> createReportTemplate(String actor, Map<String, Object> body) throws IOException {
        requireUser(actor);
        String name = text(body, "name").trim();
        if (name.isBlank()) throw new ProblemException(400, "template_name_required", "Report template name is required");
        String key = defaulted(body, "key", slug(name)).trim().toLowerCase(Locale.ROOT);
        if (!key.matches("[a-z0-9][a-z0-9._-]{1,63}")) {
            throw new ProblemException(400, "invalid_template_key", "Template key must contain 2-64 lowercase letters, numbers, dots, underscores or hyphens");
        }
        if (reportTemplates.values().stream().anyMatch(template -> template.key.equals(key))) {
            throw new ProblemException(409, "template_exists", "Report template key already exists");
        }
        String projectKey = text(body, "projectKey").trim().toUpperCase(Locale.ROOT);
        if (!projectKey.isBlank()) ensurePermission(requireProject(projectKey), actor, "BROWSE");
        String jql = text(body, "jql").trim();
        Map<String, Object> parameters = normalizeReportParameters(body.get("parameters"));
        validateReportTemplateDefinition(jql, parameters, actor);
        ReportTemplate template = new ReportTemplate(nextId(), key, name, actor, false);
        template.description = text(body, "description");
        template.category = defaulted(body, "category", "custom");
        template.projectKey = projectKey;
        template.jql = jql;
        template.visibility = normalizeVisibility(text(body, "visibility"), "private");
        template.sharedWith.addAll(validUsernames(body.get("sharedWith")));
        if (!"shared".equals(template.visibility)) template.sharedWith.clear();
        template.parameters.putAll(parameters);
        reportTemplates.put(template.id, template);
        audit(actor, "report.template.created", "report-template", String.valueOf(template.id), template.name);
        save();
        return template.json();
    }

    synchronized Map<String, Object> updateReportTemplate(
            String actor, long id, Map<String, Object> body) throws IOException {
        ReportTemplate template = editableReportTemplate(actor, id);
        if (body.containsKey("name")) {
            String name = text(body, "name").trim();
            if (name.isBlank()) throw new ProblemException(400, "template_name_required", "Report template name is required");
            template.name = name;
        }
        if (body.containsKey("description")) template.description = text(body, "description");
        if (body.containsKey("category")) template.category = defaulted(body, "category", template.category);
        if (body.containsKey("projectKey")) {
            String projectKey = text(body, "projectKey").trim().toUpperCase(Locale.ROOT);
            if (!projectKey.isBlank()) ensurePermission(requireProject(projectKey), actor, "BROWSE");
            template.projectKey = projectKey;
        }
        String candidateJql = body.containsKey("jql") ? text(body, "jql").trim() : template.jql;
        Map<String, Object> candidateParameters = body.containsKey("parameters")
                ? normalizeReportParameters(body.get("parameters"))
                : new LinkedHashMap<>(template.parameters);
        validateReportTemplateDefinition(candidateJql, candidateParameters, actor);
        template.jql = candidateJql;
        if (body.containsKey("visibility")) template.visibility = normalizeVisibility(text(body, "visibility"), template.visibility);
        if (body.containsKey("sharedWith")) {
            template.sharedWith.clear();
            template.sharedWith.addAll(validUsernames(body.get("sharedWith")));
        }
        if (!"shared".equals(template.visibility)) template.sharedWith.clear();
        template.parameters.clear();
        template.parameters.putAll(candidateParameters);
        template.updatedAt = Instant.now().toString();
        audit(actor, "report.template.updated", "report-template", String.valueOf(id), template.name);
        save();
        return template.json();
    }

    synchronized void deleteReportTemplate(String actor, long id) throws IOException {
        ReportTemplate template = editableReportTemplate(actor, id);
        reportTemplates.remove(template.id);
        audit(actor, "report.template.deleted", "report-template", String.valueOf(id), template.name);
        save();
    }

    synchronized Map<String, Object> executeReport(
            String actor, Map<String, Object> body) {
        String projectKey = defaulted(body, "projectKey", "KTEST").toUpperCase(Locale.ROOT);
        String type = text(body, "type");
        long templateId = Json.longValue(body.get("templateId"), 0);
        long filterId = Json.longValue(body.get("filterId"), 0);
        String jql = text(body, "jql");
        Map<String, Object> parameters = reportParameterValues(body.get("parameters"));
        return reports(actor, projectKey, type, filterId, templateId, jql, parameters);
    }

    synchronized Map<String, Object> adminOverview(String actor) {
        ensureGlobalAdmin(actor);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("version", VERSION);
        result.put("projects", projects.size());
        result.put("issues", issues.size());
        result.put("users", users.size());
        result.put("activeUsers", users.values().stream().filter(user -> user.active).count());
        result.put("filters", filters.size());
        result.put("reportTemplates", reportTemplates.size());
        result.put("adminEntries", adminEntries.size());
        result.put("plugins", plugins.size());
        result.put("auditEvents", auditEvents.size());
        result.put("categories", adminEntries.values().stream()
                .collect(java.util.stream.Collectors.groupingBy(entry -> entry.category,
                        LinkedHashMap::new, java.util.stream.Collectors.counting())));
        return result;
    }

    synchronized Map<String, Object> adminCatalog(String actor) {
        ensureGlobalAdmin(actor);
        Map<String, List<Map<String, Object>>> grouped = new LinkedHashMap<>();
        adminEntries.values().stream()
                .sorted(Comparator.comparing((AdminEntry entry) -> entry.category)
                        .thenComparing(entry -> entry.name.toLowerCase(Locale.ROOT)))
                .forEach(entry -> grouped.computeIfAbsent(entry.category, ignored -> new ArrayList<>())
                        .add(entry.json()));
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("categories", grouped);
        result.put("entries", adminEntries.values().stream().map(AdminEntry::json).toList());
        return result;
    }

    synchronized List<Map<String, Object>> adminEntries(String actor, String category, String query) {
        ensureGlobalAdmin(actor);
        String normalizedCategory = category == null ? "" : category.trim().toLowerCase(Locale.ROOT);
        String needle = query == null ? "" : query.trim().toLowerCase(Locale.ROOT);
        return adminEntries.values().stream()
                .filter(entry -> normalizedCategory.isBlank() || entry.category.equals(normalizedCategory))
                .filter(entry -> needle.isBlank()
                        || entry.name.toLowerCase(Locale.ROOT).contains(needle)
                        || entry.key.toLowerCase(Locale.ROOT).contains(needle)
                        || entry.description.toLowerCase(Locale.ROOT).contains(needle))
                .sorted(Comparator.comparing((AdminEntry entry) -> entry.name.toLowerCase(Locale.ROOT)))
                .map(AdminEntry::json)
                .toList();
    }

    synchronized Map<String, Object> createAdminEntry(
            String actor, String category, Map<String, Object> body) throws IOException {
        ensureGlobalAdmin(actor);
        String normalizedCategory = normalizeAdminCategory(category);
        String key = defaulted(body, "key", slug(defaulted(body, "name", normalizedCategory))).trim().toLowerCase(Locale.ROOT);
        String name = text(body, "name").trim();
        if (name.isBlank()) throw new ProblemException(400, "admin_name_required", "Administration entry name is required");
        if (key.isBlank() || !key.matches("[a-z0-9][a-z0-9._-]{1,63}")) {
            throw new ProblemException(400, "invalid_admin_key", "Administration entry key is invalid");
        }
        String storageKey = adminStorageKey(normalizedCategory, key);
        if (adminEntries.containsKey(storageKey)) {
            throw new ProblemException(409, "admin_entry_exists", "Administration entry already exists");
        }
        AdminEntry entry = new AdminEntry(nextId(), normalizedCategory, key, name);
        entry.description = text(body, "description");
        entry.system = Json.boolValue(body.get("system"), false);
        entry.editable = Json.boolValue(body.get("editable"), true);
        entry.enabled = Json.boolValue(body.get("enabled"), true);
        if (body.get("properties") instanceof Map<?, ?> properties) {
            properties.forEach((property, value) -> entry.properties.put(String.valueOf(property), value));
        }
        adminEntries.put(storageKey, entry);
        audit(actor, "admin.entry.created", "admin", storageKey, entry.name);
        save();
        return entry.json();
    }

    synchronized Map<String, Object> updateAdminEntry(
            String actor, String category, long id, Map<String, Object> body) throws IOException {
        ensureGlobalAdmin(actor);
        AdminEntry entry = requireAdminEntry(category, id);
        if (entry.system && !entry.editable) {
            throw new ProblemException(409, "system_entry_read_only", "System administration entry is read-only");
        }
        if (body.containsKey("key")) {
            String key = text(body, "key").trim().toLowerCase(Locale.ROOT);
            if (!key.matches("[a-z0-9][a-z0-9._-]{1,63}")) {
                throw new ProblemException(400, "invalid_admin_key", "Administration entry key is invalid");
            }
            String candidateStorageKey = adminStorageKey(entry.category, key);
            AdminEntry existing = adminEntries.get(candidateStorageKey);
            if (existing != null && existing.id != entry.id) {
                throw new ProblemException(409, "admin_entry_exists", "Administration entry already exists");
            }
            adminEntries.remove(adminStorageKey(entry.category, entry.key));
            entry.key = key;
            adminEntries.put(candidateStorageKey, entry);
        }
        if (body.containsKey("name")) {
            String name = text(body, "name").trim();
            if (name.isBlank()) throw new ProblemException(400, "admin_name_required", "Administration entry name is required");
            entry.name = name;
        }
        if (body.containsKey("description")) entry.description = text(body, "description");
        if (body.containsKey("editable")) entry.editable = Json.boolValue(body.get("editable"), entry.editable);
        if (body.containsKey("enabled")) entry.enabled = Json.boolValue(body.get("enabled"), entry.enabled);
        if (body.get("properties") instanceof Map<?, ?> properties) {
            entry.properties.clear();
            properties.forEach((property, value) -> entry.properties.put(String.valueOf(property), value));
        }
        entry.updatedAt = Instant.now().toString();
        audit(actor, "admin.entry.updated", "admin", adminStorageKey(entry.category, entry.key), entry.name);
        save();
        return entry.json();
    }

    synchronized void deleteAdminEntry(String actor, String category, long id) throws IOException {
        ensureGlobalAdmin(actor);
        AdminEntry entry = requireAdminEntry(category, id);
        if (entry.system || !entry.editable) {
            throw new ProblemException(409, "system_entry_read_only", "System administration entry cannot be deleted");
        }
        adminEntries.remove(adminStorageKey(entry.category, entry.key));
        audit(actor, "admin.entry.deleted", "admin", adminStorageKey(entry.category, entry.key), entry.name);
        save();
    }

    synchronized List<Map<String, Object>> plugins() {
        return plugins.values().stream().map(PluginDescriptor::json).toList();
    }

    synchronized Map<String, Object> jiraMyself(String actor) {
        return requireUser(actor).json();
    }

    synchronized List<Map<String, Object>> jiraFields() {
        return List.of(
                field("summary", "Summary", "string"),
                field("description", "Description", "string"),
                field("issuetype", "Issue Type", "issuetype"),
                field("priority", "Priority", "priority"),
                field("status", "Status", "status"),
                field("assignee", "Assignee", "user"),
                field("reporter", "Reporter", "user"),
                field("labels", "Labels", "array"),
                field("components", "Component/s", "array"),
                field("fixVersions", "Fix Version/s", "array"),
                field("affectsVersions", "Affects Version/s", "array"),
                field("analysisDomain", "Analysis Domain", "string"),
                field("processArea", "Process Area", "string"),
                field("formalScope", "Formal Scope", "string"),
                field("evidenceRole", "Evidence Role", "string"),
                field("assessmentRating", "Assessment Rating", "string"),
                field("assessorDecision", "Assessor Decision", "string"),
                field("asil", "ASIL", "string"),
                field("cybersecurityLevel", "Cybersecurity Level", "string"),
                field("reviewStatus", "Review Status", "string"));
    }

    synchronized Map<String, Object> jiraProject(String actor, String key) {
        Project project = requireProject(key);
        ensurePermission(project, actor, "BROWSE");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", key.hashCode());
        result.put("key", key);
        result.put("name", project.name);
        result.put("description", project.description);
        result.put("lead", userJson(project.lead));
        result.put("projectTypeKey", project.type);
        result.put("versions", project.versions.values().stream().map(Version::json).toList());
        ensureProjectComponents(project);
        result.put("components", project.components.values().stream()
                .map(component -> jiraComponent(project, component))
                .toList());
        return result;
    }

    synchronized Map<String, Object> jiraIssue(String actor, String key) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "BROWSE");
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("id", String.valueOf(issue.id));
        result.put("key", issue.key);
        result.put("self", "/rest/api/2/issue/" + issue.key);
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("summary", issue.summary);
        fields.put("description", issue.description);
        fields.put("project", Map.of("key", issue.projectKey, "name", requireProject(issue.projectKey).name));
        fields.put("issuetype", Map.of("name", issue.type));
        fields.put("priority", Map.of("name", issue.priority));
        fields.put("status", Map.of("name", issue.status, "statusCategory", statusCategory(issue.status)));
        fields.put("resolution", issue.resolution.isBlank() ? null : Map.of("name", issue.resolution));
        fields.put("assignee", userJsonNullable(issue.assignee));
        fields.put("reporter", userJsonNullable(issue.reporter));
        fields.put("creator", userJsonNullable(issue.creator));
        fields.put("environment", issue.environment);
        fields.put("duedate", issue.dueDate.isBlank() ? null : issue.dueDate);
        fields.put("labels", new ArrayList<>(issue.labels));
        Project issueProject = requireProject(issue.projectKey);
        fields.put("components", issue.components.stream()
                .map(name -> jiraIssueComponent(issueProject, name))
                .toList());
        fields.put("fixVersions", issue.fixVersions.stream().map(name -> Map.of("name", name)).toList());
        fields.put("versions", issue.affectsVersions.stream().map(name -> Map.of("name", name)).toList());
        fields.put("created", issue.createdAt);
        fields.put("updated", issue.updatedAt);
        fields.put("comment", Map.of(
                "total", issue.comments.size(),
                "comments", issue.comments.stream().map(Comment::json).toList()));
        fields.put("attachment", issue.attachments.values().stream().map(Attachment::json).toList());
        fields.put("subtasks", issue.subtasks.stream().map(subtask -> Map.of("key", subtask)).toList());
        fields.put("worklog", Map.of(
                "total", issue.worklogs.stream().mapToInt(item -> item.minutes * 60).sum(),
                "worklogs", issue.worklogs.stream().map(Worklog::json).toList()));
        fields.put("issuelinks", issue.links.stream().map(IssueLink::json).toList());
        result.put("fields", fields);
        return result;
    }

    synchronized Map<String, Object> createJiraIssue(String actor, Map<String, Object> body) throws IOException {
        Map<String, Object> fields = nestedMap(body.get("fields"));
        Map<String, Object> request = new LinkedHashMap<>();
        Map<String, Object> project = nestedMap(fields.get("project"));
        Map<String, Object> issueType = nestedMap(fields.get("issuetype"));
        Map<String, Object> priority = nestedMap(fields.get("priority"));
        Map<String, Object> assignee = nestedMap(fields.get("assignee"));
        Map<String, Object> reporter = nestedMap(fields.get("reporter"));
        request.put("projectKey", defaulted(project, "key", "KTEST"));
        request.put("summary", text(fields, "summary"));
        request.put("description", text(fields, "description"));
        request.put("environment", text(fields, "environment"));
        request.put("dueDate", text(fields, "duedate"));
        request.put("type", defaulted(issueType, "name", "Task"));
        request.put("priority", defaulted(priority, "name", "Medium"));
        request.put("assignee", defaulted(assignee, "name", defaulted(assignee, "key", "")));
        request.put("reporter", defaulted(reporter, "name", defaulted(reporter, "key", actor)));
        request.put("labels", fields.getOrDefault("labels", List.of()));
        request.put("components", fields.getOrDefault("components", List.of()));
        request.put("fixVersions", namesFromObjects(fields.get("fixVersions")));
        request.put("affectsVersions", namesFromObjects(fields.get("versions")));
        return jiraIssue(actor, String.valueOf(createIssue(actor, request).get("key")));
    }

    synchronized Map<String, Object> updateJiraIssue(String actor, String key, Map<String, Object> body) throws IOException {
        Map<String, Object> fields = nestedMap(body.get("fields"));
        Map<String, Object> request = new LinkedHashMap<>();
        if (fields.containsKey("summary")) request.put("summary", fields.get("summary"));
        if (fields.containsKey("description")) request.put("description", fields.get("description"));
        if (fields.containsKey("environment")) request.put("environment", fields.get("environment"));
        if (fields.containsKey("duedate")) request.put("dueDate", fields.get("duedate"));
        if (fields.containsKey("resolution")) request.put("resolution", text(nestedMap(fields.get("resolution")), "name"));
        if (fields.containsKey("issuetype")) request.put("type", text(nestedMap(fields.get("issuetype")), "name"));
        if (fields.containsKey("priority")) request.put("priority", text(nestedMap(fields.get("priority")), "name"));
        if (fields.containsKey("assignee")) request.put("assignee", text(nestedMap(fields.get("assignee")), "name"));
        if (fields.containsKey("reporter")) request.put("reporter", text(nestedMap(fields.get("reporter")), "name"));
        if (fields.containsKey("labels")) request.put("labels", fields.get("labels"));
        if (fields.containsKey("components")) request.put("components", fields.get("components"));
        if (fields.containsKey("fixVersions")) request.put("fixVersions", namesFromObjects(fields.get("fixVersions")));
        if (fields.containsKey("versions")) request.put("affectsVersions", namesFromObjects(fields.get("versions")));
        updateIssue(actor, key, request, 0);
        return jiraIssue(actor, key);
    }

    private Map<String, Object> nestedMap(Object value) {
        Map<String, Object> result = new LinkedHashMap<>();
        if (value instanceof Map<?, ?> map) {
            map.forEach((key, item) -> result.put(String.valueOf(key), item));
        }
        return result;
    }

    private List<String> namesFromObjects(Object value) {
        if (!(value instanceof Iterable<?> values)) return List.of();
        List<String> names = new ArrayList<>();
        for (Object item : values) {
            if (item instanceof Map<?, ?> map) {
                Object name = map.get("name");
                if (name != null && !String.valueOf(name).isBlank()) names.add(String.valueOf(name));
            } else if (item != null && !String.valueOf(item).isBlank()) {
                names.add(String.valueOf(item));
            }
        }
        return names;
    }

    synchronized Map<String, Object> addJiraComment(String actor, String key, Map<String, Object> body) throws IOException {
        String text = text(body, "body");
        if (body.get("body") instanceof Map<?, ?> document) text = extractDocumentText(document);
        return addComment(actor, key, Map.of("body", text));
    }

    synchronized List<Map<String, Object>> jiraTransitions(String actor, String key) {
        Issue issue = requireIssue(key);
        Project project = requireProject(issue.projectKey);
        ensurePermission(project, actor, "BROWSE");
        return project.workflow.stream()
                .filter(transition -> transition.enabled && transition.from.equals(issue.status))
                .map(transition -> {
                    Map<String, Object> result = new LinkedHashMap<>();
                    result.put("id", transition.id);
                    result.put("name", transition.name);
                    result.put("to", Map.of("id", transition.to, "name", transition.to));
                    return result;
                })
                .toList();
    }

    synchronized Map<String, Object> jiraTransition(String actor, String key, Map<String, Object> body) throws IOException {
        String target = text(body, "status");
        if (target.isBlank() && body.get("transition") instanceof Map<?, ?> transition) {
            Object transitionTarget = transition.get("to");
            target = transitionTarget == null ? "" : String.valueOf(transitionTarget);
        }
        if (target.isBlank()) {
            String id = text(body, "id");
            try {
                long transitionId = Long.parseLong(id);
                Issue issue = requireIssue(key);
                target = requireProject(issue.projectKey).workflow.stream()
                        .filter(item -> item.id == transitionId)
                        .map(item -> item.to)
                        .findFirst()
                        .orElse("");
            } catch (NumberFormatException ignored) {
                // The normal custom route reports the invalid transition below.
            }
        }
        return jiraIssue(actor, keyAfterTransition(actor, key, target));
    }

    private String keyAfterTransition(String actor, String key, String target) throws IOException {
        transition(actor, key, target, 0);
        return key;
    }

    private static String extractDocumentText(Map<?, ?> document) {
        StringBuilder result = new StringBuilder();
        Object content = document.get("content");
        if (content instanceof Iterable<?> items) {
            for (Object item : items) {
                if (item instanceof Map<?, ?> map) {
                    Object text = map.get("text");
                    if (text != null) result.append(text).append('\n');
                    result.append(extractDocumentText(map));
                }
            }
        }
        return result.toString().trim();
    }

    private Map<String, Object> field(String id, String name, String schemaType) {
        return Map.of(
                "id", id,
                "name", name,
                "custom", false,
                "schema", Map.of("type", schemaType, "system", id));
    }

    private static String adminStorageKey(String category, String key) {
        return category == null ? "" : category.trim().toLowerCase(Locale.ROOT)
                + ":" + (key == null ? "" : key.trim().toLowerCase(Locale.ROOT));
    }

    private SavedFilter visibleFilter(String actor, long id) {
        requireUser(actor);
        SavedFilter filter = filters.get(id);
        if (filter == null) throw new ProblemException(404, "filter_not_found", "Filter not found");
        if (!canViewFilter(filter, actor)) {
            throw new ProblemException(403, "filter_access_denied", "You do not have access to this filter");
        }
        return filter;
    }

    private SavedFilter editableFilter(String actor, long id) {
        SavedFilter filter = visibleFilter(actor, id);
        if (!hasGlobalAdmin(actor) && !filter.owner.equals(actor)) {
            throw new ProblemException(403, "filter_owner_required", "Only the filter owner or administrator may edit this filter");
        }
        return filter;
    }

    private boolean canViewFilter(SavedFilter filter, String actor) {
        User user = users.get(actor);
        if (filter == null || user == null || !user.active) return false;
        if (user.globalRoles.contains("administrators") || filter.owner.equals(actor)) return projectVisible(filter.projectKey, actor);
        String visibility = filter.visibility == null ? "private" : filter.visibility.toLowerCase(Locale.ROOT);
        boolean shared = "shared".equals(visibility) && filter.sharedWith.contains(actor);
        boolean global = "global".equals(visibility);
        return (shared || global) && projectVisible(filter.projectKey, actor);
    }

    private boolean projectVisible(String projectKey, String actor) {
        return projectKey == null || projectKey.isBlank()
                || hasPermission(projects.get(projectKey.toUpperCase(Locale.ROOT)), actor, "BROWSE");
    }

    private static String normalizeVisibility(String value, String fallback) {
        String candidate = value == null || value.isBlank() ? fallback : value.trim().toLowerCase(Locale.ROOT);
        if (!List.of("private", "shared", "global").contains(candidate)) {
            throw new ProblemException(400, "invalid_visibility", "Visibility must be private, shared or global");
        }
        return candidate;
    }

    private List<String> validUsernames(Object value) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (String username : Json.stringList(value)) {
            String candidate = username.trim();
            if (candidate.isBlank()) continue;
            requireUser(candidate);
            result.add(candidate);
        }
        return new ArrayList<>(result);
    }

    private static void validateJql(String jql, String actor) {
        if (jql == null || jql.isBlank()) return;
        try {
            Jql.parse(jql, actor);
        } catch (ProblemException error) {
            throw error;
        } catch (RuntimeException error) {
            throw new ProblemException(400, "invalid_jql", "Invalid JQL expression");
        }
    }

    private static String normalizeFrequency(String value) {
        String candidate = value == null || value.isBlank() ? "daily" : value.trim().toLowerCase(Locale.ROOT);
        if (!List.of("hourly", "daily", "weekly", "monthly").contains(candidate)) {
            throw new ProblemException(400, "invalid_frequency", "Frequency must be hourly, daily, weekly or monthly");
        }
        return candidate;
    }

    private static String nextRunFor(String frequency) {
        String normalized = normalizeFrequency(frequency);
        Duration delay = switch (normalized) {
            case "hourly" -> Duration.ofHours(1);
            case "weekly" -> Duration.ofDays(7);
            case "monthly" -> Duration.ofDays(30);
            default -> Duration.ofDays(1);
        };
        return Instant.now().plus(delay).toString();
    }

    private FilterSubscription requireSubscription(SavedFilter filter, long subscriptionId) {
        FilterSubscription subscription = filterSubscriptions.get(subscriptionId);
        if (subscription == null || subscription.filterId != filter.id) {
            throw new ProblemException(404, "subscription_not_found", "Filter subscription not found");
        }
        return subscription;
    }

    private ReportTemplate visibleReportTemplate(String actor, long id) {
        requireUser(actor);
        ReportTemplate template = reportTemplates.get(id);
        if (template == null) throw new ProblemException(404, "report_template_not_found", "Report template not found");
        if (!canViewReportTemplate(template, actor)) {
            throw new ProblemException(403, "report_template_access_denied", "You do not have access to this report template");
        }
        return template;
    }

    private boolean canViewReportTemplate(ReportTemplate template, String actor) {
        User user = users.get(actor);
        if (template == null || user == null || !user.active) return false;
        if (!projectVisible(template.projectKey, actor)) return false;
        if (user.globalRoles.contains("administrators") || template.owner.equals(actor) || template.builtIn) return true;
        return switch (template.visibility == null ? "private" : template.visibility.toLowerCase(Locale.ROOT)) {
            case "global" -> true;
            case "shared" -> template.sharedWith.contains(actor);
            default -> false;
        };
    }

    private ReportTemplate editableReportTemplate(String actor, long id) {
        ReportTemplate template = visibleReportTemplate(actor, id);
        if (template.builtIn) {
            throw new ProblemException(403, "built_in_template_read_only", "Built-in report templates are read-only");
        }
        if (!hasGlobalAdmin(actor) && !template.owner.equals(actor)) {
            throw new ProblemException(403, "template_owner_required", "Only the template owner or administrator may edit this template");
        }
        return template;
    }

    private Map<String, Object> reportPayload(
            String reportType,
            List<Issue> issues,
            Map<String, Integer> statusCounts,
            Map<String, Integer> priorityCounts,
            Map<String, Integer> typeCounts,
            Map<String, Object> parameters,
            String projectKey) {
        String normalized = reportType == null || reportType.isBlank()
                ? "summary" : reportType.trim().toLowerCase(Locale.ROOT);
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("reportType", normalized);
        payload.put("issueCount", issues.size());
        switch (normalized) {
            case "summary" -> {
                payload.put("statusCounts", statusCounts);
                payload.put("priorityCounts", priorityCounts);
                payload.put("typeCounts", typeCounts);
            }
            case "status" -> payload.put("groups", statusCounts);
            case "priority" -> payload.put("groups", priorityCounts);
            case "issue-type" -> payload.put("groups", typeCounts);
            case "control-chart" -> {
                List<Map<String, Object>> rows = new ArrayList<>();
                for (Issue issue : issues) {
                    if (!"DONE".equals(issue.status)) continue;
                    double cycleDays = Math.max(0.0,
                            Duration.between(parseTimestamp(issue.createdAt), parseTimestamp(issue.updatedAt))
                                    .toHours() / 24.0);
                    rows.add(Map.of(
                            "key", issue.key,
                            "summary", issue.summary,
                            "cycleDays", Math.round(cycleDays * 100.0) / 100.0,
                            "createdAt", issue.createdAt,
                            "completedAt", issue.updatedAt));
                }
                payload.put("rows", rows);
                payload.put("averageCycleDays", rows.stream()
                        .mapToDouble(row -> ((Number) row.get("cycleDays")).doubleValue())
                        .average().orElse(0.0));
            }
            case "cumulative-flow" -> {
                payload.putAll(cumulativeFlowPayload(projectKey, issues, statusCounts));
            }
            case "pie" -> {
                String field = String.valueOf(parameters.getOrDefault("groupBy", "status"));
                Map<String, Integer> groups = groupByField(issues, field);
                List<Map<String, Object>> segments = new ArrayList<>();
                int total = groups.values().stream().mapToInt(Integer::intValue).sum();
                groups.forEach((label, value) -> segments.add(Map.of(
                        "label", label,
                        "value", value,
                        "percentage", total == 0 ? 0.0 : Math.round(value * 10000.0 / total) / 100.0)));
                payload.put("groupBy", field);
                payload.put("groups", groups);
                payload.put("segments", segments);
            }
            case "word-group" -> {
                String field = String.valueOf(parameters.getOrDefault("field", "summary"));
                int minLength = integerParameter(parameters, "minLength", 3, 1, 64);
                int limit = integerParameter(parameters, "limit", 20, 1, 100);
                Map<String, Integer> words = wordGroups(issues, field, minLength, limit);
                payload.put("field", field);
                payload.put("minLength", minLength);
                payload.put("limit", limit);
                payload.put("groups", words);
                payload.put("words", words.entrySet().stream()
                        .map(entry -> Map.of("word", entry.getKey(), "count", entry.getValue()))
                        .toList());
            }
            case "issue-duration" -> {
                payload.putAll(issueDurationPayload(issues));
            }
            case "created-vs-resolved" -> {
                int resolved = (int) issues.stream().filter(issue -> "DONE".equals(issue.status)).count();
                payload.put("created", issues.size());
                payload.put("resolved", resolved);
                payload.put("series", List.of(
                        Map.of("name", "created", "value", issues.size()),
                        Map.of("name", "resolved", "value", resolved)));
            }
            case "sprint-burndown" -> {
                int completed = (int) issues.stream().filter(issue -> "DONE".equals(issue.status)).count();
                payload.put("total", issues.size());
                payload.put("completed", completed);
                payload.put("remaining", issues.size() - completed);
                payload.put("series", List.of(
                        Map.of("name", "total", "value", issues.size()),
                        Map.of("name", "remaining", "value", issues.size() - completed)));
            }
            case "filter-results" -> payload.put("rows", issues.stream().map(Issue::json).toList());
            case "aspice-coverage" -> {
                Map<String, Integer> processAreas = countBy(issues,
                        issue -> issue.processArea.isBlank() ? "Unmapped" : issue.processArea);
                Map<String, Integer> evidenceRoles = countBy(issues, issue -> issue.evidenceRole);
                int assessed = (int) issues.stream().filter(issue -> !issue.assessmentRating.isBlank()).count();
                payload.put("processAreas", processAreas);
                payload.put("evidenceRoles", evidenceRoles);
                payload.put("assessed", assessed);
                payload.put("coverage", issues.isEmpty() ? 0.0 : Math.round(assessed * 10000.0 / issues.size()) / 100.0);
            }
            case "cybersecurity-risk" -> {
                Map<String, Integer> levels = countBy(issues,
                        issue -> issue.cybersecurityLevel.isBlank() ? "Unrated" : issue.cybersecurityLevel);
                Map<String, Integer> reviews = countBy(issues, issue -> issue.reviewStatus);
                payload.put("levels", levels);
                payload.put("reviewStatus", reviews);
            }
            case "functional-safety" -> {
                Map<String, Integer> asils = countBy(issues,
                        issue -> issue.asil.isBlank() ? "Unrated" : issue.asil);
                Map<String, Integer> decisions = countBy(issues, issue -> issue.assessorDecision);
                payload.put("asil", asils);
                payload.put("decisions", decisions);
            }
            default -> {
                payload.put("rows", issues.stream().map(Issue::json).toList());
                payload.put("statusCounts", statusCounts);
                payload.put("priorityCounts", priorityCounts);
                payload.put("typeCounts", typeCounts);
            }
        }
        return payload;
    }

    private void addBuiltInReportParameters(ReportTemplate template) {
        if (!template.builtIn) return;
        switch (template.key) {
            case "pie" -> {
                template.parameters.putIfAbsent("groupBy", Map.of(
                        "type", "enum", "required", false,
                        "allowedValues", List.of("status", "priority", "issue-type", "assignee", "reporter",
                                "analysis-domain", "process-area", "evidence-role", "assessment-rating", "review-status")));
            }
            case "word-group" -> {
                template.parameters.putIfAbsent("field", Map.of(
                        "type", "enum", "required", false,
                        "allowedValues", List.of("summary", "description", "text")));
                template.parameters.putIfAbsent("minLength", Map.of(
                        "type", "number", "required", false));
                template.parameters.putIfAbsent("limit", Map.of(
                        "type", "number", "required", false));
            }
            default -> {
                // The remaining built-ins have no extra parameters.
            }
        }
    }

    private static Map<String, Object> resolveBuiltInReportParameters(
            String reportType, Map<String, Object> supplied) {
        String normalized = reportType == null || reportType.isBlank()
                ? "summary" : reportType.trim().toLowerCase(Locale.ROOT);
        Map<String, Object> result = new LinkedHashMap<>();
        Set<String> allowed = switch (normalized) {
            case "pie" -> Set.of("groupBy");
            case "word-group" -> Set.of("field", "minLength", "limit");
            default -> Set.of();
        };
        for (String name : supplied.keySet()) {
            if (!allowed.contains(name)) {
                throw new ProblemException(400, "unknown_report_parameter",
                        "Unknown report parameter: " + name,
                        Map.of("reportType", normalized, "parameter", name));
            }
        }
        if ("pie".equals(normalized)) {
            String groupBy = supplied.get("groupBy") == null
                    ? "status" : String.valueOf(supplied.get("groupBy")).trim().toLowerCase(Locale.ROOT);
            if (!Set.of("status", "priority", "issue-type", "assignee", "reporter", "analysis-domain",
                    "process-area", "evidence-role", "assessment-rating", "review-status").contains(groupBy)) {
                throw new ProblemException(400, "invalid_report_parameter_value",
                        "Pie report groupBy is not supported", Map.of("parameter", "groupBy", "value", groupBy));
            }
            result.put("groupBy", groupBy);
        }
        if ("word-group".equals(normalized)) {
            String field = supplied.get("field") == null
                    ? "summary" : String.valueOf(supplied.get("field")).trim().toLowerCase(Locale.ROOT);
            if (!Set.of("summary", "description", "text").contains(field)) {
                throw new ProblemException(400, "invalid_report_parameter_value",
                        "Word grouping field is not supported", Map.of("parameter", "field", "value", field));
            }
            result.put("field", field);
            result.put("minLength", integerParameter(supplied, "minLength", 3, 1, 64));
            result.put("limit", integerParameter(supplied, "limit", 20, 1, 100));
        }
        return result;
    }

    private static int integerParameter(
            Map<String, Object> parameters, String name, int fallback, int minimum, int maximum) {
        Object raw = parameters == null ? null : parameters.get(name);
        if (raw == null) return fallback;
        int value;
        try {
            if (raw instanceof Number number) value = new BigDecimal(number.toString()).intValueExact();
            else value = Integer.parseInt(String.valueOf(raw).trim());
        } catch (Exception error) {
            throw new ProblemException(400, "invalid_report_parameter_value",
                    "Report parameter must be an integer: " + name,
                    Map.of("parameter", name, "value", String.valueOf(raw)));
        }
        if (value < minimum || value > maximum) {
            throw new ProblemException(400, "invalid_report_parameter_value",
                    "Report parameter is outside the allowed range: " + name,
                    Map.of("parameter", name, "minimum", minimum, "maximum", maximum, "value", value));
        }
        return value;
    }

    private Map<String, Integer> groupByField(List<Issue> issues, String field) {
        return countBy(issues, issue -> {
            String value = switch (field) {
                case "priority" -> issue.priority;
                case "issue-type" -> issue.type;
                case "assignee" -> issue.assignee.isBlank() ? "Unassigned" : issue.assignee;
                case "reporter" -> issue.reporter.isBlank() ? "Unknown" : issue.reporter;
                case "analysis-domain" -> issue.analysisDomain;
                case "process-area" -> issue.processArea.isBlank() ? "Unmapped" : issue.processArea;
                case "evidence-role" -> issue.evidenceRole;
                case "assessment-rating" -> issue.assessmentRating.isBlank() ? "Unrated" : issue.assessmentRating;
                case "review-status" -> issue.reviewStatus;
                default -> issue.status;
            };
            return value == null || value.isBlank() ? "Unknown" : value;
        });
    }

    private Map<String, Integer> wordGroups(List<Issue> issues, String field, int minLength, int limit) {
        Set<String> stopWords = Set.of("the", "and", "for", "with", "that", "this", "from", "are", "was",
                "issue", "task", "bug", "问题", "项目", "以及", "进行", "需要", "通过", "已经", "一个");
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Issue issue : issues) {
            String source = switch (field) {
                case "description" -> issue.description;
                case "text" -> issue.summary + " " + issue.description;
                default -> issue.summary;
            };
            Matcher matcher = Pattern.compile("[\\p{L}\\p{N}]{" + minLength + ",}").matcher(source == null ? "" : source.toLowerCase(Locale.ROOT));
            while (matcher.find()) {
                String word = matcher.group();
                if (!stopWords.contains(word)) counts.merge(word, 1, Integer::sum);
            }
        }
        return counts.entrySet().stream()
                .sorted(Map.Entry.<String, Integer>comparingByValue(Comparator.reverseOrder())
                        .thenComparing(Map.Entry.comparingByKey()))
                .limit(limit)
                .collect(LinkedHashMap::new, (map, entry) -> map.put(entry.getKey(), entry.getValue()), Map::putAll);
    }

    private Map<String, Object> issueDurationPayload(List<Issue> issues) {
        List<Map<String, Object>> rows = new ArrayList<>();
        Map<String, Integer> buckets = new LinkedHashMap<>();
        buckets.put("0-1d", 0);
        buckets.put("1-3d", 0);
        buckets.put("3-7d", 0);
        buckets.put("7-14d", 0);
        buckets.put("14d+", 0);
        Instant now = Instant.now();
        for (Issue issue : issues) {
            Instant start = parseTimestamp(issue.createdAt);
            Instant end = "DONE".equals(issue.status) ? parseTimestamp(issue.updatedAt) : now;
            double days = Math.max(0.0, Duration.between(start, end).toHours() / 24.0);
            String bucket = days < 1 ? "0-1d" : days < 3 ? "1-3d" : days < 7 ? "3-7d" : days < 14 ? "7-14d" : "14d+";
            buckets.merge(bucket, 1, Integer::sum);
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("key", issue.key);
            row.put("summary", issue.summary);
            row.put("status", issue.status);
            row.put("durationDays", Math.round(days * 100.0) / 100.0);
            row.put("bucket", bucket);
            row.put("startedAt", issue.createdAt);
            if ("DONE".equals(issue.status)) row.put("endedAt", issue.updatedAt);
            rows.add(row);
        }
        rows.sort(Comparator.comparing(row -> ((Number) row.get("durationDays")).doubleValue(), Comparator.reverseOrder()));
        double[] values = rows.stream().mapToDouble(row -> ((Number) row.get("durationDays")).doubleValue()).toArray();
        double average = values.length == 0 ? 0.0 : java.util.Arrays.stream(values).average().orElse(0.0);
        double median = values.length == 0 ? 0.0 : values[values.length / 2];
        return Map.of("rows", rows, "buckets", buckets,
                "averageDays", Math.round(average * 100.0) / 100.0,
                "medianDays", Math.round(median * 100.0) / 100.0);
    }

    private Map<String, Object> cumulativeFlowPayload(
            String projectKey, List<Issue> issues, Map<String, Integer> currentStatusCounts) {
        Map<String, List<ProjectEvent>> eventsByIssue = new LinkedHashMap<>();
        projectEvents.stream()
                .filter(event -> projectKey.equalsIgnoreCase(event.projectKey))
                .filter(event -> event.issueKey != null && !event.issueKey.isBlank())
                .sorted(Comparator.comparing(event -> parseTimestamp(event.timestamp)))
                .forEach(event -> eventsByIssue.computeIfAbsent(event.issueKey, ignored -> new ArrayList<>()).add(event));
        if (issues.isEmpty()) return Map.of("series", List.of(), "statuses", List.of());
        LocalDate start = issues.stream().map(issue -> parseTimestamp(issue.createdAt)
                .atZone(ZoneId.systemDefault()).toLocalDate()).min(LocalDate::compareTo).orElse(LocalDate.now());
        LocalDate end = LocalDate.now();
        List<Map<String, Object>> points = new ArrayList<>();
        for (LocalDate date = start; !date.isAfter(end); date = date.plusDays(1)) {
            Instant boundary = date.plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant();
            Map<String, Integer> counts = new LinkedHashMap<>();
            for (Issue issue : issues) {
                if (parseTimestamp(issue.createdAt).isAfter(boundary)) continue;
                String status = statusAt(issue, eventsByIssue.getOrDefault(issue.key, List.of()), boundary);
                counts.merge(status, 1, Integer::sum);
            }
            points.add(Map.of("date", date.toString(), "counts", counts));
        }
        return Map.of("series", points, "statuses", new ArrayList<>(currentStatusCounts.keySet()));
    }

    private String statusAt(Issue issue, List<ProjectEvent> events, Instant boundary) {
        String status = null;
        for (ProjectEvent event : events) {
            Instant timestamp = parseTimestamp(event.timestamp);
            if (timestamp.isAfter(boundary)) break;
            if ("issue.transitioned".equals(event.type)) {
                Object to = event.payload.get("to");
                if (to != null) status = String.valueOf(to);
            } else if ("issue.created".equals(event.type)) {
                Object createdStatus = event.payload.get("status");
                if (createdStatus != null) status = String.valueOf(createdStatus);
            }
        }
        if (status != null && !status.isBlank()) return status;
        return issue.status;
    }

    private static String normalizeAdminCategory(String value) {
        String candidate = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (candidate.isBlank() || !candidate.matches("[a-z0-9][a-z0-9._-]{1,63}")) {
            throw new ProblemException(400, "invalid_admin_category", "Administration category is invalid");
        }
        return candidate;
    }

    private AdminEntry requireAdminEntry(String category, long id) {
        String normalizedCategory = normalizeAdminCategory(category);
        AdminEntry entry = adminEntries.values().stream()
                .filter(candidate -> candidate.id == id && candidate.category.equals(normalizedCategory))
                .findFirst()
                .orElse(null);
        if (entry == null) throw new ProblemException(404, "admin_entry_not_found", "Administration entry not found");
        return entry;
    }

    private static String slug(String value) {
        String candidate = value == null ? "" : value.trim().toLowerCase(Locale.ROOT)
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("^-+|-+$", "");
        return candidate.isBlank() ? "custom-template" : candidate;
    }

    /**
     * Normalize the persisted schema while keeping the two built-in report
     * capability flags as metadata.  They are deliberately not treated as
     * user-supplied parameters.
     */
    private static Map<String, Object> normalizeReportParameters(Object value) {
        if (value == null) return new LinkedHashMap<>();
        if (!(value instanceof Map<?, ?> raw)) {
            throw new ProblemException(400, "invalid_report_parameters",
                    "Report parameters must be a JSON object");
        }
        Map<String, Object> normalized = new LinkedHashMap<>();
        raw.forEach((rawName, rawDefinition) -> {
            String name = String.valueOf(rawName);
            if (REPORT_PARAMETER_METADATA.contains(name)) {
                if (!(rawDefinition instanceof Boolean)) {
                    throw new ProblemException(400, "invalid_report_parameters",
                            "Built-in report metadata must be boolean",
                            Map.of("parameter", name));
                }
                normalized.put(name, rawDefinition);
                return;
            }
            if (!name.matches("[A-Za-z][A-Za-z0-9_]*")) {
                throw new ProblemException(400, "invalid_report_parameters",
                        "Report parameter names must contain letters, numbers and underscores",
                        Map.of("parameter", name));
            }
            if (!(rawDefinition instanceof Map<?, ?> definition)) {
                throw new ProblemException(400, "invalid_report_parameters",
                        "Report parameter definitions must be JSON objects",
                        Map.of("parameter", name));
            }
            normalized.put(name, normalizeReportParameterDefinition(name, definition));
        });
        return normalized;
    }

    private static Map<String, Object> normalizeReportParameterDefinition(
            String name, Map<?, ?> rawDefinition) {
        String type = rawDefinition.get("type") == null
                ? "string"
                : String.valueOf(rawDefinition.get("type")).trim().toLowerCase(Locale.ROOT);
        if (!REPORT_PARAMETER_TYPES.contains(type)) {
            throw new ProblemException(400, "invalid_report_parameters",
                    "Report parameter type must be string, enum, number or date",
                    Map.of("parameter", name, "type", type));
        }
        Map<String, Object> definition = new LinkedHashMap<>();
        definition.put("type", type);
        definition.put("required", Json.boolValue(rawDefinition.get("required"), false));
        if ("enum".equals(type)) {
            Object rawAllowed = rawDefinition.get("allowedValues");
            if (!(rawAllowed instanceof Iterable<?> iterable)) {
                throw new ProblemException(400, "invalid_report_parameters",
                        "Enum report parameters require allowedValues",
                        Map.of("parameter", name));
            }
            LinkedHashSet<String> allowed = new LinkedHashSet<>();
            for (Object item : iterable) {
                if (item == null || String.valueOf(item).isBlank()) {
                    throw new ProblemException(400, "invalid_report_parameters",
                            "Enum allowedValues must contain non-empty values",
                            Map.of("parameter", name));
                }
                allowed.add(String.valueOf(item));
            }
            if (allowed.isEmpty()) {
                throw new ProblemException(400, "invalid_report_parameters",
                        "Enum report parameters require at least one allowed value",
                        Map.of("parameter", name));
            }
            definition.put("allowedValues", new ArrayList<>(allowed));
        }
        return definition;
    }

    private static Map<String, Map<String, Object>> reportParameterSchema(
            Map<String, Object> parameters) {
        Map<String, Map<String, Object>> schema = new LinkedHashMap<>();
        if (parameters == null) return schema;
        parameters.forEach((name, value) -> {
            if (REPORT_PARAMETER_METADATA.contains(name)) return;
            if (!(value instanceof Map<?, ?> rawDefinition)) {
                throw new ProblemException(400, "invalid_report_parameters",
                        "Report parameter definitions must be JSON objects",
                        Map.of("parameter", name));
            }
            Map<String, Object> definition = new LinkedHashMap<>();
            rawDefinition.forEach((key, item) -> definition.put(String.valueOf(key), item));
            schema.put(name, definition);
        });
        return schema;
    }

    private static Map<String, Object> reportParameterValues(Object value) {
        if (value == null) return new LinkedHashMap<>();
        if (!(value instanceof Map<?, ?> raw)) {
            throw new ProblemException(400, "invalid_report_parameters",
                    "Report parameter values must be a JSON object");
        }
        Map<String, Object> values = new LinkedHashMap<>();
        raw.forEach((name, item) -> values.put(String.valueOf(name), item));
        return values;
    }

    private static void validateReportTemplateDefinition(
            String jql, Map<String, Object> parameters, String actor) {
        String source = jql == null ? "" : jql.trim();
        Map<String, Map<String, Object>> schema = reportParameterSchema(parameters);
        Matcher matcher = REPORT_PARAMETER_PLACEHOLDER.matcher(source);
        StringBuffer withoutPlaceholders = new StringBuffer();
        LinkedHashSet<String> placeholders = new LinkedHashSet<>();
        while (matcher.find()) {
            String name = matcher.group(1);
            placeholders.add(name);
            if (!schema.containsKey(name)) {
                throw new ProblemException(400, "invalid_report_parameters",
                        "Report JQL references an undefined parameter",
                        Map.of("parameter", name));
            }
            matcher.appendReplacement(withoutPlaceholders, "");
        }
        matcher.appendTail(withoutPlaceholders);
        if (withoutPlaceholders.toString().contains("{{")
                || withoutPlaceholders.toString().contains("}}")) {
            throw new ProblemException(400, "invalid_report_parameters",
                    "Report JQL contains an invalid parameter placeholder");
        }
        Map<String, Object> sampleValues = new LinkedHashMap<>();
        for (String name : placeholders) {
            sampleValues.put(name, sampleReportParameterValue(schema.get(name)));
        }
        String sampleJql = substituteReportParameters(source, sampleValues, schema);
        validateJql(sampleJql, actor);
    }

    private static Object sampleReportParameterValue(Map<String, Object> definition) {
        String type = String.valueOf(definition.getOrDefault("type", "string"));
        return switch (type) {
            case "number" -> 0L;
            case "date" -> "1970-01-01";
            case "enum" -> ((List<?>) definition.getOrDefault("allowedValues", List.of("value"))).get(0);
            default -> "value";
        };
    }

    private static Map<String, Object> resolveReportParameters(
            ReportTemplate template, Map<String, Object> supplied, String actor) {
        Map<String, Map<String, Object>> schema = reportParameterSchema(template.parameters);
        Map<String, Object> provided = supplied == null ? Map.of() : supplied;
        for (String name : provided.keySet()) {
            if (!schema.containsKey(name)) {
                throw new ProblemException(400, "unknown_report_parameter",
                        "Unknown report parameter: " + name,
                        Map.of("parameter", name, "templateId", template.id));
            }
        }
        Map<String, Object> normalized = new LinkedHashMap<>();
        for (Map.Entry<String, Map<String, Object>> entry : schema.entrySet()) {
            String name = entry.getKey();
            Map<String, Object> definition = entry.getValue();
            boolean required = Json.boolValue(definition.get("required"), false);
            if (!provided.containsKey(name) || provided.get(name) == null
                    || (provided.get(name) instanceof String text && text.isBlank())) {
                if (required) {
                    throw new ProblemException(400, "missing_report_parameter",
                            "Required report parameter is missing: " + name,
                            Map.of("parameter", name, "templateId", template.id));
                }
                continue;
            }
            normalized.put(name, normalizeReportParameterValue(name, definition, provided.get(name)));
        }
        String source = template.jql == null ? "" : template.jql;
        Matcher matcher = REPORT_PARAMETER_PLACEHOLDER.matcher(source);
        StringBuffer withoutPlaceholders = new StringBuffer();
        while (matcher.find()) matcher.appendReplacement(withoutPlaceholders, "");
        matcher.appendTail(withoutPlaceholders);
        if (withoutPlaceholders.toString().contains("{{")
                || withoutPlaceholders.toString().contains("}}")) {
            throw new ProblemException(400, "invalid_report_parameters",
                    "Report JQL contains an invalid parameter placeholder",
                    Map.of("templateId", template.id));
        }
        validateJql(substituteReportParameters(source, normalized, schema), actor);
        return normalized;
    }

    private static Object normalizeReportParameterValue(
            String name, Map<String, Object> definition, Object value) {
        String type = String.valueOf(definition.getOrDefault("type", "string"));
        switch (type) {
            case "string" -> {
                if (!(value instanceof String)) throw invalidReportParameterValue(name, type);
                return value;
            }
            case "date" -> {
                if (!(value instanceof String text)) throw invalidReportParameterValue(name, type);
                try {
                    return LocalDate.parse(text).toString();
                } catch (DateTimeParseException error) {
                    throw invalidReportParameterValue(name, type);
                }
            }
            case "enum" -> {
                if (!(value instanceof String text)) throw invalidReportParameterValue(name, type);
                List<String> allowed = Json.stringList(definition.get("allowedValues"));
                if (!allowed.contains(text)) throw invalidReportParameterValue(name, type);
                return text;
            }
            case "number" -> {
                String token;
                if (value instanceof Number number) {
                    token = number.toString();
                } else if (value instanceof String text) {
                    token = text.trim();
                } else {
                    throw invalidReportParameterValue(name, type);
                }
                if (!REPORT_PARAMETER_TOKEN.matcher(token).matches()) {
                    throw invalidReportParameterValue(name, type);
                }
                try {
                    if (token.contains(".")) return Double.parseDouble(token);
                    return Long.parseLong(token);
                } catch (NumberFormatException error) {
                    try {
                        return new BigDecimal(token);
                    } catch (NumberFormatException ignored) {
                        throw invalidReportParameterValue(name, type);
                    }
                }
            }
            default -> throw invalidReportParameterValue(name, type);
        }
    }

    private static ProblemException invalidReportParameterValue(String name, String type) {
        return new ProblemException(400, "invalid_report_parameter_value",
                "Invalid value for report parameter: " + name,
                Map.of("parameter", name, "type", type));
    }

    private static String substituteReportParameters(
            String source, Map<String, Object> values, Map<String, Map<String, Object>> schema) {
        String template = source == null ? "" : source;
        Matcher matcher = REPORT_PARAMETER_PLACEHOLDER.matcher(template);
        StringBuffer result = new StringBuffer();
        while (matcher.find()) {
            String name = matcher.group(1);
            if (!values.containsKey(name) || !schema.containsKey(name)) {
                throw new ProblemException(400, "invalid_report_parameters",
                        "Report parameter was not resolved: " + name,
                        Map.of("parameter", name));
            }
            String replacement = jqlLiteral(values.get(name),
                    String.valueOf(schema.get(name).getOrDefault("type", "string")));
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(result);
        if (result.toString().contains("{{") || result.toString().contains("}}")) {
            throw new ProblemException(400, "invalid_report_parameters",
                    "Report JQL contains an unresolved parameter placeholder");
        }
        return result.toString();
    }

    private static String jqlLiteral(Object value, String type) {
        if ("number".equals(type)) return String.valueOf(value);
        String text = String.valueOf(value);
        StringBuilder escaped = new StringBuilder(text.length() + 2);
        for (char character : text.toCharArray()) {
            if (character == '\\' || character == '"') escaped.append('\\');
            if (character == '\n' || character == '\r' || character == '\t') {
                escaped.append(' ');
            } else {
                escaped.append(character);
            }
        }
        return "\"" + escaped + "\"";
    }

    private Map<String, Object> permissionsFor(Project project, String actor) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String permission : PERMISSIONS) result.put(permission, hasPermission(project, actor, permission));
        return result;
    }

    private Map<String, Integer> countBy(List<Issue> source, java.util.function.Function<Issue, String> value) {
        Map<String, Integer> result = new LinkedHashMap<>();
        for (Issue issue : source) result.merge(value.apply(issue), 1, Integer::sum);
        return result;
    }

    private Map<String, Object> userJson(String username) {
        User user = users.get(username);
        return user == null ? Map.of("name", username) : Map.of(
                "name", user.username,
                "displayName", user.displayName,
                "emailAddress", user.email);
    }

    private Map<String, Object> userJsonNullable(String username) {
        return username == null || username.isBlank() ? null : userJson(username);
    }

    private String statusCategory(String status) {
        return "DONE".equals(status) ? "done" : "IN_PROGRESS".equals(status) ? "indeterminate" : "new";
    }

    private boolean isProjectStatus(Project project, String status) {
        return STATUSES.contains(status) || project.settings.boardColumns.containsKey(status);
    }

    private Project requireProject(String key) {
        Project project = projects.get(key.toUpperCase(Locale.ROOT));
        if (project == null) throw new ProblemException(404, "project_not_found", "Project not found: " + key);
        return project;
    }

    private Issue requireIssue(String key) {
        Issue issue = issues.get(key.toUpperCase(Locale.ROOT));
        if (issue == null) throw new ProblemException(404, "issue_not_found", "Issue not found: " + key);
        return issue;
    }

    private User requireUser(String actor) {
        User user = users.get(actor);
        if (user == null || !user.active) throw new ProblemException(401, "unknown_user", "Unknown JiraFlow user");
        return user;
    }

    /**
     * Authentication middleware calls this after bearer-token validation.  The
     * actor header is therefore only a selector among active JiraFlow users,
     * never an unchecked identity string.
     */
    synchronized void validateActor(String actor) {
        requireUser(actor);
    }

    private Issue editableIssue(String actor, String key) {
        Issue issue = requireIssue(key);
        ensurePermission(requireProject(issue.projectKey), actor, "EDIT");
        return issue;
    }

    private boolean hasPermission(Project project, String actor, String permission) {
        User user = users.get(actor);
        if (user == null || !user.active) return false;
        if (user.globalRoles.contains("administrators")) return true;
        if ("BROWSE".equals(permission) || "WATCH".equals(permission) || "VOTE".equals(permission)) return true;
        boolean developer = project.roles.getOrDefault("developers", new LinkedHashSet<>()).contains(actor);
        boolean reporter = project.roles.getOrDefault("reporters", new LinkedHashSet<>()).contains(actor);
        return switch (permission) {
            case "CREATE" -> developer || reporter;
            case "EDIT", "TRANSITION", "ATTACH", "ASSIGN", "WORKLOG", "LINK" -> developer;
            case "COMMENT" -> developer || reporter;
            case "ADMINISTER", "DELETE" -> false;
            default -> false;
        };
    }

    private void ensurePermission(Project project, String actor, String permission) {
        requireUser(actor);
        if (project == null) {
            throw new ProblemException(404, "project_not_found", "Project not found");
        }
        if (!hasPermission(project, actor, permission)) {
            throw new ProblemException(403, "permission_denied",
                    "User " + actor + " lacks " + permission + " on project " + project.key,
                    Map.of("actor", actor, "projectKey", project.key, "permission", permission));
        }
    }

    private void ensureGlobalAdmin(String actor) {
        User user = requireUser(actor);
        if (!user.globalRoles.contains("administrators")) {
            throw new ProblemException(403, "admin_required", "Global administrator access is required");
        }
    }

    private boolean hasGlobalAdmin(String actor) {
        User user = users.get(actor);
        return user != null && user.active && user.globalRoles.contains("administrators");
    }

    private void ensureRevision(Issue issue, long expectedRevision) {
        if (expectedRevision > 0 && expectedRevision != issue.revision) {
            throw new ProblemException(409, "revision_conflict",
                    "Issue changed since revision " + expectedRevision,
                    Map.of("expectedRevision", expectedRevision, "actualRevision", issue.revision, "issue", issue.json()));
        }
    }

    private void ensureUnlocked(Issue issue, String actor) {
        cleanupExpiredLocks();
        LockInfo lock = locks.get(issue.key);
        if (lock != null && !lock.username.equals(actor)) {
            throw new ProblemException(409, "issue_locked", "Issue is locked by " + lock.username,
                    Map.of("lock", lock.json()));
        }
    }

    private void cleanupExpiredLocks() {
        String now = Instant.now().toString();
        locks.values().removeIf(lock -> lock.expiresAt.compareTo(now) < 0);
    }

    private void cleanupPresence() {
        Instant cutoff = Instant.now().minus(Duration.ofMinutes(10));
        presence.values().removeIf(item -> parseTimestamp(item.updatedAt).isBefore(cutoff));
    }

    private void touch(Issue issue) {
        issue.revision++;
        issue.updatedAt = Instant.now().toString();
    }

    private long nextId() {
        return nextEntityId++;
    }

    private void audit(String actor, String action, String entity, String entityKey, String detail) {
        auditEvents.add(new AuditEvent(nextId(), actor, action, entity, entityKey, detail));
    }

    private void event(String actor, String projectKey, String type, String issueKey, Map<String, Object> payload) {
        Issue issue = issueKey == null || issueKey.isBlank() ? null : issues.get(issueKey.toUpperCase(Locale.ROOT));
        Object fields = payload.get("fields");
        String[] changedFields = fields instanceof List<?> list
                ? list.stream().map(String::valueOf).toArray(String[]::new)
                : payload.containsKey("from") && payload.containsKey("to")
                        ? new String[]{"from", "to"}
                        : payload.keySet().stream().map(String::valueOf).toArray(String[]::new);
        Map<String, Object> eventPayload = new LinkedHashMap<>(payload);
        if (issue != null) eventPayload.put("processArea", issue.processArea);
        projectEvents.add(new ProjectEvent(nextId(), UUID.randomUUID().toString(), actor, projectKey, type,
                issueKey, eventPayload, issue == null ? 0 : issue.revision, changedFields));
    }

    private void notifyWatchers(Issue issue, String actor, String kind, String message) {
        Set<String> recipients = new HashSet<>(issue.watchers);
        recipients.remove(actor);
        for (String recipient : recipients) {
            Notification notification = new Notification(nextId(), recipient, kind, message, issue.key);
            notifications.put(String.valueOf(notification.id), notification);
        }
    }

    private static String text(Map<String, Object> body, String key) {
        Object value = body.get(key);
        return value == null ? "" : String.valueOf(value);
    }

    private static String defaulted(Map<String, Object> body, String key, String fallback) {
        String value = text(body, key).trim();
        return value.isBlank() ? fallback : value;
    }

    private static String normalizeStatus(String value) {
        String status = value == null ? "" : value.trim();
        return switch (status.toUpperCase(Locale.ROOT)) {
            case "BACKLOG", "BACKLOG：" -> "BACKLOG";
            case "TODO", "TO DO", "SELECTED FOR DEVELOPMENT", "待开发" -> "TODO";
            case "IN_PROGRESS", "IN PROGRESS", "处理中" -> "IN_PROGRESS";
            case "DONE", "完成" -> "DONE";
            default -> status.toUpperCase(Locale.ROOT);
        };
    }

    private static Instant parseTimestamp(String value) {
        try {
            return Instant.parse(value);
        } catch (Exception ignored) {
            return Instant.EPOCH;
        }
    }
}
