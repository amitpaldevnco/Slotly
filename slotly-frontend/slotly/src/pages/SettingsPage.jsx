/**
 * Account settings.
 *
 * The design's Settings screen offers password changes, two-factor
 * authentication, billing and notification preferences. Slotly has none of
 * those: there is no change-password endpoint, no 2FA, no billing, and no
 * notification-preferences table. Rendering switches for them would be an
 * elaborate way of doing nothing, so this page carries the settings that
 * genuinely exist and no others.
 *
 * What is here, and where each one is stored:
 *
 * - Identity (name, email, role) — read-only. Set at sign-up; the role cannot
 *   change at all (`completeProfile` returns 409 on a second attempt).
 * - Timezone — `PATCH /auth/profile`. The single setting that makes every time
 *   in the app read correctly or incorrectly, which is why it gets a section of
 *   its own here rather than a field on a form about something else.
 * - Booking policy — `PATCH /availability/settings`, providers only. The same
 *   control appears on the Availability page beside the hours it constrains;
 *   both edit one value through one endpoint, so they cannot disagree.
 * - Notifications — the live account-health list, which is derived rather than
 *   stored. See `NotificationsContext`.
 *
 * Everything else about a person — photo, phone number, business details, bio,
 * qualifications — lives on `/profile`, because those are what other people
 * read rather than settings the account runs on. No field is editable in both
 * places.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import TimezoneSelect from "react-timezone-select";
import { DateTime } from "luxon";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useNotifications } from "../context/NotificationsContext";
import { parseApiError } from "../api/client";
import * as authApi from "../api/auth";
import * as availabilityApi from "../api/availability";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import Page, { PageHeader, SectionNav } from "../components/ui/Page";
import Icon from "../components/ui/Icon";
import Field, { Input } from "../components/ui/Field";
import { Alert, PageLoader } from "../components/ui/Feedback";
import {
  primaryButton,
  secondaryButton,
  dangerButton,
  buttonSm,
  cardClasses,
  zoneName,
} from "../lib/ui";
import {
  buildTimezonesWithCountry,
  normalizeTimezone,
  timezoneSelectClassNames,
  timezoneSelectMenuProps,
} from "../lib/timezones";

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, setUser, logout } = useAuth();
  const toast = useToast();
  const { notices, reload: reloadNotifications } = useNotifications();

  const isProvider = user?.role === "provider";

  const timezonesWithCountry = useMemo(() => buildTimezonesWithCountry(), []);

  const [timezone, setTimezone] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  useEffect(() => {
    if (!user) return;
    setTimezone(normalizeTimezone(user.timezone || "UTC"));
  }, [user]);

  const sections = useMemo(() => {
    const list = [
      { id: "account", label: "Account" },
      { id: "timezone", label: "Timezone" },
      { id: "notifications", label: "Notifications" },
    ];
    if (isProvider) list.push({ id: "policy", label: "Booking policy" });
    list.push({ id: "session", label: "Session" });
    return list;
  }, [isProvider]);

  const active = useActiveSection(sections);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setFormError("");

    try {
      const formData = new FormData();
      formData.append(
        "timezone",
        normalizeTimezone(typeof timezone === "string" ? timezone : timezone.value)
      );

      const updated = await authApi.updateProfile(formData);
      setUser(updated);
      setSavedAt(Date.now());
      toast.success("Settings saved.");
      reloadNotifications();
    } catch (err) {
      const parsed = parseApiError(err, "Could not save your settings.");
      if (Object.keys(parsed.fieldErrors).length > 0) setErrors(parsed.fieldErrors);
      else setFormError(parsed.message);
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <PageLoader label="Loading your settings…" />;

  const resolvedZone = typeof timezone === "string" ? timezone : timezone?.value;

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Manage your account preferences and how Slotly reads time for you."
      />

      <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <SectionNav items={sections} active={active} />

        <form onSubmit={handleSubmit} noValidate className="min-w-0 space-y-10">
          {/* Account */}
          <SettingsSection
            id="account"
            title="Account"
            description="Who you are on Slotly. Set when you signed up."
          >
            <dl className="divide-y divide-line-soft">
              <ReadOnlyRow label="Name" value={user.name} />
              <ReadOnlyRow label="Email" value={user.email} />
              <ReadOnlyRow
                label="Role"
                value={<span className="capitalize">{user.role}</span>}
                // Your role is fixed after setup, and someone will look for a way
                // to change it. Saying so is kinder than leaving them hunting.
                hint="Fixed at sign-up — it decides which half of Slotly your account uses."
              />
              <ReadOnlyRow label="Phone" value={user.phone_number} />
            </dl>

            <p className="mt-5 border-t border-line-soft pt-5 text-xs leading-relaxed text-ink-3">
              Your photo, phone number
              {isProvider ? ", business details and bio" : ""} are edited on{" "}
              <Link to="/profile" className="font-medium text-ink underline underline-offset-2">
                your profile
              </Link>
              , because that is what other people see.
            </p>
          </SettingsSection>

          {/* Timezone */}
          <SettingsSection
            id="timezone"
            title="Timezone"
            description="Every appointment time in Slotly is drawn in this zone."
          >
            <Field
              id="timezone"
              label="Your working timezone"
              error={errors.timezone}
              hint="Change it while travelling and your appointments follow — they do not move, the clock does. Other people always see the same appointment converted to their own zone."
            >
              <TimezoneSelect
                inputId="timezone"
                value={timezone}
                onChange={setTimezone}
                labelStyle="original"
                timezones={timezonesWithCountry}
                unstyled
                classNames={timezoneSelectClassNames}
                {...timezoneSelectMenuProps}
              />
            </Field>

            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md border border-line bg-subtle px-4 py-3">
              <span className="flex items-center gap-2 text-xs text-ink-3">
                <Icon name="globe" size={14} />
                {zoneName(resolvedZone)}
              </span>
              <span className="flex items-center gap-2 text-xs text-ink-3">
                <Icon name="clock" size={14} />
                Local time now: <LocalClock zone={resolvedZone} />
              </span>
            </div>
          </SettingsSection>

          {/* Notifications */}
          <SettingsSection
            id="notifications"
            title="Notifications"
            description="What Slotly is currently flagging on your account."
          >
            {notices.length === 0 ? (
              <div className="flex items-start gap-3 rounded-md border border-success-line bg-success-soft px-4 py-3.5">
                <Icon name="checkCircle" size={18} className="mt-0.5 text-success-ink" />
                <div>
                  <p className="text-sm font-semibold text-success-ink">Nothing needs attention</p>
                  <p className="mt-1 text-xs leading-relaxed text-success-ink/85">
                    Your account is set up and nothing is blocking a booking.
                  </p>
                </div>
              </div>
            ) : (
              <ul className="space-y-2">
                {notices.map((notice) => (
                  <li key={notice.id}>
                    <Link
                      to={notice.to}
                      className="flex items-start gap-3 rounded-md border border-line bg-surface px-4 py-3.5 transition hover:border-line-strong hover:bg-subtle"
                    >
                      <Icon
                        name={notice.icon}
                        size={17}
                        className={`mt-0.5 shrink-0 ${
                          notice.tone === "danger"
                            ? "text-danger"
                            : notice.tone === "warn"
                              ? "text-warn-ink"
                              : "text-ink-3"
                        }`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-ink">{notice.title}</span>
                        <span className="mt-1 block text-xs leading-relaxed text-ink-2">
                          {notice.body}
                        </span>
                      </span>
                      <Icon name="chevronRight" size={16} className="mt-1 shrink-0 text-ink-3" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-5 border-t border-line-soft pt-5 text-xs leading-relaxed text-ink-3">
              Slotly works these out from your account as it stands — there is nothing to switch on
              or off, and nothing is sent by email or push.
            </p>
          </SettingsSection>

          {isProvider && <BookingPolicySection />}

          {/* Session */}
          <SettingsSection
            id="session"
            title="Session"
            description="You are signed in on this device."
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm text-ink-2">
                Signing out clears your session cookie. Your data is untouched.
              </p>
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  navigate("/");
                }}
                className={dangerButton}
              >
                <Icon name="logout" size={16} />
                Sign out
              </button>
            </div>
          </SettingsSection>

          {formError && <Alert tone="error">{formError}</Alert>}

          {/* The save bar. Sticky, because the sections above are long enough that
              a button at the bottom is off-screen for most of the time spent on
              the page. */}
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-canvas/90 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-5">
            {savedAt && !saving && (
              <p className="mr-auto flex items-center gap-1.5 text-xs text-success-ink">
                <Icon name="checkCircle" size={14} />
                Saved
              </p>
            )}
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className={secondaryButton}
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className={primaryButton}>
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </Page>
  );
}

/**
 * One settings block: a heading outside the card, the controls inside it. That
 * is the design's arrangement, and it is what makes the section anchors land on
 * a visible title rather than on the top edge of a panel.
 */
function SettingsSection({ id, title, description, children }) {
  return (
    <section id={id} className="scroll-mt-[calc(var(--spacing-topbar)+1.5rem)]">
      <div className="mb-4">
        <h2 className="font-display text-xl font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      <div className={`${cardClasses} p-5 sm:p-6`}>{children}</div>
    </section>
  );
}

function ReadOnlyRow({ label, value, hint }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0">
      <dt className="text-[0.8125rem] font-medium text-ink">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="block truncate text-sm text-ink-2">{value || "—"}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>}
      </dd>
    </div>
  );
}

/** The current time in the selected zone, so the choice can be sanity-checked. */
function LocalClock({ zone }) {
  const [now, setNow] = useState(() => DateTime.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(DateTime.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const local = now.setZone(zone || "UTC");
  return (
    <span className="font-medium tabular-nums text-ink">
      {local.isValid ? local.toFormat("h:mm a") : "—"}
    </span>
  );
}

/**
 * How long before an appointment a client may still cancel.
 *
 * The same control the Availability page carries, against the same endpoint. The
 * note about existing bookings is not decoration — it is the visible half of the
 * snapshot rule: tightening this cannot retroactively trap someone who booked
 * under the old policy.
 */
function BookingPolicySection() {
  const { user, refetchUser } = useAuth();
  const toast = useToast();

  const { data, setData, loading } = useApiResource(
    ({ signal }) => providersApi.getAvailability(user.id, {}, { signal }).catch(() => null),
    { enabled: Boolean(user?.id), deps: [user?.id] }
  );

  const saved = data?.cancellationCutoffHours;

  const [hours, setHours] = useState("");
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (saved != null) setHours(String(saved));
  }, [saved]);

  const dirty = saved != null && String(hours) !== String(saved);

  const handleSave = async () => {
    setError("");

    const parsed = Number(hours);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 720) {
      setError("Enter a whole number of hours between 0 and 720.");
      return;
    }

    setSavingPolicy(true);
    try {
      const result = await availabilityApi.updateSettings({ cancellationCutoffHours: parsed });
      setData((current) => ({ ...current, cancellationCutoffHours: result.cancellationCutoffHours }));
      // The cutoff also lives on the user record the dashboard reads, so re-sync
      // rather than letting the two drift.
      refetchUser();
      toast.success("Cancellation policy saved.");
    } catch (err) {
      const apiError = parseApiError(err, "Could not save your policy.");
      setError(apiError.fieldErrors.cancellationCutoffHours || apiError.message);
      toast.error(apiError.message);
    } finally {
      setSavingPolicy(false);
    }
  };

  return (
    <SettingsSection
      id="policy"
      title="Booking policy"
      description="How late a client may still cancel an appointment with you."
    >
      <Field
        id="settings-cutoff-hours"
        label="Clients can cancel up to"
        error={error}
        hint="You can always cancel or reschedule anything on your calendar yourself."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Input
            id="settings-cutoff-hours"
            type="number"
            min="0"
            max="720"
            step="1"
            value={hours}
            disabled={loading}
            onChange={(event) => setHours(event.target.value)}
            className="w-28"
          />
          <span className="text-sm text-ink-2">hours before the appointment</span>

          {/* Only offered once the value has actually changed. A permanently
              enabled Save invites a pointless request and gives no signal that
              anything is unsaved. */}
          {dirty && (
            <button
              type="button"
              onClick={handleSave}
              disabled={savingPolicy}
              className={`${primaryButton} ${buttonSm}`}
            >
              {savingPolicy ? "Saving…" : "Save policy"}
            </button>
          )}
        </div>
      </Field>

      <p className="mt-5 flex items-start gap-2 border-t border-line-soft pt-5 text-xs leading-relaxed text-ink-3">
        <Icon name="info" size={14} className="mt-px shrink-0" />
        <span>
          Affects new bookings only. Every existing booking keeps the policy it was made under, so
          nobody is caught out by a change made after they booked. The same setting appears on{" "}
          <Link to="/availability" className="font-medium text-ink underline underline-offset-2">
            Availability
          </Link>
          , beside the hours it constrains.
        </span>
      </p>
    </SettingsSection>
  );
}

/**
 * Which section the reader is currently in, for the anchor list's active state.
 *
 * An IntersectionObserver rather than a scroll handler: the sections are tall
 * and irregular, and a scroll listener would have to re-measure all of them on
 * every frame to answer the same question.
 */
function useActiveSection(sections) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const elements = sections
      .map((section) => document.getElementById(section.id))
      .filter(Boolean);
    if (elements.length === 0) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActive(visible[0].target.id);
      },
      // The top band only, so a section counts as "current" once its heading
      // reaches the area just under the top bar rather than when its foot enters
      // the viewport.
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sections]);

  return active;
}
