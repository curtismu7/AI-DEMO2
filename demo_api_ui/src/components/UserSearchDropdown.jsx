import React, { useState, useRef } from "react";

export default function UserSearchDropdown({ value, onChange }) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [show, setShow] = useState(false);
  const debounceRef = useRef();

  // Fetch users from backend
  const fetchUsers = (search) => {
    setLoading(true);
    fetch(`/api/mfa/test/users?search=${encodeURIComponent(search)}&limit=10`)
      .then((res) => res.json())
      .then((data) => {
        setOptions(data.users || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  // Debounced search
  const onInputChange = (e) => {
    const val = e.target.value;
    setInput(val);
    setShow(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (val.length >= 2) fetchUsers(val);
      else setOptions([]);
    }, 250);
  };

  // Option select
  const selectUser = (user) => {
    setInput(user ? user.username : "");
    setShow(false);
    if (onChange) onChange(user);
  };

  return (
    <div style={{ position: "relative", flex: 1 }}>
      <input
        type="text"
        value={input}
        onChange={onInputChange}
        onFocus={() => setShow(true)}
        placeholder="Search username..."
        style={{
          width: "100%", padding: "6px 10px", border: "1px solid #cbd5e1",
          borderRadius: 6, fontFamily: "monospace", fontSize: "0.85rem",
        }}
      />
      {show && options.length > 0 && (
        <div style={{
          position: "absolute", top: "110%", left: 0, right: 0, zIndex: 10,
          background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)", maxHeight: 220, overflowY: "auto"
        }}>
          {options.map((user) => (
            <div
              key={user.id}
              onClick={() => selectUser(user)}
              style={{
                padding: "8px 12px", cursor: "pointer",
                borderBottom: "1px solid #f1f5f9",
              }}
            >
              {user.username} <span style={{ color: "#888", fontSize: "0.8em" }}>({user.id})</span>
            </div>
          ))}
        </div>
      )}
      {loading && <div style={{ position: "absolute", top: "110%", left: 0, color: "#888", fontSize: "0.85em" }}>Loading...</div>}
    </div>
  );
}
