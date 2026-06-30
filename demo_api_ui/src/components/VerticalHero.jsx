import React from "react";
import { useVertical } from "../vertical/useVertical";
import { formatCurrency, formatDate, formatPercent } from "../utils/formatters";

function formatValue(value, format) {
  if (value === null || value === undefined) return "—";
  switch (format) {
    case "money":
      return formatCurrency(Number(value), "USD");
    case "count":
      return String(Math.round(Number(value)));
    case "date":
      return formatDate(value);
    case "percent":
      return formatPercent(Number(value), 2);
    case "text":
    default:
      return String(value);
  }
}

function resolveValue(dataKey, heroStats) {
  if (!heroStats) return undefined;
  const key = dataKey.startsWith("heroStats.") ? dataKey.slice("heroStats.".length) : dataKey;
  return heroStats[key];
}

export default function VerticalHero() {
  const { pageManifest, pageMockData } = useVertical();
  const dashboard = pageManifest?.dashboard;
  if (!dashboard?.hero?.cards) return null;

  const heroStats = pageMockData?.heroStats || {};

  return (
    <div className="vertical-hero">
      {dashboard.hero.cards.map((card) => (
        <div key={card.dataKey} className="vertical-hero-card">
          <span className="vertical-hero-label">{card.label}</span>
          <span className="vertical-hero-value">
            {formatValue(resolveValue(card.dataKey, heroStats), card.format)}
          </span>
        </div>
      ))}
    </div>
  );
}
