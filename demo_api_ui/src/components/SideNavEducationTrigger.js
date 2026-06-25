import React, { useState } from 'react';
import { MdMenuBook } from 'react-icons/md';
import TrainingSlideOut from './TrainingSlideOut';

export default function SideNavEducationTrigger({ collapsed }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="sidenav-link sidenav-learn-btn"
        onClick={() => setOpen(true)}
        title="AI Agent Training"
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10 }}
      >
        <MdMenuBook size={20} className="sidenav-icon" />
        {!collapsed && <span className="sidenav-link-label">AI Agent Training</span>}
      </button>
      <TrainingSlideOut open={open} onClose={() => setOpen(false)} />
    </>
  );
}
