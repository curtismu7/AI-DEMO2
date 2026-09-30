package com.pingidentity.demo.rar;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Set;

/** Small dependency-free executable tests for the RAR policy. */
public final class AiAgentAuthorizationDetailPolicyTest {
    private static final Map<String, Object> USER_INFO = Map.of(
            "user_id", "demouser",
            "account_ids", List.of("checking-100", "savings-200"),
            "transaction_limit", new BigDecimal("500.00"),
            "currency", "USD");

    private static Map<String, Object> validTransferDetail() {
        return Map.of(
                "type", "banking_transaction",
                "user_id", "demouser",
                "actions", List.of("transfer"),
                "source_account", "checking-100",
                "destination_account", "savings-200",
                "amount", new BigDecimal("125.00"),
                "currency", "USD");
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    public static void main(String[] args) {
        check(AiAgentAuthorizationDetailPolicy.validate(validTransferDetail(), "demouser",
                Set.of("transactions:write"), USER_INFO).isValid(),
                "valid transaction for current user should pass");

        Map<String, Object> otherUser = new java.util.HashMap<>(validTransferDetail());
        otherUser.put("user_id", "another-user");
        check(!AiAgentAuthorizationDetailPolicy.validate(otherUser, "demouser",
                Set.of("transactions:write"), USER_INFO).isValid(),
                "different user must be rejected");

        Map<String, Object> unknownField = new java.util.HashMap<>(validTransferDetail());
        unknownField.put("override_policy", true);
        check(!AiAgentAuthorizationDetailPolicy.validate(unknownField, "demouser",
                Set.of("transactions:write"), USER_INFO).isValid(),
                "unknown field must be rejected");

        Map<String, Object> noWriteScope = new java.util.HashMap<>(validTransferDetail());
        check(!AiAgentAuthorizationDetailPolicy.validate(noWriteScope, "demouser",
                Set.of("accounts:read"), USER_INFO).isValid(),
                "transfer requires write scope");

        Map<String, Object> outsideAccount = new java.util.HashMap<>(validTransferDetail());
        outsideAccount.put("source_account", "checking-999");
        check(!AiAgentAuthorizationDetailPolicy.validate(outsideAccount, "demouser",
                Set.of("transactions:write"), USER_INFO).isValid(),
                "unmapped account must be rejected");

        Map<String, Object> overLimit = new java.util.HashMap<>(validTransferDetail());
        overLimit.put("amount", new BigDecimal("500.01"));
        check(!AiAgentAuthorizationDetailPolicy.validate(overLimit, "demouser",
                Set.of("transactions:write"), USER_INFO).isValid(),
                "amount above mapped limit must be rejected");

        Map<String, Object> smallerTransfer = new java.util.HashMap<>(validTransferDetail());
        smallerTransfer.put("amount", new BigDecimal("100.00"));
        check(AiAgentAuthorizationDetailPolicy.isEqualOrSubset(smallerTransfer, validTransferDetail(),
                "demouser", Set.of("transactions:write"), USER_INFO),
                "smaller same-account transfer should be an accepted subset");
        check(!AiAgentAuthorizationDetailPolicy.isEqualOrSubset(validTransferDetail(), smallerTransfer,
                "demouser", Set.of("transactions:write"), USER_INFO),
                "larger transfer must not be a subset of smaller accepted transfer");

        System.out.println("PF AI Agent RAR policy tests passed");
    }
}
