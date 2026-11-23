import React, { useEffect, useState } from "react";
import { buildSubscribeTx, DEFAULT_TOKEN } from "../stellar";
import {
  useFormValidation,
  validateAddress,
  validateInterval,
  validateStroopAmount,
  type FormFields,
} from "../hooks/useFormValidation";
import { isValidStellarAddress } from "../utils/addressValidation";
import { BILLING_INTERVALS, CONTRACT_LIMITS, STROOPS_PER_XLM } from "../constants";
import IntervalSelector from "./IntervalSelector";
import BalanceDisplay from "./BalanceDisplay";
import AllowanceDisplay from "./AllowanceDisplay";
import AddressBook from "./AddressBook";
import ReferralPanel from "./ReferralPanel";
import ToastContainer from "./Toast";
import { useToast } from "../hooks/useToast";
import { friendlyError } from "../utils/errors";
import { useDirtyPreroute } from "../hooks/useDirtyPreroute";
import StroopInput from "./StroopInput";
import { useTranslation } from "../i18n";

interface Props {
  userKey: string;
  onSign: (xdr: string) => Promise<string>;
  onSuccess: () => void;
  announce?: (message: string) => void;
  isPaused?: boolean;
  /** When true, wallet mutations are disabled because the browser is offline. */
  isOffline?: boolean;
}

type TouchedFields = {
  merchant: boolean;
  amount: boolean;
  interval: boolean;
  referrer: boolean;
  tokenAddress: boolean;
};

function validateReferrer(referrer: string, userKey: string, invalidAddressMsg: string, selfReferralMsg: string): { valid: boolean; error?: string } {
  if (!referrer.trim()) {
    // Referrer is optional
    return { valid: true };
  }

  const trimmed = referrer.trim();

  // Check if it's a valid Stellar address
  if (!isValidStellarAddress(trimmed)) {
    return { valid: false, error: invalidAddressMsg };
  }

  // Check for self-referral client-side
  if (trimmed === userKey) {
    return { valid: false, error: selfReferralMsg };
  }

  return { valid: true };
}

function fieldsAreValid(fields: FormFields, referrerValid: boolean): boolean {
  return (
    validateAddress(fields.merchant).valid &&
    validateStroopAmount(fields.amount, CONTRACT_LIMITS.MAX_SUBSCRIPTION_AMOUNT).valid &&
    validateInterval(fields.interval, CONTRACT_LIMITS.MIN_INTERVAL_SECONDS).valid &&
    referrerValid
  );
}

export default function SubscribeForm({
  userKey,
  onSign,
  onSuccess,
  announce,
  isPaused = false,
  isOffline = false,
}: Props) {
  const { t } = useTranslation();
  const [merchant, setMerchant] = useState("");
  const [amountStroops, setAmountStroops] = useState<bigint | null>(null);
  const [interval, setInterval] = useState(BILLING_INTERVALS[2].value);
  const [referrer, setReferrer] = useState("");
  const [tokenAddress, setTokenAddress] = useState(DEFAULT_TOKEN);
  const [touched, setTouched] = useState<TouchedFields>({
    merchant: false,
    amount: false,
    interval: false,
    referrer: false,
    tokenAddress: false,
  });
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const { errors, validate, validateAsync, isValidating, cancelValidation } = useFormValidation();
  const { toasts, addToast, removeToast, pauseToast, resumeToast } = useToast();

  const amountString =
    amountStroops !== null ? (Number(amountStroops) / STROOPS_PER_XLM).toString() : "";
  const fields: FormFields = { merchant, amount: amountString, interval, tokenAddress };
  const referrerValidation = validateReferrer(
    referrer,
    userKey,
    t("subscribe.validation.invalidAddress"),
    t("subscribe.validation.selfReferral"),
  );
  const canSubmit =
    fieldsAreValid(fields, referrerValidation.valid) &&
    !pending &&
    !isValidating &&
    !isPaused &&
    !isOffline;

  const isDirty =
    merchant.trim() !== "" ||
    amountStroops !== null ||
    referrer.trim() !== "" ||
    interval !== BILLING_INTERVALS[2].value ||
    tokenAddress !== DEFAULT_TOKEN;

  useDirtyPreroute(isDirty && !pending);

  // Re-validate when touched fields change so errors clear as the user corrects them.
  useEffect(() => {
    if (touched.merchant || touched.amount || touched.interval || touched.tokenAddress) {
      validate(fields);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on field values + touched
  }, [
    merchant,
    amountStroops,
    interval,
    touched.merchant,
    touched.amount,
    touched.interval,
    tokenAddress,
    touched.tokenAddress,
    validate,
  ]);

  // Any edit makes an in-flight server check stale: abort it so a submit that awaited it
  // bails out instead of sending the values captured before the edit.
  useEffect(() => {
    cancelValidation();
  }, [merchant, amountStroops, interval, tokenAddress, referrer, cancelValidation]);

  function handleBlur(field: keyof TouchedFields) {
    setTouched((prev) => ({ ...prev, [field]: true }));
    validate(fields);
  }

  function handleMerchantChange(e: React.ChangeEvent<HTMLInputElement>) {
    setMerchant(e.target.value);
  }

  function handleReferrerChange(e: React.ChangeEvent<HTMLInputElement>) {
    setReferrer(e.target.value);
  }

  function handleReferrerBlur() {
    setTouched((prev) => ({ ...prev, referrer: true }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Implicit (Enter-key) submission can bypass the disabled button; never race a running check.
    if (pending || isValidating) return;
    setTouched({
      merchant: true,
      amount: true,
      interval: true,
      referrer: true,
      tokenAddress: true,
    });
    setStatus(null);

    if (!validate(fields) || amountStroops === null) return;
    if (!(await validateAsync(fields))) return;

    setPending(true);
    announce?.(t("subscribe.announced.submitted"));
    try {
      const xdr = await buildSubscribeTx(
        userKey,
        merchant,
        amountStroops,
        BigInt(interval),
        tokenAddress,
        referrer.trim() || null,
        ""
      );
      const hash = await onSign(xdr);
      setStatus(`${t("subscribe.success")} tx: ${hash.slice(0, 12)}…`);
      addToast(t("subscribe.success"), "success", hash);
      announce?.(t("subscribe.announced.confirmed"));
      onSuccess();
    } catch (err: unknown) {
      const msg = `Error: ${friendlyError(err instanceof Error ? err.message : String(err))}`;
      setStatus(msg);
      addToast(msg, "error");
      announce?.(msg);
    } finally {
      setPending(false);
    }
  }

  const merchantError = touched.merchant && errors.merchant ? errors.merchant : undefined;
  const amountError = touched.amount && errors.amount ? errors.amount : undefined;
  const intervalError = touched.interval && errors.interval ? errors.interval : undefined;
  const referrerError = touched.referrer ? referrerValidation.error : undefined;
  const tokenAddressError =
    touched.tokenAddress && errors.tokenAddress ? errors.tokenAddress : undefined;

  return (
    <form className="subscribe-form" onSubmit={handleSubmit} noValidate>
      <h2 className="subscribe-form__title">{t("subscribe.title")}</h2>

      <div className="form-group">
        <BalanceDisplay address={userKey} tokenId={tokenAddress} />
      </div>

      {/* Referral Panel */}
      <ReferralPanel publicKey={userKey} />

      {/* Merchant Field */}
      <div className="form-group">
        <label className="form-label" htmlFor="merchant-input">
          {t("subscribe.merchant.label")}
        </label>
        <input
          id="merchant-input"
          data-testid="merchant-input"
          name="merchant"
          className="input"
          placeholder={t("subscribe.merchant.placeholder")}
          value={merchant}
          onChange={handleMerchantChange}
          onBlur={() => handleBlur("merchant")}
          aria-invalid={merchantError ? true : undefined}
          aria-describedby={merchantError ? "merchant-error" : undefined}
          autoComplete="off"
        />
        <button type="button" className="btn-secondary" onClick={() => setShowAddressBook(true)}>
          {t("subscribe.merchant.addressBook")}
        </button>
        {merchantError && (
          <span
            id="merchant-error"
            data-testid="merchant-error"
            className="error-message text-error"
            role="alert"
          >
            {merchantError}
          </span>
        )}
      </div>

      {/* Amount Field */}
      <div data-testid="amount-wrapper" onBlur={() => handleBlur("amount")}>
        <StroopInput label={t("subscribe.amount.label")} onChange={setAmountStroops} disabled={pending || isPaused} />
        {amountError && (
          <span
            id="amount-error"
            data-testid="amount-error"
            className="error-message text-error"
            role="alert"
          >
            {amountError}
          </span>
        )}
      </div>

      {/* Interval Field */}
      <div data-testid="interval-wrapper" tabIndex={-1} onBlur={() => handleBlur("interval")}>
        <IntervalSelector
          value={interval}
          onChange={(seconds) => {
            setInterval(seconds);
          }}
        />
        {intervalError && (
          <span
            id="interval-error"
            data-testid="interval-error"
            className="error-message text-error"
            role="alert"
          >
            {intervalError}
          </span>
        )}
      </div>

      {/* Token Address Field */}
      <div className="form-group">
        <label className="form-label" htmlFor="tokenAddress-input">
          {t("subscribe.token.label")}
        </label>
        <input
          id="tokenAddress-input"
          data-testid="tokenAddress-input"
          name="tokenAddress"
          className="input"
          placeholder={t("subscribe.token.placeholder")}
          value={tokenAddress}
          onChange={(e) => setTokenAddress(e.target.value)}
          onBlur={() => handleBlur("tokenAddress")}
          aria-invalid={tokenAddressError ? true : undefined}
          aria-describedby={tokenAddressError ? "tokenAddress-error" : undefined}
          autoComplete="off"
        />
        {tokenAddressError && (
          <span
            id="tokenAddress-error"
            data-testid="tokenAddress-error"
            className="error-message text-error"
            role="alert"
          >
            {tokenAddressError}
          </span>
        )}
      </div>

      {/* Referrer / allowance */}
      <div className="form-group">
        <label className="form-label" htmlFor="referrer-input">
          {t("subscribe.referrer.label")}
        </label>
        <input
          id="referrer-input"
          data-testid="referrer-input"
          name="referrer"
          className="input"
          placeholder={t("subscribe.referrer.placeholder")}
          value={referrer}
          onChange={handleReferrerChange}
          onBlur={handleReferrerBlur}
          aria-invalid={referrerError ? true : undefined}
          aria-describedby={referrerError ? "referrer-error" : undefined}
          autoComplete="off"
        />
        {referrerError && (
          <span
            id="referrer-error"
            data-testid="referrer-error"
            className="error-message text-error"
            role="alert"
          >
            {referrerError}
          </span>
        )}
        <AllowanceDisplay userKey={userKey} subscriptionAmount={0n} refreshTrigger={0} />
        <AllowanceDisplay
          userKey={userKey}
          subscriptionAmount={BigInt(Math.round(parseFloat(amountString || "0") * STROOPS_PER_XLM))}
          refreshTrigger={0}
          tokenId={tokenAddress}
        />
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="btn-primary subscribe-form__submit"
        aria-busy={pending || isValidating}
        aria-label={
          isOffline
            ? t("subscribe.submit.ariaOffline")
            : isPaused
              ? t("subscribe.submit.ariaPaused")
              : undefined
        }
        title={isOffline ? t("subscribe.submit.titleOffline") : undefined}
      >
        {pending ? t("subscribe.submit.pending") : isValidating ? t("subscribe.submit.validating") : t("subscribe.submit")}
      </button>

      {status && (
        <p className={`form-status${status.startsWith("Error") ? " text-error" : ""}`}>{status}</p>
      )}

      {showAddressBook && (
        <AddressBook
          onSelect={(address) => {
            setMerchant(address);
            setShowAddressBook(false);
          }}
          onClose={() => setShowAddressBook(false)}
        />
      )}

      <ToastContainer
        toasts={toasts}
        onRemove={removeToast}
        onPause={pauseToast}
        onResume={resumeToast}
      />
    </form>
  );
}
