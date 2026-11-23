import React, { useEffect, useState } from "react";
import {
  buildSubscribeTx,
  calculateProtocolFee,
  DEFAULT_TOKEN,
  getAllowance,
  getProtocolFee,
} from "../stellar";
import {
  useFormValidation,
  validateAddress,
  validateInterval,
  validateStroopAmount,
  type FormFields,
} from "../hooks/useFormValidation";
import { isValidStellarAddress } from "../utils/addressValidation";
import { formatAddress, formatXlm } from "../utils/format";
import { parseSubscribeLinkParams, type SubscribeLinkParams } from "../utils/subscribeLink";
import {
  BILLING_INTERVALS,
  CONTRACT_LIMITS,
  SECONDS_PER_DAY,
  STROOPS_PER_XLM,
} from "../constants";
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
import ConfirmModal from "./ConfirmModal";

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
  const [linkParams] = useState<SubscribeLinkParams>(() =>
    parseSubscribeLinkParams(window.location.search, userKey)
  );
  const [merchant, setMerchant] = useState(linkParams.merchant ?? "");
  const [amountStroops, setAmountStroops] = useState<bigint | null>(null);
  const [interval, setInterval] = useState(BILLING_INTERVALS[2].value);
  const [referrer, setReferrer] = useState(linkParams.referrer ?? "");
  const [tokenAddress, setTokenAddress] = useState(DEFAULT_TOKEN);
  const [linkNotice] = useState<string | null>(
    linkParams.notices.length ? linkParams.notices.join(" ") : null
  );
  const [touched, setTouched] = useState<TouchedFields>({
    merchant: false,
    amount: false,
    interval: false,
    referrer: linkParams.selfReferral,
    tokenAddress: false,
  });
  const [showAddressBook, setShowAddressBook] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [feeBps, setFeeBps] = useState(0);
  const [allowanceStroops, setAllowanceStroops] = useState<bigint | null>(null);
  const [firstChargeAt, setFirstChargeAt] = useState(0);
  const [trialDays, setTrialDays] = useState("0");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const { errors, validate, validateAsync, isValidating, cancelValidation } = useFormValidation();
  const { toasts, addToast, removeToast, pauseToast, resumeToast } = useToast();

  const amountString =
    amountStroops !== null ? (Number(amountStroops) / STROOPS_PER_XLM).toString() : "";
  const fields: FormFields = { merchant, amount: amountString, interval, tokenAddress };
  const referrerValidation = validateReferrer(referrer, userKey);
  const trialDaysValue = Number(trialDays);
  const trialValid =
    trialDays.trim() !== "" &&
    Number.isInteger(trialDaysValue) &&
    trialDaysValue >= 0 &&
    trialDaysValue <= 3650;
  const trialSeconds = trialValid ? BigInt(trialDaysValue) * BigInt(SECONDS_PER_DAY) : 0n;
  const feeStroops = amountStroops === null ? 0n : calculateProtocolFee(amountStroops, feeBps);
  const canSubmit =
    fieldsAreValid(fields, referrerValidation.valid) &&
    trialValid &&
    !pending &&
    !isValidating &&
    !isPaused &&
    !isOffline;

  const isDirty =
    merchant.trim() !== "" ||
    amountStroops !== null ||
    referrer.trim() !== "" ||
    interval !== BILLING_INTERVALS[2].value ||
    tokenAddress !== DEFAULT_TOKEN ||
    trialDays !== "0";

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

  useEffect(() => {
    if (!showConfirm) return;
    let cancelled = false;
    setFirstChargeAt(Math.floor(Date.now() / 1000) + Number(trialSeconds) + interval);
    Promise.all([getProtocolFee(userKey), getAllowance(userKey, tokenAddress)])
      .then(([fee, allowance]) => {
        if (cancelled) return;
        setFeeBps(fee?.bps ?? 0);
        setAllowanceStroops(allowance);
      })
      .catch(() => {
        if (cancelled) return;
        setFeeBps(0);
        setAllowanceStroops(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showConfirm, userKey, tokenAddress, interval, trialSeconds]);

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

    if (!validate(fields) || amountStroops === null || !trialValid) return;
    if (!(await validateAsync(fields))) return;

    setShowConfirm(true);
  }

  async function handleConfirm() {
    if (amountStroops === null || pending) return;
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
        "",
        trialSeconds
      );
      const hash = await onSign(xdr);
      setShowConfirm(false);
      setStatus(`Subscribed! tx: ${hash.slice(0, 12)}…`);
      addToast("Subscribed!", "success", hash);
      announce?.("Transaction confirmed");
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

      {linkNotice && (
        <p className="form-status text-muted" role="status" data-testid="referral-link-notice">
          {linkNotice}
        </p>
      )}
      {linkParams.referrer && !linkParams.selfReferral && (
        <p className="form-status" data-testid="referrer-from-link">
          Referred by <strong>{formatAddress(linkParams.referrer)}</strong>
        </p>
      )}

      {/* Referral Panel */}
      <ReferralPanel publicKey={userKey} merchant={merchant} />

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
        <StroopInput
          label="Amount"
          onChange={setAmountStroops}
          disabled={pending || isPaused}
          isInvalid={Boolean(amountError)}
          ariaDescribedBy={amountError ? "amount-error" : undefined}
        />
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
      <div data-testid="interval-wrapper" onBlur={() => handleBlur("interval")}>
        <IntervalSelector
          id="interval-select"
          value={interval}
          onChange={(seconds) => {
            setInterval(seconds);
          }}
          onBlur={() => handleBlur("interval")}
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

      <div className="form-group">
        <label className="form-label" htmlFor="trial-days-input">
          Trial period (days, optional)
        </label>
        <input
          id="trial-days-input"
          data-testid="trial-days-input"
          name="trialDays"
          className="input"
          type="number"
          min="0"
          max="3650"
          step="1"
          value={trialDays}
          onChange={(e) => setTrialDays(e.target.value)}
          aria-invalid={!trialValid ? true : undefined}
          aria-describedby={!trialValid ? "trial-days-error" : undefined}
        />
        {!trialValid && (
          <span
            id="trial-days-error"
            data-testid="trial-days-error"
            className="error-message text-error"
            role="alert"
          >
            Enter a whole number of days between 0 and 3650.
          </span>
        )}
      </div>

      {/* Referrer Field */}
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

      {showConfirm && amountStroops !== null && (
        <ConfirmModal
          message="Review your subscription before signing"
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
          confirmDisabled={pending}
          confirmTestId="subscribe-confirm"
          cancelTestId="subscribe-cancel"
          confirmLabel={pending ? "Subscribing…" : "Subscribe"}
        >
          <div className="subscribe-summary" data-testid="subscribe-summary">
            <div className="flex-between">
              <span className="text-sm text-muted">Gross charge</span>
              <span className="text-mono" data-testid="summary-gross">
                {formatXlm(amountStroops)}
              </span>
            </div>
            <div className="flex-between">
              <span className="text-sm text-muted">Protocol fee ({feeBps} bps)</span>
              <span className="text-mono" data-testid="summary-fee">
                {formatXlm(feeStroops)}
              </span>
            </div>
            <div className="flex-between">
              <span className="text-sm text-muted">Merchant receives</span>
              <span className="text-mono" data-testid="summary-net">
                {formatXlm(amountStroops - feeStroops)}
              </span>
            </div>
            <div className="flex-between">
              <span className="text-sm text-muted">Billing interval</span>
              <span data-testid="summary-interval">
                {BILLING_INTERVALS.find((i) => i.value === interval)?.label ?? `${interval}s`}
              </span>
            </div>
            <div className="flex-between">
              <span className="text-sm text-muted">Trial</span>
              <span data-testid="summary-trial">
                {trialValid && trialDaysValue > 0 ? `${trialDays} day(s)` : "None"}
              </span>
            </div>
            <div className="flex-between">
              <span className="text-sm text-muted">First charge</span>
              <span data-testid="summary-first-charge">
                {new Date(firstChargeAt * 1000).toLocaleString()}
              </span>
            </div>
            {allowanceStroops !== null && allowanceStroops < amountStroops && (
              <p className="text-error" data-testid="summary-allowance-warning" role="alert">
                Your allowance ({formatXlm(allowanceStroops)}) is below the gross charge. Increase
                it before the first charge.
              </p>
            )}
          </div>
        </ConfirmModal>
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
