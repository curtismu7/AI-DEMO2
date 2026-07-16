/**
 * CitationPill — Interactive citation reference component
 *
 * Renders [K1]–[K50] references as styled, clickable pills.
 * On hover/click, shows a popover with the assertion's source and claim.
 *
 * Usage:
 *   import CitationPill from './CitationPill';
 *   <CitationPill id="K1" assertion={assertionObj} />
 *
 * Or use the full message renderer:
 *   import { CitedMessage } from './CitationPill';
 *   <CitedMessage text={message} domain="banking-domain" />
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { parseCitations, extractCitationIds, createCitationResolver } from '../utils/parseCitations';
import './CitationPill.css';

// ---------------------------------------------------------------------------
// Shared resolver instance (singleton across all CitedMessage components)
// ---------------------------------------------------------------------------

const resolver = createCitationResolver();

// ---------------------------------------------------------------------------
// CitationPill — Single citation badge
// ---------------------------------------------------------------------------

/**
 * @param {object} props
 * @param {string} props.id - Citation ID (e.g., 'K1')
 * @param {object|null} props.assertion - Resolved assertion object
 * @param {boolean} [props.loading] - Whether the assertion is still loading
 */
export function CitationPill({ id, assertion, loading = false }) {
  const [showPopover, setShowPopover] = useState(false);
  const pillRef = useRef(null);
  const timeoutRef = useRef(null);

  const handleMouseEnter = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setShowPopover(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => setShowPopover(false), 200);
  }, []);

  const handleClick = useCallback((e) => {
    e.stopPropagation();
    setShowPopover(prev => !prev);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <span
      ref={pillRef}
      className={`okf-citation-pill ${assertion ? 'resolved' : ''} ${loading ? 'loading' : ''}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      aria-label={`Citation ${id}${assertion ? `: ${assertion.source}` : ''}`}
      aria-expanded={showPopover}
    >
      <span className="okf-citation-pill__label">[{id}]</span>

      {showPopover && assertion && (
        <span
          className="okf-citation-popover"
          role="tooltip"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <span className="okf-citation-popover__header">
            <span className="okf-citation-popover__id">{id}</span>
            <span className="okf-citation-popover__source">{assertion.source}</span>
          </span>
          <span className="okf-citation-popover__claim">{assertion.claim}</span>
          {assertion.citations && assertion.citations.length > 0 && (
            <span className="okf-citation-popover__refs">
              {assertion.citations.map((c, i) => (
                <span key={i} className="okf-citation-popover__ref">
                  {c.uri ? (
                    <a href={c.uri} target="_blank" rel="noopener noreferrer">{c.ref}</a>
                  ) : (
                    c.ref
                  )}
                </span>
              ))}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// CitedMessage — Full message with inline citation pills
// ---------------------------------------------------------------------------

/**
 * Renders a message string with [Kn] references replaced by CitationPill components.
 *
 * @param {object} props
 * @param {string} props.text - The message text containing [Kn] references
 * @param {string} [props.domain='banking-domain'] - Domain for assertion resolution
 * @param {string} [props.className] - Additional CSS class for the wrapper
 */
export function CitedMessage({ text, domain = 'banking-domain', className = '' }) {
  const [assertions, setAssertions] = useState(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const ids = extractCitationIds(text);
    if (ids.length === 0) {
      setAssertions(new Map());
      return;
    }

    let cancelled = false;
    setLoading(true);

    resolver.resolveAll(domain, ids).then(result => {
      if (!cancelled) {
        setAssertions(result);
        setLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [text, domain]);

  const segments = parseCitations(text);

  return (
    <span className={`okf-cited-message ${className}`.trim()}>
      {segments.map((segment, i) => {
        if (segment.type === 'text') {
          return <span key={i}>{segment.content}</span>;
        }
        return (
          <CitationPill
            key={`${segment.id}-${i}`}
            id={segment.id}
            assertion={assertions.get(segment.id) || null}
            loading={loading && !assertions.has(segment.id)}
          />
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Citation Footer — Summary of all citations at bottom of message
// ---------------------------------------------------------------------------

/**
 * Renders a collapsible footer showing all citations referenced in a message.
 *
 * @param {object} props
 * @param {string} props.text - The message text
 * @param {string} [props.domain='banking-domain']
 */
export function CitationFooter({ text, domain = 'banking-domain' }) {
  const [assertions, setAssertions] = useState(new Map());
  const [expanded, setExpanded] = useState(false);

  const ids = extractCitationIds(text);

  useEffect(() => {
    if (ids.length === 0) return;

    let cancelled = false;
    resolver.resolveAll(domain, ids).then(result => {
      if (!cancelled) setAssertions(result);
    });
    return () => { cancelled = true; };
  }, [text, domain]);

  if (ids.length === 0) return null;

  return (
    <div className="okf-citation-footer">
      <button
        className="okf-citation-footer__toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span className="okf-citation-footer__icon">📚</span>
        <span className="okf-citation-footer__count">
          {ids.length} source{ids.length !== 1 ? 's' : ''}
        </span>
        <span className={`okf-citation-footer__chevron ${expanded ? 'expanded' : ''}`}>
          ▾
        </span>
      </button>

      {expanded && (
        <div className="okf-citation-footer__list">
          {ids.map(id => {
            const assertion = assertions.get(id);
            return (
              <div key={id} className="okf-citation-footer__item">
                <span className="okf-citation-footer__item-id">[{id}]</span>
                <span className="okf-citation-footer__item-text">
                  {assertion ? assertion.source : 'Loading...'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default CitationPill;
