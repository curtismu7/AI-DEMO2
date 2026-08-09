import React from 'react';
import SupportConsole from './supportConsole/SupportConsole';

export default function UniversityAdminOps({ user, onLogout }) {
  return <SupportConsole vertical="university" user={user} onLogout={onLogout} />;
}
