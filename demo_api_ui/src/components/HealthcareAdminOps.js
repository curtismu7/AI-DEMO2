import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function HealthcareAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="healthcare" user={user} onLogout={onLogout} />;
}
