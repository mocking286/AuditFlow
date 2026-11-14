package com.jiraflow;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

final class Jql {
    private static final Pattern ORDER_BY = Pattern.compile("(?is)\\s+ORDER\\s+BY\\s+(.+)$");
    private static final Set<String> CONDITION_FIELDS = Set.of(
            "project", "projectkey", "key", "issuekey", "status", "assignee", "reporter",
            "creator", "priority", "issuetype", "type", "summary", "text", "description",
            "labels", "component", "components", "fixversion", "fixversions", "affectsversion",
            "affectsversions", "resolution", "swimlane", "created", "updated");
    private static final Set<String> SORT_FIELDS = Set.of(
            "key", "summary", "priority", "status", "assignee", "reporter", "created",
            "createddate", "updated", "updateddate", "rank");

    private Jql() {}

    static Query parse(String expression, String currentUser) {
        String source = expression == null ? "" : expression.trim();
        Comparator<Issue> comparator = Comparator.comparingInt(issue -> issue.rank);
        Matcher order = ORDER_BY.matcher(source);
        if (order.find()) {
            comparator = sortComparator(order.group(1).trim());
            source = source.substring(0, order.start()).trim();
        }
        if (source.isBlank()) return new Query(issue -> true, comparator, "");
        Parser parser = new Parser(source, currentUser == null ? "testuser" : currentUser);
        Predicate<Issue> predicate = parser.expression();
        parser.expect(TokenType.END);
        return new Query(predicate, comparator, source);
    }

    static final class Query {
        final Predicate<Issue> predicate;
        final Comparator<Issue> comparator;
        final String normalized;

        Query(Predicate<Issue> predicate, Comparator<Issue> comparator, String normalized) {
            this.predicate = predicate;
            this.comparator = comparator;
            this.normalized = normalized;
        }
    }

    private static Comparator<Issue> sortComparator(String orderBy) {
        if (orderBy == null || orderBy.isBlank()) {
            throw new ProblemException(400, "invalid_jql", "ORDER BY requires at least one sort field");
        }
        Comparator<Issue> result = Comparator.comparingInt(issue -> issue.rank);
        boolean hasField = false;
        for (String clause : orderBy.split(",", -1)) {
            String[] parts = clause.trim().split("\\s+");
            if (parts.length == 0 || parts[0].isBlank() || parts.length > 2) {
                throw new ProblemException(400, "invalid_jql", "Invalid ORDER BY clause");
            }
            String field = parts[0].toLowerCase(Locale.ROOT);
            if (!SORT_FIELDS.contains(field)) {
                throw new ProblemException(400, "invalid_jql", "Unknown ORDER BY field: " + parts[0]);
            }
            if (parts.length == 2
                    && !"ASC".equalsIgnoreCase(parts[1])
                    && !"DESC".equalsIgnoreCase(parts[1])) {
                throw new ProblemException(400, "invalid_jql", "Sort direction must be ASC or DESC");
            }
            Comparator<Issue> next = Comparator.comparing(issue -> sortValue(issue, field));
            if (parts.length > 1 && "DESC".equalsIgnoreCase(parts[1])) next = next.reversed();
            result = hasField ? result.thenComparing(next) : next;
            hasField = true;
        }
        if (!hasField) throw new ProblemException(400, "invalid_jql", "ORDER BY requires at least one sort field");
        return result;
    }

    private static String sortValue(Issue issue, String field) {
        return switch (field.toLowerCase(Locale.ROOT)) {
            case "key" -> issue.key;
            case "summary" -> issue.summary;
            case "priority" -> String.format("%02d", priorityRank(issue.priority));
            case "status" -> issue.status;
            case "assignee" -> issue.assignee;
            case "reporter" -> issue.reporter;
            case "created", "createddate" -> issue.createdAt;
            case "updated", "updateddate" -> issue.updatedAt;
            case "rank" -> String.format("%09d", issue.rank);
            default -> throw new ProblemException(400, "invalid_jql", "Unknown ORDER BY field: " + field);
        };
    }

    private static List<String> values(Issue issue, String field) {
        validateConditionField(field);
        return switch (field.toLowerCase(Locale.ROOT)) {
            case "project", "projectkey" -> List.of(issue.projectKey);
            case "key", "issuekey" -> List.of(issue.key);
            case "status" -> List.of(issue.status, displayStatus(issue.status));
            case "assignee" -> List.of(issue.assignee);
            case "reporter" -> List.of(issue.reporter);
            case "creator" -> List.of(issue.creator);
            case "priority" -> List.of(issue.priority);
            case "issuetype", "type" -> List.of(issue.type);
            case "summary" -> List.of(issue.summary);
            case "text" -> List.of(issue.summary + " " + issue.description + " " + String.join(" ", issue.comments.stream().map(comment -> comment.body).toList()));
            case "description" -> List.of(issue.description);
            case "labels" -> new ArrayList<>(issue.labels);
            case "component", "components" -> new ArrayList<>(issue.components);
            case "fixversion", "fixversions" -> new ArrayList<>(issue.fixVersions);
            case "affectsversion", "affectsversions" -> new ArrayList<>(issue.affectsVersions);
            case "resolution" -> List.of(issue.resolution);
            case "swimlane" -> List.of(issue.swimlane);
            case "created" -> List.of(issue.createdAt);
            case "updated" -> List.of(issue.updatedAt);
            default -> throw new ProblemException(400, "invalid_jql", "Unknown JQL field: " + field);
        };
    }

    private static void validateConditionField(String field) {
        if (field == null || !CONDITION_FIELDS.contains(field.toLowerCase(Locale.ROOT))) {
            throw new ProblemException(400, "invalid_jql", "Unknown JQL field: " + field);
        }
    }

    private static boolean matches(Issue issue, String field, String operator, List<String> expected, String currentUser) {
        List<String> actual = values(issue, field);
        String normalizedOperator = operator.toUpperCase(Locale.ROOT);
        if (expected.isEmpty()) return false;
        if (isDateField(field) && isRelational(normalizedOperator)) {
            Instant actualTime = parseInstant(actual.get(0));
            Instant expectedTime = parseInstant(expected.get(0));
            if (actualTime != null && expectedTime != null) {
                int comparison = actualTime.compareTo(expectedTime);
                return switch (normalizedOperator) {
                    case ">" -> comparison > 0;
                    case ">=" -> comparison >= 0;
                    case "<" -> comparison < 0;
                    case "<=" -> comparison <= 0;
                    default -> comparison == 0;
                };
            }
        }
        if (isCurrentUser(expected.get(0))) expected = List.of(currentUser);
        if ("IN".equals(normalizedOperator) || "NOT IN".equals(normalizedOperator)) {
            boolean contains = expected.stream().anyMatch(candidate -> anyEquals(actual, candidate));
            return "IN".equals(normalizedOperator) ? contains : !contains;
        }
        return switch (normalizedOperator) {
            case "=" -> anyEquals(actual, expected.get(0));
            case "!=" -> !anyEquals(actual, expected.get(0));
            case "~" -> anyContains(actual, expected.get(0));
            case "!~" -> !anyContains(actual, expected.get(0));
            case ">" -> anyCompare(actual, expected.get(0)) > 0;
            case ">=" -> anyCompare(actual, expected.get(0)) >= 0;
            case "<" -> anyCompare(actual, expected.get(0)) < 0;
            case "<=" -> anyCompare(actual, expected.get(0)) <= 0;
            default -> false;
        };
    }

    private static boolean anyEquals(List<String> actual, String expected) {
        return actual.stream().anyMatch(value -> value.equalsIgnoreCase(stripQuotes(expected)));
    }

    private static boolean anyContains(List<String> actual, String expected) {
        String needle = stripQuotes(expected).toLowerCase(Locale.ROOT);
        return actual.stream().anyMatch(value -> value.toLowerCase(Locale.ROOT).contains(needle));
    }

    private static int anyCompare(List<String> actual, String expected) {
        String candidate = stripQuotes(expected);
        for (String value : actual) {
            try {
                int comparison = Double.compare(Double.parseDouble(value), Double.parseDouble(candidate));
                if (comparison != 0) return comparison;
            } catch (NumberFormatException ignored) {
                int comparison = value.compareToIgnoreCase(candidate);
                if (comparison != 0) return comparison;
            }
        }
        return 0;
    }

    private static boolean isCurrentUser(String value) {
        return value.equalsIgnoreCase("currentUser()") || value.equalsIgnoreCase("currentuser");
    }

    private static boolean isDateField(String field) {
        return "created".equalsIgnoreCase(field) || "updated".equalsIgnoreCase(field);
    }

    private static boolean isRelational(String operator) {
        return List.of(">", ">=", "<", "<=").contains(operator);
    }

    private static Instant parseInstant(String value) {
        String candidate = stripQuotes(value).trim();
        if (candidate.matches("-\\d+[hdwmy]")) {
            int amount = Integer.parseInt(candidate.substring(1, candidate.length() - 1));
            char unit = candidate.charAt(candidate.length() - 1);
            Duration duration = switch (unit) {
                case 'h' -> Duration.ofHours(amount);
                case 'd' -> Duration.ofDays(amount);
                case 'w' -> Duration.ofDays(amount * 7L);
                case 'm' -> Duration.ofDays(amount * 30L);
                case 'y' -> Duration.ofDays(amount * 365L);
                default -> Duration.ZERO;
            };
            return Instant.now().minus(duration);
        }
        try {
            return Instant.parse(candidate);
        } catch (DateTimeParseException ignored) {
            try {
                return LocalDate.parse(candidate).atStartOfDay(ZoneOffset.UTC).toInstant();
            } catch (DateTimeParseException ignoredAgain) {
                return null;
            }
        }
    }

    private static String stripQuotes(String value) {
        if (value == null) return "";
        String result = value.trim();
        if (result.length() >= 2 && result.startsWith("\"") && result.endsWith("\"")) {
            return result.substring(1, result.length() - 1);
        }
        return result;
    }

    private static String displayStatus(String status) {
        return switch (status) {
            case "TODO" -> "待开发";
            case "IN_PROGRESS" -> "处理中";
            case "DONE" -> "完成";
            default -> "Backlog";
        };
    }

    private static int priorityRank(String priority) {
        return switch (priority.toLowerCase(Locale.ROOT)) {
            case "highest", "blocker" -> 5;
            case "high", "major" -> 4;
            case "medium", "normal" -> 3;
            case "low", "minor" -> 2;
            case "lowest", "trivial" -> 1;
            default -> 0;
        };
    }

    private enum TokenType {
        WORD, STRING, OPERATOR, LEFT_PAREN, RIGHT_PAREN, COMMA, END
    }

    private record Token(TokenType type, String value) {}

    private static final class Lexer {
        private final String text;
        private int position;

        Lexer(String text) {
            this.text = text;
        }

        Token next() {
            while (position < text.length() && Character.isWhitespace(text.charAt(position))) position++;
            if (position >= text.length()) return new Token(TokenType.END, "");
            char c = text.charAt(position);
            if (c == '(') {
                position++;
                return new Token(TokenType.LEFT_PAREN, "(");
            }
            if (c == ')') {
                position++;
                return new Token(TokenType.RIGHT_PAREN, ")");
            }
            if (c == ',') {
                position++;
                return new Token(TokenType.COMMA, ",");
            }
            if (c == '"' || c == '\'') return new Token(TokenType.STRING, quoted(c));
            if ("=!~<>".indexOf(c) >= 0) {
                int start = position++;
                if (position < text.length() && (text.charAt(position) == '=' || text.charAt(position) == '~')) position++;
                return new Token(TokenType.OPERATOR, text.substring(start, position));
            }
            int start = position;
            while (position < text.length()) {
                char current = text.charAt(position);
                if (Character.isWhitespace(current) || "() ,=!~<>".indexOf(current) >= 0) break;
                position++;
            }
            return new Token(TokenType.WORD, text.substring(start, position));
        }

        private String quoted(char quote) {
            position++;
            StringBuilder value = new StringBuilder();
            while (position < text.length()) {
                char c = text.charAt(position++);
                if (c == quote) return value.toString();
                if (c == '\\' && position < text.length()) value.append(text.charAt(position++));
                else value.append(c);
            }
            throw new ProblemException(400, "invalid_jql", "Unclosed quoted value");
        }
    }

    private static final class Parser {
        private final Lexer lexer;
        private final String currentUser;
        private Token current;

        Parser(String text, String currentUser) {
            this.lexer = new Lexer(text);
            this.currentUser = currentUser;
            this.current = lexer.next();
        }

        Predicate<Issue> expression() {
            return or();
        }

        private Predicate<Issue> or() {
            Predicate<Issue> result = and();
            while (isWord("OR")) {
                advance();
                Predicate<Issue> right = and();
                result = result.or(right);
            }
            return result;
        }

        private Predicate<Issue> and() {
            Predicate<Issue> result = primary();
            while (isWord("AND")) {
                advance();
                Predicate<Issue> right = primary();
                result = result.and(right);
            }
            return result;
        }

        private Predicate<Issue> primary() {
            if (current.type == TokenType.LEFT_PAREN) {
                advance();
                Predicate<Issue> result = expression();
                require(TokenType.RIGHT_PAREN, ")");
                return result;
            }
            if (isWord("NOT")) {
                advance();
                return primary().negate();
            }
            return condition();
        }

        private Predicate<Issue> condition() {
            String field = requireValue("field");
            validateConditionField(field);
            String operator;
            if (isWord("NOT")) {
                advance();
                requireWord("IN");
                operator = "NOT IN";
            } else if (isWord("IN")) {
                advance();
                operator = "IN";
            } else {
                operator = requireOperator();
            }
            List<String> expected = "IN".equals(operator) || "NOT IN".equals(operator) ? valuesList() : List.of(value());
            return issue -> matches(issue, field, operator, expected, currentUser);
        }

        private List<String> valuesList() {
            List<String> result = new ArrayList<>();
            if (current.type == TokenType.LEFT_PAREN) {
                advance();
                while (current.type != TokenType.RIGHT_PAREN && current.type != TokenType.END) {
                    result.add(value());
                    if (current.type == TokenType.COMMA) advance();
                    else if (current.type != TokenType.RIGHT_PAREN) {
                        throw new ProblemException(400, "invalid_jql", "Expected comma in IN list");
                    }
                }
                require(TokenType.RIGHT_PAREN, ")");
            } else {
                result.add(value());
            }
            return result;
        }

        private String value() {
            if (current.type == TokenType.STRING) {
                String value = current.value;
                advance();
                return value;
            }
            String value = requireValue("value");
            if ("currentUser".equalsIgnoreCase(value) && current.type == TokenType.LEFT_PAREN) {
                advance();
                require(TokenType.RIGHT_PAREN, ")");
                return currentUser;
            }
            return value;
        }

        private String requireOperator() {
            if (current.type != TokenType.OPERATOR) {
                throw new ProblemException(400, "invalid_jql", "Expected comparison operator");
            }
            String value = current.value;
            advance();
            return value;
        }

        private String requireValue(String name) {
            if (current.type != TokenType.WORD && current.type != TokenType.STRING) {
                throw new ProblemException(400, "invalid_jql", "Expected " + name);
            }
            String value = current.value;
            advance();
            return value;
        }

        private void requireWord(String word) {
            if (!isWord(word)) throw new ProblemException(400, "invalid_jql", "Expected " + word);
            advance();
        }

        private void require(TokenType type, String label) {
            if (current.type != type) throw new ProblemException(400, "invalid_jql", "Expected " + label);
            advance();
        }

        private void expect(TokenType type) {
            if (current.type != type) throw new ProblemException(400, "invalid_jql", "Unexpected token " + current.value);
        }

        private boolean isWord(String value) {
            return current.type == TokenType.WORD && current.value.equalsIgnoreCase(value);
        }

        private void advance() {
            current = lexer.next();
        }
    }
}
