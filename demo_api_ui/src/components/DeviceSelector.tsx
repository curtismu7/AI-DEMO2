import React, { FC } from "react";
import "./DeviceSelector.css";

export interface Device {
  id: string;
  type: string;
  phone?: string;
  email?: string;
  nickname?: string;
}

interface DeviceSelectorProps {
  devices?: Device[];
  selectedDeviceId?: string | null;
  onSelectDevice?: (deviceId: string) => void;
  onBack?: (() => void) | null;
  disabled?: boolean;
  title?: string;
}

const DeviceSelector: FC<DeviceSelectorProps> = ({
  devices = [],
  selectedDeviceId = null,
  onSelectDevice = (_deviceId: string) => {},
  onBack = null,
  disabled = false,
  title = "Select how you'd like to verify this transaction:",
}) => {
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
      {onBack && (
        <button
          type="button"
          className="device-selector__back-btn"
          onClick={onBack}
          disabled={disabled}
        >
          ← Back
        </button>
      )}
    </div>
  );
};

export default DeviceSelector;
