package com.pingidentity.demo.ciba;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pingidentity.sdk.GuiConfigDescriptor;
import com.pingidentity.sdk.PluginDescriptor;
import com.pingidentity.sdk.oobauth.OOBAuthGeneralException;
import com.pingidentity.sdk.oobauth.OOBAuthPlugin;
import com.pingidentity.sdk.oobauth.OOBAuthRequestContext;
import com.pingidentity.sdk.oobauth.OOBAuthResultContext;
import com.pingidentity.sdk.oobauth.OOBAuthTransactionContext;
import com.pingidentity.sdk.oobauth.UnknownUserException;
import com.pingidentity.sdk.oobauth.UserAuthBindingMessageException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
// The generic PF ConfigurablePlugin interface retains this historical type name.
import org.sourceid.saml20.adapter.conf.Configuration;
import org.sourceid.saml20.adapter.conf.Field;
import org.sourceid.saml20.adapter.gui.TextFieldDescriptor;

/**
 * Demo-only stand-in for the PingOne MFA CIBA authenticator: instead of pushing to a phone, it registers the
 * approval request with the demo BFF and asks the BFF for the answer. A person approves or denies on the demo
 * page. PingFederate still runs the whole CIBA protocol (auth_req_id, polling, tokens); only the approval
 * channel differs. It proves the PingFederate flow, not PingOne MFA.
 */
public final class AiAgentWebApproverAuthenticator implements OOBAuthPlugin {
    private static final String VERSION = "1.0.0";
    private static final String FIELD_URL = "Approval URL";
    private static final String FIELD_CREDENTIAL = "Approval Credential";
    private static final Log LOG = LogFactory.getLog(AiAgentWebApproverAuthenticator.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final HttpClient HTTP = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();

    private String approvalUrl = "";
    private String credential = "";

    @Override
    public void configure(Configuration configuration) {
        approvalUrl = stripTrailingSlash(fieldValue(configuration, FIELD_URL));
        credential = fieldValue(configuration, FIELD_CREDENTIAL);
    }

    @Override
    public PluginDescriptor getPluginDescriptor() {
        GuiConfigDescriptor gui = new GuiConfigDescriptor();
        gui.addField(new TextFieldDescriptor(FIELD_URL,
                "HTTPS base URL of the demo BFF's web-approver endpoints, for example"
                        + " https://demo-api-server:3001/api/pf-ai-agent/ciba/web-approver"));
        gui.addField(new TextFieldDescriptor(FIELD_CREDENTIAL,
                "Sent as a bearer credential on every call to the Approval URL.", true));
        PluginDescriptor descriptor = new PluginDescriptor("AI Demo web approver (CIBA stand-in)", this, gui, VERSION);
        descriptor.setAttributeContractSet(Set.of("subject"));
        return descriptor;
    }

    @Override
    public OOBAuthTransactionContext initiate(OOBAuthRequestContext request, Map<String, Object> inParameters)
            throws UnknownUserException, UserAuthBindingMessageException, OOBAuthGeneralException {
        String subject = request.getUserAttributes() == null ? null : request.getUserAttributes().getSingleValue("subject");
        if (subject == null || subject.isBlank()) throw new UnknownUserException("no subject in the CIBA request");
        String transactionId = UUID.randomUUID().toString();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("transactionId", transactionId);
        body.put("subject", subject);
        body.put("bindingMessage", request.getUserAuthBindingMessage());
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(approvalUrl + "/requests"))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString(toJson(body))));
        if (response.statusCode() != 200) {
            LOG.warn("web approver registration returned HTTP " + response.statusCode());
            throw new OOBAuthGeneralException("the approval service did not accept the request");
        }
        OOBAuthTransactionContext context = new OOBAuthTransactionContext();
        context.setTransactionIdentifier(transactionId);
        return context;
    }

    @Override
    public OOBAuthResultContext check(String transactionId, Map<String, Object> inParameters)
            throws OOBAuthGeneralException {
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(
                approvalUrl + "/requests/" + URLEncoder.encode(transactionId, StandardCharsets.UTF_8))).GET());
        OOBAuthResultContext result = new OOBAuthResultContext();
        if (response.statusCode() == 404) {
            result.setStatus(OOBAuthResultContext.Status.FAILURE);
            result.setStatusMessage("the approval request is unknown");
            return result;
        }
        if (response.statusCode() != 200) throw new OOBAuthGeneralException("the approval service is unavailable");
        String status;
        try {
            Map<String, Object> answer = JSON.readValue(response.body(), new TypeReference<Map<String, Object>>() { });
            status = String.valueOf(answer.get("status"));
        } catch (Exception exception) {
            throw new OOBAuthGeneralException("the approval service answered with something unreadable", exception);
        }
        switch (ApprovalStatus.of(status)) {
            case SUCCESS:
                result.setStatus(OOBAuthResultContext.Status.SUCCESS);
                result.setApprovedScope(Set.of("openid"));
                break;
            case FAILURE:
                result.setStatus(OOBAuthResultContext.Status.FAILURE);
                result.setStatusMessage("the request was " + status);
                break;
            default:
                result.setStatus(OOBAuthResultContext.Status.IN_PROGRESS);
        }
        return result;
    }

    @Override
    public void finished(String transactionId) {
        // The BFF expires its own entries; nothing to clean up here.
    }

    private HttpResponse<String> send(HttpRequest.Builder builder) throws OOBAuthGeneralException {
        try {
            return HTTP.send(builder
                    .header("Authorization", "Bearer " + credential)
                    .header("Accept", "application/json")
                    .timeout(Duration.ofSeconds(5))
                    .build(), HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new OOBAuthGeneralException("interrupted calling the approval service", exception);
        } catch (Exception exception) {
            LOG.warn("web approver call failed: " + exception.getClass().getSimpleName());
            throw new OOBAuthGeneralException("could not reach the approval service", exception);
        }
    }

    private static String toJson(Map<String, Object> body) throws OOBAuthGeneralException {
        try {
            return JSON.writeValueAsString(body);
        } catch (Exception exception) {
            throw new OOBAuthGeneralException(exception);
        }
    }

    private static String stripTrailingSlash(String value) {
        return value.endsWith("/") ? value.substring(0, value.length() - 1) : value;
    }

    private static String fieldValue(Configuration configuration, String name) {
        Field field = configuration == null ? null : configuration.getField(name);
        return field == null || field.getValue() == null ? "" : field.getValue().trim();
    }
}
