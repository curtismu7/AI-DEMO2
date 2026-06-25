import { useCallback, useEffect, useRef, useState, FC } from "react";
import apiClient from "../services/apiClient";
import { notifyError, notifyInfo, notifySuccess } from "../utils/appToast";
import "./MFATestPage.css";
import ApiCallPreviewCard from "./shared/ApiCallPreviewCard";
import MFATestCard from "./MFATestCard";
import PingOneApiPanel from "./PingOneApiPanel";
import MFALogsModal from "./MFALogsModal";

interface PingOneUser {
  id: string;
  username: string;
  email?: string;
  name?: string;
}

interface MFADevice {
  id: string;
  type: string;
  phone?: string;
  email?: string;
  nickname?: string;
  status?: string;
  createdAt?: string;
  [key: string]: any;
}

interface MFAConfig {
  success?: boolean;
  error?: string;
  [key: string]: any;
}

interface PingOneRequest {
  [key: string]: any;
}

interface PingOneResponse {
  [key: string]: any;
}

const MFATestPage: FC = () => {
  const [config, setConfig] = useState<MFAConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [testUserId, setTestUserId] = useState("");
  // demoUser is the primary demo identity; it lives beyond the first 100 of 1300+
  // PingOne users, so we resolve it explicitly and keep it pinned to the picker.
  const [defaultUser, setDefaultUser] = useState<PingOneUser | null>(null);
  const [pingoneUsers, setPingoneUsers] = useState<PingOneUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [userPickerOpen, setUserPickerOpen] = useState(false);

  const [smsInitiateStatus, setSmsInitiateStatus] = useState("pending");
  const [smsInitiateError, setSmsInitiateError] = useState<string | null>(null);
  const [smsDaId, setSmsDaId] = useState<string | null>(null);
  const [smsDevices, setSmsDevices] = useState<MFADevice[]>([]);
  const [smsOtp, setSmsOtp] = useState("");
  const [smsVerifyStatus, setSmsVerifyStatus] = useState("pending");
  const [smsVerifyError, setSmsVerifyError] = useState<string | null>(null);

  const [emailInitiateStatus, setEmailInitiateStatus] = useState("pending");
  const [emailInitiateError, setEmailInitiateError] = useState<string | null>(
    null,
  );
  const [emailDaId, setEmailDaId] = useState<string | null>(null);
  const [emailDevices, setEmailDevices] = useState<MFADevice[]>([]);
  const [emailOtp, setEmailOtp] = useState("");
  const [emailVerifyStatus, setEmailVerifyStatus] = useState("pending");
  const [emailVerifyError, setEmailVerifyError] = useState<string | null>(null);

  const [fidoInitiateStatus, setFidoInitiateStatus] = useState("pending");
  const [fidoInitiateError, setFidoInitiateError] = useState<string | null>(
    null,
  );
  const [fidoDaId, setFidoDaId] = useState<string | null>(null);

  const [devices, setDevices] = useState<MFADevice[]>([]);
  const [devicesStatus, setDevicesStatus] = useState("pending");
  const [devicesPingoneReq, setDevicesPingoneReq] =
    useState<PingOneRequest | null>(null);
  const [devicesPingoneRes, setDevicesPingoneRes] =
    useState<PingOneResponse | null>(null);
  const [devicesError, setDevicesError] = useState<string | null>(null);

  const [enrollSmsPhone, setEnrollSmsPhone] = useState("");
  const [enrollSmsCountryCode, setEnrollSmsCountryCode] = useState("+1");
  const [enrollSmsInitStatus, setEnrollSmsInitStatus] = useState("pending");
  const [enrollSmsInitError, setEnrollSmsInitError] = useState<string | null>(
    null,
  );
  const [enrollSmsDeviceId, setEnrollSmsDeviceId] = useState<string | null>(
    null,
  );
  const [enrollSmsAlreadyActive, setEnrollSmsAlreadyActive] = useState(false);
  const [enrollSmsOtp, setEnrollSmsOtp] = useState("");
  const [enrollSmsCompleteStatus, setEnrollSmsCompleteStatus] =
    useState("pending");
  const [enrollSmsCompleteError, setEnrollSmsCompleteError] = useState<
    string | null
  >(null);
  const [enrollEmailStatus, setEnrollEmailStatus] = useState("pending");
  const [enrollEmailError, setEnrollEmailError] = useState<string | null>(null);
  const [enrollEmailInput, setEnrollEmailInput] = useState("");
  const [existingFido2Device, setExistingFido2Device] =
    useState<MFADevice | null>(null);
  const [deletingDeviceId, setDeletingDeviceId] = useState<string | null>(null);
  const [fidoEnrollInitStatus, setFidoEnrollInitStatus] = useState("pending");
  const [fidoEnrollInitError, setFidoEnrollInitError] = useState<string | null>(
    null,
  );

  const [fidoChallengeOptions, setFidoChallengeOptions] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [fidoVerifyStatus, setFidoVerifyStatus] = useState("pending");
  const [fidoVerifyError, setFidoVerifyError] = useState<string | null>(null);

  const [fidoEnrollData, setFidoEnrollData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [fidoEnrollCompleteStatus, setFidoEnrollCompleteStatus] =
    useState("pending");
  const [fidoEnrollCompleteError, setFidoEnrollCompleteError] = useState<
    string | null
  >(null);

  const [fidoEnrollInitPingoneReq, setFidoEnrollInitPingoneReq] =
    useState<PingOneRequest | null>(null);
  const [fidoEnrollInitPingoneRes, setFidoEnrollInitPingoneRes] =
    useState<PingOneResponse | null>(null);
  const [fidoEnrollCompletePingoneReq, setFidoEnrollCompletePingoneReq] =
    useState<PingOneRequest | null>(null);
  const [fidoEnrollCompletePingoneRes, setFidoEnrollCompletePingoneRes] =
    useState<PingOneResponse | null>(null);
  const [fidoVerifyPingoneReq, setFidoVerifyPingoneReq] =
    useState<PingOneRequest | null>(null);
  const [fidoVerifyPingoneRes, setFidoVerifyPingoneRes] =
    useState<PingOneResponse | null>(null);
  const [fidoInitiatePingoneReq, setFidoInitiatePingoneReq] =
    useState<PingOneRequest | null>(null);
  const [fidoInitiatePingoneRes, setFidoInitiatePingoneRes] =
    useState<PingOneResponse | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_fidoSelectDevicePingoneReq, setFidoSelectDevicePingoneReq] =
    useState<PingOneRequest | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_fidoSelectDevicePingoneRes, setFidoSelectDevicePingoneRes] =
    useState<PingOneResponse | null>(null);
  const [smsInitiatePingoneReq, setSmsInitiatePingoneReq] =
    useState<PingOneRequest | null>(null);
  const [smsInitiatePingoneRes, setSmsInitiatePingoneRes] =
    useState<PingOneResponse | null>(null);
  const [smsSelectDevicePingoneReq, setSmsSelectDevicePingoneReq] =
    useState<PingOneRequest | null>(null);
  const [smsSelectDevicePingoneRes, setSmsSelectDevicePingoneRes] =
    useState<PingOneResponse | null>(null);
  const [smsVerifyPingoneReq, setSmsVerifyPingoneReq] =
    useState<PingOneRequest | null>(null);
  const [smsVerifyPingoneRes, setSmsVerifyPingoneRes] =
    useState<PingOneResponse | null>(null);
  const [emailInitiatePingoneReq, setEmailInitiatePingoneReq] =
    useState<PingOneRequest | null>(null);
  const [emailInitiatePingoneRes, setEmailInitiatePingoneRes] =
    useState<PingOneResponse | null>(null);
  const [emailSelectDevicePingoneReq, setEmailSelectDevicePingoneReq] =
    useState<PingOneRequest | null>(null);
  const [emailSelectDevicePingoneRes, setEmailSelectDevicePingoneRes] =
    useState<PingOneResponse | null>(null);
  const [emailVerifyPingoneReq, setEmailVerifyPingoneReq] =
    useState<PingOneRequest | null>(null);
  const [emailVerifyPingoneRes, setEmailVerifyPingoneRes] =
    useState<PingOneResponse | null>(null);
  const [enrollSmsInitPingoneReq, setEnrollSmsInitPingoneReq] =
    useState<PingOneRequest | null>(null);
  const [enrollSmsInitPingoneRes, setEnrollSmsInitPingoneRes] =
    useState<PingOneResponse | null>(null);
  const [enrollSmsCompletePingoneReq, setEnrollSmsCompletePingoneReq] =
    useState<PingOneRequest | null>(null);
  const [enrollSmsCompletePingoneRes, setEnrollSmsCompletePingoneRes] =
    useState<PingOneResponse | null>(null);
  const [enrollEmailPingoneReq, setEnrollEmailPingoneReq] =
    useState<PingOneRequest | null>(null);
  const [enrollEmailPingoneRes, setEnrollEmailPingoneRes] =
    useState<PingOneResponse | null>(null);

  const [workerTokenStatus, setWorkerTokenStatus] = useState<string | null>(
    null,
  );
  const [workerTokenError, setWorkerTokenError] = useState<string | null>(null);

  // Auto-enrollment state: when challenge initiated but no device enrolled
  const [autoEnrollFido, setAutoEnrollFido] = useState(false);
  const [noFidoDeviceDetected, setNoFidoDeviceDetected] = useState(false);
  const [autoEnrollSms, setAutoEnrollSms] = useState(false);
  const [noSmsDeviceDetected, setNoSmsDeviceDetected] = useState(false);
  const [autoEnrollEmail, setAutoEnrollEmail] = useState(false);
  const [noEmailDeviceDetected, setNoEmailDeviceDetected] = useState(false);

  const [rawSmsInitiate, setRawSmsInitiate] = useState<PingOneResponse | null>(
    null,
  );
  const [rawSmsVerify, setRawSmsVerify] = useState<PingOneResponse | null>(
    null,
  );
  const [rawEmailInitiate, setRawEmailInitiate] =
    useState<PingOneResponse | null>(null);
  const [rawEmailVerify, setRawEmailVerify] = useState<PingOneResponse | null>(
    null,
  );
  const [rawFidoInitiate, setRawFidoInitiate] =
    useState<PingOneResponse | null>(null);
  const [rawFidoVerify, setRawFidoVerify] = useState<PingOneResponse | null>(
    null,
  );
  const [rawEnrollSmsInit, setRawEnrollSmsInit] =
    useState<PingOneResponse | null>(null);
  const [rawEnrollSmsComplete, setRawEnrollSmsComplete] =
    useState<PingOneResponse | null>(null);
  const [rawEnrollEmail, setRawEnrollEmail] = useState<PingOneResponse | null>(
    null,
  );
  const [rawFidoEnrollInit, setRawFidoEnrollInit] =
    useState<PingOneResponse | null>(null);
  const [rawFidoEnrollComplete, setRawFidoEnrollComplete] =
    useState<PingOneResponse | null>(null);
  const [rawDevices, setRawDevices] = useState<PingOneResponse | null>(null);

  // Logs modal state
  const [logsModalOpen, setLogsModalOpen] = useState(false);

  const [fixRpStatus, setFixRpStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [fixRpResult, setFixRpResult] = useState<string | null>(null);

  const fixFido2Rp = useCallback(async () => {
    setFixRpStatus("loading");
    setFixRpResult(null);
    try {
      const { data } = await apiClient.post("/api/auth/mfa/ensure-fido2-rp");
      const msg = data.changed
        ? `Fixed — updated ${data.policies?.filter((p) => p.updated).length ?? 0} of ${data.count} policies to rpId=${data.rpId}`
        : `Already correct — ${data.count} policies already set to rpId=${data.rpId}`;
      setFixRpStatus("done");
      setFixRpResult(msg);
      notifySuccess(msg);
    } catch (err: any) {
      const detail = err?.response?.data?.message || err?.response?.data?.error || err.message;
      setFixRpStatus("error");
      setFixRpResult(detail);
      notifyError(`Fix RP failed: ${detail}`);
    }
  }, []);

  const loadConfig = useCallback(async (): Promise<void> => {
    try {
      const { data } = await apiClient.get("/api/mfa/test/config");
      if (data.success !== false) {
        setConfig(data);
        setLoading(false);
      } else {
        setError(`Failed to load config: ${data.error}`);
        setLoading(false);
      }
    } catch (err: unknown) {
      console.error("Config error:", err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(`Failed to load config: ${errorMsg}`);
      setLoading(false);
    }
  }, []);

  const loadDevices = useCallback(async (): Promise<void> => {
    try {
      setDevicesStatus("pending");
      setDevicesError(null);
      const { data } = await apiClient.get(`/api/mfa/test/integration/devices`);
      setRawDevices(data);
      if (data.pingoneRequest) setDevicesPingoneReq(data.pingoneRequest);
      if (data.pingoneResponse) setDevicesPingoneRes(data.pingoneResponse);
      if (data.success) {
        setDevices(data.devices || []);
        setDevicesStatus("passed");
      } else {
        setDevicesStatus("failed");
        setDevicesError(data.error);
      }
    } catch (err) {
      setRawDevices({ error: err.message });
      console.error("Devices error:", err);
      setDevicesStatus("failed");
      setDevicesError(err.message);
    }
  }, []);

  const deleteDevice = useCallback(
    async (deviceId) => {
      if (!deviceId) return;
      setDeletingDeviceId(deviceId);
      try {
        await apiClient.delete(`/api/mfa/test/integration/devices/${deviceId}`);
        notifySuccess("Device deleted");
        setExistingFido2Device(null);
        setFidoEnrollData(null);
        setFidoEnrollInitStatus("pending");
        setFidoEnrollInitError(null);
        loadDevices();
      } catch (err) {
        const msg =
          err?.response?.data?.message ||
          err?.response?.data?.error ||
          err.message;
        notifyError(`Delete failed: ${msg}`);
      } finally {
        setDeletingDeviceId(null);
      }
    },
    [loadDevices],
  );

  const loadWorkerToken = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/mfa/test/worker-token");
      if (data.success) {
        setWorkerTokenStatus("valid");
        setWorkerTokenError(null);
        notifySuccess("Worker token fetched successfully");
      } else {
        setWorkerTokenStatus("error");
        setWorkerTokenError(data.error || "Failed to fetch worker token");
        notifyError(data.error || "Failed to fetch worker token");
      }
    } catch (err) {
      setWorkerTokenStatus("error");
      setWorkerTokenError(err.message);
      notifyError(`Worker token error: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    loadConfig();
    loadWorkerToken();
    // Pick the default test user. Priority: logged-in user > demoUser.
    // demoUser lives beyond the default 100-user page, so resolve it by username
    // and pin it to the picker (always visible/selectable) regardless of the default.
    (async () => {
      let demo: PingOneUser | null = null;
      try {
        const { data } = await apiClient.get("/api/mfa/test/users?q=demoUser");
        demo =
          (data?.users || []).find(
            (u: PingOneUser) => (u.username || "").toLowerCase() === "demouser",
          ) || null;
        if (demo) setDefaultUser(demo);
      } catch (err) {
        console.warn("[MFA] Could not resolve demoUser:", err.message);
      }
      // Prefer the logged-in user when present.
      try {
        const { data } = await apiClient.get("/api/auth/oauth/user/status");
        if (data?.authenticated && data?.user?.oauthId) {
          setTestUserId((prev) => prev || data.user.oauthId);
          return;
        }
      } catch (err) {
        console.warn("[MFA] Could not load logged-in user:", err.message);
      }
      // No logged-in user — default to demoUser.
      if (demo) setTestUserId((prev) => prev || demo.id);
    })();
  }, [loadConfig, loadWorkerToken]);

  const loadPingoneUsers = useCallback(
    async (searchQuery?: string): Promise<void> => {
      setUsersLoading(true);
      try {
        const qs = searchQuery ? `?q=${encodeURIComponent(searchQuery)}` : "";
        const { data } = await apiClient.get(`/api/mfa/test/users${qs}`);
        if (data.success) setPingoneUsers(data.users || []);
        else console.warn("[MFA] Users load failed:", data.error);
      } catch (e) {
        console.warn("[MFA] Users load error:", e.message);
      }
      setUsersLoading(false);
    },
    [],
  );

  // Load all users on mount; debounce server search while typing
  useEffect(() => {
    loadPingoneUsers();
  }, [loadPingoneUsers]);

  const userSearchTimerRef = useRef(null);
  const handleUserSearch = (value) => {
    setUserSearch(value);
    setUserPickerOpen(true);
    if (userSearchTimerRef.current) clearTimeout(userSearchTimerRef.current);
    if (!value.trim()) {
      // Empty search — reload full list
      userSearchTimerRef.current = setTimeout(() => loadPingoneUsers(), 100);
    } else {
      // Debounce 300ms then hit server with SCIM filter
      userSearchTimerRef.current = setTimeout(
        () => loadPingoneUsers(value.trim()),
        300,
      );
    }
  };

  // Auto-enroll FIDO2 if challenge initiated but no device enrolled
  // (i.e., no WebAuthn options arrive after 5 seconds)
  useEffect(() => {
    if (
      fidoInitiateStatus === "passed" &&
      fidoDaId &&
      !fidoChallengeOptions &&
      !autoEnrollFido
    ) {
      const timer = setTimeout(() => {
        // No options arrived — user doesn't have FIDO2 enrolled
        setNoFidoDeviceDetected(true);
        setAutoEnrollFido(true);
        notifyInfo("No FIDO2 device found. Starting automatic enrollment…");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [fidoInitiateStatus, fidoDaId, fidoChallengeOptions, autoEnrollFido]);

  // Auto-enroll SMS if challenge initiated but no SMS device enrolled
  useEffect(() => {
    if (
      smsInitiateStatus === "passed" &&
      smsDaId &&
      smsDevices.length === 0 &&
      !autoEnrollSms
    ) {
      const timer = setTimeout(() => {
        // No SMS device found
        setNoSmsDeviceDetected(true);
        setAutoEnrollSms(true);
        notifyInfo("No SMS device found. Starting automatic enrollment…");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [smsInitiateStatus, smsDaId, smsDevices, autoEnrollSms]);

  // Auto-enroll Email if challenge initiated but no Email device enrolled
  useEffect(() => {
    if (
      emailInitiateStatus === "passed" &&
      emailDaId &&
      emailDevices.length === 0 &&
      !autoEnrollEmail
    ) {
      const timer = setTimeout(() => {
        // No Email device found
        setNoEmailDeviceDetected(true);
        setAutoEnrollEmail(true);
        notifyInfo("No Email device found. Starting automatic enrollment…");
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [emailInitiateStatus, emailDaId, emailDevices, autoEnrollEmail]);

  // SMS OTP test functions
  const testSmsInitiate = useCallback(async () => {
    setSmsInitiateStatus("pending");
    setSmsInitiateError(null);
    try {
      // Step 1: Initiate device authentication
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/initiate",
        { method: "sms" },
      );
      setRawSmsInitiate(data);
      if (data.pingoneRequest) setSmsInitiatePingoneReq(data.pingoneRequest);
      if (data.pingoneResponse) setSmsInitiatePingoneRes(data.pingoneResponse);

      if (data.success && data.daId && data.devices?.length > 0) {
        setSmsDaId(data.daId);
        setSmsDevices(data.devices || []);

        // Step 2: Automatically select first SMS-capable device to trigger OTP send
        const smsDevice = data.devices.find(
          (d) =>
            String(d.type || "")
              .toUpperCase()
              .includes("SMS") ||
            String(d.type || "")
              .toUpperCase()
              .includes("PHONE"),
        );

        if (smsDevice) {
          try {
            const selectResp = await apiClient.post(
              "/api/mfa/test/integration/select-device",
              { daId: data.daId, deviceId: smsDevice.id },
            );
            if (selectResp.data?.pingoneRequest)
              setSmsSelectDevicePingoneReq(selectResp.data.pingoneRequest);
            if (selectResp.data?.pingoneResponse)
              setSmsSelectDevicePingoneRes(selectResp.data.pingoneResponse);

            if (selectResp.data?.success) {
              setSmsInitiateStatus("passed");
              notifySuccess(
                `SMS OTP sent to ${smsDevice.nickname || smsDevice.email || "registered device"}`,
              );
            } else {
              setSmsInitiateStatus("failed");
              setSmsInitiateError(
                selectResp.data?.error || "Failed to select SMS device",
              );
              notifyError(
                `SMS device selection failed: ${selectResp.data?.error}`,
              );
            }
          } catch (selectErr) {
            setSmsInitiateStatus("failed");
            setSmsInitiateError(selectErr.message);
            notifyError(`SMS device selection failed: ${selectErr.message}`);
          }
        } else {
          setSmsInitiateStatus("failed");
          setSmsInitiateError("No SMS device found");
          notifyError("No SMS device available for authentication");
        }
      } else {
        setSmsInitiateStatus("failed");
        setSmsInitiateError(data.error || "No devices available");
        notifyError(
          `SMS OTP initiation failed: ${data.error || "No devices available"}`,
        );
      }
    } catch (err) {
      const errData = err?.response?.data;
      setRawSmsInitiate(errData || { error: err.message });
      if (errData?.pingoneRequest)
        setSmsInitiatePingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setSmsInitiatePingoneRes(errData.pingoneResponse);
      setSmsInitiateStatus("failed");
      setSmsInitiateError(err.message);
      notifyError(`SMS OTP initiation failed: ${err.message}`);
    }
  }, []);

  const testSmsVerify = useCallback(async () => {
    if (!smsDaId || !smsOtp || smsDevices.length === 0) {
      notifyError("Please initiate SMS challenge and enter OTP code");
      return;
    }
    setSmsVerifyStatus("pending");
    setSmsVerifyError(null);
    try {
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/verify-otp",
        {
          daId: smsDaId,
          deviceId: smsDevices[0].id,
          otp: smsOtp,
        },
      );
      setRawSmsVerify(data);
      if (data.pingoneRequest) setSmsVerifyPingoneReq(data.pingoneRequest);
      if (data.pingoneResponse) setSmsVerifyPingoneRes(data.pingoneResponse);
      if (data.success) {
        setSmsVerifyStatus(data.completed ? "passed" : "pending");
        if (data.completed) {
          notifySuccess("SMS OTP verified successfully");
        } else {
          notifyInfo("SMS OTP verification in progress");
        }
      } else {
        setSmsVerifyStatus("failed");
        setSmsVerifyError(data.error);
        notifyError(`SMS OTP verification failed: ${data.error}`);
      }
    } catch (err) {
      const errData = err?.response?.data;
      setRawSmsVerify(errData || { error: err.message });
      if (errData?.pingoneRequest)
        setSmsVerifyPingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setSmsVerifyPingoneRes(errData.pingoneResponse);
      setSmsVerifyStatus("failed");
      setSmsVerifyError(err.message);
      notifyError(`SMS OTP verification failed: ${err.message}`);
    }
  }, [smsDaId, smsDevices, smsOtp]);

  // Email OTP test functions
  const testEmailInitiate = useCallback(async () => {
    setEmailInitiateStatus("pending");
    setEmailInitiateError(null);
    try {
      // Step 1: Initiate device authentication
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/initiate",
        { method: "email" },
      );
      setRawEmailInitiate(data);
      if (data.pingoneRequest) setEmailInitiatePingoneReq(data.pingoneRequest);
      if (data.pingoneResponse)
        setEmailInitiatePingoneRes(data.pingoneResponse);

      if (data.success && data.daId && data.devices?.length > 0) {
        setEmailDaId(data.daId);
        setEmailDevices(data.devices || []);

        // Step 2: Automatically select first EMAIL-capable device to trigger OTP send
        const emailDevice = data.devices.find(
          (d) =>
            String(d.type || "")
              .toUpperCase()
              .includes("EMAIL") ||
            String(d.type || "")
              .toUpperCase()
              .includes("MAIL"),
        );

        if (emailDevice) {
          try {
            const selectResp = await apiClient.post(
              "/api/mfa/test/integration/select-device",
              { daId: data.daId, deviceId: emailDevice.id },
            );
            if (selectResp.data?.pingoneRequest)
              setEmailSelectDevicePingoneReq(selectResp.data.pingoneRequest);
            if (selectResp.data?.pingoneResponse)
              setEmailSelectDevicePingoneRes(selectResp.data.pingoneResponse);

            if (selectResp.data?.success) {
              setEmailInitiateStatus("passed");
              notifySuccess(
                `Email OTP sent to ${emailDevice.email || "registered email"}`,
              );
            } else {
              setEmailInitiateStatus("failed");
              setEmailInitiateError(
                selectResp.data?.error || "Failed to select Email device",
              );
              notifyError(
                `Email device selection failed: ${selectResp.data?.error}`,
              );
            }
          } catch (selectErr) {
            setEmailInitiateStatus("failed");
            setEmailInitiateError(selectErr.message);
            notifyError(`Email device selection failed: ${selectErr.message}`);
          }
        } else {
          setEmailInitiateStatus("failed");
          setEmailInitiateError("No Email device found");
          notifyError("No Email device available for authentication");
        }
      } else {
        setEmailInitiateStatus("failed");
        setEmailInitiateError(data.error || "No devices available");
        notifyError(
          `Email OTP initiation failed: ${data.error || "No devices available"}`,
        );
      }
    } catch (err) {
      const errData = err?.response?.data;
      setRawEmailInitiate(errData || { error: err.message });
      if (errData?.pingoneRequest)
        setEmailInitiatePingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setEmailInitiatePingoneRes(errData.pingoneResponse);
      setEmailInitiateStatus("failed");
      setEmailInitiateError(err.message);
      notifyError(`Email OTP initiation failed: ${err.message}`);
    }
  }, []);

  const testEmailVerify = useCallback(async () => {
    if (!emailDaId || !emailOtp || emailDevices.length === 0) {
      notifyError("Please initiate Email challenge and enter OTP code");
      return;
    }
    setEmailVerifyStatus("pending");
    setEmailVerifyError(null);
    try {
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/verify-otp",
        {
          daId: emailDaId,
          deviceId: emailDevices[0].id,
          otp: emailOtp,
        },
      );
      setRawEmailVerify(data);
      if (data.pingoneRequest) setEmailVerifyPingoneReq(data.pingoneRequest);
      if (data.pingoneResponse) setEmailVerifyPingoneRes(data.pingoneResponse);
      if (data.success) {
        setEmailVerifyStatus(data.completed ? "passed" : "pending");
        if (data.completed) {
          notifySuccess("Email OTP verified successfully");
        } else {
          notifyInfo("Email OTP verification in progress");
        }
      } else {
        setEmailVerifyStatus("failed");
        setEmailVerifyError(data.error);
        notifyError(`Email OTP verification failed: ${data.error}`);
      }
    } catch (err) {
      const errData = err?.response?.data;
      setRawEmailVerify(errData || { error: err.message });
      if (errData?.pingoneRequest)
        setEmailVerifyPingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setEmailVerifyPingoneRes(errData.pingoneResponse);
      setEmailVerifyStatus("failed");
      setEmailVerifyError(err.message);
      notifyError(`Email OTP verification failed: ${err.message}`);
    }
  }, [emailDaId, emailDevices, emailOtp]);

  // FIDO2 test functions
  const testFidoInitiate = useCallback(async () => {
    setFidoInitiateStatus("pending");
    setFidoInitiateError(null);
    setFidoChallengeOptions(null);
    try {
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/initiate",
        { method: "fido2" },
      );
      setRawFidoInitiate(data);
      if (data.pingoneRequest) setFidoInitiatePingoneReq(data.pingoneRequest);
      if (data.pingoneResponse) setFidoInitiatePingoneRes(data.pingoneResponse);
      if (data.selectDeviceRequest)
        setFidoSelectDevicePingoneReq(data.selectDeviceRequest);
      if (data.selectDeviceResponse)
        setFidoSelectDevicePingoneRes(data.selectDeviceResponse);
      if (data.success) {
        setFidoDaId(data.daId);
        setFidoInitiateStatus("passed");
        notifySuccess(
          "FIDO2 challenge initiated — polling for WebAuthn options…",
        );
        // Poll for publicKeyCredentialRequestOptions from challenge status (retry up to 10 times)
        let optionsFound = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          try {
            const statusResp = await apiClient.get(
              `/api/mfa/test/integration/challenge/${data.daId}/status`,
            );
            if (statusResp.data.publicKeyCredentialRequestOptions) {
              setFidoChallengeOptions(
                statusResp.data.publicKeyCredentialRequestOptions,
              );
              optionsFound = true;
              break;
            }
          } catch (_e) {
            /* non-fatal — keep retrying */
          }
          // Wait 300ms before next attempt
          if (attempt < 9) {
            await new Promise((resolve) => setTimeout(resolve, 300));
          }
        }
        if (!optionsFound) {
          console.warn(
            "[FIDO2] Challenge options not available after 10 polling attempts",
          );
        }
      } else {
        setFidoInitiateStatus("failed");
        setFidoInitiateError(data.error);
        notifyError(`FIDO2 initiation failed: ${data.error}`);
      }
    } catch (err) {
      const errData = err?.response?.data;
      setRawFidoInitiate(errData || { error: err.message });
      if (errData?.pingoneRequest)
        setFidoInitiatePingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setFidoInitiatePingoneRes(errData.pingoneResponse);
      setFidoInitiateStatus("failed");
      setFidoInitiateError(err.message);
      notifyError(`FIDO2 initiation failed: ${err.message}`);
    }
  }, []);

  const testFidoVerify = useCallback(async () => {
    if (!fidoDaId || !fidoChallengeOptions) {
      notifyError("Initiate FIDO2 challenge first, then use your passkey");
      return;
    }
    setFidoVerifyStatus("pending");
    setFidoVerifyError(null);
    try {
      if (!navigator.credentials)
        throw new Error("WebAuthn not supported in this browser");

      // Safe base64 decode helper
      const safeBase64ToBytes = (str) => {
        try {
          return Uint8Array.from(atob(str), (c) => c.charCodeAt(0));
        } catch (e) {
          // If decoding fails, try treating as UTF-8 string
          if (typeof str === "string") {
            const bytes = new Uint8Array(str.length);
            for (let i = 0; i < str.length; i++) {
              bytes[i] = str.charCodeAt(i);
            }
            return bytes;
          }
          throw e;
        }
      };

      const opts = {
        ...fidoChallengeOptions,
        challenge: safeBase64ToBytes(fidoChallengeOptions.challenge),
      };
      const assertion = (await navigator.credentials.get({
        publicKey: opts,
      })) as any;
      const toB64 = (buf: any) =>
        btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buf))));
      const assertionPayload = {
        id: assertion.id,
        rawId: toB64(assertion.rawId),
        type: assertion.type,
        response: {
          clientDataJSON: toB64(assertion.response.clientDataJSON),
          authenticatorData: toB64(assertion.response.authenticatorData),
          signature: toB64(assertion.response.signature),
          userHandle: assertion.response.userHandle
            ? toB64(assertion.response.userHandle)
            : null,
        },
      };
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/verify-fido2",
        {
          daId: fidoDaId,
          assertion: assertionPayload,
        },
      );
      setRawFidoVerify(data);
      if (data.success) {
        setFidoVerifyStatus(data.completed ? "passed" : "pending");
        if (data.pingoneRequest) setFidoVerifyPingoneReq(data.pingoneRequest);
        if (data.pingoneResponse) setFidoVerifyPingoneRes(data.pingoneResponse);
        notifySuccess(
          data.completed ? "FIDO2 verified " : "FIDO2 verification in progress",
        );
      } else {
        setFidoVerifyStatus("failed");
        setFidoVerifyError(data.error);
        if (data.pingoneRequest) setFidoVerifyPingoneReq(data.pingoneRequest);
        if (data.pingoneResponse) setFidoVerifyPingoneRes(data.pingoneResponse);
        notifyError(`FIDO2 verification failed: ${data.error}`);
      }
    } catch (err) {
      const errData = err?.response?.data;
      const detail = errData?.error || errData?.message || err.message;
      setRawFidoVerify(errData || { error: detail });
      setFidoVerifyStatus("failed");
      setFidoVerifyError(detail);
      if (errData?.pingoneRequest)
        setFidoVerifyPingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setFidoVerifyPingoneRes(errData.pingoneResponse);
      notifyError(`FIDO2 verification error: ${detail}`);
    }
  }, [fidoDaId, fidoChallengeOptions]);

  // Device enrollment functions
  const testEnrollSmsInit = useCallback(async () => {
    if (!enrollSmsPhone.trim()) {
      notifyError("Enter your phone number");
      return;
    }
    // Build E.164: dial code + local digits (strip non-digits and leading zeros)
    const dialCode = enrollSmsCountryCode.split("-")[0];
    const localPart = enrollSmsPhone
      .trim()
      .replace(/\D/g, "")
      .replace(/^0+/, "");
    const e164 = `${dialCode}${localPart}`;
    setEnrollSmsInitStatus("pending");
    setEnrollSmsInitError(null);
    setEnrollSmsDeviceId(null);
    setEnrollSmsAlreadyActive(false);
    setEnrollSmsOtp("");
    setEnrollSmsCompleteStatus("pending");
    setEnrollSmsCompleteError(null);
    try {
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/enroll-sms-init",
        { phone: e164 },
      );
      setRawEnrollSmsInit(data);
      if (data.pingoneRequest) setEnrollSmsInitPingoneReq(data.pingoneRequest);
      if (data.pingoneResponse)
        setEnrollSmsInitPingoneRes(data.pingoneResponse);
      if (data.success) {
        setEnrollSmsDeviceId(data.deviceId);
        setEnrollSmsInitStatus("passed");
        if (data.status === "ACTIVE") {
          // Management API enrolled the device directly as active — no OTP needed
          setEnrollSmsAlreadyActive(true);
          setEnrollSmsCompleteStatus("passed");
          notifySuccess(
            `SMS device enrolled and active for ${data.phone || e164}`,
          );
          loadDevices();
        } else {
          notifySuccess(
            `SMS device created — OTP sent to ${data.phone || e164}`,
          );
        }
      } else {
        setEnrollSmsInitStatus("failed");
        setEnrollSmsInitError(data.error);
        notifyError(`SMS enrollment failed: ${data.error}`);
      }
    } catch (err) {
      const errData = err?.response?.data;
      const detail = errData?.error || errData?.message || err.message;
      setRawEnrollSmsInit(errData || { error: detail });
      if (errData?.pingoneRequest)
        setEnrollSmsInitPingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setEnrollSmsInitPingoneRes(errData.pingoneResponse);
      setEnrollSmsInitStatus("failed");
      setEnrollSmsInitError(detail);
      notifyError(`SMS enrollment failed: ${detail}`);
    }
  }, [enrollSmsPhone, enrollSmsCountryCode, loadDevices]);

  const testEnrollSmsComplete = useCallback(async () => {
    if (!enrollSmsOtp || enrollSmsOtp.length !== 6) {
      notifyError("Enter the 6-digit OTP sent to your phone");
      return;
    }
    setEnrollSmsCompleteStatus("pending");
    setEnrollSmsCompleteError(null);
    try {
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/enroll-sms-complete",
        { deviceId: enrollSmsDeviceId, otp: enrollSmsOtp },
      );
      setRawEnrollSmsComplete(data);
      if (data.pingoneRequest)
        setEnrollSmsCompletePingoneReq(data.pingoneRequest);
      if (data.pingoneResponse)
        setEnrollSmsCompletePingoneRes(data.pingoneResponse);
      if (data.success) {
        setEnrollSmsCompleteStatus("passed");
        notifySuccess("SMS device activated successfully!");
        setEnrollSmsOtp("");
        loadDevices();
      } else {
        setEnrollSmsCompleteStatus("failed");
        setEnrollSmsCompleteError(data.error);
        notifyError(`SMS activation failed: ${data.error}`);
      }
    } catch (err) {
      const errData = err?.response?.data;
      setRawEnrollSmsComplete(errData || { error: err.message });
      if (errData?.pingoneRequest)
        setEnrollSmsCompletePingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setEnrollSmsCompletePingoneRes(errData.pingoneResponse);
      setEnrollSmsCompleteStatus("failed");
      setEnrollSmsCompleteError(err.message);
      notifyError(`SMS activation failed: ${err.message}`);
    }
  }, [enrollSmsDeviceId, enrollSmsOtp, loadDevices]);

  const testEnrollEmail = useCallback(async () => {
    if (!enrollEmailInput || !enrollEmailInput.trim()) {
      notifyError("Please enter an email address");
      return;
    }
    setEnrollEmailStatus("pending");
    setEnrollEmailError(null);
    try {
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/enroll-email",
        { email: enrollEmailInput.trim() },
      );
      setRawEnrollEmail(data);
      if (data.pingoneRequest) setEnrollEmailPingoneReq(data.pingoneRequest);
      if (data.pingoneResponse) setEnrollEmailPingoneRes(data.pingoneResponse);
      if (data.success) {
        setEnrollEmailStatus("passed");
        notifySuccess("Email device enrolled successfully");
        setEnrollEmailInput("");
        loadDevices(); // Refresh device list
      } else {
        setEnrollEmailStatus("failed");
        setEnrollEmailError(data.error);
        notifyError(`Email enrollment failed: ${data.error}`);
      }
    } catch (err) {
      const errData = err?.response?.data;
      setRawEnrollEmail(errData || { error: err.message });
      if (errData?.pingoneRequest)
        setEnrollEmailPingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setEnrollEmailPingoneRes(errData.pingoneResponse);
      setEnrollEmailStatus("failed");
      setEnrollEmailError(err.message);
      notifyError(`Email enrollment failed: ${err.message}`);
    }
  }, [enrollEmailInput, loadDevices]);

  const testFidoEnrollInit = useCallback(async () => {
    setFidoEnrollInitStatus("pending");
    setFidoEnrollInitError(null);
    setFidoEnrollData(null);
    try {
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/enroll-fido2-init",
        {},
      );
      setRawFidoEnrollInit(data);
      if (data.success) {
        setFidoEnrollData(data);
        setFidoEnrollInitStatus("passed");
        if (data.pingoneRequest)
          setFidoEnrollInitPingoneReq(data.pingoneRequest);
        if (data.pingoneResponse)
          setFidoEnrollInitPingoneRes(data.pingoneResponse);
        notifySuccess(
          "FIDO2 enrollment initiated — click Complete Registration to register your device",
        );
      } else {
        setFidoEnrollInitStatus("failed");
        setFidoEnrollInitError(data.message || data.error);
        if (data.existingDevice) setExistingFido2Device(data.existingDevice);
        if (data.pingoneRequest)
          setFidoEnrollInitPingoneReq(data.pingoneRequest);
        if (data.pingoneResponse)
          setFidoEnrollInitPingoneRes(data.pingoneResponse);
        notifyError(`FIDO2 enrollment initiation failed: ${data.error}`);
      }
    } catch (err) {
      const errData = err?.response?.data;
      const detail = errData?.message || errData?.error || err.message;
      setRawFidoEnrollInit(errData || { error: detail });
      setFidoEnrollInitStatus("failed");
      setFidoEnrollInitError(detail);
      if (errData?.existingDevice)
        setExistingFido2Device(errData.existingDevice);
      if (errData?.pingoneRequest)
        setFidoEnrollInitPingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setFidoEnrollInitPingoneRes(errData.pingoneResponse);
      notifyError(`FIDO2 enrollment initiation failed: ${detail}`);
    }
  }, []);

  // Auto-trigger FIDO2 enrollment when challenge initiated but no device enrolled
  useEffect(() => {
    if (autoEnrollFido && fidoEnrollInitStatus === "pending") {
      testFidoEnrollInit();
    }
  }, [autoEnrollFido, fidoEnrollInitStatus, testFidoEnrollInit]);

  // Auto-trigger Email enrollment when challenge initiated but no device enrolled
  useEffect(() => {
    if (autoEnrollEmail && enrollEmailStatus === "pending") {
      testEnrollEmail();
    }
  }, [autoEnrollEmail, enrollEmailStatus, testEnrollEmail]);

  // Note: SMS enrollment is automatic via PingOne profile phone number update
  // No direct enrollment endpoint, but detection alerts user to phone number configuration

  const testFidoEnrollComplete = useCallback(async () => {
    if (
      !fidoEnrollData?.deviceId ||
      !fidoEnrollData?.publicKeyCredentialCreationOptions
    ) {
      notifyError("Initiate FIDO2 enrollment first");
      return;
    }
    setFidoEnrollCompleteStatus("pending");
    setFidoEnrollCompleteError(null);
    try {
      if (!navigator.credentials)
        throw new Error("WebAuthn not supported in this browser");
      // PingOne may return publicKeyCredentialCreationOptions as a JSON string
      const rawOpts = fidoEnrollData.publicKeyCredentialCreationOptions;
      const creationOpts =
        typeof rawOpts === "string" ? JSON.parse(rawOpts) : rawOpts;
      if (!creationOpts)
        throw new Error("Missing publicKeyCredentialCreationOptions");
      console.log(
        "[FIDO2] creationOpts challenge:",
        creationOpts.challenge,
        "user.id:",
        creationOpts.user?.id,
      );

      // Convert base64url or signed byte array (PingOne) → Uint8Array
      const safeBase64ToBytes = (val) => {
        if (!val)
          throw new Error(`Expected base64url but got: ${JSON.stringify(val)}`);
        if (val instanceof Uint8Array) return val;
        if (val instanceof ArrayBuffer) return new Uint8Array(val);
        // PingOne sometimes returns signed byte arrays (Java-style) — convert directly
        if (Array.isArray(val)) return new Uint8Array(val.map((b) => b & 0xff));
        // Strip whitespace, normalise base64url alphabet, re-pad
        const stripped = String(val)
          .replace(/\s/g, "")
          .replace(/-/g, "+")
          .replace(/_/g, "/")
          .replace(/=+$/, "");
        const padded = stripped + "=".repeat((4 - (stripped.length % 4)) % 4);
        try {
          return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
        } catch (e) {
          console.error(
            "[FIDO2] atob failed — raw val:",
            val,
            "padded:",
            padded,
          );
          throw new Error(
            `base64 decode failed (first 20: "${padded.slice(0, 20)}"): ${e.message}`,
          );
        }
      };

      const publicKey = {
        ...creationOpts,
        challenge: safeBase64ToBytes(creationOpts.challenge),
        user: {
          ...creationOpts.user,
          id: safeBase64ToBytes(creationOpts.user?.id),
        },
      };
      // Fix: PingOne returns pubKeyCredParams[].alg as strings ("-7") but
      // WebAuthn requires integers (-7). Browser silently drops string-alg entries.
      if (Array.isArray(publicKey.pubKeyCredParams)) {
        publicKey.pubKeyCredParams = publicKey.pubKeyCredParams.map((p) => ({
          ...p,
          alg: typeof p.alg === "string" ? parseInt(p.alg, 10) : p.alg,
        }));
        console.log(
          "[FIDO2] pubKeyCredParams alg coerced to int:",
          publicKey.pubKeyCredParams,
        );
      }
      // Convert excludeCredentials ids (PingOne sends base64url strings)
      if (Array.isArray(publicKey.excludeCredentials)) {
        publicKey.excludeCredentials = publicKey.excludeCredentials.map(
          (c) => ({
            ...c,
            id: safeBase64ToBytes(c.id),
          }),
        );
      }
      console.log(
        "[FIDO2] publicKey for navigator.credentials.create:",
        JSON.stringify(
          {
            rpId: publicKey.rp?.id,
            rpName: publicKey.rp?.name,
            authenticatorSelection: publicKey.authenticatorSelection,
            attestation: publicKey.attestation,
            excludeCredentials:
              (publicKey.excludeCredentials || []).length + " entries",
            pubKeyCredParams: publicKey.pubKeyCredParams,
          },
          null,
          2,
        ),
      );
      const credential = (await navigator.credentials.create({
        publicKey,
      })) as any;
      const toB64 = (buf: any) => {
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i++)
          binary += String.fromCharCode(bytes[i]);
        return btoa(binary); // standard base64 with = padding, no URL-safe substitution
      };
      const attestation = {
        id: credential.id, // browser returns base64url already
        rawId: toB64(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: toB64(credential.response.clientDataJSON),
          attestationObject: toB64(credential.response.attestationObject),
        },
        // Include authenticatorAttachment if present (passkey = "platform")
        ...(credential.authenticatorAttachment
          ? { authenticatorAttachment: credential.authenticatorAttachment }
          : {}),
      };
      const { data } = await apiClient.post(
        "/api/mfa/test/integration/enroll-fido2-complete",
        {
          deviceId: fidoEnrollData.deviceId,
          attestation,
          origin: window.location.origin,
        },
      );
      setRawFidoEnrollComplete(data);
      if (data.success) {
        setFidoEnrollCompleteStatus("passed");
        if (data.pingoneRequest)
          setFidoEnrollCompletePingoneReq(data.pingoneRequest);
        if (data.pingoneResponse)
          setFidoEnrollCompletePingoneRes(data.pingoneResponse);
        notifySuccess("FIDO2 device registered ");
        loadDevices();
      } else {
        setFidoEnrollCompleteStatus("failed");
        setFidoEnrollCompleteError(data.error);
        if (data.pingoneRequest)
          setFidoEnrollCompletePingoneReq(data.pingoneRequest);
        if (data.pingoneResponse)
          setFidoEnrollCompletePingoneRes(data.pingoneResponse);
        notifyError(`FIDO2 registration failed: ${data.error}`);
      }
    } catch (err) {
      const errData = err?.response?.data;
      const detail = errData?.error || errData?.message || err.message;
      setRawFidoEnrollComplete(errData || { error: detail });
      setFidoEnrollCompleteStatus("failed");
      setFidoEnrollCompleteError(detail);
      if (errData?.pingoneRequest)
        setFidoEnrollCompletePingoneReq(errData.pingoneRequest);
      if (errData?.pingoneResponse)
        setFidoEnrollCompletePingoneRes(errData.pingoneResponse);
      notifyError(`FIDO2 registration error: ${detail}`);
    }
  }, [fidoEnrollData, loadDevices]);

  if (loading) {
    return (
      <div className="mfa-test-page">
        <div className="mfa-test-loading">
          <div className="spinner" />
          <p>Loading MFA test environment...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mfa-test-page">
        <div className="mfa-test-error">
          <p className="error-message">{error}</p>
          <button
            type="button"
            className="mfa-test-button mfa-test-button--primary"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mfa-test-page">
      <div className="mfa-test-header">
        <h1 className="mfa-test-title">PingOne MFA Test Page</h1>
        <div className="mfa-test-meta">
          <div className="mfa-test-status">
            <span
              className={`mfa-status-pill ${config?.mfaEnabled && workerTokenStatus === "valid" ? "mfa-status-pill--success" : "mfa-status-pill--error"}`}
            >
              {config?.mfaEnabled && workerTokenStatus === "valid"
                ? " Ready"
                : !config?.mfaEnabled
                  ? " MFA Disabled"
                  : " Worker Token Missing"}
            </span>
          </div>
          <div className="mfa-test-actions">
            <button
              type="button"
              className="mfa-test-button mfa-test-button--logs"
              onClick={() => setLogsModalOpen(true)}
            >
              View Logs
            </button>
            <button
              type="button"
              className="mfa-test-button mfa-test-button--secondary"
              onClick={loadWorkerToken}
            >
              Refresh Worker Token
            </button>
            <button
              type="button"
              className="mfa-test-button mfa-test-button--secondary"
              onClick={loadDevices}
            >
              Refresh Devices
            </button>
            <button
              type="button"
              className="mfa-test-button mfa-test-button--secondary"
              onClick={fixFido2Rp}
              disabled={fixRpStatus === "loading"}
              title="Set PingOne FIDO2 policy Relying Party ID to this site's hostname so passkey registration works"
            >
              {fixRpStatus === "loading" ? "Fixing…" : "Fix Passkey RP"}
            </button>
          </div>
        </div>
        {(fixRpStatus === "done" || fixRpStatus === "error") && fixRpResult && (
          <div
            className={`mfa-test-info-banner${fixRpStatus === "error" ? " mfa-test-info-banner--error" : ""}`}
            role="alert"
          >
            <strong>{fixRpStatus === "done" ? "Passkey RP:" : "Fix RP Error:"}</strong> {fixRpResult}
          </div>
        )}

        {/* User picker combobox — searchable PingOne user list */}
        {(() => {
          // Always keep demoUser (defaultUser) pinned at the top so it's visible
          // even though it sits beyond the first 100-user page from PingOne.
          const baseUsers =
            defaultUser && !pingoneUsers.some((u) => u.id === defaultUser.id)
              ? [defaultUser, ...pingoneUsers]
              : pingoneUsers;
          // baseUsers always contains defaultUser (when set), so this also
          // resolves the pinned demoUser default.
          const selectedUser = baseUsers.find((u) => u.id === testUserId);
          // Filter users by search term (client-side fallback for server filtering)
          const displayUsers = userSearch
            ? baseUsers.filter(
                (u) =>
                  u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
                  (u.name &&
                    u.name.toLowerCase().includes(userSearch.toLowerCase())) ||
                  (u.email &&
                    u.email.toLowerCase().includes(userSearch.toLowerCase())),
              )
            : baseUsers;
          return (
            <div className="mfa-user-picker">
              <label className="mfa-user-picker__label">Test as User:</label>
              <div className="mfa-user-picker__combobox">
                <input
                  id="mfa-user-search"
                  type="text"
                  className="mfa-user-picker__input"
                  placeholder={
                    usersLoading
                      ? "Loading users…"
                      : selectedUser
                        ? `${selectedUser.name || selectedUser.username} — ${selectedUser.email || selectedUser.username}`
                        : "Search users…"
                  }
                  value={userSearch}
                  onChange={(e) => handleUserSearch(e.target.value)}
                  onFocus={() => {
                    setUserPickerOpen(true);
                    if (!pingoneUsers.length) loadPingoneUsers();
                  }}
                  onBlur={() => setTimeout(() => setUserPickerOpen(false), 150)}
                  autoComplete="off"
                  disabled={usersLoading}
                />
                {userPickerOpen && (
                  <ul className="mfa-user-picker__dropdown" role="listbox">
                    {!userSearch && (
                      <li
                        className={
                          "mfa-user-picker__option" +
                          (!testUserId
                            ? " mfa-user-picker__option--selected"
                            : "")
                        }
                        onMouseDown={() => {
                          setTestUserId("");
                          setUserSearch("");
                          setUserPickerOpen(false);
                          loadDevices();
                        }}
                        role="option"
                        aria-selected={!testUserId}
                      >
                        <span className="mfa-user-picker__opt-name">
                          — Session user —
                        </span>
                      </li>
                    )}
                    {usersLoading && (
                      <li
                        className="mfa-user-picker__option"
                        style={{
                          color: "#94a3b8",
                          fontStyle: "italic",
                          pointerEvents: "none",
                        }}
                        role="option"
                        aria-selected={false}
                      >
                        <span className="mfa-user-picker__opt-name">
                          Searching…
                        </span>
                      </li>
                    )}
                    {!usersLoading &&
                      displayUsers.length === 0 &&
                      userSearch && (
                        <li
                          className="mfa-user-picker__option"
                          style={{
                            color: "#94a3b8",
                            fontStyle: "italic",
                            pointerEvents: "none",
                          }}
                          role="option"
                          aria-selected={false}
                        >
                          <span className="mfa-user-picker__opt-name">
                            No users found for "{userSearch}"
                          </span>
                        </li>
                      )}
                    {!usersLoading &&
                      displayUsers.map((u) => (
                        <li
                          key={u.id}
                          className={
                            "mfa-user-picker__option" +
                            (u.id === testUserId
                              ? " mfa-user-picker__option--selected"
                              : "")
                          }
                          onMouseDown={() => {
                            setTestUserId(u.id);
                            setUserSearch("");
                            setUserPickerOpen(false);
                            setPingoneUsers([]);
                            loadPingoneUsers();
                            loadDevices();
                          }}
                          role="option"
                          aria-selected={u.id === testUserId}
                        >
                          <span className="mfa-user-picker__opt-name">
                            {u.name || u.username}
                          </span>
                          <span className="mfa-user-picker__opt-email">
                            {u.email || u.username}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
              <button
                type="button"
                className="mfa-user-picker__refresh"
                onClick={() => loadPingoneUsers()}
                title="Reload user list from PingOne"
              >
                ↻
              </button>
              {testUserId && (
                <>
                  <button
                    type="button"
                    className="mfa-user-picker__clear"
                    onClick={() => {
                      setTestUserId("");
                      setUserSearch("");
                      loadDevices();
                    }}
                  >
                    Clear
                  </button>
                  <span className="mfa-user-picker__active">
                    Override active
                  </span>
                </>
              )}
            </div>
          );
        })()}

        {workerTokenError && (
          <div
            className="mfa-test-info-banner mfa-test-info-banner--error"
            role="alert"
          >
            <strong>Worker Token Error:</strong> {workerTokenError}
          </div>
        )}
      </div>

      <div className="mfa-test-content">
        {/* Info banner when using auto-resolved default policy */}
        {config?.policySource === "auto" && (
          <div className="mfa-test-info-banner">
            <strong>Using default MFA policy</strong>
            <p>
              <code>PINGONE_MFA_POLICY_ID</code> is not set — the server will
              automatically resolve the default MFA policy from your PingOne
              environment at runtime.
            </p>
            <p>
              To pin a specific policy: set{" "}
              <code>PINGONE_MFA_POLICY_ID=&lt;id&gt;</code> in your{" "}
              <code>.env</code>.
            </p>
          </div>
        )}

        <ApiCallPreviewCard
          method="POST"
          endpoint="https://auth.pingone.com/{environmentId}/as/bc-authorize"
          requestBody={{
            scope: "openid",
            login_hint: "<user_email>",
            binding_message: "Approve banking transaction",
            request_expiry: 120,
          }}
          docUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-backchannel-authentication-request"
          docLabel="PingOne CIBA Docs"
          description="CIBA back-channel authentication — sends push notification to user's authenticator app for step-up approval"
        />
        {/* Configuration Section */}
        <section className="mfa-test-section">
          <h2 className="mfa-test-section-title">MFA Configuration</h2>
          <div className="config-display">
            <div className="config-item">
              <span className="config-label">Policy ID:</span>
              <span className="config-value">
                {config?.policyId || "Not configured"}
              </span>
            </div>
            <div className="config-item">
              <span className="config-label">ACR Value:</span>
              <span className="config-value">
                {config?.acrValue || "Not configured"}
              </span>
            </div>
            <div className="config-item">
              <span className="config-label">Threshold:</span>
              <span className="config-value">
                ${config?.threshold?.toFixed(2) || "500.00"}
              </span>
            </div>
          </div>
        </section>
        {/* Device Management Section */}
        <section className="mfa-test-section">
          <h2 className="mfa-test-section-title">Devices</h2>
          <WhatIsHappening
            title="Device Management — Listing Enrolled MFA Devices"
            steps={[
              "GET /api/mfa/test/devices → BFF calls PingOne Management API to list all MFA devices for the authenticated user",
              "Each device has: type (SMS, EMAIL, FIDO2_BIOMETRICS), nickname/email, status (ACTIVE, INACTIVE), and enrolledAt date",
              "Devices are the registered MFA factors — each one can be used to satisfy an MFA challenge",
              "Admins can disable or delete devices via PingOne console or Management API",
            ]}
            apiFlow={[
              {
                method: "GET",
                endpoint: "/api/mfa/test/devices",
                note: "List enrolled MFA devices",
              },
              {
                method: "GET",
                endpoint: "/v1/environments/{envId}/users/{userId}/devices",
                note: "PingOne Management API",
              },
            ]}
          />
          <MFATestCard
            title="List Devices"
            status={devicesStatus}
            error={devicesError}
            onTest={loadDevices}
            rawResult={rawDevices}
            pingoneRequest={devicesPingoneReq}
            pingoneResponse={devicesPingoneRes}
            docsUrl="https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/read-all-mfa-user-devices.html"
            docsSectionTitle="Device Management — List MFA Devices"
            endpoint="/v1/environments/{envId}/users/{userId}/devices"
            method="GET"
          />
          {devices.length > 0 && (
            <div className="devices-list">
              <h3 className="devices-list-title">Enrolled Devices</h3>
              <ul className="devices-items">
                {devices.map((device) => (
                  <li key={device.id} className="device-item">
                    <span className="device-type">{device.type}</span>
                    <span className="device-nickname">
                      {device.nickname || device.email || "—"}
                    </span>
                    <span
                      className={`device-status device-status--${(device.status || "unknown").toLowerCase()}`}
                    >
                      {device.status || "UNKNOWN"}
                    </span>
                    <span className="device-meta">
                      ID: {device.id?.substring(0, 12)}…
                    </span>
                    {device.createdAt && (
                      <span className="device-meta">
                        Enrolled:{" "}
                        {new Date(device.createdAt).toLocaleDateString()}
                      </span>
                    )}
                    <button
                      type="button"
                      className="mfa-test-button mfa-test-button--danger"
                      disabled={deletingDeviceId === device.id}
                      onClick={() => deleteDevice(device.id)}
                      style={{
                        marginLeft: "auto",
                        padding: "2px 10px",
                        fontSize: "0.8rem",
                      }}
                    >
                      {deletingDeviceId === device.id ? "Deleting…" : "Delete"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Device Enrollment Section */}
        <section className="mfa-test-section">
          <h2 className="mfa-test-section-title">Device Registration</h2>
          <WhatIsHappening
            title="Device Enrollment — Registering a New MFA Device"
            steps={[
              "SMS enrollment (Step 1): POST enroll-sms-init with phone → PingOne creates SMS device and texts an OTP",
              "SMS enrollment (Step 2): POST enroll-sms-complete with deviceId + OTP → PingOne activates the device",
              "Email enrollment: POST enroll-email → PingOne creates an EMAIL device record for the user",
              "FIDO2 enrollment (Step 1): POST enroll-fido2-init → PingOne returns publicKeyCredentialCreationOptions",
              "FIDO2 enrollment (Step 2): Browser calls navigator.credentials.create() — private key stays in device secure enclave",
              "FIDO2 enrollment (Step 3): POST enroll-fido2-complete with attestation → PingOne stores the public key",
            ]}
            apiFlow={[
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/enroll-sms-init",
                note: "Create SMS device + send OTP",
              },
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/enroll-sms-complete",
                note: "Activate with OTP",
              },
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/enroll-email",
                note: "Register email device",
              },
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/enroll-fido2-init",
                note: "Get WebAuthn creation options",
              },
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/enroll-fido2-complete",
                note: "Submit attestation",
              },
            ]}
          />

          {/* ── SMS Enrollment ── */}
          <h3
            style={{
              margin: "1rem 0 0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            SMS Device
          </h3>
          <div style={{ marginBottom: "1rem" }}>
            <label
              htmlFor="enroll-sms-phone"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "600",
              }}
            >
              Phone Number:
            </label>
            <div
              style={{
                display: "flex",
                gap: "0.5rem",
                marginBottom: "0.25rem",
              }}
            >
              <select
                value={enrollSmsCountryCode}
                onChange={(e) => setEnrollSmsCountryCode(e.target.value)}
                style={{
                  flexShrink: 0,
                  width: "8rem",
                  padding: "0.5rem",
                  borderRadius: "0.375rem",
                  border: "1px solid #d1d5db",
                  fontSize: "0.875rem",
                }}
              >
                <option value="+1"> +1 US</option>
                <option value="+1-CA"> +1 CA</option>
                <option value="+44"> +44 UK</option>
                <option value="+61"> +61 AU</option>
                <option value="+64">+64 NZ</option>
                <option value="+49"> +49 DE</option>
                <option value="+33"> +33 FR</option>
                <option value="+34"> +34 ES</option>
                <option value="+39"> +39 IT</option>
                <option value="+31">+31 NL</option>
                <option value="+46">+46 SE</option>
                <option value="+47">+47 NO</option>
                <option value="+45">+45 DK</option>
                <option value="+358">+358 FI</option>
                <option value="+41">+41 CH</option>
                <option value="+43">+43 AT</option>
                <option value="+32">+32 BE</option>
                <option value="+353">+353 IE</option>
                <option value="+351">+351 PT</option>
                <option value="+81"> +81 JP</option>
                <option value="+82"> +82 KR</option>
                <option value="+86">+86 CN</option>
                <option value="+91"> +91 IN</option>
                <option value="+65">+65 SG</option>
                <option value="+60">+60 MY</option>
                <option value="+52"> +52 MX</option>
                <option value="+55"> +55 BR</option>
                <option value="+27"> +27 ZA</option>
                <option value="+971">+971 AE</option>
                <option value="+966"> +966 SA</option>
                <option value="+972"> +972 IL</option>
              </select>
              <input
                id="enroll-sms-phone"
                type="tel"
                className="otp-input"
                placeholder="415 555 0100"
                value={enrollSmsPhone}
                onChange={(e) => setEnrollSmsPhone(e.target.value)}
                maxLength={15}
                style={{ flex: 1, letterSpacing: "0.05rem" }}
              />
            </div>
            <p
              style={{
                fontSize: "0.75rem",
                color: "#6b7280",
                margin: "0 0 0.75rem",
              }}
            >
              Digits only, no leading zero — e.g. 415 555 0100
            </p>
          </div>
          <MFATestCard
            title="Enroll SMS Device"
            status={enrollSmsInitStatus}
            error={enrollSmsInitError}
            onTest={testEnrollSmsInit}
            endpoint="/v1/environments/{envId}/users/{userId}/devices"
            rawResult={rawEnrollSmsInit}
            pingoneRequest={enrollSmsInitPingoneReq}
            pingoneResponse={enrollSmsInitPingoneRes}
            docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-create-device-sms"
            docsSectionTitle="MFA Enroll SMS Device — Init"
          />
          {enrollSmsDeviceId && !enrollSmsAlreadyActive && (
            <div className="otp-verify-section" style={{ marginTop: "0.5rem" }}>
              <p className="info-text" style={{ marginBottom: "0.5rem" }}>
                OTP sent — enter the code from your phone to activate:
              </p>
              <div className="otp-input-group">
                <input
                  type="text"
                  className="otp-input"
                  placeholder="6-digit OTP"
                  value={enrollSmsOtp}
                  onChange={(e) =>
                    setEnrollSmsOtp(
                      e.target.value.replace(/\D/g, "").slice(0, 6),
                    )
                  }
                  maxLength={6}
                  autoFocus
                />
                <button
                  type="button"
                  className="mfa-test-button mfa-test-button--primary"
                  onClick={testEnrollSmsComplete}
                  disabled={enrollSmsOtp.length !== 6}
                >
                  Activate SMS Device
                </button>
              </div>
              <MFATestCard
                title="Activate SMS Device (Step 2)"
                status={enrollSmsCompleteStatus}
                error={enrollSmsCompleteError}
                onTest={testEnrollSmsComplete}
                endpoint="/v1/environments/{envId}/users/{userId}/devices/{deviceId}"
                rawResult={rawEnrollSmsComplete}
                pingoneRequest={enrollSmsCompletePingoneReq}
                pingoneResponse={enrollSmsCompletePingoneRes}
                docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-activate-device"
                docsSectionTitle="MFA Enroll SMS Device — Complete"
              />
            </div>
          )}

          {/* ── Email Enrollment ── */}
          <h3
            style={{
              margin: "1rem 0 0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            Email Device
          </h3>
          <div style={{ marginBottom: "1rem" }}>
            <label
              htmlFor="enroll-email-input"
              style={{
                display: "block",
                marginBottom: "0.5rem",
                fontWeight: "600",
              }}
            >
              Email to Enroll:
            </label>
            <input
              id="enroll-email-input"
              type="email"
              className="otp-input"
              placeholder="user@example.com"
              value={enrollEmailInput}
              onChange={(e) => setEnrollEmailInput(e.target.value)}
              maxLength={100}
              style={{
                width: "100%",
                marginBottom: "0.75rem",
                fontFamily: "system-ui, sans-serif",
                letterSpacing: "normal",
                fontSize: "0.95rem",
              }}
            />
          </div>
          <MFATestCard
            title="Enroll Email Device"
            status={enrollEmailStatus}
            error={enrollEmailError}
            onTest={testEnrollEmail}
            endpoint="/v1/environments/{envId}/users/{userId}/devices"
            rawResult={rawEnrollEmail}
            pingoneRequest={enrollEmailPingoneReq}
            pingoneResponse={enrollEmailPingoneRes}
            docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-create-device-email"
            docsSectionTitle="MFA Enroll Email Device"
          />

          {/* ── FIDO2 Enrollment ── */}
          <h3
            style={{
              margin: "1rem 0 0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
            }}
          >
            FIDO2 / Passkey
          </h3>
          {existingFido2Device && (
            <div
              style={{
                padding: "0.75rem 1rem",
                marginBottom: "0.75rem",
                background: "#fef3c7",
                border: "1px solid #f59e0b",
                borderRadius: 8,
                display: "flex",
                alignItems: "center",
                gap: 12,
                fontSize: "0.88rem",
              }}
            >
              <span>
                <strong>Existing FIDO2 device detected.</strong> PingOne only
                allows one active passkey per RP. Delete the existing device
                first, then re-enroll.
              </span>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  color: "#92400e",
                }}
              >
                {existingFido2Device.nickname || existingFido2Device.type} ·{" "}
                {existingFido2Device.id?.slice(0, 12)}…
              </span>
              <button
                type="button"
                className="mfa-test-button mfa-test-button--danger"
                disabled={deletingDeviceId === existingFido2Device.id}
                onClick={() => deleteDevice(existingFido2Device.id)}
                style={{ marginLeft: "auto", whiteSpace: "nowrap" }}
              >
                {deletingDeviceId === existingFido2Device.id
                  ? "Deleting…"
                  : "Delete & Re-enroll"}
              </button>
            </div>
          )}
          <MFATestCard
            title="Initiate FIDO2 Enrollment"
            status={fidoEnrollInitStatus}
            error={fidoEnrollInitError}
            onTest={testFidoEnrollInit}
            endpoint="/v1/environments/{envId}/users/{userId}/devices"
            rawResult={rawFidoEnrollInit}
            pingoneRequest={fidoEnrollInitPingoneReq}
            pingoneResponse={fidoEnrollInitPingoneRes}
            docsUrl="https://developer.pingidentity.com/pingone-api/mfa/users/mfa-devices/fido2-biometrics-devices/create-mfa-user-device-fido2---security_key.html"
            docsSectionTitle="FIDO2 Enroll — Init Registration"
          />
          {fidoEnrollData?.publicKeyCredentialCreationOptions &&
            (() => {
              const raw = fidoEnrollData.publicKeyCredentialCreationOptions;
              const opts = typeof raw === "string" ? JSON.parse(raw) : raw;
              const rpId = opts?.rp?.id || "—";
              const rpName = opts?.rp?.name || "—";
              const currentOrigin = window.location.origin;
              const currentHostname = window.location.hostname;
              const match =
                rpId === currentHostname ||
                currentHostname.endsWith(`.${rpId}`);
              const excludeCount = (opts?.excludeCredentials || []).length;
              const authSel = opts?.authenticatorSelection;
              return (
                <div
                  style={{
                    margin: "0.5rem 0",
                    padding: "0.75rem 1rem",
                    background: match ? "#f0fdf4" : "#fef2f2",
                    border: `1px solid ${match ? "#bbf7d0" : "#fecaca"}`,
                    borderRadius: 8,
                    fontSize: "0.85rem",
                    fontFamily: "monospace",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 700,
                      marginBottom: 4,
                      color: match ? "#166534" : "#991b1b",
                    }}
                  >
                    {match ? "" : ""} FIDO2 RP ID Debug
                  </div>
                  <div>
                    <strong>PingOne rp.id:</strong> {rpId}
                  </div>
                  <div>
                    <strong>PingOne rp.name:</strong> {rpName}
                  </div>
                  <div>
                    <strong>Browser origin:</strong> {currentOrigin}
                  </div>
                  <div>
                    <strong>Browser hostname:</strong> {currentHostname}
                  </div>
                  <div>
                    <strong>RP ID match:</strong>{" "}
                    {match ? (
                      <span style={{ color: "#166534" }}>
                        {" "}
                        Hostname matches RP ID
                      </span>
                    ) : (
                      <span style={{ color: "#991b1b" }}>
                        {" "}
                        MISMATCH — browser will reject or PingOne will fail
                        attestation validation
                      </span>
                    )}
                  </div>
                  <div>
                    <strong>excludeCredentials:</strong> {excludeCount}{" "}
                    device(s)
                    {excludeCount > 0 && (
                      <span style={{ color: "#991b1b" }}>
                        {" "}
                        — existing passkey may block re-enrollment
                      </span>
                    )}
                  </div>
                  {authSel && (
                    <div>
                      <strong>authenticatorSelection:</strong> attachment=
                      {authSel.authenticatorAttachment || "any"}, residentKey=
                      {authSel.residentKey || "—"}, userVerification=
                      {authSel.userVerification || "—"}
                    </div>
                  )}
                </div>
              );
            })()}
          {fidoEnrollData?.publicKeyCredentialCreationOptions && (
            <MFATestCard
              title="Complete FIDO2 Registration"
              status={fidoEnrollCompleteStatus}
              error={fidoEnrollCompleteError}
              onTest={testFidoEnrollComplete}
              endpoint="/v1/environments/{envId}/users/{userId}/devices/{deviceId}"
              rawResult={rawFidoEnrollComplete}
              pingoneRequest={fidoEnrollCompletePingoneReq}
              pingoneResponse={fidoEnrollCompletePingoneRes}
              docsUrl="https://apidocs.pingidentity.com/pingone/platform/v1/api/#post-activate-device"
              docsSectionTitle="FIDO2 Enroll — Complete Registration"
            />
          )}
        </section>

        {/* Authentication Test Sections Header */}
        <h2
          className="mfa-test-section-title"
          style={{ margin: "2rem 0 1rem" }}
        >
          Authentication
        </h2>

        {/* SMS OTP Test Section */}
        <section className="mfa-test-section">
          <h2 className="mfa-test-section-title">SMS OTP Testing</h2>
          <WhatIsHappening
            title="SMS OTP — One-Time Password via text message"
            steps={[
              "POST /api/mfa/test/integration/initiate with method=sms → PingOne creates a device authorization (DA)",
              "PingOne sends a 6-digit OTP to the user's registered phone number",
              "User enters the OTP; POST /api/mfa/test/integration/verify-otp with the code + daId",
              "PingOne validates the OTP and marks the DA as COMPLETED",
              "The DA ID ties all steps together — it is the session reference for this MFA challenge",
            ]}
            apiFlow={[
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/initiate",
                note: "method=sms",
              },
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/verify-otp",
                note: "Submit 6-digit code",
              },
            ]}
          />
          <MFATestCard
            title="Initiate SMS OTP Challenge"
            status={smsInitiateStatus}
            error={smsInitiateError}
            onTest={testSmsInitiate}
            endpoint="/v1/environments/{envId}/as/deviceAuthentications"
            rawResult={rawSmsInitiate}
            pingoneRequest={smsInitiatePingoneReq}
            pingoneResponse={smsInitiatePingoneRes}
            docsUrl="https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/initialize-device-authentication.html"
            docsSectionTitle="MFA Challenge — Initiate (SMS)"
          />
          {(smsSelectDevicePingoneReq || smsSelectDevicePingoneRes) && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "0.375rem",
              }}
            >
              <h4
                style={{
                  margin: "0 0 0.5rem 0",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  color: "#166534",
                }}
              >
                Select Device (automatic)
              </h4>
              <PingOneApiPanel
                request={smsSelectDevicePingoneReq}
                response={smsSelectDevicePingoneRes}
                endpoint={{
                  method: "PUT",
                  url: "/v1/environments/{envId}/deviceAuthentications/{daId}",
                }}
                docsUrl="https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/select-device-authentication.html"
                docsSectionTitle="MFA Device Selection"
              />
            </div>
          )}
          {smsDaId && (
            <div className="otp-verify-section">
              <DaResponseCard daId={smsDaId} method="sms" />
              <h3 className="otp-verify-title">Verify SMS OTP</h3>
              {noSmsDeviceDetected ? (
                <div className="otp-no-device-banner">
                  <p className="info-text">
                    <strong>No SMS device found</strong> — this user needs an
                    SMS-enabled phone number registered in PingOne.
                  </p>
                  <p
                    className="info-text"
                    style={{ fontSize: "0.9em", marginTop: "8px" }}
                  >
                    SMS devices are managed via the PingOne user profile phone
                    number field. Update the user's phone number or enroll a
                    different MFA method (Email, FIDO2).
                  </p>
                </div>
              ) : (
                <div className="otp-input-group">
                  <input
                    type="text"
                    className="otp-input"
                    placeholder="Enter 6-digit OTP code"
                    value={smsOtp}
                    onChange={(e) => setSmsOtp(e.target.value)}
                    maxLength={6}
                  />
                  <button
                    type="button"
                    className="mfa-test-button mfa-test-button--primary"
                    onClick={testSmsVerify}
                    disabled={!smsOtp || smsOtp.length !== 6}
                  >
                    Verify OTP
                  </button>
                </div>
              )}
              <MFATestCard
                title="Verify SMS OTP"
                status={smsVerifyStatus}
                error={smsVerifyError}
                onTest={testSmsVerify}
                rawResult={rawSmsVerify}
                pingoneRequest={smsVerifyPingoneReq}
                pingoneResponse={smsVerifyPingoneRes}
                docsUrl="https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/validate-otp-device-authentication.html"
                docsSectionTitle="MFA Verify OTP (SMS)"
                endpoint="/v1/environments/{envId}/deviceAuthentications/{daId}"
                method="PUT"
              />
            </div>
          )}
        </section>

        {/* Email OTP Test Section */}
        <section className="mfa-test-section">
          <h2 className="mfa-test-section-title">Email OTP Testing</h2>
          <WhatIsHappening
            title="Email OTP — One-Time Password via email"
            steps={[
              "Identical flow to SMS but OTP is sent to the user's registered email address",
              "POST /api/mfa/test/integration/initiate with method=email → PingOne sends OTP email",
              "User retrieves OTP from email and submits via verify-otp endpoint",
            ]}
            apiFlow={[
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/initiate",
                note: "method=email",
              },
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/verify-otp",
                note: "Submit 6-digit code",
              },
            ]}
          />
          <MFATestCard
            title="Initiate Email OTP Challenge"
            status={emailInitiateStatus}
            error={emailInitiateError}
            onTest={testEmailInitiate}
            endpoint="/v1/environments/{envId}/as/deviceAuthentications"
            rawResult={rawEmailInitiate}
            pingoneRequest={emailInitiatePingoneReq}
            pingoneResponse={emailInitiatePingoneRes}
            docsUrl="https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/initialize-device-authentication.html"
            docsSectionTitle="MFA Challenge — Initiate (Email OTP)"
          />
          {(emailSelectDevicePingoneReq || emailSelectDevicePingoneRes) && (
            <div
              style={{
                marginTop: "0.75rem",
                padding: "0.75rem",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: "0.375rem",
              }}
            >
              <h4
                style={{
                  margin: "0 0 0.5rem 0",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  color: "#166534",
                }}
              >
                Select Device (automatic)
              </h4>
              <PingOneApiPanel
                request={emailSelectDevicePingoneReq}
                response={emailSelectDevicePingoneRes}
                endpoint={{
                  method: "PUT",
                  url: "/v1/environments/{envId}/deviceAuthentications/{daId}",
                }}
                docsUrl="https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/select-device-authentication.html"
                docsSectionTitle="MFA Device Selection"
              />
            </div>
          )}
          {emailDaId && (
            <div className="otp-verify-section">
              <DaResponseCard daId={emailDaId} method="email" />
              <h3 className="otp-verify-title">Verify Email OTP</h3>
              {noEmailDeviceDetected ? (
                <div className="otp-no-device-banner">
                  <p className="info-text">
                    <strong>No Email device found</strong> — automatic
                    enrollment started above.
                  </p>
                  <p
                    className="info-text"
                    style={{ fontSize: "0.9em", marginTop: "8px" }}
                  >
                    Scroll up to the <strong>Device Enrollment</strong> section
                    and click "Enroll Email Device" to register an email OTP
                    device. Once registered, you'll be able to verify with this
                    email address.
                  </p>
                </div>
              ) : (
                <div className="otp-input-group">
                  <input
                    type="text"
                    className="otp-input"
                    placeholder="Enter 6-digit OTP code"
                    value={emailOtp}
                    onChange={(e) => setEmailOtp(e.target.value)}
                    maxLength={6}
                  />
                  <button
                    type="button"
                    className="mfa-test-button mfa-test-button--primary"
                    onClick={testEmailVerify}
                    disabled={!emailOtp || emailOtp.length !== 6}
                  >
                    Verify OTP
                  </button>
                </div>
              )}
              <MFATestCard
                title="Verify Email OTP"
                status={emailVerifyStatus}
                error={emailVerifyError}
                onTest={testEmailVerify}
                rawResult={rawEmailVerify}
                pingoneRequest={emailVerifyPingoneReq}
                pingoneResponse={emailVerifyPingoneRes}
                docsUrl="https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/validate-otp-device-authentication.html"
                docsSectionTitle="MFA Verify OTP (Email)"
                endpoint="/v1/environments/{envId}/deviceAuthentications/{daId}"
                method="PUT"
              />
            </div>
          )}
        </section>

        {/* FIDO2/Passkey Test Section */}
        <section className="mfa-test-section">
          <h2 className="mfa-test-section-title">FIDO2/Passkey Testing</h2>
          <WhatIsHappening
            title="FIDO2/WebAuthn — Passwordless passkey authentication"
            steps={[
              "POST /api/mfa/test/integration/initiate with method=fido2 → PingOne returns a DA ID",
              "GET /api/mfa/test/integration/challenge/:daId/status → returns publicKeyCredentialRequestOptions",
              "Browser calls navigator.credentials.get({ publicKey }) — OS/browser handles biometric/PIN prompt",
              "The authenticator signs the PingOne challenge with the private key stored on-device",
              "POST /api/mfa/test/integration/verify-fido2 with the signed assertion → PingOne validates signature",
              "No password is ever sent — the private key never leaves the device (FIDO2 security guarantee)",
            ]}
            apiFlow={[
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/initiate",
                note: "method=fido2",
              },
              {
                method: "GET",
                endpoint: "/api/mfa/test/integration/challenge/:daId/status",
                note: "Get WebAuthn options",
              },
              {
                method: "POST",
                endpoint: "/api/mfa/test/integration/verify-fido2",
                note: "Submit assertion",
              },
            ]}
          />
          <MFATestCard
            title="Initiate FIDO2 Challenge"
            status={fidoInitiateStatus}
            error={fidoInitiateError}
            onTest={testFidoInitiate}
            rawResult={rawFidoInitiate}
            pingoneRequest={fidoInitiatePingoneReq}
            pingoneResponse={fidoInitiatePingoneRes}
            docsUrl="https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/initialize-device-authentication.html"
            docsSectionTitle="MFA Challenge — Initiate (FIDO2)"
            endpoint="/v1/environments/{envId}/deviceAuthentications"
            method="POST"
          />
          {fidoDaId && (
            <div className="fido-verify-section">
              <DaResponseCard daId={fidoDaId} method="fido2" />
              <h3 className="fido-verify-title">Verify FIDO2 Passkey</h3>
              {fidoChallengeOptions ? (
                <>
                  <p className="info-text">
                    WebAuthn options ready. Click below to authenticate with
                    your passkey.
                  </p>
                  <MFATestCard
                    title="Verify FIDO2 with Passkey"
                    status={fidoVerifyStatus}
                    error={fidoVerifyError}
                    onTest={testFidoVerify}
                    rawResult={rawFidoVerify}
                    pingoneRequest={fidoVerifyPingoneReq}
                    pingoneResponse={fidoVerifyPingoneRes}
                    docsUrl="https://developer.pingidentity.com/pingone-api/mfa/mfa-authentication/mfa-device-authentications/check-assertion-device-authentication.html"
                    docsSectionTitle="MFA Verify Assertion (FIDO2)"
                    endpoint="/v1/environments/{envId}/deviceAuthentications/{daId}"
                    method="PUT"
                  />
                </>
              ) : noFidoDeviceDetected ? (
                <div className="fido-no-device-banner">
                  <p className="info-text">
                    <strong>No FIDO2 device found</strong> — automatic
                    enrollment started above.
                  </p>
                  <p
                    className="info-text"
                    style={{ fontSize: "0.9em", marginTop: "8px" }}
                  >
                    Scroll up to the <strong>Device Enrollment</strong> section
                    to complete FIDO2 registration. Once registered, you'll be
                    able to verify with this passkey.
                  </p>
                </div>
              ) : (
                <p className="info-text">
                  Waiting for WebAuthn credential request options from PingOne…
                </p>
              )}
            </div>
          )}
        </section>

        {/* Logs Modal */}
        {logsModalOpen && (
          <MFALogsModal onClose={() => setLogsModalOpen(false)} />
        )}
      </div>
    </div>
  );
};

export default MFATestPage;

function WhatIsHappening({ title, steps, apiFlow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="what-is-happening">
      <button
        type="button"
        className="wih-toggle"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="wih-icon">{open ? "▼" : "▶"}</span>
        <span className="wih-label">{title || "What is happening here?"}</span>
      </button>
      {open && (
        <div className="wih-body">
          {steps && (
            <ol className="wih-steps">
              {steps.map((s) => (
                <li key={s} className="wih-step">
                  {s}
                </li>
              ))}
            </ol>
          )}
          {apiFlow && (
            <div className="wih-api">
              <div className="wih-api-title">API Calls Involved</div>
              {apiFlow.map((a) => (
                <div key={`${a.method}-${a.endpoint}`} className="wih-api-row">
                  <span
                    className={`wih-method wih-method--${a.method?.toLowerCase()}`}
                  >
                    {a.method}
                  </span>
                  <code className="wih-endpoint">{a.endpoint}</code>
                  {a.note && <span className="wih-note">{a.note}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DaResponseCard({ daId, method }) {
  const METHOD_LABELS = {
    sms: "SMS OTP",
    email: "Email OTP",
    fido2: "FIDO2/Passkey",
  };
  return (
    <div className="da-response-card">
      <div className="da-response-card-title">
        Challenge Initiated — {METHOD_LABELS[method] || method}
      </div>
      <div className="da-response-card-row">
        <span className="da-label">DA ID</span>
        <code className="da-value">{daId}</code>
        <span className="da-desc">
          Device Authorization ID — reference for this MFA challenge session
        </span>
      </div>
      <div className="da-response-card-row">
        <span className="da-label">Status</span>
        <span className="da-value da-value--pending">PENDING</span>
        <span className="da-desc">
          PENDING = OTP sent. COMPLETED = user verified. EXPIRED = time window
          passed.
        </span>
      </div>
      <div className="da-response-card-row">
        <span className="da-label">Method</span>
        <span className="da-value">{METHOD_LABELS[method] || method}</span>
        <span className="da-desc">
          MFA method PingOne is expecting the user to satisfy
        </span>
      </div>
    </div>
  );
}
