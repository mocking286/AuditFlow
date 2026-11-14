package com.jiraflow;

import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

final class Json {
    private Json() {}

    static String stringify(Object value) {
        if (value == null) return "null";
        if (value instanceof String || value instanceof Character) return quote(String.valueOf(value));
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map<?, ?> map) {
            StringBuilder out = new StringBuilder("{");
            boolean first = true;
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!first) out.append(',');
                first = false;
                out.append(quote(String.valueOf(entry.getKey()))).append(':').append(stringify(entry.getValue()));
            }
            return out.append('}').toString();
        }
        if (value instanceof Iterable<?> iterable) {
            StringBuilder out = new StringBuilder("[");
            boolean first = true;
            for (Object item : iterable) {
                if (!first) out.append(',');
                first = false;
                out.append(stringify(item));
            }
            return out.append(']').toString();
        }
        if (value.getClass().isArray()) {
            StringBuilder out = new StringBuilder("[");
            for (int i = 0; i < Array.getLength(value); i++) {
                if (i > 0) out.append(',');
                out.append(stringify(Array.get(value, i)));
            }
            return out.append(']').toString();
        }
        return quote(String.valueOf(value));
    }

    static String quote(String input) {
        StringBuilder out = new StringBuilder("\"");
        for (char c : input.toCharArray()) {
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\b' -> out.append("\\b");
                case '\f' -> out.append("\\f");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> {
                    if (c < 0x20) out.append(String.format("\\u%04x", (int) c));
                    else out.append(c);
                }
            }
        }
        return out.append('"').toString();
    }

    static Map<String, Object> parseObject(String input) {
        Object value = parse(input);
        if (!(value instanceof Map<?, ?> map)) throw new ProblemException(400, "invalid_json", "JSON object required");
        Map<String, Object> result = new LinkedHashMap<>();
        map.forEach((key, item) -> result.put(String.valueOf(key), item));
        return result;
    }

    static Object parse(String input) {
        Parser parser = new Parser(input == null ? "" : input);
        Object value = parser.value();
        parser.skipWhitespace();
        if (!parser.atEnd()) throw new ProblemException(400, "invalid_json", "Unexpected JSON content");
        return value;
    }

    static long longValue(Object value, long fallback) {
        if (value instanceof Number number) return number.longValue();
        try {
            return Long.parseLong(String.valueOf(value));
        } catch (Exception ignored) {
            return fallback;
        }
    }

    static boolean boolValue(Object value, boolean fallback) {
        if (value instanceof Boolean bool) return bool;
        if (value == null) return fallback;
        return Boolean.parseBoolean(String.valueOf(value));
    }

    static List<String> stringList(Object value) {
        List<String> result = new ArrayList<>();
        if (value instanceof Iterable<?> iterable) {
            for (Object item : iterable) result.add(String.valueOf(item));
        } else if (value != null && !String.valueOf(value).isBlank()) {
            for (String item : String.valueOf(value).split(",")) {
                if (!item.isBlank()) result.add(item.trim());
            }
        }
        return result;
    }

    private static final class Parser {
        private final String text;
        private int position;

        Parser(String text) {
            this.text = text.trim();
        }

        Object value() {
            skipWhitespace();
            if (atEnd()) return Map.of();
            char c = text.charAt(position);
            if (c == '{') return object();
            if (c == '[') return array();
            if (c == '"') return string();
            if (text.startsWith("true", position)) {
                position += 4;
                return true;
            }
            if (text.startsWith("false", position)) {
                position += 5;
                return false;
            }
            if (text.startsWith("null", position)) {
                position += 4;
                return null;
            }
            if (c == '-' || Character.isDigit(c)) return number();
            throw new ProblemException(400, "invalid_json", "Unexpected JSON token at position " + position);
        }

        Map<String, Object> object() {
            Map<String, Object> result = new LinkedHashMap<>();
            position++;
            skipWhitespace();
            if (consume('}')) return result;
            while (!atEnd()) {
                skipWhitespace();
                if (position >= text.length() || text.charAt(position) != '"') {
                    throw new ProblemException(400, "invalid_json", "Object key must be a string");
                }
                String key = string();
                skipWhitespace();
                require(':');
                result.put(key, value());
                skipWhitespace();
                if (consume('}')) return result;
                require(',');
            }
            throw new ProblemException(400, "invalid_json", "Unclosed JSON object");
        }

        List<Object> array() {
            List<Object> result = new ArrayList<>();
            position++;
            skipWhitespace();
            if (consume(']')) return result;
            while (!atEnd()) {
                result.add(value());
                skipWhitespace();
                if (consume(']')) return result;
                require(',');
                skipWhitespace();
            }
            throw new ProblemException(400, "invalid_json", "Unclosed JSON array");
        }

        String string() {
            require('"');
            StringBuilder result = new StringBuilder();
            while (!atEnd()) {
                char c = text.charAt(position++);
                if (c == '"') return result.toString();
                if (c != '\\') {
                    result.append(c);
                    continue;
                }
                if (atEnd()) throw new ProblemException(400, "invalid_json", "Unclosed JSON escape");
                char escaped = text.charAt(position++);
                switch (escaped) {
                    case '"' -> result.append('"');
                    case '\\' -> result.append('\\');
                    case '/' -> result.append('/');
                    case 'b' -> result.append('\b');
                    case 'f' -> result.append('\f');
                    case 'n' -> result.append('\n');
                    case 'r' -> result.append('\r');
                    case 't' -> result.append('\t');
                    case 'u' -> {
                        if (position + 4 > text.length()) {
                            throw new ProblemException(400, "invalid_json", "Invalid unicode escape");
                        }
                        String hex = text.substring(position, position + 4);
                        try {
                            result.append((char) Integer.parseInt(hex, 16));
                        } catch (NumberFormatException error) {
                            throw new ProblemException(400, "invalid_json", "Invalid unicode escape");
                        }
                        position += 4;
                    }
                    default -> throw new ProblemException(400, "invalid_json", "Invalid JSON escape");
                }
            }
            throw new ProblemException(400, "invalid_json", "Unclosed JSON string");
        }

        Number number() {
            int start = position;
            if (text.charAt(position) == '-') position++;
            while (!atEnd() && Character.isDigit(text.charAt(position))) position++;
            boolean decimal = false;
            if (!atEnd() && text.charAt(position) == '.') {
                decimal = true;
                position++;
                while (!atEnd() && Character.isDigit(text.charAt(position))) position++;
            }
            if (!atEnd() && (text.charAt(position) == 'e' || text.charAt(position) == 'E')) {
                decimal = true;
                position++;
                if (!atEnd() && (text.charAt(position) == '+' || text.charAt(position) == '-')) position++;
                while (!atEnd() && Character.isDigit(text.charAt(position))) position++;
            }
            String token = text.substring(start, position);
            try {
                return decimal ? Double.parseDouble(token) : Long.parseLong(token);
            } catch (NumberFormatException error) {
                throw new ProblemException(400, "invalid_json", "Invalid JSON number");
            }
        }

        void skipWhitespace() {
            while (!atEnd() && Character.isWhitespace(text.charAt(position))) position++;
        }

        boolean atEnd() {
            return position >= text.length();
        }

        boolean consume(char expected) {
            if (!atEnd() && text.charAt(position) == expected) {
                position++;
                return true;
            }
            return false;
        }

        void require(char expected) {
            if (!consume(expected)) {
                throw new ProblemException(400, "invalid_json", "Expected '" + expected + "' at position " + position);
            }
        }
    }
}
