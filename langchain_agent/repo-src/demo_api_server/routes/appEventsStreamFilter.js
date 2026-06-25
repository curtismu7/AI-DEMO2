'use strict';

// Whether a user is an admin (role or scope). Admins receive every app-event
// category on the shared SSE stream.
function isAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Array.isArray(user.scopes) && user.scopes.includes('admin');
}

// Access gate for the shared SSE stream. Admins see everything; any other
// authenticated user receives only 'control_plane' events (the AI Control Plane
// push notice), never admin-only telemetry.
function controlPlaneVisible(user, event) {
  if (!user || !event) return false;
  if (isAdmin(user)) return true;
  return event.category === 'control_plane';
}

module.exports = { controlPlaneVisible, isAdmin };
