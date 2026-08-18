/**
 * Availability settings — `availability_editor`.
 *
 * Transcribed from the reference: a page heading, then a twelve-column split —
 * the Timezone card and the Weekly Hours editor on the left, a sticky
 * Scheduling Rules card on the right.
 *
 * The reference's rules card offers Slot Duration, Buffer Time and Minimum
 * Notice. In Slotly the first two are per-service, not per-provider — they are
 * columns on `services`, edited on the service form — and there is no
 * minimum-notice setting at all. The card therefore carries the one scheduling
 * rule that *is* the provider's and does exist, the cancellation cutoff, plus
 * the explanation of how a slot is arrived at, which is the question the missing
 * controls were really answering.
 *
 * The scope tabs above the editor have no counterpart in the reference and are
 * kept because the feature does: a service may override the provider's default
 * hours, and this is the only screen that can edit either.
 *
 * Everything loads in one request and each editor is handed its slice, so the
 * page owns the single source of truth for what is currently saved.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { parseApiError } from "../api/client";
import * as availabilityApi from "../api/availability";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import WeeklyHoursEditor from "../components/availability/WeeklyHoursEditor";
import ExceptionsEditor from "../components/availability/ExceptionsEditor";
import Icon from "../components/ui/Icon";
import Field, { Input } from "../components/ui/Field";
import { Alert, ErrorState, PageLoader } from "../components/ui/Feedback";
import { container, primaryButton, secondaryButton, buttonSm, zoneName } from "../lib/ui";

export default function AvailabilityPage() {
  const { user, refetchUser } = useAuth();
  const toast = useToast();

  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [resetting, setResetting] = useState(false);

  // The service list is what tells the tabs which services already have a custom
  // schedule — loaded once, independently of which tab is selected. Non-fatal:
  // the page still works with just the default-hours tab.
  const {
    data: servicesData,
    setData: setServices,
    loading: servicesLoading,
  } = useApiResource(
    ({ signal }) => providersApi.listServices(user.id, { signal }).catch(() => []),
    { enabled: Boolean(user?.id), deps: [user?.id], initialData: [] }
  );

  // Active services only. A retired service is not bookable, so hours for it
  // could never produce a slot — offering a tab to configure them is inviting a
  // provider to spend time on something with no effect. Its rules stay in the
  // database untouched, so reactivating brings them back with it.
  //
  // Filtered rather than requested that way, because the endpoint returns the
  // owner's retired services deliberately (the Services page needs them) and a
  // second request for a different slice of the same list would be waste.
  const services = useMemo(
    () => (servicesData ?? []).filter((service) => service.isActive !== false),
    [servicesData]
  );

  const {
    data: availability,
    setData: setAvailability,
    loading,
    error: loadError,
    reload: load,
  } = useApiResource(
    ({ signal }) =>
      providersApi
        .getAvailability(user.id, selectedServiceId ? { serviceId: selectedServiceId } : {}, {
          signal,
        })
        // Stamp each response with the tab it was fetched for. A scope switch
        // keeps the previous schedule on screen while the new one loads, which
        // means that for a moment `availability` holds one scope's rules while
        // `selectedServiceId` names another. The editors must not be handed that
        // mismatch — it is how a service's hours ended up displayed, and then
        // saved, as the provider's default.
        .then((data) => ({ ...data, forServiceId: selectedServiceId ?? null })),
    {
      enabled: Boolean(user?.id),
      deps: [user?.id, selectedServiceId],
      fallback: "Could not load your availability.",
    }
  );

  const selectedService = services.find((s) => s.id === selectedServiceId) || null;

  /** True once the loaded availability actually belongs to the selected tab. */
  const availabilityInSync = availability?.forServiceId === (selectedServiceId ?? null);

  const handleReset = async () => {
    if (!selectedServiceId) return;
    setResetting(true);
    try {
      await availabilityApi.resetServiceRules(selectedServiceId);
      setServices((current) =>
        current.map((s) =>
          s.id === selectedServiceId ? { ...s, hasCustomAvailability: false } : s
        )
      );
      await load();
      toast.success("This service now follows your default hours.");
    } catch (err) {
      toast.error(parseApiError(err, "Could not reset this service's hours.").message);
    } finally {
      setResetting(false);
    }
  };

  // The page needs both requests: the tabs come from the service list and the
  // editors from the availability. Deliberately not true for a tab switch —
  // that refetches while the current schedule stays on screen.
  const initialLoading = servicesLoading || (loading && !availability);

  if (initialLoading && !loadError) return <PageLoader label="Loading your availability…" />;

  if (loadError) {
    return (
      <div className={`${container} py-8 md:py-12`}>
        <ErrorState message={loadError} onRetry={load} />
      </div>
    );
  }

  return (
    <div className={`${container} pb-16 pt-8 md:pt-12`}>
      <header className="mb-10">
        <h1 className="mb-2 font-h1-mobile text-h1-mobile text-primary md:font-h1 md:text-h1">
          Availability Settings
        </h1>
        <p className="max-w-2xl font-body text-body text-on-surface-variant">
          Define your weekly booking hours and scheduling rules.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-12">
        {/* Left column */}
        <div className="space-y-6 lg:col-span-8">
          {/* Timezone */}
          <div className="flex flex-col items-start justify-between gap-4 rounded-lg border border-outline-variant bg-surface-container-lowest p-6 sm:flex-row sm:items-center">
            <div>
              <h3 className="flex items-center gap-2 font-small text-small font-semibold text-primary">
                <Icon name="public" size={18} />
                Global Timezone
              </h3>
              <p className="mt-1 font-caption text-caption text-on-surface-variant">
                All times below are relative to this timezone.
              </p>
            </div>

            {/* Read-only here on purpose: the timezone is an account setting and
                is edited in one place, so two screens cannot disagree about it. */}
            <div className="flex w-full items-center gap-3 sm:w-auto">
              <span className="flex-1 rounded-md border border-outline-variant px-3 py-2 font-small text-small text-on-surface sm:w-64 sm:flex-none">
                {zoneName(availability.timezone)}
              </span>
              <Link
                to="/settings"
                className="shrink-0 font-small text-small font-semibold text-primary underline underline-offset-2"
              >
                Change
              </Link>
            </div>
          </div>

          {/* Scope tabs — the provider's default hours, or one service's own. */}
          {services.length > 0 && (
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {[{ id: null, label: "Default hours" }]
                .concat(
                  services.map((s) => ({
                    id: s.id,
                    label: s.name,
                    dot: s.hasCustomAvailability,
                  }))
                )
                .map((option) => {
                  const active = option.id === selectedServiceId;
                  return (
                    <button
                      key={option.id ?? "__default"}
                      type="button"
                      onClick={() => setSelectedServiceId(option.id)}
                      aria-pressed={active}
                      className={`flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-full border px-4 py-2 font-small text-small transition-colors ${
                        active
                          ? "border-primary bg-primary text-on-primary"
                          : "border-outline-variant bg-surface text-on-surface-variant hover:bg-surface-container-low hover:text-primary"
                      }`}
                    >
                      <span className="max-w-[14rem] truncate">{option.label}</span>
                      {option.dot && (
                        <span
                          aria-hidden="true"
                          title="Has its own hours"
                          className={`h-1.5 w-1.5 rounded-full ${
                            active ? "bg-on-primary/80" : "bg-primary"
                          }`}
                        />
                      )}
                    </button>
                  );
                })}
            </div>
          )}

          {selectedService && (
            <Alert
              tone={selectedService.hasCustomAvailability ? "info" : "warn"}
              action={
                selectedService.hasCustomAvailability && (
                  <button
                    type="button"
                    onClick={handleReset}
                    disabled={resetting}
                    className={`${secondaryButton} ${buttonSm}`}
                  >
                    {resetting ? "Resetting…" : "Reset to default"}
                  </button>
                )
              }
            >
              {selectedService.hasCustomAvailability ? (
                <>
                  <span className="font-semibold">{selectedService.name}</span> has its own
                  hours, separate from your default schedule.
                </>
              ) : (
                <>
                  <span className="font-semibold">{selectedService.name}</span> currently
                  follows your default hours. Saving below gives it a schedule of its own.
                </>
              )}
            </Alert>
          )}

          {/* Held back until the fetched scope matches the selected tab, so the
              grid is never populated from the scope the provider just left. */}
          {availabilityInSync && (
            <WeeklyHoursEditor
              key={`rules-${selectedServiceId ?? "default"}`}
              rules={availability.rules}
              serviceId={selectedServiceId}
              scopeLabel={selectedService?.name}
              onSaved={(rules) => {
                setAvailability((current) => ({
                  ...current,
                  rules,
                  // An empty week on a service is not a schedule of its own — it
                  // means "follow my default hours", and the server clears the
                  // override to match.
                  scope: selectedServiceId && rules.length > 0 ? "service" : "provider",
                }));
                if (selectedServiceId) {
                  setServices((current) =>
                    current.map((s) =>
                      s.id === selectedServiceId
                        ? { ...s, hasCustomAvailability: rules.length > 0 }
                        : s
                    )
                  );
                }
                // Saving an empty week hands the service back to the default
                // hours, so what is on screen is now the provider's schedule,
                // not this service's. Re-fetch rather than guess at it.
                if (selectedServiceId && rules.length === 0) load();
              }}
            />
          )}

          {availabilityInSync && (
            <ExceptionsEditor
              key={`exceptions-${selectedServiceId ?? "default"}`}
              exceptions={availability.exceptions}
              timezone={availability.timezone}
              serviceId={selectedServiceId}
              onChanged={(exceptions) => {
                setAvailability((current) => ({ ...current, exceptions }));
                if (selectedServiceId) {
                  setServices((current) =>
                    current.map((s) =>
                      s.id === selectedServiceId ? { ...s, hasCustomAvailability: true } : s
                    )
                  );
                }
              }}
            />
          )}
        </div>

        {/* Right column: scheduling rules */}
        <div className="lg:col-span-4">
          <div className="sticky top-24 space-y-6">
            <CancellationPolicyCard
              value={availability.cancellationCutoffHours}
              onSaved={(hours) => {
                setAvailability((current) => ({ ...current, cancellationCutoffHours: hours }));
                // The cutoff also lives on the user record the dashboard reads,
                // so re-sync rather than letting the two drift.
                refetchUser();
                toast.success("Cancellation policy saved.");
              }}
            />

            <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-6">
              <h2 className="mb-6 flex items-center gap-2 font-h3 text-[18px] font-semibold text-primary">
                <Icon name="tune" size={20} />
                How slots are worked out
              </h2>

              <ol className="space-y-4">
                {[
                  "Start from your weekly hours",
                  "Subtract your exceptions",
                  "Subtract anything already booked",
                  "Keep only where the appointment plus its buffers fits",
                ].map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-container-high font-caption text-[10px] font-bold text-on-surface">
                      {index + 1}
                    </span>
                    <span className="font-small text-small text-on-surface-variant">{step}</span>
                  </li>
                ))}
              </ol>

              <p className="mt-6 border-t border-outline-variant/50 pt-4 font-caption text-caption text-on-surface-variant">
                A service&apos;s own duration, buffers and slot spacing are set on{" "}
                <Link
                  to="/services"
                  className="font-semibold text-primary underline underline-offset-2"
                >
                  the service itself
                </Link>
                , because they differ per service.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * How long before an appointment a client may still cancel.
 *
 * The note about existing bookings is not decoration — it is the visible half of
 * the snapshot rule: tightening this cannot retroactively trap someone who
 * booked under the old policy.
 */
function CancellationPolicyCard({ value, onSaved }) {
  const toast = useToast();

  const [hours, setHours] = useState(String(value ?? 12));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const dirty = String(hours) !== String(value ?? 12);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const parsed = Number(hours);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 720) {
      setError("Enter a whole number of hours between 0 and 720.");
      return;
    }

    setSaving(true);
    try {
      const saved = await availabilityApi.updateSettings({ cancellationCutoffHours: parsed });
      onSaved(saved.cancellationCutoffHours);
    } catch (err) {
      const apiError = parseApiError(err, "Could not save your policy.");
      setError(apiError.fieldErrors.cancellationCutoffHours || apiError.message);
      toast.error(apiError.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-outline-variant bg-surface-container-lowest p-6">
      <h2 className="mb-6 flex items-center gap-2 font-h3 text-[18px] font-semibold text-primary">
        <Icon name="rule" size={20} />
        Scheduling Rules
      </h2>

      <form onSubmit={handleSubmit}>
        <Field
          id="cutoff-hours"
          label="Cancellation notice"
          error={error}
          hint="How far in advance a client must cancel. You can always cancel or reschedule anything on your calendar yourself."
        >
          <div className="flex items-center gap-3">
            <Input
              id="cutoff-hours"
              type="number"
              min="0"
              max="720"
              step="1"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              className="w-24"
            />
            <span className="font-small text-small text-on-surface-variant">hours before</span>
          </div>
        </Field>

        {/* Only offered once the value has actually changed. A permanently
            enabled Save invites a pointless request and gives no signal that
            anything is unsaved. */}
        {dirty && (
          <button type="submit" disabled={saving} className={`${primaryButton} ${buttonSm} mt-4`}>
            {saving ? "Saving…" : "Save policy"}
          </button>
        )}
      </form>

      <p className="mt-6 flex items-start gap-2 border-t border-outline-variant/50 pt-4 font-caption text-caption text-on-surface-variant">
        <Icon name="info" size={16} className="mt-px shrink-0" />
        <span>
          Affects new bookings only. Every existing booking keeps the policy it was made under, so
          nobody is caught out by a change made after they booked.
        </span>
      </p>
    </div>
  );
}
