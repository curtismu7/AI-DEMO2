import React from "react";
import { useVertical } from "../vertical/useVertical";

function formatValue(value, format) {
  if (value === null || value === undefined) return "—";
  switch (format) {
    case "money":
      return "$" + Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "count":
      return String(Math.round(Number(value)));
    case "date":
      return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    case "percent": {
      const n = Number(value);
      if (Number.isNaN(n)) return String(value);
      return n.toFixed(2) + "%";
    }
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
