import React, { createContext, useCallback, useState, useContext } from 'react';

const InspectorFieldContext = createContext(null);

export const InspectorFieldProvider = ({ children }) => {
  const [fields, setFields] = useState({});

  const registerFields = useCallback((inspectorId, data) => {
    setFields(prev => ({
      ...prev,
      [inspectorId]: flattenObject(data)
    }));
  }, []);

  const getMatchingFields = useCallback((fieldNames) => {
    const allFields = Object.values(fields).reduce((acc, f) => ({ ...acc, ...f }), {});
    const matches = {};
    fieldNames.forEach(name => {
      const match = findMatchingField(name, allFields);
      if (match) matches[name] = match;
    });
    return matches;
  }, [fields]);

  return (
    <InspectorFieldContext.Provider value={{ registerFields, getMatchingFields, allFields: fields }}>
      {children}
    </InspectorFieldContext.Provider>
  );
};

// Without a provider, inspectors still work: they just can't share fields with
// each other. A missing provider used to throw and take down the whole page
// (/agent-gateway-capabilities crashed on every load from 2026-08-31). Module-level
// so the functions keep one identity: both inspectors list them in effect deps.
const NO_PROVIDER_FIELDS = Object.freeze({
  registerFields: () => {},
  getMatchingFields: () => ({}),
  allFields: {},
});

export const useInspectorFields = () => useContext(InspectorFieldContext) ?? NO_PROVIDER_FIELDS;

// Flatten nested objects for field extraction
const flattenObject = (obj, prefix = '') => {
  const result = {};
  for (const [key, value] of Object.entries(obj || {})) {
    const newKey = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenObject(value, newKey));
    } else if (!Array.isArray(value)) {
      result[newKey] = value;
    }
  }
  return result;
};

// Smart field matching: matches common field name patterns
const findMatchingField = (targetName, availableFields) => {
  const normalize = (n) => n.toLowerCase().replace(/[_-]/g, '');
  const targetNorm = normalize(targetName);

  // Exact normalized match
  for (const [key, val] of Object.entries(availableFields)) {
    if (normalize(key) === targetNorm) return val;
  }

  // Partial match (e.g., "userId" matches "user_id", "id" at end)
  const patterns = [
    (n) => n.toLowerCase().includes(targetNorm),
    (n) => targetNorm.includes(normalize(n))
  ];

  for (const pattern of patterns) {
    for (const [key, val] of Object.entries(availableFields)) {
      if (pattern(key) && typeof val === 'string') return val;
    }
  }

  return null;
};
