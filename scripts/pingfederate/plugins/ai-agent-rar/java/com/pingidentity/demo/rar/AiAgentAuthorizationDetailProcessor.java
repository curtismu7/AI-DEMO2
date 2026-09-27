package com.pingidentity.demo.rar;

import com.pingidentity.sdk.GuiConfigDescriptor;
import com.pingidentity.sdk.PluginDescriptor;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetail;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailContext;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailProcessingException;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailProcessor;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailProcessorDescriptor;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailValidationResult;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;
// The generic PF ConfigurablePlugin interface retains this historical type name;
// this adapter only implements the OAuth authorization-details processor API.
import org.sourceid.saml20.adapter.conf.Configuration;

/** PingFederate SDK adapter for the demo banking_transaction authorization detail. */
public final class AiAgentAuthorizationDetailProcessor implements AuthorizationDetailProcessor {
    private static final String VERSION = "1.0.0";

    @Override
    public void configure(Configuration configuration) {
        // The demo policy reads its per-user limits from the authenticated user mapping.
    }

    @Override
    public PluginDescriptor getPluginDescriptor() {
        AuthorizationDetailProcessorDescriptor descriptor = new AuthorizationDetailProcessorDescriptor(
                "AI Demo banking_transaction processor", this, new GuiConfigDescriptor(), VERSION);
        descriptor.setSupportedAuthorizationDetailTypes(Set.of(AiAgentAuthorizationDetailPolicy.DETAIL_TYPE));
        return descriptor;
    }

    @Override
    public AuthorizationDetailValidationResult validate(
            AuthorizationDetail authorizationDetail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) {
        AiAgentAuthorizationDetailPolicy.ValidationResult result = check(authorizationDetail, context, inParameters);
        return result.isValid()
                ? AuthorizationDetailValidationResult.createValidResult()
                : AuthorizationDetailValidationResult.createInvalidResult(result.reason());
    }

    @Override
    public AuthorizationDetail enrich(
            AuthorizationDetail authorizationDetail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) throws AuthorizationDetailProcessingException {
        AiAgentAuthorizationDetailPolicy.ValidationResult result = check(authorizationDetail, context, inParameters);
        if (!result.isValid()) throw new AuthorizationDetailProcessingException(result.reason());
        return new AuthorizationDetail(authorizationDetail);
    }

    @Override
    public String getUserConsentDescription(
            AuthorizationDetail authorizationDetail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) throws AuthorizationDetailProcessingException {
        AiAgentAuthorizationDetailPolicy.ValidationResult result = check(authorizationDetail, context, inParameters);
        if (!result.isValid()) throw new AuthorizationDetailProcessingException(result.reason());
        Map<String, Object> detail = authorizationDetail.getDetail();
        BigDecimal amount = AiAgentAuthorizationDetailPolicy.amount(detail);
        return "Allow a " + detail.get("currency") + " " + amount.toPlainString()
                + " transfer from " + detail.get("source_account")
                + " to " + detail.get("destination_account") + "?";
    }

    @Override
    public boolean isEqualOrSubset(
            AuthorizationDetail requestedAuthorizationDetail,
            AuthorizationDetail acceptedAuthorizationDetail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) {
        if (!hasRequiredContext(context)) return false;
        return AiAgentAuthorizationDetailPolicy.isEqualOrSubset(
                requestedAuthorizationDetail.getDetail(),
                acceptedAuthorizationDetail.getDetail(),
                context.getUserKey(),
                context.getScope(),
                mappedUserInfo(inParameters));
    }

    private AiAgentAuthorizationDetailPolicy.ValidationResult check(
            AuthorizationDetail detail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) {
        if (detail == null || !hasRequiredContext(context)) {
            return new AiAgentAuthorizationDetailPolicy.ValidationResult(false,
                    "authenticated transaction context is unavailable");
        }
        return AiAgentAuthorizationDetailPolicy.validate(
                detail.getDetail(), context.getUserKey(), context.getScope(), mappedUserInfo(inParameters));
    }

    private static boolean hasRequiredContext(AuthorizationDetailContext context) {
        return context != null && context.getUserKey() != null && !context.getUserKey().isBlank()
                && context.getClientId() != null && !context.getClientId().isBlank()
                && context.getScope() != null;
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mappedUserInfo(Map<String, Object> inParameters) {
        if (inParameters == null) return null;
        Object candidate = inParameters.get(AuthorizationDetailProcessor.IN_PARAMETER_AUTH_DETAILS_USER_INFO);
        return candidate instanceof Map<?, ?> ? (Map<String, Object>) candidate : null;
    }
}
