package com.jiraflow;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.Executors;

public final class JiraFlowServer {
    private static final String AUDITFLOW_EXTENSION_ORIGIN =
            "chrome-extension://jcnjkbebdinfibjhjbokmdoobokjlkom";

    private final Store store;
    private final String bearerToken;
    private final String boundActor;
    private final Set<String> corsOrigins;
    private final int port;

    private JiraFlowServer(
            Store store,
            String bearerToken,
            String boundActor,
            Set<String> corsOrigins,
            int port) {
        this.store = store;
        this.bearerToken = bearerToken;
        this.boundActor = boundActor;
        this.corsOrigins = corsOrigins;
        this.port = port;
    }

    public static void main(String[] args) throws Exception {
        int port = 4188;
        String host = envOrDefault("JIRAFLOW_HOST", "127.0.0.1");
        String configuredToken = envOrDefault("JIRAFLOW_TOKEN", "");
        String configuredActor = envOrDefault("JIRAFLOW_USER", "");
        String configuredCorsOrigins = envOrDefault("JIRAFLOW_CORS_ORIGIN", "");
        Path dataDir = Path.of(System.getProperty("user.home"), ".jiraflow");
        for (int i = 0; i < args.length; i++) {
            if ("--port".equals(args[i]) && i + 1 < args.length) port = Integer.parseInt(args[++i]);
            if ("--data".equals(args[i]) && i + 1 < args.length) dataDir = Path.of(args[++i]);
            if ("--host".equals(args[i]) && i + 1 < args.length) host = args[++i];
            if ("--token".equals(args[i]) && i + 1 < args.length) configuredToken = args[++i];
            if ("--user".equals(args[i]) && i + 1 < args.length) configuredActor = args[++i];
            if ("--cors-origin".equals(args[i]) && i + 1 < args.length) configuredCorsOrigins = args[++i];
        }
        if (port < 1 || port > 65535) throw new IllegalArgumentException("Port must be between 1 and 65535");
        Files.createDirectories(dataDir);
        String bearerToken = loadOrCreateToken(dataDir, configuredToken);
        Set<String> corsOrigins = parseCorsOrigins(configuredCorsOrigins, port);
        Store store = new Store(dataDir);
        store.load();
        String boundActor = loadOrCreateActorBinding(dataDir, configuredActor, store);
        JiraFlowServer app = new JiraFlowServer(store, bearerToken, boundActor, corsOrigins, port);
        HttpServer server = HttpServer.create(new InetSocketAddress(host, port), 0);
        server.createContext("/", app::handle);
        server.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
        server.start();
        System.out.printf("JiraFlow %s listening on http://%s:%d%n", Store.VERSION, host, port);
        System.out.printf("Data directory: %s%n", dataDir.toAbsolutePath());
    }

    private void handle(HttpExchange exchange) throws IOException {
        applyCors(exchange);
        exchange.getResponseHeaders().set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
        exchange.getResponseHeaders().set("Vary", "Origin");
        if ("OPTIONS".equalsIgnoreCase(exchange.getRequestMethod())) {
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
            return;
        }

        try {
            String path = exchange.getRequestURI().getPath();
            String method = exchange.getRequestMethod().toUpperCase(Locale.ROOT);
            if ("/health".equals(path) || "/api/health".equals(path)) {
                Map<String, Object> health = new LinkedHashMap<>();
                health.put("status", "ok");
                health.put("service", "JiraFlow");
                health.put("version", Store.VERSION);
                health.put("storage", store.storageHealth());
                health.put("authentication", Map.of(
                        "scheme", "bearer",
                        "tokenConfigured", !bearerToken.isBlank()));
                health.put("capabilities", List.of(
                        "dashboard", "permissions", "jql", "workflows", "versions", "reports",
                        "attachments", "notifications", "audit", "user-admin", "worklogs",
                        "rest-v2", "presence", "locks", "plugins", "aspice-analysis",
                        "cybersecurity-analysis", "functional-safety-analysis"));
                sendJson(exchange, 200, health);
                return;
            }
            if (path.startsWith("/api/") || path.startsWith("/rest/api/2/")) {
                authenticate(exchange);
            }
            if (path.startsWith("/api/")) {
                handleApi(exchange, method, path);
                return;
            }
            if (path.startsWith("/rest/api/2/")) {
                handleRest(exchange, method, path);
                return;
            }
            if ("/favicon.ico".equals(path) && "GET".equals(method)) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }
            serveStatic(exchange, path);
        } catch (ProblemException error) {
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("error", error.getMessage());
            body.put("code", error.code);
            if (!error.details.isEmpty()) body.put("details", error.details);
            sendJson(exchange, error.status, body);
        } catch (Exception error) {
            error.printStackTrace();
            sendJson(exchange, 500, Map.of("error", "Internal server error", "code", "internal_error"));
        } finally {
            exchange.close();
        }
    }

    private void authenticate(HttpExchange exchange) {
        String supplied = exchange.getRequestHeaders().getFirst("Authorization");
        if (supplied != null && supplied.regionMatches(true, 0, "Bearer ", 0, 7)) {
            supplied = supplied.substring(7).trim();
        } else {
            supplied = exchange.getRequestHeaders().getFirst("X-JiraFlow-Token");
        }
        if (supplied == null || supplied.isBlank()) {
            throw new ProblemException(401, "authentication_required", "A JiraFlow bearer token is required");
        }
        if (!constantTimeEquals(bearerToken, supplied)) {
            throw new ProblemException(401, "invalid_token", "The JiraFlow bearer token is invalid");
        }
        actor(exchange);
        store.validateActor(boundActor);
    }

    private void applyCors(HttpExchange exchange) {
        String origin = exchange.getRequestHeaders().getFirst("Origin");
        if (origin == null || origin.isBlank()) return;
        String normalized = normalizeOrigin(origin);
        if (corsOrigins.contains(normalized)) {
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", origin);
            exchange.getResponseHeaders().set(
                    "Access-Control-Allow-Headers",
                    "Authorization, Content-Type, X-JiraFlow-Token, X-JiraFlow-User, If-Match");
        }
    }

    private static boolean constantTimeEquals(String expected, String supplied) {
        byte[] expectedBytes = expected.getBytes(StandardCharsets.UTF_8);
        byte[] suppliedBytes = supplied.getBytes(StandardCharsets.UTF_8);
        int length = Math.max(expectedBytes.length, suppliedBytes.length);
        int difference = expectedBytes.length ^ suppliedBytes.length;
        for (int i = 0; i < length; i++) {
            byte expectedByte = i < expectedBytes.length ? expectedBytes[i] : 0;
            byte suppliedByte = i < suppliedBytes.length ? suppliedBytes[i] : 0;
            difference |= expectedByte ^ suppliedByte;
        }
        return difference == 0;
    }

    private static String loadOrCreateToken(Path dataDir, String configuredToken) throws IOException {
        String supplied = configuredToken == null ? "" : configuredToken.trim();
        if (!supplied.isBlank()) {
            if (supplied.length() < 24) {
                throw new IllegalArgumentException("JiraFlow token must contain at least 24 characters");
            }
            return supplied;
        }
        Path tokenFile = dataDir.resolve(".token");
        if (Files.exists(tokenFile)) {
            String persisted = Files.readString(tokenFile, StandardCharsets.UTF_8).trim();
            if (persisted.length() < 24) {
                throw new IOException("JiraFlow token file is present but invalid");
            }
            return persisted;
        }
        byte[] random = new byte[32];
        new SecureRandom().nextBytes(random);
        String generated = Base64.getUrlEncoder().withoutPadding().encodeToString(random);
        try {
            Files.writeString(tokenFile, generated + System.lineSeparator(), StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        } catch (java.nio.file.FileAlreadyExistsException race) {
            String persisted = Files.readString(tokenFile, StandardCharsets.UTF_8).trim();
            if (persisted.length() < 24) throw new IOException("JiraFlow token file is invalid", race);
            return persisted;
        }
        try {
            Files.setPosixFilePermissions(tokenFile, Set.of(
                    java.nio.file.attribute.PosixFilePermission.OWNER_READ,
                    java.nio.file.attribute.PosixFilePermission.OWNER_WRITE));
        } catch (UnsupportedOperationException ignored) {
            // Windows and other non-POSIX filesystems have no equivalent mode.
        }
        return generated;
    }

    /**
     * A bearer token is a credential for one Store user.  Persisting that
     * binding prevents a caller who obtains the token from selecting the
     * administrator (or any other user) by changing X-JiraFlow-User.
     *
     * JIRAFLOW_USER/--user is only honored when the binding is initialized;
     * a later change requires an explicit data-directory migration instead of
     * silently changing the token's identity.
     */
    private static String loadOrCreateActorBinding(
            Path dataDir,
            String configuredActor,
            Store store) throws IOException {
        String requested = configuredActor == null ? "" : configuredActor.trim();
        boolean explicitlyConfigured = !requested.isBlank();
        if (requested.isBlank()) requested = "testuser";

        Path actorFile = dataDir.resolve(".token-user");
        if (Files.exists(actorFile)) {
            String persisted = Files.readString(actorFile, StandardCharsets.UTF_8).trim();
            if (persisted.isBlank()) {
                throw new IOException("JiraFlow token identity file is present but empty");
            }
            validateStartupActor(store, persisted);
            if (explicitlyConfigured && !requested.equals(persisted)) {
                throw new IOException("JIRAFLOW_USER does not match the persisted token identity");
            }
            return persisted;
        }

        validateStartupActor(store, requested);
        try {
            Files.writeString(actorFile, requested + System.lineSeparator(), StandardCharsets.UTF_8,
                    StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        } catch (java.nio.file.FileAlreadyExistsException race) {
            String persisted = Files.readString(actorFile, StandardCharsets.UTF_8).trim();
            if (persisted.isBlank()) {
                throw new IOException("JiraFlow token identity file is present but empty", race);
            }
            validateStartupActor(store, persisted);
            if (explicitlyConfigured && !requested.equals(persisted)) {
                throw new IOException("JIRAFLOW_USER does not match the persisted token identity", race);
            }
            return persisted;
        }
        try {
            Files.setPosixFilePermissions(actorFile, Set.of(
                    java.nio.file.attribute.PosixFilePermission.OWNER_READ,
                    java.nio.file.attribute.PosixFilePermission.OWNER_WRITE));
        } catch (UnsupportedOperationException ignored) {
            // Windows and other non-POSIX filesystems have no equivalent mode.
        }
        return requested;
    }

    private static void validateStartupActor(Store store, String actor) throws IOException {
        try {
            store.validateActor(actor);
        } catch (ProblemException error) {
            throw new IOException("JiraFlow token identity is not an active Store user: " + actor, error);
        }
    }

    private static Set<String> parseCorsOrigins(String configured, int port) {
        if (configured == null || configured.isBlank()) {
            return Set.of(
                    "http://127.0.0.1:" + port,
                    "http://localhost:" + port,
                    AUDITFLOW_EXTENSION_ORIGIN);
        }
        Set<String> origins = new HashSet<>();
        for (String item : configured.split(",")) {
            String origin = normalizeOrigin(item);
            if (origin.isBlank() || "*".equals(origin)) {
                throw new IllegalArgumentException("JiraFlow CORS origins must be explicit URLs");
            }
            origins.add(origin);
        }
        if (origins.isEmpty()) throw new IllegalArgumentException("At least one CORS origin is required");
        return Set.copyOf(origins);
    }

    private static String normalizeOrigin(String value) {
        String origin = value == null ? "" : value.trim();
        while (origin.endsWith("/")) origin = origin.substring(0, origin.length() - 1);
        return origin;
    }

    private static String envOrDefault(String name, String fallback) {
        String value = System.getenv(name);
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private void handleApi(HttpExchange exchange, String method, String path) throws IOException {
        List<String> parts = segments(path);
        String actor = actor(exchange);

        if (parts.size() == 2 && "dashboard".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.dashboard(actor, query(exchange.getRequestURI(), "project")));
            return;
        }
        if (parts.size() == 2 && "audit".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("events", store.auditLog(
                    actor, query(exchange.getRequestURI(), "project"),
                    integerQuery(exchange.getRequestURI(), "limit", 100))));
            return;
        }
        if (parts.size() == 2 && "session".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.session(actor));
            return;
        }
        if (parts.size() == 2 && "users".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("users", store.users(actor)));
            return;
        }
        if (parts.size() == 3 && "admin".equals(parts.get(1)) && "users".equals(parts.get(2))
                && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("users", store.users(actor)));
            return;
        }
        if (parts.size() == 3 && "admin".equals(parts.get(1)) && "users".equals(parts.get(2))
                && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("user", store.createUser(actor, body(exchange))));
            return;
        }
        if (parts.size() == 4 && "admin".equals(parts.get(1)) && "users".equals(parts.get(2))
                && "PATCH".equals(method)) {
            sendJson(exchange, 200, Map.of("user", store.updateUser(actor, parts.get(3), body(exchange))));
            return;
        }
        if (parts.size() == 2 && "admin".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.adminOverview(actor));
            return;
        }
        if (parts.size() == 3 && "admin".equals(parts.get(1))
                && "overview".equals(parts.get(2)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.adminOverview(actor));
            return;
        }
        if (parts.size() == 3 && "admin".equals(parts.get(1))
                && "catalog".equals(parts.get(2)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.adminCatalog(actor));
            return;
        }
        if (parts.size() == 3 && "admin".equals(parts.get(1))
                && !"users".equals(parts.get(2))
                && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("entries", store.adminEntries(
                    actor,
                    parts.get(2),
                    query(exchange.getRequestURI(), "q"))));
            return;
        }
        if (parts.size() == 3 && "admin".equals(parts.get(1))
                && !"users".equals(parts.get(2))
                && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("entry", store.createAdminEntry(
                    actor, parts.get(2), body(exchange))));
            return;
        }
        if (parts.size() == 4 && "admin".equals(parts.get(1))
                && !"users".equals(parts.get(2))
                && ("PATCH".equals(method) || "DELETE".equals(method))) {
            long id = longPart(parts.get(3));
            if ("PATCH".equals(method)) {
                sendJson(exchange, 200, Map.of("entry", store.updateAdminEntry(
                        actor, parts.get(2), id, body(exchange))));
            } else {
                store.deleteAdminEntry(actor, parts.get(2), id);
                sendJson(exchange, 200, Map.of("deleted", true));
            }
            return;
        }
        if (parts.size() == 2 && "projects".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("projects", store.projects()));
            return;
        }
        if (parts.size() == 4 && "integrations".equals(parts.get(1))
                && "auditflow".equals(parts.get(2)) && "projects".equals(parts.get(3))
                && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("projects", store.auditflowProjects(actor)));
            return;
        }
        if (parts.size() == 5 && "integrations".equals(parts.get(1))
                && "auditflow".equals(parts.get(2)) && "projects".equals(parts.get(3))
                && "ensure".equals(parts.get(4)) && "POST".equals(method)) {
            sendJson(exchange, 200, store.ensureAuditflowProject(actor, body(exchange)));
            return;
        }
        if (parts.size() == 5 && "integrations".equals(parts.get(1))
                && "auditflow".equals(parts.get(2)) && "issues".equals(parts.get(3))
                && "upsert".equals(parts.get(4)) && "POST".equals(method)) {
            sendJson(exchange, 200, store.upsertAuditflowIssue(actor, body(exchange)));
            return;
        }
        if (parts.size() == 4 && "integrations".equals(parts.get(1))
                && "auditflow".equals(parts.get(2)) && "transitions".equals(parts.get(3))
                && "POST".equals(method)) {
            sendJson(exchange, 200, store.auditflowTransition(actor, body(exchange)));
            return;
        }
        if (parts.size() == 6 && "integrations".equals(parts.get(1))
                && "auditflow".equals(parts.get(2)) && "projects".equals(parts.get(3))
                && "events".equals(parts.get(5)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.auditflowEvents(actor, parts.get(4),
                    longQuery(exchange.getRequestURI(), "afterRevision", 0),
                    integerQuery(exchange.getRequestURI(), "limit", 100)));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "auditflow-mapping".equals(parts.get(3)) && "PUT".equals(method)) {
            sendJson(exchange, 200, Map.of("project", store.mapAuditflowProject(parts.get(2), actor, body(exchange))));
            return;
        }
        if (parts.size() == 3 && "projects".equals(parts.get(1))
                && !"events".equals(parts.get(2)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("project", store.project(parts.get(2), actor)));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "components".equals(parts.get(3))
                && ("GET".equals(method) || "POST".equals(method))) {
            if ("GET".equals(method)) {
                sendJson(exchange, 200, Map.of("components", store.components(actor, parts.get(2))));
            } else {
                sendJson(exchange, 201, Map.of("component", store.createComponent(
                        actor, parts.get(2), body(exchange))));
            }
            return;
        }
        if (parts.size() == 5 && "projects".equals(parts.get(1))
                && "components".equals(parts.get(3))
                && ("PATCH".equals(method) || "DELETE".equals(method))) {
            long id = longPart(parts.get(4));
            if ("PATCH".equals(method)) {
                sendJson(exchange, 200, Map.of("component", store.updateComponent(
                        actor, parts.get(2), id, body(exchange))));
            } else {
                store.deleteComponent(actor, parts.get(2), id);
                sendJson(exchange, 200, Map.of("deleted", true));
            }
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "settings".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.projectSettings(parts.get(2), actor));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "settings".equals(parts.get(3)) && "PATCH".equals(method)) {
            sendJson(exchange, 200, store.updateProjectSettings(parts.get(2), actor, body(exchange)));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "statuses".equals(parts.get(3)) && "POST".equals(method)) {
            sendJson(exchange, 201, store.addBoardStatus(parts.get(2), actor, body(exchange)));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "workflow".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.workflow(parts.get(2), actor));
            return;
        }
        if (parts.size() == 5 && "projects".equals(parts.get(1))
                && "workflow".equals(parts.get(3)) && "transitions".equals(parts.get(4))
                && "POST".equals(method)) {
            sendJson(exchange, 201, store.addWorkflowTransition(parts.get(2), actor, body(exchange)));
            return;
        }
        if (parts.size() == 6 && "projects".equals(parts.get(1))
                && "workflow".equals(parts.get(3)) && "transitions".equals(parts.get(4))
                && "PATCH".equals(method)) {
            sendJson(exchange, 200, Map.of("transition", store.updateWorkflowTransition(
                    parts.get(2), actor, longPart(parts.get(5)), body(exchange))));
            return;
        }
        if (parts.size() == 6 && "projects".equals(parts.get(1))
                && "workflow".equals(parts.get(3)) && "transitions".equals(parts.get(4))
                && "DELETE".equals(method)) {
            store.deleteWorkflowTransition(parts.get(2), actor, longPart(parts.get(5)));
            sendJson(exchange, 200, Map.of("deleted", true));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "versions".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("versions", store.versions(actor, parts.get(2))));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "versions".equals(parts.get(3)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("version", store.createVersion(actor, parts.get(2), body(exchange))));
            return;
        }
        if (parts.size() == 5 && "projects".equals(parts.get(1))
                && "versions".equals(parts.get(3)) && "PATCH".equals(method)) {
            sendJson(exchange, 200, Map.of("version", store.updateVersion(
                    actor, parts.get(2), longPart(parts.get(4)), body(exchange))));
            return;
        }
        if (parts.size() == 5 && "projects".equals(parts.get(1))
                && "versions".equals(parts.get(3)) && "POST".equals(method)
                && "release".equalsIgnoreCase(query(exchange.getRequestURI(), "action"))) {
            sendJson(exchange, 200, Map.of("version", store.releaseVersion(
                    actor, parts.get(2), longPart(parts.get(4)))));
            return;
        }
        if (parts.size() == 3 && "boards".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.board(
                    parts.get(2),
                    actor,
                    query(exchange.getRequestURI(), "q"),
                    query(exchange.getRequestURI(), "jql")));
            return;
        }
        if (parts.size() == 2 && "search".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.search(
                    actor,
                    query(exchange.getRequestURI(), "project"),
                    query(exchange.getRequestURI(), "jql"),
                    longQuery(exchange.getRequestURI(), "filterId", 0),
                    integerQuery(exchange.getRequestURI(), "startAt", 0),
                    integerQuery(exchange.getRequestURI(), "maxResults", 50)));
            return;
        }
        if (parts.size() == 3
                && "import".equals(parts.get(1))
                && "cep".equals(parts.get(2))
                && "POST".equals(method)) {
            sendJson(exchange, 200, store.importCepIssues(actor, body(exchange)));
            return;
        }
        if (parts.size() == 2 && "filters".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("filters", store.filters(
                    actor,
                    query(exchange.getRequestURI(), "project"),
                    query(exchange.getRequestURI(), "q"))));
            return;
        }
        if (parts.size() == 2 && "filters".equals(parts.get(1)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("filter", store.createFilter(actor, body(exchange))));
            return;
        }
        if (parts.size() == 3 && "filters".equals(parts.get(1))
                && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("filter", store.filter(actor, longPart(parts.get(2)))));
            return;
        }
        if (parts.size() == 3 && "filters".equals(parts.get(1))
                && ("PATCH".equals(method) || "DELETE".equals(method))) {
            long id = longPart(parts.get(2));
            if ("PATCH".equals(method)) {
                sendJson(exchange, 200, Map.of("filter", store.updateFilter(actor, id, body(exchange))));
            } else {
                store.deleteFilter(actor, id);
                sendJson(exchange, 200, Map.of("deleted", true));
            }
            return;
        }
        if (parts.size() == 4 && "filters".equals(parts.get(1))
                && "share".equals(parts.get(3))
                && ("POST".equals(method) || "PATCH".equals(method) || "DELETE".equals(method))) {
            Map<String, Object> request = "DELETE".equals(method)
                    ? new LinkedHashMap<>(Map.of("visibility", "private", "sharedWith", List.of()))
                    : body(exchange);
            sendJson(exchange, 200, Map.of("filter", store.updateFilter(
                    actor, longPart(parts.get(2)), request)));
            return;
        }
        if (parts.size() == 4 && "filters".equals(parts.get(1))
                && ("subscription".equals(parts.get(3)) || "subscriptions".equals(parts.get(3)))
                && ("GET".equals(method) || "POST".equals(method))) {
            long filterId = longPart(parts.get(2));
            if ("GET".equals(method)) {
                sendJson(exchange, 200, Map.of("subscriptions", store.filterSubscriptions(actor, filterId)));
            } else {
                sendJson(exchange, 201, Map.of("subscription", store.createFilterSubscription(
                        actor, filterId, body(exchange))));
            }
            return;
        }
        if (parts.size() == 5 && "filters".equals(parts.get(1))
                && ("subscription".equals(parts.get(3)) || "subscriptions".equals(parts.get(3)))
                && ("PATCH".equals(method) || "DELETE".equals(method))) {
            long filterId = longPart(parts.get(2));
            long subscriptionId = longPart(parts.get(4));
            if ("PATCH".equals(method)) {
                sendJson(exchange, 200, Map.of("subscription", store.updateFilterSubscription(
                        actor, filterId, subscriptionId, body(exchange))));
            } else {
                store.deleteFilterSubscription(actor, filterId, subscriptionId);
                sendJson(exchange, 200, Map.of("deleted", true));
            }
            return;
        }
        if (parts.size() == 2 && "search".equals(parts.get(1)) && "POST".equals(method)) {
            Map<String, Object> request = body(exchange);
            sendJson(exchange, 200, store.search(
                    actor,
                    text(request, "project"),
                    text(request, "jql"),
                    Json.longValue(request.get("filterId"), 0),
                    (int) Json.longValue(request.get("startAt"), 0),
                    (int) Json.longValue(request.get("maxResults"), 50)));
            return;
        }
        if (parts.size() == 2 && "issues".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.search(
                    actor,
                    query(exchange.getRequestURI(), "project"),
                    query(exchange.getRequestURI(), "jql"),
                    longQuery(exchange.getRequestURI(), "filterId", 0),
                    integerQuery(exchange.getRequestURI(), "startAt", 0),
                    integerQuery(exchange.getRequestURI(), "maxResults", 50)));
            return;
        }
        if (parts.size() == 2 && "issues".equals(parts.get(1)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("issue", store.createIssue(actor, body(exchange))));
            return;
        }
        if (parts.size() == 3 && "issues".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("issue", store.issue(parts.get(2), actor)));
            return;
        }
        if (parts.size() == 3 && "issues".equals(parts.get(1)) && "PATCH".equals(method)) {
            Map<String, Object> request = body(exchange);
            sendJson(exchange, 200, Map.of("issue", store.updateIssue(
                    actor, parts.get(2), request, expectedRevision(exchange, request))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "assessment".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("assessment", store.assessment(actor, parts.get(2))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "assessment".equals(parts.get(3)) && "PATCH".equals(method)) {
            Map<String, Object> request = body(exchange);
            sendJson(exchange, 200, Map.of("assessment", store.updateAssessment(
                    actor, parts.get(2), request, expectedRevision(exchange, request))));
            return;
        }
        if (parts.size() == 3 && "issues".equals(parts.get(1)) && "DELETE".equals(method)) {
            store.deleteIssue(actor, parts.get(2));
            sendJson(exchange, 200, Map.of("deleted", true));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "transition".equals(parts.get(3)) && "POST".equals(method)) {
            Map<String, Object> request = body(exchange);
            sendJson(exchange, 200, Map.of("issue", store.transition(
                    actor, parts.get(2), text(request, "status"), expectedRevision(exchange, request))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "comments".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("comments", store.comments(actor, parts.get(2))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "comments".equals(parts.get(3)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("comment", store.addComment(actor, parts.get(2), body(exchange))));
            return;
        }
        if (parts.size() == 5 && "issues".equals(parts.get(1))
                && "comments".equals(parts.get(3)) && "PATCH".equals(method)) {
            sendJson(exchange, 200, Map.of("comment", store.updateComment(
                    actor, parts.get(2), longPart(parts.get(4)), body(exchange))));
            return;
        }
        if (parts.size() == 5 && "issues".equals(parts.get(1))
                && "comments".equals(parts.get(3)) && "DELETE".equals(method)) {
            store.deleteComment(actor, parts.get(2), longPart(parts.get(4)));
            sendJson(exchange, 200, Map.of("deleted", true));
            return;
        }
        if (parts.size() == 6 && "issues".equals(parts.get(1))
                && "comments".equals(parts.get(3)) && "pin".equals(parts.get(5))
                && ("POST".equals(method) || "DELETE".equals(method))) {
            sendJson(exchange, 200, Map.of("comment", store.pinComment(
                    actor, parts.get(2), longPart(parts.get(4)), "POST".equals(method))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "worklogs".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("worklogs", store.worklogs(actor, parts.get(2))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "worklogs".equals(parts.get(3)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("worklog", store.addWorklog(actor, parts.get(2), body(exchange))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "subtasks".equals(parts.get(3)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("issue", store.createSubtask(actor, parts.get(2), body(exchange))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "attachments".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("attachments", store.attachments(actor, parts.get(2))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "attachments".equals(parts.get(3)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("attachment", store.addAttachment(actor, parts.get(2), body(exchange))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "history".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("history", store.history(actor, parts.get(2))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "watch".equals(parts.get(3)) && ("POST".equals(method) || "DELETE".equals(method))) {
            sendJson(exchange, 200, Map.of("issue", store.watch(actor, parts.get(2), "POST".equals(method))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "vote".equals(parts.get(3)) && ("POST".equals(method) || "DELETE".equals(method))) {
            sendJson(exchange, 200, Map.of("issue", store.vote(actor, parts.get(2), "POST".equals(method))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "lock".equals(parts.get(3)) && ("POST".equals(method) || "DELETE".equals(method))) {
            sendJson(exchange, 200, store.lock(actor, parts.get(2), "POST".equals(method)));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "links".equals(parts.get(3)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("issue", store.linkIssue(actor, parts.get(2), body(exchange))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "links".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("links", store.issueLinks(actor, parts.get(2))));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "links".equals(parts.get(3)) && "DELETE".equals(method)) {
            store.deleteIssueLink(actor, parts.get(2), body(exchange));
            sendJson(exchange, 200, Map.of("deleted", true));
            return;
        }
        if (parts.size() == 4 && "issues".equals(parts.get(1))
                && "rank".equals(parts.get(3)) && "PATCH".equals(method)) {
            Map<String, Object> request = body(exchange);
            sendJson(exchange, 200, Map.of("issue", store.rankIssue(
                    actor, parts.get(2), request, expectedRevision(exchange, request))));
            return;
        }
        if (parts.size() == 5 && "issues".equals(parts.get(1))
                && "attachments".equals(parts.get(3))) {
            if ("GET".equals(method)) {
                sendJson(exchange, 200, store.downloadAttachment(actor, parts.get(2), longPart(parts.get(4))));
                return;
            }
            if ("DELETE".equals(method)) {
                store.deleteAttachment(actor, parts.get(2), longPart(parts.get(4)));
                sendJson(exchange, 200, Map.of("deleted", true));
                return;
            }
        }
        if (parts.size() == 2 && "notifications".equals(parts.get(1)) && "POST".equals(method)
                && "read-all".equals(query(exchange.getRequestURI(), "action"))) {
            sendJson(exchange, 200, Map.of("updated", store.markNotificationsRead(actor)));
            return;
        }
        if (parts.size() == 3 && "notifications".equals(parts.get(1))
                && "read-all".equals(parts.get(2)) && "POST".equals(method)) {
            sendJson(exchange, 200, Map.of("updated", store.markNotificationsRead(actor)));
            return;
        }
        if (parts.size() == 2 && "events".equals(parts.get(1)) && "GET".equals(method)) {
            String project = query(exchange.getRequestURI(), "project");
            sendJson(exchange, 200, Map.of("events", store.projectEvents(
                    actor, project.isBlank() ? "KTEST" : project,
                    longQuery(exchange.getRequestURI(), "since", 0))));
            return;
        }
        if (parts.size() == 3 && "projects".equals(parts.get(1))
                && "events".equals(parts.get(2)) && "GET".equals(method)) {
            String project = query(exchange.getRequestURI(), "project");
            sendJson(exchange, 200, Map.of("events", store.projectEvents(
                    actor, project.isBlank() ? "KTEST" : project,
                    longQuery(exchange.getRequestURI(), "since", 0))));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "events".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("events", store.projectEvents(
                    actor, parts.get(2), longQuery(exchange.getRequestURI(), "since", 0))));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "presence".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("presence", store.projectPresence(actor, parts.get(2))));
            return;
        }
        if (parts.size() == 4 && "projects".equals(parts.get(1))
                && "presence".equals(parts.get(3)) && "POST".equals(method)) {
            sendJson(exchange, 200, Map.of("presence", store.updatePresence(actor, parts.get(2), body(exchange))));
            return;
        }
        if (parts.size() == 2 && "notifications".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("notifications", store.notifications(
                    actor, "true".equalsIgnoreCase(query(exchange.getRequestURI(), "unreadOnly")))));
            return;
        }
        if (parts.size() == 3 && "notifications".equals(parts.get(1)) && "PATCH".equals(method)) {
            sendJson(exchange, 200, Map.of("notification", store.updateNotification(
                    actor, longPart(parts.get(2)), body(exchange))));
            return;
        }
        if (parts.size() == 3 && "reports".equals(parts.get(1))
                && "execute".equals(parts.get(2)) && "POST".equals(method)) {
            sendJson(exchange, 200, Map.of("report", store.executeReport(actor, body(exchange))));
            return;
        }
        if (parts.size() == 3 && "reports".equals(parts.get(1))
                && "types".equals(parts.get(2)) && "GET".equals(method)) {
            List<Map<String, Object>> types = store.reportTypes();
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("types", types);
            // Keep the original response key for older JiraFlow 2.0 clients.
            response.put("reportTypes", types);
            sendJson(exchange, 200, response);
            return;
        }
        if (parts.size() == 3 && "reports".equals(parts.get(1))
                && "templates".equals(parts.get(2)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("templates", store.reportTemplates(
                    actor,
                    query(exchange.getRequestURI(), "project"),
                    query(exchange.getRequestURI(), "q"))));
            return;
        }
        if (parts.size() == 3 && "reports".equals(parts.get(1))
                && "templates".equals(parts.get(2)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("template", store.createReportTemplate(actor, body(exchange))));
            return;
        }
        if (parts.size() == 4 && "reports".equals(parts.get(1))
                && "templates".equals(parts.get(2)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("template", store.reportTemplate(actor, longPart(parts.get(3)))));
            return;
        }
        if (parts.size() == 4 && "reports".equals(parts.get(1))
                && "templates".equals(parts.get(2))
                && ("PATCH".equals(method) || "DELETE".equals(method))) {
            long id = longPart(parts.get(3));
            if ("PATCH".equals(method)) {
                sendJson(exchange, 200, Map.of("template", store.updateReportTemplate(
                        actor, id, body(exchange))));
            } else {
                store.deleteReportTemplate(actor, id);
                sendJson(exchange, 200, Map.of("deleted", true));
            }
            return;
        }
        if (parts.size() == 2 && "reports".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("report", store.reports(
                    actor,
                    defaultedQuery(exchange.getRequestURI(), "project", "KTEST"),
                    query(exchange.getRequestURI(), "type"),
                    longQuery(exchange.getRequestURI(), "filterId", 0),
                    longQuery(exchange.getRequestURI(), "templateId", 0),
                    query(exchange.getRequestURI(), "jql"))));
            return;
        }
        // JiraFlow 2.0 aliases retained for clients that predate /api/reports/*.
        if (parts.size() == 2 && "report-types".equals(parts.get(1)) && "GET".equals(method)) {
            List<Map<String, Object>> types = store.reportTypes();
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("reportTypes", types);
            response.put("types", types);
            sendJson(exchange, 200, response);
            return;
        }
        if (parts.size() == 2 && "report-templates".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("templates", store.reportTemplates(
                    actor,
                    query(exchange.getRequestURI(), "project"),
                    query(exchange.getRequestURI(), "q"))));
            return;
        }
        if (parts.size() == 2 && "report-templates".equals(parts.get(1)) && "POST".equals(method)) {
            sendJson(exchange, 201, Map.of("template", store.createReportTemplate(actor, body(exchange))));
            return;
        }
        if (parts.size() == 3 && "report-templates".equals(parts.get(1))
                && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("template", store.reportTemplate(actor, longPart(parts.get(2)))));
            return;
        }
        if (parts.size() == 3 && "report-templates".equals(parts.get(1))
                && ("PATCH".equals(method) || "DELETE".equals(method))) {
            long id = longPart(parts.get(2));
            if ("PATCH".equals(method)) {
                sendJson(exchange, 200, Map.of("template", store.updateReportTemplate(
                        actor, id, body(exchange))));
            } else {
                store.deleteReportTemplate(actor, id);
                sendJson(exchange, 200, Map.of("deleted", true));
            }
            return;
        }
        if (parts.size() == 2 && "plugins".equals(parts.get(1)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("plugins", store.plugins()));
            return;
        }
        throw new ProblemException(404, "route_not_found", "Route not found");
    }

    private void handleRest(HttpExchange exchange, String method, String path) throws IOException {
        List<String> parts = segments(path);
        String actor = actor(exchange);
        if (parts.size() == 4 && "rest".equals(parts.get(0)) && "api".equals(parts.get(1))
                && "2".equals(parts.get(2)) && "myself".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.jiraMyself(actor));
            return;
        }
        if (parts.size() == 4 && "field".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.jiraFields());
            return;
        }
        if (parts.size() == 5 && "project".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.jiraProject(actor, parts.get(4)));
            return;
        }
        if (parts.size() == 6 && "project".equals(parts.get(3))
                && "components".equals(parts.get(5))
                && ("GET".equals(method) || "POST".equals(method))) {
            if ("GET".equals(method)) {
                sendJson(exchange, 200, store.jiraComponents(actor, parts.get(4)));
            } else {
                sendJson(exchange, 201, store.createJiraComponent(
                        actor, parts.get(4), body(exchange)));
            }
            return;
        }
        if (parts.size() == 5 && "component".equals(parts.get(3))
                && "GET".equals(method)) {
            sendJson(exchange, 200, store.jiraComponentById(actor, longPart(parts.get(4))));
            return;
        }
        if (parts.size() == 5 && "component".equals(parts.get(3))
                && ("PUT".equals(method) || "PATCH".equals(method))) {
            sendJson(exchange, 200, store.updateJiraComponent(
                    actor, longPart(parts.get(4)), body(exchange)));
            return;
        }
        if (parts.size() == 5 && "component".equals(parts.get(3))
                && "DELETE".equals(method)) {
            store.deleteJiraComponent(actor, longPart(parts.get(4)));
            sendJson(exchange, 204, Map.of());
            return;
        }
        if (parts.size() == 6 && "project".equals(parts.get(3))
                && "versions".equals(parts.get(5)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.versions(actor, parts.get(4)));
            return;
        }
        if (parts.size() == 6 && "project".equals(parts.get(3))
                && "versions".equals(parts.get(5)) && "POST".equals(method)) {
            sendJson(exchange, 201, store.createVersion(actor, parts.get(4), body(exchange)));
            return;
        }
        if (parts.size() == 4 && "search".equals(parts.get(3)) && "GET".equals(method)) {
            Map<String, Object> result = store.search(
                    actor,
                    query(exchange.getRequestURI(), "project"),
                    query(exchange.getRequestURI(), "jql"),
                    longQuery(exchange.getRequestURI(), "filterId", 0),
                    integerQuery(exchange.getRequestURI(), "startAt", 0),
                    integerQuery(exchange.getRequestURI(), "maxResults", 50));
            sendJson(exchange, 200, restSearch(actor, result));
            return;
        }
        if (parts.size() == 4 && "search".equals(parts.get(3)) && "POST".equals(method)) {
            Map<String, Object> request = body(exchange);
            Map<String, Object> result = store.search(
                    actor,
                    text(request, "project"),
                    text(request, "jql"),
                    Json.longValue(request.get("filterId"), 0),
                    (int) Json.longValue(request.get("startAt"), 0),
                    (int) Json.longValue(request.get("maxResults"), 50));
            sendJson(exchange, 200, restSearch(actor, result));
            return;
        }
        if (parts.size() == 5 && "issue".equals(parts.get(3)) && "GET".equals(method)) {
            sendJson(exchange, 200, store.jiraIssue(actor, parts.get(4)));
            return;
        }
        if (parts.size() == 4 && "issue".equals(parts.get(3))
                && "POST".equals(method)) {
            sendJson(exchange, 201, store.createJiraIssue(actor, body(exchange)));
            return;
        }
        if (parts.size() == 5 && "issue".equals(parts.get(3))
                && "POST".equals(method)) {
            throw new ProblemException(405, "method_not_allowed", "POST requires /rest/api/2/issue");
        }
        if (parts.size() == 5 && "issue".equals(parts.get(3))
                && ("PUT".equals(method) || "PATCH".equals(method))) {
            sendJson(exchange, 200, store.updateJiraIssue(actor, parts.get(4), body(exchange)));
            return;
        }
        if (parts.size() == 5 && "issue".equals(parts.get(3)) && "DELETE".equals(method)) {
            store.deleteIssue(actor, parts.get(4));
            sendJson(exchange, 204, Map.of());
            return;
        }
        if (parts.size() == 6 && "issue".equals(parts.get(3))
                && "comment".equals(parts.get(5)) && "POST".equals(method)) {
            store.addJiraComment(actor, parts.get(4), body(exchange));
            sendJson(exchange, 201, store.jiraIssue(actor, parts.get(4)));
            return;
        }
        if (parts.size() == 6 && "issue".equals(parts.get(3))
                && "comment".equals(parts.get(5)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of(
                    "startAt", 0,
                    "maxResults", 100,
                    "total", store.comments(actor, parts.get(4)).size(),
                    "comments", store.comments(actor, parts.get(4))));
            return;
        }
        if (parts.size() == 6 && "issue".equals(parts.get(3))
                && "worklog".equals(parts.get(5)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("worklogs", store.worklogs(actor, parts.get(4))));
            return;
        }
        if (parts.size() == 6 && "issue".equals(parts.get(3))
                && "worklog".equals(parts.get(5)) && "POST".equals(method)) {
            sendJson(exchange, 201, store.addWorklog(actor, parts.get(4), body(exchange)));
            return;
        }
        if (parts.size() == 6 && "issue".equals(parts.get(3))
                && "watchers".equals(parts.get(5))
                && ("GET".equals(method) || "POST".equals(method) || "DELETE".equals(method))) {
            if ("GET".equals(method)) {
                Map<String, Object> issue = store.issue(parts.get(4), actor);
                Object watchers = issue.get("watchers");
                sendJson(exchange, 200, watchers == null ? List.of() : watchers);
            } else {
                String username = text(body(exchange), "username");
                if (username.isBlank()) username = actor;
                Map<String, Object> issue = store.issue(parts.get(4), actor);
                @SuppressWarnings("unchecked")
                List<String> current = new ArrayList<>((List<String>) issue.getOrDefault("watchers", List.of()));
                boolean enabled = "POST".equals(method);
                if (enabled && !current.contains(username)) current.add(username);
                if (!enabled) current.remove(username);
                store.setWatcher(actor, parts.get(4), username, enabled);
                sendJson(exchange, 200, current);
            }
            return;
        }
        if (parts.size() == 6 && "issue".equals(parts.get(3))
                && "votes".equals(parts.get(5))
                && ("GET".equals(method) || "POST".equals(method) || "DELETE".equals(method))) {
            Map<String, Object> issue = store.issue(parts.get(4), actor);
            if (!"GET".equals(method)) {
                boolean enabled = "POST".equals(method);
                store.vote(actor, parts.get(4), enabled);
                issue = store.issue(parts.get(4), actor);
            }
            sendJson(exchange, 200, Map.of(
                    "votes", ((List<?>) issue.getOrDefault("voters", List.of())).size(),
                    "voters", issue.getOrDefault("voters", List.of())));
            return;
        }
        if (parts.size() == 6 && "issue".equals(parts.get(3))
                && "transitions".equals(parts.get(5)) && "GET".equals(method)) {
            sendJson(exchange, 200, Map.of("transitions", store.jiraTransitions(actor, parts.get(4))));
            return;
        }
        if (parts.size() == 6 && "issue".equals(parts.get(3))
                && "transitions".equals(parts.get(5)) && "POST".equals(method)) {
            sendJson(exchange, 200, store.jiraTransition(actor, parts.get(4), body(exchange)));
            return;
        }
        throw new ProblemException(404, "route_not_found", "REST route not found");
    }

    private Map<String, Object> restSearch(String actor, Map<String, Object> result) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("startAt", result.get("startAt"));
        response.put("maxResults", result.get("maxResults"));
        response.put("total", result.get("total"));
        List<Map<String, Object>> jiraIssues = new ArrayList<>();
        Object rawIssues = result.get("issues");
        if (rawIssues instanceof Iterable<?> items) {
            for (Object item : items) {
                if (item instanceof Map<?, ?> map && map.get("key") != null) {
                    jiraIssues.add(store.jiraIssue(actor, String.valueOf(map.get("key"))));
                }
            }
        }
        response.put("issues", jiraIssues);
        return response;
    }

    private void serveStatic(HttpExchange exchange, String path) throws IOException {
        if (!"GET".equalsIgnoreCase(exchange.getRequestMethod())) {
            throw new ProblemException(405, "method_not_allowed", "Method not allowed");
        }
        String clean = path == null || path.isBlank() || "/".equals(path) ? "/index.html" : path;
        if (clean.contains("..")) throw new ProblemException(400, "invalid_path", "Invalid path");
        String resource = "/static" + clean;
        try (InputStream input = JiraFlowServer.class.getResourceAsStream(resource)) {
            if (input == null) throw new ProblemException(404, "not_found", "Not found");
            byte[] data = input.readAllBytes();
            exchange.getResponseHeaders().set("Content-Type", contentType(resource));
            exchange.sendResponseHeaders(200, data.length);
            try (OutputStream output = exchange.getResponseBody()) {
                output.write(data);
            }
        }
    }

    private String actor(HttpExchange exchange) {
        String requested = exchange.getRequestHeaders().getFirst("X-JiraFlow-User");
        if (requested == null || requested.isBlank()) return boundActor;
        requested = requested.trim();
        if (!boundActor.equals(requested)) {
            throw new ProblemException(
                    401,
                    "actor_mismatch",
                    "The bearer token is bound to a different JiraFlow user");
        }
        return boundActor;
    }

    private static Map<String, Object> body(HttpExchange exchange) throws IOException {
        byte[] bytes = exchange.getRequestBody().readAllBytes();
        if (bytes.length == 0) return new LinkedHashMap<>();
        return Json.parseObject(new String(bytes, StandardCharsets.UTF_8));
    }

    private static void sendJson(HttpExchange exchange, int status, Object value) throws IOException {
        if (status == 204 || status == 304) {
            exchange.getResponseHeaders().remove("Content-Type");
            exchange.sendResponseHeaders(status, -1);
            exchange.close();
            return;
        }
        byte[] bytes = Json.stringify(value).getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
        exchange.sendResponseHeaders(status, bytes.length);
        try (OutputStream output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    private static List<String> segments(String path) {
        List<String> result = new ArrayList<>();
        for (String item : path.split("/")) {
            if (!item.isBlank()) result.add(URLDecoder.decode(item, StandardCharsets.UTF_8));
        }
        return result;
    }

    private static String query(URI uri, String name) {
        String raw = uri.getRawQuery();
        if (raw == null) return "";
        for (String pair : raw.split("&")) {
            String[] values = pair.split("=", 2);
            String key = URLDecoder.decode(values[0], StandardCharsets.UTF_8);
            if (name.equals(key)) return values.length == 1 ? "" : URLDecoder.decode(values[1], StandardCharsets.UTF_8);
        }
        return "";
    }

    private static int integerQuery(URI uri, String name, int fallback) {
        try {
            return Integer.parseInt(query(uri, name));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static long longQuery(URI uri, String name, long fallback) {
        try {
            return Long.parseLong(query(uri, name));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    private static String defaultedQuery(URI uri, String name, String fallback) {
        String value = query(uri, name);
        return value.isBlank() ? fallback : value;
    }

    private static long longPart(String value) {
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException error) {
            throw new ProblemException(400, "invalid_id", "Invalid numeric id");
        }
    }

    private static long expectedRevision(HttpExchange exchange, Map<String, Object> body) {
        long fromBody = Json.longValue(body.get("expectedRevision"), 0);
        if (fromBody > 0) return fromBody;
        String header = exchange.getRequestHeaders().getFirst("If-Match");
        if (header == null || header.isBlank()) return 0;
        return Json.longValue(header.replace("\"", ""), 0);
    }

    private static String text(Map<String, Object> body, String key) {
        Object value = body.get(key);
        return value == null ? "" : String.valueOf(value);
    }

    private static String defaulted(Map<String, Object> body, String key, String fallback) {
        String value = text(body, key).trim();
        return value.isBlank() ? fallback : value;
    }

    private static String contentType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".json")) return "application/json; charset=utf-8";
        return "text/html; charset=utf-8";
    }
}
