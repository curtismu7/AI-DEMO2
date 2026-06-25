// banking_api_ui/src/services/bffAxios.js
import axios from 'axios';
import { resolveApiBaseUrl } from '../utils/resolveApiBaseUrl';

/**
 * Same-origin API calls that rely on the Backend-for-Frontend (BFF) session cookie only.
 * The Backend-for-Frontend (BFF) is banking_api_server: it holds OAuth tokens server-side; the browser only sends the session cookie.
 * Intentionally no Authorization / refresh interceptors — those can break
 * admin routes when the SPA does not send Bearer tokens (session fallback).
 */
const bffAxios = axios.create({
  baseURL: resolveApiBaseUrl(),
  withCredentials: true,
  timeout: 30000,
});

export default bffAxios;
