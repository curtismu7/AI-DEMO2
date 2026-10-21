import { Link } from "react-router-dom";
import { PERSONAL_AGENT_CLIENTS } from "../../config/personalAgentClients";
import "./PersonalAgentClientCards.css";

function launchExternal(url) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function ClientAction({ client }) {
  if (client.externalUrl) {
    return (
      <button
        type="button"
        className="personal-agent-client-cards__action"
        onClick={() => launchExternal(client.externalUrl)}
      >
        {client.actionLabel}
      </button>
    );
  }

  return (
    <Link className="personal-agent-client-cards__action personal-agent-client-cards__action--link" to={client.setupPath}>
      {client.actionLabel}
    </Link>
  );
}
/**
 * variant="dock": one slim row (client, kind, action) for layouts that keep setup one click away
 * but do not give it a page section. The default is the full set of cards.
 */
function ClientDock() {
  const KIND_LABEL = { browser: "Browser", mac: "Mac", hosted: "Hosted" };
  return (
    <section className="personal-agent-client-dock" aria-label="Personal agent clients">
      <span className="personal-agent-client-dock__label">Connect a client</span>
      {PERSONAL_AGENT_CLIENTS.map((client) => (
        <div className="personal-agent-client-dock__chip" key={client.id}>
          <small>{KIND_LABEL[client.kind] || client.kind}</small>
          <strong>{client.label}</strong>
          <ClientAction client={client} />
        </div>
      ))}
    </section>
  );
}

export default function PersonalAgentClientCards({ variant = "cards" }) {
  if (variant === "dock") return <ClientDock />;
  const groups = [
    {
      label: "Browser personal agent",
      clients: PERSONAL_AGENT_CLIENTS.filter((client) => client.kind === "browser"),
    },
    {
      label: "Mac personal agent",
      clients: PERSONAL_AGENT_CLIENTS.filter((client) => client.kind === "mac"),
    },
    {
      label: "Hosted always-on agent",
      clients: PERSONAL_AGENT_CLIENTS.filter((client) => client.kind === "hosted"),
    },
  ];

  return (
    <section className="personal-agent-client-cards" aria-label="Personal agent clients">
      <div className="personal-agent-client-cards__heading">
        <div>
          <p className="personal-agent-client-cards__eyebrow">Choose the client boundary</p>
          <h2>Personal agent clients</h2>
        </div>
        <p className="personal-agent-client-cards__lede">
          The client owns the conversation. Ping owns identity, consent, policy, and protected tools.
        </p>
      </div>

      <div className="personal-agent-client-cards__groups">
        {groups.map((group) => (
          <div className="personal-agent-client-cards__group" key={group.label}>
            <h3>{group.label}</h3>
            <div className="personal-agent-client-cards__grid">
              {group.clients.map((client) => (
                <article className="personal-agent-client-cards__card" key={client.id}>
                  <div className="personal-agent-client-cards__card-heading">
                    <div>
                      <h4>{client.label}</h4>
                      <p>{client.runtime}</p>
                    </div>
                    <span className="personal-agent-client-cards__status">
                      {client.kind === "browser" ? "External" : client.kind === "hosted" ? "Hosted" : "Local"}
                    </span>
                  </div>
                  <p className="personal-agent-client-cards__description">{client.description}</p>
                  <div className="personal-agent-client-cards__chips" aria-label={`${client.label} controls`}>
                    {client.chips.map((chip) => <span key={chip}>{chip}</span>)}
                  </div>
                  <ClientAction client={client} />
                </article>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
