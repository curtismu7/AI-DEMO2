// demo_api_ui/src/components/GraphifyPage.jsx
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import HeroSection from './HeroSection';
import { HERO_VARIANTS } from '../config/heroVariants';
import { GRAPHIFY_DEMOS, GRAPHIFY_STATS } from './graphifyDemos';
import './GraphifyPage.css';

/**
 * Showcase SPA for Graphify — teaches agents-vs-grep with canned demos.
 * No live CLI; outputs are snapshots from graphify-out/.
 */
export default function GraphifyPage() {
  const [activeId, setActiveId] = useState(GRAPHIFY_DEMOS[0].id);
  const [copied, setCopied] = useState(false);
  const demo = GRAPHIFY_DEMOS.find((d) => d.id === activeId) || GRAPHIFY_DEMOS[0];
  const hero = HERO_VARIANTS.graphify;

  /** Copy the active demo command to the clipboard. */
  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(demo.command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="graphify-page">
      <HeroSection
        avatar="G"
        title="Graphify"
        description="Codebase knowledge graph — query, path, and explain before you grep."
        subtitle="Agent tooling showcase · offline canned demos"
        size="compact"
        backgroundColor={hero.backgroundColor}
        avatarSize="sm"
      />

      <div className="graphify-page__body">
        <p className="graphify-page__thesis">
          <strong>Agents don’t grep blindly</strong> — they traverse a graph,
          then open only the files the graph pointed at.
        </p>

        <div className="graphify-mode-banner" role="note">
          <strong>This page is a showcase, not a live tool.</strong>
          <p>
            Everything below — stats, demo commands, and outputs — is a
            snapshot from <code>graphify-out/</code>, computed ahead of time.
            There is no "Run" button here and no backend call. To run
            Graphify yourself, copy a command from "Try it" below and run it
            in a terminal at the repo root.
          </p>
        </div>

        <div className="graphify-stats" aria-label="Graph snapshot stats">
          <div className="graphify-stat">
            <span className="graphify-stat__value">{GRAPHIFY_STATS.nodes}</span>
            <span className="graphify-stat__label">Nodes</span>
          </div>
          <div className="graphify-stat">
            <span className="graphify-stat__value">{GRAPHIFY_STATS.edges}</span>
            <span className="graphify-stat__label">Edges</span>
          </div>
          <div className="graphify-stat">
            <span className="graphify-stat__value">{GRAPHIFY_STATS.communities}</span>
            <span className="graphify-stat__label">Communities</span>
          </div>
          <div className="graphify-stat">
            <span className="graphify-stat__value">{GRAPHIFY_STATS.extractedPct}</span>
            <span className="graphify-stat__label">EXTRACTED</span>
          </div>
          <div className="graphify-stat">
            <span className="graphify-stat__value">{GRAPHIFY_STATS.inferredPct}</span>
            <span className="graphify-stat__label">INFERRED</span>
          </div>
        </div>

        <section className="graphify-section">
          <h2>What it is</h2>
          <p>
            Graphify turns this repo into a persistent knowledge graph: symbols,
            files, docs, and communities, with honest edge labels (
            <code>EXTRACTED</code> from AST/imports vs <code>INFERRED</code>).
            Three verbs cover most agent work: <code>query</code> (BFS context),{' '}
            <code>path</code> (A→B), <code>explain</code> (one concept).
          </p>
          <table className="graphify-compare">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Question it answers</th>
                <th>Backing store</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><strong>Graphify</strong></td>
                <td>What’s related / how do A and B connect?</td>
                <td><code>graphify-out/graph.json</code></td>
              </tr>
              <tr>
                <td>
                  <Link to="/code-search">Code Search</Link>
                </td>
                <td>Find code <em>like</em> this meaning</td>
                <td>Weaviate vector ANN</td>
              </tr>
              <tr>
                <td>
                  <Link to="/code-explorer">Code Explorer</Link>
                </td>
                <td>Show source for X / callers</td>
                <td>Codegraph SQLite AST</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="graphify-section">
          <h2>Try it</h2>
          <p>
            Canned outputs from this repo’s graph — no backend. This tab
            doesn't run anything itself: click "Copy", paste the command into
            a terminal at the repo root, then press enter.
          </p>
          <div className="graphify-demos" role="tablist" aria-label="Graphify demos">
            {GRAPHIFY_DEMOS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="tab"
                aria-selected={d.id === activeId}
                className={`graphify-demo-btn${d.id === activeId ? ' graphify-demo-btn--active' : ''}`}
                onClick={() => setActiveId(d.id)}
              >
                {d.verb}
              </button>
            ))}
          </div>
          <div className="graphify-demo-card" role="tabpanel">
            <h3 className="graphify-demo-card__title">{demo.title}</h3>
            <p className="graphify-demo-card__teach">{demo.teaching}</p>
            <div className="graphify-cmd-row">
              <pre className="graphify-cmd">{demo.command}</pre>
              <button type="button" className="graphify-copy" onClick={handleCopy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <pre className="graphify-output">{demo.output}</pre>
          </div>
        </section>

        <section className="graphify-section">
          <h2>How agents use it here</h2>
          <pre className="graphify-flow">{`question
  → graphify query / path / explain
  → scoped nodes + edges
  → Read / Grep only those files
  → after edits: graphify update .`}</pre>
          <p>
            Cursor rule <code>.cursor/rules/graphify.mdc</code> and{' '}
            <code>CLAUDE.md</code> require this before broad exploration. Artifact
            lives at <code>graphify-out/</code> (AST update is free — no API cost).
          </p>
        </section>

        <section className="graphify-section">
          <h2>Related</h2>
          <div className="graphify-links">
            <Link className="graphify-link" to="/code-explorer">
              Code Explorer →
            </Link>
            <Link className="graphify-link" to="/code-search">
              Code Search →
            </Link>
          </div>
          <p className="graphify-note">
            Stats and demo snippets are a snapshot. Re-run{' '}
            <code>graphify update .</code> locally to refresh the live graph.
          </p>
        </section>
      </div>
    </div>
  );
}
