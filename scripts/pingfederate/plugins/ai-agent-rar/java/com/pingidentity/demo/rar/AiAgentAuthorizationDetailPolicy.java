package com.pingidentity.demo.rar;

import java.math.BigDecimal;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Pure policy checks for the demo's banking_transaction RAR type. */
public final class AiAgentAuthorizationDetailPolicy {
    public static final String DETAIL_TYPE = "banking_transaction";
    public static final String REQUIRED_SCOPE = "transactions:write";

    private static final Set<String> ALLOWED_FIELDS = Set.of(
            "type", "user_id", "actions", "source_account", "destination_account", "amount", "currency");

    private AiAgentAuthorizationDetailPolicy() { }

    public record ValidationResult(boolean isValid, String reason) {
        static ValidationResult allow() { return new ValidationResult(true, ""); }
        static ValidationResult deny(String reason) { return new ValidationResult(false, reason); }
    }

    /**
     * Checks that need no user: what PingFederate can decide when the request is
     * pushed, before anyone has signed in.
     */
    public static ValidationResult validateShape(Map<String, Object> detail, Set<String> requestedScopes) {
        if (detail == null || requestedScopes == null) {
            return ValidationResult.deny("authorization detail or requested scope is unavailable");
        }
        if (!DETAIL_TYPE.equals(detail.get("type"))) {
            return ValidationResult.deny("unsupported authorization detail type");
        }
        if (!ALLOWED_FIELDS.equals(detail.keySet())) {
            return ValidationResult.deny("authorization detail contains missing or unsupported fields");
        }
        if (!requestedScopes.contains(REQUIRED_SCOPE)) {
            return ValidationResult.deny("transactions:write scope is required");
        }
        if (cleanString(detail.get("user_id")) == null) {
            return ValidationResult.deny("authorization detail user is missing");
        }
        List<String> actions = stringList(detail.get("actions"));
        if (actions == null || !actions.equals(List.of("transfer"))) {
            return ValidationResult.deny("only the transfer action is supported");
        }
        String sourceAccount = cleanString(detail.get("source_account"));
        String destinationAccount = cleanString(detail.get("destination_account"));
        if (sourceAccount == null || destinationAccount == null || sourceAccount.equals(destinationAccount)) {
            return ValidationResult.deny("transaction accounts are missing or identical");
        }
        BigDecimal amount = decimal(detail.get("amount"));
        if (amount == null || amount.signum() <= 0) {
            return ValidationResult.deny("transaction amount must be a positive number");
        }
        if (cleanString(detail.get("currency")) == null) {
            return ValidationResult.deny("transaction currency is missing");
        }
        return ValidationResult.allow();
    }

    public static ValidationResult validate(
            Map<String, Object> detail,
            String authenticatedUserKey,
            Set<String> requestedScopes,
            Map<String, Object> mappedUserInfo) {
        if (detail == null || authenticatedUserKey == null || authenticatedUserKey.isBlank()
                || requestedScopes == null || mappedUserInfo == null) {
            return ValidationResult.deny("authenticated transaction context is unavailable");
        }
        ValidationResult shape = validateShape(detail, requestedScopes);
        if (!shape.isValid()) return shape;

        String mappedUserId = cleanString(mappedUserInfo.get("user_id"));
        if (!authenticatedUserKey.equals(detail.get("user_id")) || !authenticatedUserKey.equals(mappedUserId)) {
            return ValidationResult.deny("authorization detail user does not match the authenticated user");
        }

        List<String> accountIds = stringList(mappedUserInfo.get("account_ids"));
        if (accountIds == null || !accountIds.contains(detail.get("source_account"))
                || !accountIds.contains(detail.get("destination_account"))) {
            return ValidationResult.deny("transaction accounts are not mapped to the authenticated user");
        }

        BigDecimal maximum = decimal(mappedUserInfo.get("transaction_limit"));
        if (maximum == null || decimal(detail.get("amount")).compareTo(maximum) > 0) {
            return ValidationResult.deny("transaction amount is outside the user's mapped limit");
        }

        if (!detail.get("currency").equals(cleanString(mappedUserInfo.get("currency")))) {
            return ValidationResult.deny("transaction currency does not match the user's mapped currency");
        }
        return ValidationResult.allow();
    }

    public static boolean isEqualOrSubset(
            Map<String, Object> requested,
            Map<String, Object> accepted,
            String authenticatedUserKey,
            Set<String> scopes,
            Map<String, Object> mappedUserInfo) {
        if (!validate(requested, authenticatedUserKey, scopes, mappedUserInfo).isValid()
                || !validate(accepted, authenticatedUserKey, scopes, mappedUserInfo).isValid()) {
            return false;
        }
        return sameDetail(requested, accepted);
    }

    /**
     * The same comparison for a call that carries no signed-in user: shape only. The
     * user-bound checks already ran in enrich, before the user was asked to consent, so
     * a request that failed them never reaches this point.
     */
    public static boolean isEqualOrSubset(
            Map<String, Object> requested,
            Map<String, Object> accepted,
            Set<String> scopes) {
        if (!validateShape(requested, scopes).isValid() || !validateShape(accepted, scopes).isValid()) {
            return false;
        }
        return sameDetail(requested, accepted);
    }

    private static boolean sameDetail(Map<String, Object> requested, Map<String, Object> accepted) {
        if (!sameString(requested, accepted, "type")
                || !sameString(requested, accepted, "user_id")
                || !sameString(requested, accepted, "source_account")
                || !sameString(requested, accepted, "destination_account")
                || !sameString(requested, accepted, "currency")) {
            return false;
        }
        List<String> requestedActions = stringList(requested.get("actions"));
        List<String> acceptedActions = stringList(accepted.get("actions"));
        if (requestedActions == null || acceptedActions == null
                || !new HashSet<>(acceptedActions).containsAll(requestedActions)) {
            return false;
        }
        BigDecimal requestedAmount = decimal(requested.get("amount"));
        BigDecimal acceptedAmount = decimal(accepted.get("amount"));
        return requestedAmount != null && acceptedAmount != null
                && requestedAmount.compareTo(acceptedAmount) <= 0;
    }

    public static BigDecimal amount(Map<String, Object> detail) {
        return detail == null ? null : decimal(detail.get("amount"));
    }

    private static boolean sameString(Map<String, Object> left, Map<String, Object> right, String key) {
        String a = cleanString(left.get(key));
        String b = cleanString(right.get(key));
        return a != null && a.equals(b);
    }

    private static String cleanString(Object value) {
        if (!(value instanceof String string) || string.isBlank() || !string.equals(string.trim())) return null;
        return string;
    }

    private static List<String> stringList(Object value) {
        if (!(value instanceof List<?> list) || list.isEmpty()) return null;
        java.util.ArrayList<String> result = new java.util.ArrayList<>(list.size());
        for (Object item : list) {
            String candidate = cleanString(item);
            if (candidate == null) return null;
            result.add(candidate);
        }
        return result;
    }

    private static BigDecimal decimal(Object value) {
        if (!(value instanceof Number number)) return null;
        try {
            BigDecimal result = new BigDecimal(number.toString());
            return result.scale() > 4 ? null : result;
        } catch (NumberFormatException exception) {
            return null;
        }
    }
}
