import React from 'react';
import styles from './TokenStepIndicator.module.css';

interface TokenStepIndicatorProps {
  currentStep: number;
  totalSteps: number;
  stepLabels?: string[];
  compact?: boolean;
  showLabel?: boolean;
}

const TokenStepIndicator: React.FC<TokenStepIndicatorProps> = ({
  currentStep,
  totalSteps,
  stepLabels = [],
  compact = false,
  showLabel = true,
}) => {
  if (totalSteps <= 0) return null;

  const steps = Array.from({ length: totalSteps }, (_, i) => i + 1);
  const isComplete = currentStep >= totalSteps;

  return (
    <div className={`${styles.tokenStepIndicator} ${compact ? styles.compact : ''}`}>
      {showLabel && (
        <span className={styles.label}>
          Step {currentStep} of {totalSteps}
        </span>
      )}
      <div className={styles.stepsContainer}>
        {steps.map((step) => {
          const isActive = step === currentStep;
          const isCompleted = step < currentStep;
          let stepStatus = 'pending';
          if (isCompleted) stepStatus = 'completed';
          if (isActive) stepStatus = 'active';

          return (
            <div
              key={step}
              className={`${styles.step} ${styles[stepStatus]}`}
              title={stepLabels[step - 1] || `Step ${step}`}
            >
              {isCompleted ? (
                <span className={styles.checkmark}>✓</span>
              ) : (
                <span className={styles.stepNumber}>{step}</span>
              )}
            </div>
          );
        })}
      </div>
      {isComplete && <span className={styles.completeLabel}>Complete</span>}
    </div>
  );
};

export default TokenStepIndicator;
