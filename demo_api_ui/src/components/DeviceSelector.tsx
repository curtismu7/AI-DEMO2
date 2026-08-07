import React, { FC } from "react";
import "./DeviceSelector.css";

export interface Device {
  id: string;
  type: string;
  phone?: string;
  email?: string;
  nickname?: string;
}

/** Verification methods a user can add from the picker. */
export const ENROLLABLE_TYPES = ["FIDO2", "EMAIL", "SMS"] as const;
export type EnrollableType = (typeof ENROLLABLE_TYPES)[number];

interface DeviceSelectorProps {
  devices?: Device[];
  selectedDeviceId?: string | null;
  onSelectDevice?: (deviceId: string) => void;
  onBack?: (() => void) | null;
  disabled?: boolean;
  title?: string;
  /** Offer to enrol the methods the user has not registered yet. */
  onRegisterDevice?: ((type: EnrollableType) => void) | null;
  /** Type currently mid-enrolment, so its row can show progress. */
  registeringType?: EnrollableType | null;
  /** Enrolment failure to surface inline, next to what the user just tried. */
  registerError?: string | null;
}

const DeviceSelector: FC<DeviceSelectorProps> = ({
  devices = [],
  selectedDeviceId = null,
  onSelectDevice = (_deviceId: string) => {},
  onBack = null,
  disabled = false,
  title = "Select how you'd like to verify this transaction:",
  onRegisterDevice = null,
  registeringType = null,
  registerError = null,
}) => {
  // Types the user has no device for. PingOne reports passkeys as FIDO2.
  const enrolledTypes = new Set(devices.map((d) => d.type.toUpperCase()));
  const missingTypes = onRegisterDevice
    ? ENROLLABLE_TYPES.filter((t) => !enrolledTypes.has(t))
    : [];

  const getSetupLabel = (type: EnrollableType): string => {
    switch (type) {
      case "FIDO2":
        return "Passkey";
      case "SMS":
        return "SMS Text Message";
      case "EMAIL":
        return "Email Code";
      default:
        return type;
    }
  };

  const getSetupHint = (type: EnrollableType): string => {
    switch (type) {
      case "FIDO2":
        return "Use Touch ID, Face ID or a security key";
      case "SMS":
        return "Send codes to your phone";
      case "EMAIL":
        return "Send codes to your email";
      default:
        return "";
    }
  };

  const getDeviceLabel = (device: Device): string => {
    switch (device.type) {
      case "FIDO2":
        return "Security Key (FIDO2)";
      case "OTP":
        return "One-Time Code";
      case "SMS":
        return "SMS Text Message";
      case "EMAIL":
        return "Email Code";
      case "TOTP":
        return "Authenticator App";
      case "BROWSER":
        return "Remember This Browser";
      default:
        return `${device.type} (${device.id.slice(0, 8)})`;
    }
  };

  return (
    <div className="device-selector">
      {/* Scrollable region: title + device rows + setup rows */}
      <div className="device-selector__scroll">
        <p className="device-selector__title">{title}</p>
        <div className="device-selector__list">
          {devices.map((device) => (
            <button
              key={device.id}
              type="button"
              className={`device-selector__btn device-selector__btn--${device.type.toLowerCase()}${selectedDeviceId === device.id ? " device-selector__btn--selected" : ""}`}
              onClick={() => onSelectDevice(device.id)}
              disabled={disabled}
            >
              <span className="device-selector__label">
                {getDeviceLabel(device)}
              </span>
              {device.phone && (
                <span className="device-selector__detail">{device.phone}</span>
              )}
              {device.email && (
                <span className="device-selector__detail">{device.email}</span>
              )}
              {device.nickname && (
                <span className="device-selector__detail">{device.nickname}</span>
              )}
            </button>
          ))}
        </div>
        {missingTypes.length > 0 && (
          <div className="device-selector__setup">
            {devices.length > 0 && (
              <p className="device-selector__setup-title">Or set up a new method:</p>
            )}
            <div className="device-selector__list">
              {missingTypes.map((type) => {
                const isRegistering = registeringType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    className={`device-selector__btn device-selector__btn--setup device-selector__btn--${type.toLowerCase()}`}
                    onClick={() => onRegisterDevice(type)}
                    disabled={disabled || Boolean(registeringType)}
                    aria-busy={isRegistering}
                  >
                    <span className="device-selector__label">
                      {isRegistering ? "Waiting…" : `Set up ${getSetupLabel(type)}`}
                    </span>
                    <span className="device-selector__detail">
                      {getSetupHint(type)}
                    </span>
                  </button>
                );
              })}
            </div>
            {registerError && (
              <p className="device-selector__setup-error" role="alert">
                {registerError}
              </p>
            )}
          </div>
        )}
      </div>
      {/* Back button pinned below scroll region — always visible */}
      {onBack && (
        <div className="device-selector__footer">
          <button
            type="button"
            className="device-selector__back-btn"
            onClick={onBack}
            disabled={disabled}
          >
            ← Back
          </button>
        </div>
      )}
    </div>
  );
};

export default DeviceSelector;
