package com.pingidentity.demo.rar;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pingidentity.sdk.GuiConfigDescriptor;
import com.pingidentity.sdk.PluginDescriptor;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetail;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailContext;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailProcessingException;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailProcessor;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailProcessorDescriptor;
import com.pingidentity.sdk.authorizationdetails.AuthorizationDetailValidationResult;
import java.math.BigDecimal;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.Set;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.sourceid.saml20.adapter.attribute.AttributeValue;
// The generic PF ConfigurablePlugin interface retains this historical type name;
// this adapter only implements the OAuth authorization-details processor API.
import org.sourceid.saml20.adapter.conf.Configuration;
import org.sourceid.saml20.adapter.conf.Field;
import org.sourceid.saml20.adapter.gui.TextFieldDescriptor;

/**
 * PingFederate SDK adapter for the demo banking_transaction authorization detail.
 *
 * What PingFederate 13.1 supplies, observed on a live run: validate() at push
 * time and getUserConsentDescription() are called with no user at all; only
 * enrich(), after sign-in, carries one — as the sign-in adapter's "username"
 * attribute in the user-info map, never as the context's user key. So the
 * user-bound checks run in enrich(); the earlier calls check shape only.
 */
public final class AiAgentAuthorizationDetailProcessor implements AuthorizationDetailProcessor {
    private static final String VERSION = "1.1.0";
    private static final String FIELD_LIMITS_URL = "User Limits URL";
    private static final String FIELD_LIMITS_CREDENTIAL = "User Limits Credential";
    private static final Log LOG = LogFactory.getLog(AiAgentAuthorizationDetailProcessor.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    private String limitsUrl = "";
    private String limitsCredential = "";

    @Override
    public void configure(Configuration configuration) {
        limitsUrl = fieldValue(configuration, FIELD_LIMITS_URL);
        limitsCredential = fieldValue(configuration, FIELD_LIMITS_CREDENTIAL);
    }

    @Override
    public PluginDescriptor getPluginDescriptor() {
        GuiConfigDescriptor gui = new GuiConfigDescriptor();
        gui.addField(new TextFieldDescriptor(FIELD_LIMITS_URL,
                "HTTPS endpoint that returns the signed-in user's user_id, account_ids, transaction_limit and"
                        + " currency as JSON. Called with ?username=. Leave blank to read them from the"
                        + " sign-in attributes instead."));
        gui.addField(new TextFieldDescriptor(FIELD_LIMITS_CREDENTIAL,
                "Sent as a bearer credential to the User Limits URL.", true));
        AuthorizationDetailProcessorDescriptor descriptor = new AuthorizationDetailProcessorDescriptor(
                "AI Demo banking_transaction processor", this, gui, VERSION);
        descriptor.setSupportedAuthorizationDetailTypes(Set.of(AiAgentAuthorizationDetailPolicy.DETAIL_TYPE));
        return descriptor;
    }

    @Override
    public AuthorizationDetailValidationResult validate(
            AuthorizationDetail authorizationDetail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) {
        AiAgentAuthorizationDetailPolicy.ValidationResult result =
                checkWhatIsKnown(authorizationDetail, context, inParameters);
        return result.isValid()
                ? AuthorizationDetailValidationResult.createValidResult()
                : AuthorizationDetailValidationResult.createInvalidResult(result.reason());
    }

    @Override
    public AuthorizationDetail enrich(
            AuthorizationDetail authorizationDetail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) throws AuthorizationDetailProcessingException {
        // The decision point: no shape-only fallback here. Without a signed-in user this refuses.
        AiAgentAuthorizationDetailPolicy.ValidationResult result = check(authorizationDetail, context, inParameters);
        if (!result.isValid()) throw new AuthorizationDetailProcessingException(result.reason());
        return new AuthorizationDetail(authorizationDetail);
    }

    @Override
    public String getUserConsentDescription(
            AuthorizationDetail authorizationDetail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) throws AuthorizationDetailProcessingException {
        AiAgentAuthorizationDetailPolicy.ValidationResult result =
                checkWhatIsKnown(authorizationDetail, context, inParameters);
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
        String user = authenticatedUser(context, inParameters);
        if (user == null || context.getScope() == null) return false;
        return AiAgentAuthorizationDetailPolicy.isEqualOrSubset(
                requestedAuthorizationDetail.getDetail(),
                acceptedAuthorizationDetail.getDetail(),
                user,
                context.getScope(),
                userLimits(user, inParameters));
    }

    /** Full check when a user is signed in; shape only when PingFederate has not supplied one yet. */
    private AiAgentAuthorizationDetailPolicy.ValidationResult checkWhatIsKnown(
            AuthorizationDetail detail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) {
        if (detail != null && context != null && authenticatedUser(context, inParameters) == null) {
            return AiAgentAuthorizationDetailPolicy.validateShape(detail.getDetail(), context.getScope());
        }
        return check(detail, context, inParameters);
    }

    private AiAgentAuthorizationDetailPolicy.ValidationResult check(
            AuthorizationDetail detail,
            AuthorizationDetailContext context,
            Map<String, Object> inParameters) {
        String user = authenticatedUser(context, inParameters);
        if (detail == null || user == null || context.getClientId() == null || context.getClientId().isBlank()) {
            return new AiAgentAuthorizationDetailPolicy.ValidationResult(false,
                    "authenticated transaction context is unavailable");
        }
        return AiAgentAuthorizationDetailPolicy.validate(
                detail.getDetail(), user, context.getScope(), userLimits(user, inParameters));
    }

    private static String authenticatedUser(AuthorizationDetailContext context, Map<String, Object> inParameters) {
        if (context == null) return null;
        String user = context.getUserKey();
        if (user == null || user.isBlank()) {
            Map<String, Object> userInfo = mappedUserInfo(inParameters);
            Object username = userInfo == null ? null : userInfo.get("username");
            user = username instanceof AttributeValue value ? value.getValue()
                    : username instanceof String string ? string : null;
        }
        return user == null || user.isBlank() ? null : user;
    }

    /** The user's accounts, limit and currency: looked up live when a URL is configured. */
    private Map<String, Object> userLimits(String user, Map<String, Object> inParameters) {
        if (limitsUrl.isBlank()) return mappedUserInfo(inParameters);
        try {
            HttpResponse<String> response = HTTP.send(
                    HttpRequest.newBuilder(URI.create(
                                    limitsUrl + "?username=" + URLEncoder.encode(user, StandardCharsets.UTF_8)))
                            .header("Authorization", "Bearer " + limitsCredential)
                            .header("Accept", "application/json")
                            .timeout(Duration.ofSeconds(5))
                            .build(),
                    HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                LOG.warn("banking_transaction user limits lookup returned HTTP " + response.statusCode());
                return null;
            }
            return JSON.readValue(response.body(), new TypeReference<Map<String, Object>>() { });
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return null;
        } catch (Exception exception) {
            LOG.warn("banking_transaction user limits lookup failed: " + exception.getClass().getSimpleName());
            return null;
        }
    }

    private static String fieldValue(Configuration configuration, String name) {
        // An instance created before these fields existed has no entry for them.
        Field field = configuration == null ? null : configuration.getField(name);
        return field == null || field.getValue() == null ? "" : field.getValue().trim();
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> mappedUserInfo(Map<String, Object> inParameters) {
        if (inParameters == null) return null;
        Object candidate = inParameters.get(AuthorizationDetailProcessor.IN_PARAMETER_AUTH_DETAILS_USER_INFO);
        return candidate instanceof Map<?, ?> ? (Map<String, Object>) candidate : null;
    }
}
