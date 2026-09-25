import React from 'react';
import TokenCard from './TokenCard';
import ProductCardGrid from './ProductCardGrid';
import SeatMapPanel from './SeatMapPanel';
import { formatValue } from '../utils/formatters';

function valueByPath(obj, path) {
  if (!obj || !path) return undefined;
  return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function renderRecordRows(data) {
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  if (rows.length === 0) return null;
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  if (columns.length === 0) return null;

  const total = Number.isFinite(data.totalCount) ? data.totalCount : rows.length;
  const label = ({
    listUsers: 'users',
    listApplications: 'applications',
    listPopulations: 'populations',
    listResources: 'resources',
    getEnvironmentServices: 'environment services',
    listDavinciFlows: 'DaVinci flows',
    listDavinciApplications: 'DaVinci applications',
    listDavinciConnectors: 'DaVinci connectors',
  })[data.tool] || 'results';
  const columnLabel = (key) => key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
  const cellValue = (value, key) => {
    if (value == null || value === '') return '—';
    if (typeof value === 'boolean') {
      return key === 'enabled' ? (value ? 'Enabled' : 'Disabled') : (value ? 'Yes' : 'No');
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };

  return (
    <section className="vertical-result-rows" aria-label="Tool results">
      <h4 className="vertical-result-rows__summary">Showing {rows.length} of {total} {label}</h4>
      {data.rowsTruncated ? (
        <p className="vertical-result-rows__note">This agent result includes a preview of the first {rows.length} rows.</p>
      ) : null}
      <div className="vertical-result-rows__table-wrap" style={{ overflowX: 'auto' }}>
        <table className="bar-rp-table vertical-result-rows__table">
          <thead>
            <tr>{columns.map((key) => <th key={key}>{columnLabel(key)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={row.id || row.username || row.name || rowIndex}>
                {columns.map((key) => <td key={key}>{cellValue(row?.[key], key)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function VerticalResult({ descriptor, data, onAction }) {
  // Token card(s) — decoded JWT view(s). data carries {header,payload,tokenType} (token)
  // or { t1, t2 } each of that shape (token-pair). No raw token string is present.
  if (descriptor && descriptor.type === 'token') {
    return (
      <div className="vertical-result vertical-result-token">
        {descriptor.title && <h3 className="vertical-result-title">{descriptor.title}</h3>}
        <TokenCard decoded={data} title="Token" />
      </div>
    );
  }
  if (descriptor && descriptor.type === 'token-pair') {
    return (
      <div className="vertical-result vertical-result-token-pair" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {descriptor.title && <h3 className="vertical-result-title" style={{ flexBasis: '100%' }}>{descriptor.title}</h3>}
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          <TokenCard decoded={data?.t1} title="Session token (T1)" />
        </div>
        <div style={{ flex: '1 1 320px', minWidth: 0 }}>
          {data?.t2
            ? <TokenCard decoded={data.t2} title="Exchanged token (T2)" />
            : <div className="vertical-result vertical-result-text">Exchange not available (sign-in required or exchange failed).</div>}
        </div>
      </div>
    );
  }

  if (descriptor && descriptor.type === 'productGrid') {
    const items = Array.isArray(data) ? data : (data && Array.isArray(data.products) ? data.products : []);
    return (
      <div className="vertical-result vertical-result-product-grid">
        <ProductCardGrid kind="products" title={descriptor.title} items={items} onAction={onAction} action={descriptor.action} />
      </div>
    );
  }

  if (descriptor && descriptor.type === 'seatMap') {
    const flightNumber = (data && data.flightNumber) || '';
    const rawSeats = (data && (data.seats || data)) || [];
    const seats = Array.isArray(rawSeats) ? rawSeats : [];
    return (
      <div className="vertical-result vertical-result-seat-map">
        <SeatMapPanel flightNumber={flightNumber} seats={seats} />
      </div>
    );
  }

  // Text fallback for null/undefined/unknown descriptor type
  if (!descriptor || !descriptor.type || !['card', 'fieldList', 'table', 'productGrid', 'seatMap'].includes(descriptor.type)) {
    if (typeof data === 'string') {
      return <div className="vertical-result vertical-result-text">{data}</div>;
    }
    return <div className="vertical-result vertical-result-text">{JSON.stringify(data)}</div>;
  }

  // Card and fieldList rendering
  if (descriptor.type === 'card' || descriptor.type === 'fieldList') {
    const fields = descriptor.fields || [];
    return (
      <div className="vertical-result vertical-result-fields">
        {descriptor.title && <h3 className="vertical-result-title">{descriptor.title}</h3>}
        <dl className="vertical-result-list">
          {fields.map((field, idx) => {
            const value = valueByPath(data, field.path);
            const formatted = formatValue(value, field.format);
            return (
              <div key={idx} className="vertical-result-field">
                <dt className="vertical-result-label">{field.label}</dt>
                <dd className="vertical-result-value">{formatted}</dd>
              </div>
            );
          })}
        </dl>
        {renderRecordRows(data)}
      </div>
    );
  }

  // Table rendering
  if (descriptor.type === 'table') {
    const columns = descriptor.columns || [];
    const rows = Array.isArray(data)
      ? data
      : (data && Object.values(data).find((v) => Array.isArray(v))) || [];

    return (
      <div className="vertical-result vertical-result-table">
        <table className="vertical-result-table-element">
          <thead>
            <tr>
              {columns.map((col, idx) => (
                <th key={idx}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                {columns.map((col, colIdx) => {
                  const value = valueByPath(row, col.path);
                  const formatted = formatValue(value, col.format);
                  return <td key={colIdx}>{formatted}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return null;
}

export default VerticalResult;
