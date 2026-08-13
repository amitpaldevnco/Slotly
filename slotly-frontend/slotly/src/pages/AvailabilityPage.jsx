/**
 * The provider's availability screen: weekly hours, one-off exceptions, and the
 * cancellation cutoff.
 *
 * Loads everything in one request and hands each section its slice, so the three
 * editors stay independent components while the page owns the single source of
 * truth for what is currently saved.
 *
 * ## Layout
 *
 * This was five stacked full-width panels in an 896px column: a title with a
 * three-line explanation, a timezone notice, the scope tabs, a scope explanation,
 * the weekly grid (seven rows of time inputs), the exceptions editor (a form plus
 * two lists), and the cancellation policy. Roughly three screens of scrolling, in
 * which the weekly grid — the thing the page is for — was in the middle.
 *
 * The weekly grid is now the main column and the two smaller settings are a
 * sidebar, so the page is one screen on a laptop and the grid starts at the top.
 * The three-line explanation of how slots are calculated moved into the sidebar
 * too: it is worth saying once, not worth saying above the control it describes.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { parseApiError } from "../api/client";
import * as availabilityApi from "../api/availability";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import WeeklyHoursEditor from "../components/availability/WeeklyHoursEditor";
import ExceptionsEditor from "../components/availability/ExceptionsEditor";
import Page, { PageHeader, Section, SplitLayout } from "../components/ui/Page";
import Icon from "../components/ui/Icon";
import { FilterTabs } from "../components/ui/Tabs";
import Field, { Input } from "../components/ui/Field";
import { Alert, ErrorState, PageLoader } from "../components/ui/Feedback";
import {
  primaryButton,
  secondaryButton,
  buttonSm,
  chipClasses,
  linkClasses,
  zoneName,
} from "../lib/ui";

export default function AvailabilityPage() {
  const { user, refetchUser } = useAuth();
  const toast = useToast();

  const [selectedServiceId, setSelectedServiceId] = useState(null);
  const [resetting, setResetting] = useState(false);

  // The service list is what tells the tabs which services already have a
  // custom schedule — loaded once, independently of which tab is selected.
  // Non-fatal: the page still works with just the default-hours tab.
  const {
    data: servicesData,
    setData: setServices,
    loading: servicesLoading,
  } = useApiResource(
    ({ signal }) => providersApi.listServices(user.id, { signal }).catch(() => []),
    { enabled: Boolean(user?.id), deps: [user?.id], initialData: [] }
  );

  const services = servicesData ?? [];

  const {
    data: availability,
    // Every editor below reports what it saved through an `onSaved` callback that
    // patches this state in place, so the screen updates from the server's own
    // response instead of re-fetching. Leaving `setData` out of this destructure
    // is what made a successful save look like a network failure: the callbacks
    // referenced an undeclared `setAvailability` and threw inside the editor's
    // try/catch, which then reported the throw as a failed request.
    setData: setAvailability,
    loading,
    error: loadError,
    reload: load,
  } = useApiResource(
    ({ signal }) =>
      providersApi
        .getAvailability(
          user.id,
          selectedServiceId ? { serviceId: selectedServiceId } : {},
          { signal }
        )
        // Stamp each response with the tab it was fetched for. A scope switch
        // keeps the previous schedule on screen while the new one loads (see
        // `initialLoading` below), which means that for a moment `availability`
        // holds one scope's rules while `selectedServiceId` names another. The
        // editors must not be handed that mismatch — it is how a service's hours
        // ended up displayed, and then saved, as the provider's default.
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
        current.map((s) => (s.id === selectedServiceId ? { ...s, has_custom_availability: false } : s))
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
  // editors from the availability. Waiting for both means the tabs are there on
  // the first paint instead of appearing a moment later and pushing everything
  // below them down.
  //
  // Deliberately not true for a tab switch — that refetches the availability
  // while the current schedule stays on screen, rather than blanking the page.
  const initialLoading = servicesLoading || (loading && !availability);

  if (initialLoading && !loadError) return <PageLoader label="Loading your availability…" />;

  if (loadError) {
    return (
      <Page narrow>
        <ErrorState message={loadError} onRetry={load} />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Availability"
        description="The hours clients can book, and the days they cannot."
        meta={
          <span className={chipClasses}>
            <Icon name="globe" size={12} />
            {zoneName(availability.timezone)}
          </span>
        }
      />

      {/* Only when there is more than one schedule to switch between. A provider
          with no services gets no tabs rather than a tab strip of one. */}
      {services.length > 0 && (
        <div className="mb-3">
          <FilterTabs
            label="Whose hours to edit"
            panelId="availability-editors"
            value={selectedServiceId}
            onChange={setSelectedServiceId}
            options={[{ id: null, label: "Default hours" }].concat(
              services.map((s) => ({
                id: s.id,
                label: s.service_name,
                dot: s.has_custom_availability,
              }))
            )}
          />
        </div>
      )}

      {selectedService && (
        <Alert
          tone={selectedService.has_custom_availability ? "info" : "warn"}
          className="mb-3"
          action={
            selectedService.has_custom_availability && (
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
          {selectedService.has_custom_availability ? (
            <>
              <span className="font-medium">{selectedService.service_name}</span> has its own hours,
              separate from your default schedule.
            </>
          ) : (
            <>
              <span className="font-medium">{selectedService.service_name}</span> currently follows
              your default hours. Saving below gives it a schedule of its own.
            </>
          )}
        </Alert>
      )}

      <div id="availability-editors">
        <SplitLayout
          aside={
            <>
              <Section title="How slots are worked out" flush>
                <ol className="divide-y divide-line-soft text-xs">
                  {[
                    "Start from your weekly hours",
                    "Subtract your exceptions",
                    "Subtract anything already booked",
                    "Keep only where the appointment plus its buffers fits",
                  ].map((step, index) => (
                    <li key={step} className="flex gap-2.5 px-3 py-2">
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[0.625rem] font-semibold text-brand-ink">
                        {index + 1}
                      </span>
                      <span className="leading-relaxed text-ink-2">{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="border-t border-line-soft px-3 py-2 text-xs leading-relaxed text-ink-3">
                  A service only needs its own hours if it genuinely runs on a different schedule
                  from the rest of your day.
                </p>
              </Section>

              <Section title="Timezone" flush>
                <div className="px-3 py-3">
                  <p className="flex items-center gap-2 text-[0.8125rem] font-medium text-ink">
                    <Icon name="globe" size={15} className="text-ink-3" />
                    {zoneName(availability.timezone)}
                  </p>
                  {/* Worth stating plainly: every field on this page is a
                      wall-clock time, and none of them mean anything until the
                      reader knows whose clock. */}
                  <p className="mt-1.5 text-xs leading-relaxed text-ink-3">
                    All times on this page are in this zone. Clients always see them converted to
                    their own.{" "}
                    <Link to="/profile" className={linkClasses}>
                      Change it
                    </Link>
                  </p>
                </div>
              </Section>

              <CancellationPolicyEditor
                value={availability.cancellationCutoffHours}
                onSaved={(hours) => {
                  setAvailability((current) => ({ ...current, cancellationCutoffHours: hours }));
                  // The cutoff also lives on the user record the header and
                  // dashboard read, so re-sync rather than letting the two drift.
                  refetchUser();
                  toast.success("Cancellation policy saved.");
                }}
              />
            </>
          }
        >
          {/* Held back until the fetched scope matches the selected tab, so the
              grid is never populated from the scope the provider just left. */}
          {availabilityInSync && (
            <WeeklyHoursEditor
              key={`rules-${selectedServiceId ?? "default"}`}
              rules={availability.rules}
              timezone={availability.timezone}
              serviceId={selectedServiceId}
              scopeLabel={selectedService?.service_name}
              onSaved={(rules) => {
                setAvailability((current) => ({
                  ...current,
                  rules,
                  // An empty week on a service is not a schedule of its own — it
                  // means "follow my default hours", and the server clears the
                  // override to match. See replaceAvailabilityRules.
                  scope: selectedServiceId && rules.length > 0 ? "service" : "provider",
                }));
                if (selectedServiceId) {
                  setServices((current) =>
                    current.map((s) =>
                      s.id === selectedServiceId
                        ? { ...s, has_custom_availability: rules.length > 0 }
                        : s
                    )
                  );
                }
                // Saving an empty week hands the service back to the default
                // hours, so what is on screen is now the *provider's* schedule,
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
                    s.id === selectedServiceId ? { ...s, has_custom_availability: true } : s
                  )
                );
              }
            }}
          />
          )}
        </SplitLayout>
      </div>
    </Page>
  );
}

/**
 * How long before an appointment a client may still cancel.
 *
 * The note about existing bookings is not decoration — it is the visible half of
 * the snapshot rule: tightening this cannot retroactively trap someone who booked
 * under the old policy.
 */
function CancellationPolicyEditor({ value, onSaved }) {
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
    <Section title="Cancellation policy" flush>
      <form onSubmit={handleSubmit} className="px-3 py-3">
        <Field
          id="cutoff-hours"
          label="Clients can cancel up to"
          error={error}
          hint="You can always cancel or reschedule anything on your calendar yourself."
        >
          <div className="flex items-center gap-2">
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
            <span className="text-[0.8125rem] text-ink-2">hours before</span>
          </div>
        </Field>

        {/* Only offered once the value has actually changed. A permanently
            enabled Save on a settings panel invites a pointless request and
            gives no signal that anything is unsaved. */}
        {dirty && (
          <button type="submit" disabled={saving} className={`mt-2.5 ${primaryButton} ${buttonSm}`}>
            {saving ? "Saving…" : "Save policy"}
          </button>
        )}

        <p className="mt-2.5 flex items-start gap-1.5 border-t border-line-soft pt-2.5 text-xs leading-relaxed text-ink-3">
          <Icon name="info" size={13} className="mt-px" />
          <span>
            Affects new bookings only. Every existing booking keeps the policy it was made under, so
            nobody is caught out by a change made after they booked.
          </span>
        </p>
      </form>
    </Section>
  );
}
