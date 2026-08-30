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
 *   its own here rather than a field on a form about something else. For a
 *   provider it is also the only *guarded* field on this page; see below.
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
 *
 * ## Why a provider's timezone cannot always be saved
 *
 * For a client the timezone is a lens: it changes how appointments are written
 * out and nothing else. For a provider it is load-bearing. Their weekly hours are
 * stored as a weekday and a wall-clock time ("Tuesdays, 09:00–17:00") and are
 * read in whatever zone their account currently says, so changing the zone slides
 * every working window along the real timeline. The appointments do not move —
 * they are fixed instants — which is precisely the problem: a 9 AM appointment
 * can end up at 4 AM inside the new working day, outside the hours the provider
 * has just declared and no longer reschedulable without widening them.
 *
 * So this page never lets a provider walk into that. Two things do the work:
 *
 *   1. **The check runs while they browse.** Picking a zone from the list fires
 *      `GET /availability/timezone-impact` (debounced), and any appointment the
 *      change would strand is named on screen before Save is pressed — with both
 *      clock readings of the same instant, because "9:00 AM becomes 4:00 AM" is
 *      the sentence that makes the problem legible.
 *   2. **Save is refused, not warned about.** While there are conflicts the
 *      submit button is disabled, and the server refuses the write anyway with
 *      409 `TIMEZONE_CONFLICT`, whose report is rendered through exactly the same
 *      panel. The provider's two ways forward are the two the panel offers: open
 *      each appointment and cancel or reschedule it, or keep their current zone.
 *
 * There is deliberately no "change it anyway". A forced change would silently
 * misalign a real calendar, which is the outcome the whole check exists to
 * prevent — and it is not a trade a form can reasonably offer.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import TimezoneSelect from "react-timezone-select";
import { DateTime } from "luxon";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useNotifications } from "../context/NotificationsContext";
import { parseApiError } from "../api/client";
import PasswordCard from "../components/settings/PasswordCard";
import usePageTitle from "../hooks/usePageTitle";
import * as authApi from "../api/auth";
import * as availabilityApi from "../api/availability";
import * as providersApi from "../api/providers";
import { useApiResource } from "../hooks/useApiResource";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import Page, { PageHeader, SectionNav } from "../components/ui/Page";
import Icon from "../components/ui/Icon";
import Field, { Input } from "../components/ui/Field";
import { Alert, PageLoader, SkeletonBlock } from "../components/ui/Feedback";
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
  buildTimezoneOptions,
  timezoneFilterOption,
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
  // The full list, replacing the one-per-offset menu the library would build.
  // See the note in lib/timezones.js.
  const timezoneOptions = useMemo(() => buildTimezoneOptions(), []);

  const [timezone, setTimezone] = useState("");
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);

  // The verdict on the zone currently selected: null until one has been asked
  // about. Set either by the live check below or by a 409 from the save, which
  // return the same shape on purpose.
  const [impact, setImpact] = useState(null);
  const [checkingImpact, setCheckingImpact] = useState(false);

  useEffect(() => {
    if (!user) return;
    setTimezone(normalizeTimezone(user.timezone || "UTC"));
  }, [user]);

  // `react-timezone-select` hands back either a bare zone name or an option
  // object depending on how the value was set, so every read of the selection
  // goes through this one place rather than repeating the narrowing.
  const resolvedZone = typeof timezone === "string" ? timezone : timezone?.value;
  const savedZone = user?.timezone ? normalizeTimezone(user.timezone) : null;
  const zoneIsNew = Boolean(resolvedZone && savedZone && resolvedZone !== savedZone);

  /**
   * Asks the server what the selected zone would do to the provider's calendar.
   *
   * Debounced, because a `react-timezone-select` menu emits a change per arrow
   * key and each one would otherwise be a request. Aborted on the way out, so
   * paging through the list cannot let a slower earlier answer land last and
   * report on a zone that is no longer selected.
   *
   * Only providers, and only when the selection actually differs from what is
   * saved: for a client there is nothing to check, and re-selecting your own zone
   * is not a change.
   */
  const debouncedZone = useDebouncedValue(resolvedZone, 350);

  useEffect(() => {
    if (!isProvider || !debouncedZone || debouncedZone === savedZone) {
      setImpact(null);
      setCheckingImpact(false);
      return undefined;
    }

    const controller = new AbortController();
    setCheckingImpact(true);

    availabilityApi
      .timezoneImpact(debouncedZone, { signal: controller.signal })
      .then((result) => setImpact(result))
      // A failed check must not masquerade as "all clear", but neither should it
      // block a provider over an unrelated network problem — the server checks
      // again on the write, which is the answer that counts.
      .catch(() => setImpact(null))
      .finally(() => {
        if (!controller.signal.aborted) setCheckingImpact(false);
      });

    return () => controller.abort();
  }, [isProvider, debouncedZone, savedZone]);

  const conflicts = impact && !impact.safe ? impact.conflicts : [];
  const blocked = conflicts.length > 0;

  /** Puts the form back on the saved zone — the "cancel the change" way out. */
  const keepCurrentTimezone = () => {
    setImpact(null);
    setFormError("");
    setErrors({});
    if (savedZone) setTimezone(savedZone);
  };

  const sections = useMemo(() => {
    const list = [
      { id: "account", label: "Account" },
      { id: "password", label: "Password" },
      { id: "timezone", label: "Timezone" },
      { id: "notifications", label: "Notifications" },
    ];
    if (isProvider) list.push({ id: "policy", label: "Booking policy" });
    list.push({ id: "session", label: "Session" });
    return list;
  }, [isProvider]);

  const active = useActiveSection(sections);

  usePageTitle("Settings");

  const handleSubmit = async (event) => {
    event.preventDefault();

    // Belt as well as braces: the button is already disabled while conflicts are
    // on screen, but a form can also be submitted with the keyboard.
    if (blocked) {
      setFormError("Deal with the appointments below, or keep your current timezone.");
      return;
    }

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
      setImpact(null);
      setSavedAt(Date.now());
      toast.success("Settings saved.");
      reloadNotifications();
    } catch (err) {
      const parsed = parseApiError(err, "Could not save your settings.");

      if (parsed.code === "TIMEZONE_CONFLICT") {
        // The authoritative refusal — reachable even after a clear preview, if an
        // appointment was booked in between. `details` is the same report the
        // preview returns, so the panel below renders it without a second branch.
        setImpact(parsed.details ?? null);
        setFormError(parsed.message);
        toast.error(parsed.message, { title: "Timezone not changed", duration: 9000 });
      } else if (Object.keys(parsed.fieldErrors).length > 0) {
        setErrors(parsed.fieldErrors);
      } else {
        setFormError(parsed.message);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!user) return <PageLoader label="Loading your settings…" />;

  return (
    <Page>
      <PageHeader
        title="Settings"
        description="Manage your account preferences and how Slotly reads time for you."
      />

      <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <SectionNav items={sections} active={active} />

        <div className="min-w-0 space-y-10">
          {/* Account is read-only, so it is not inside the form. */}
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
              Your name, photo and phone number
              {isProvider ? ", business details and bio" : ""} are all edited on{" "}
              <Link to="/profile" className="font-medium text-ink underline underline-offset-2">
                your profile
              </Link>
              , because that is what other people see.
            </p>
          </SettingsSection>

          {/* Password.
              Outside the page's main <form> — it posts on its own, because the
              main form saves the timezone and a timezone change has its own
              reasons to be refused. Nesting forms is invalid HTML anyway. */}
          <SettingsSection
            id="password"
            title="Password"
            description={
              user.has_password
                ? "Change the password you sign in with."
                : "You signed in with Google or GitHub. Add a password to sign in with your email as well."
            }
          >
            <PasswordCard hasPassword={Boolean(user.has_password)} />
          </SettingsSection>

          <form onSubmit={handleSubmit} noValidate className="space-y-10">


          {/* Timezone */}
          <SettingsSection
            id="timezone"
            title="Timezone"
            description="Every appointment time in Slotly is drawn in this zone."
          >
            {/* `timezone-select` rather than `timezone`, because the section
                wrapping this already owns `id="timezone"` as the anchor the
                section nav scrolls to. Two elements shared the id, so
                `<label for="timezone">` resolved to the *section* — clicking the
                label focused nothing, and assistive technology had no label for
                the control at all.

                Taken as a *function* child rather than an element one, because
                renaming the id alone did not finish the job. `Field` clones an
                element child and puts `id` on it — but react-select spends `id`
                on its container div and takes the input's from `inputId`, so
                both ended up as "timezone-select" and `<label for>` resolved to
                the div instead of the section. Same broken outcome, one layer
                further in. The function form hands the wiring over instead:
                `id` becomes `inputId`, and the aria attributes go to the input
                react-select actually renders, which is what gives the combobox
                its name and reads the hint and error out with it. */}
            <Field
              id="timezone-select"
              label="Your working timezone"
              error={errors.timezone}
              hint="Change it while travelling and your appointments follow — they do not move, the clock does. Other people always see the same appointment converted to their own zone."
            >
              {({ id, "aria-invalid": invalid, "aria-required": req }, { errorId }) => (
                <TimezoneSelect
                  inputId={id}
                  aria-invalid={invalid}
                  required={req}
                  // Not `aria-describedby`: react-select overwrites that with its
                  // own live region. `aria-errormessage` it does pass through.
                  aria-errormessage={errorId}
                  value={timezone}
                  onChange={setTimezone}
                  labelStyle="original"
                  timezones={timezonesWithCountry}
                  options={timezoneOptions}
                  filterOption={timezoneFilterOption}
                  unstyled
                  classNames={timezoneSelectClassNames}
                  {...timezoneSelectMenuProps}
                />
              )}
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

            {isProvider && (
              <TimezoneImpactPanel
                checking={checkingImpact}
                zoneIsNew={zoneIsNew}
                impact={impact}
                conflicts={conflicts}
                savedZone={savedZone}
                onKeepCurrent={keepCurrentTimezone}
              />
            )}
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
            <button
              type="submit"
              disabled={saving || blocked}
              // Said out loud rather than left to the disabled state, which on its
              // own tells someone nothing about why.
              title={blocked ? "Resolve the affected appointments first" : undefined}
              className={primaryButton}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
            </div>
          </form>
        </div>
      </div>
    </Page>
  );
}

/**
 * What the selected timezone would do to appointments already booked.
 *
 * Three states, and the quiet one matters as much as the loud one:
 *
 *   - **checking** — a plain line, no spinner over the whole section. The
 *     provider is mid-decision and a flashing panel would be worse than a pause.
 *   - **clear** — said explicitly, and only once a *different* zone is selected.
 *     Silence would be ambiguous: the provider cannot tell "nothing is wrong"
 *     from "nothing was checked", and this is a change they are about to make to
 *     a live calendar. It also names how many appointments were examined, so the
 *     reassurance is evidence rather than an assertion.
 *   - **conflicts** — every affected appointment, each with both clock readings
 *     of the same unmoved instant, and a link straight to it. The two ways
 *     forward are the two the panel offers, because they are the only two there
 *     are: sort the appointments out, or keep the current zone.
 *
 * Rendering the *appointments* rather than a count is the whole point of this
 * component. "3 appointments conflict" is a dead end; "Tue 9 Jun, 9:00 AM with
 * Priya Sharma → 4:00 AM" is something a provider can act on.
 */
function TimezoneImpactPanel({ checking, zoneIsNew, impact, conflicts, savedZone, onKeepCurrent }) {
  if (!zoneIsNew) return null;

  if (checking) {
    return (
      <p className="mt-4 flex items-center gap-2 text-xs text-ink-3">
        <Icon name="refresh" size={14} />
        Checking your upcoming appointments against this timezone…
      </p>
    );
  }

  if (impact?.safe) {
    return (
      <div className="mt-4 flex items-start gap-3 rounded-md border border-success-line bg-success-soft px-4 py-3.5">
        <Icon name="checkCircle" size={18} className="mt-0.5 shrink-0 text-success-ink" />
        <div>
          <p className="text-sm font-semibold text-success-ink">Nothing clashes with this change</p>
          <p className="mt-1 text-xs leading-relaxed text-success-ink/85">
            {impact.upcomingCount === 0
              ? "You have no upcoming appointments, so there is nothing this could affect."
              : `All ${impact.upcomingCount} of your upcoming appointment${
                  impact.upcomingCount === 1 ? "" : "s"
                } still fall inside your working hours in ${zoneName(impact.timezone)}.`}
          </p>
        </div>
      </div>
    );
  }

  if (conflicts.length === 0) return null;

  return (
    <div className="mt-4 overflow-hidden rounded-md border border-danger-line">
      <div className="border-b border-danger-line bg-danger-soft px-4 py-3.5">
        <p className="flex items-center gap-2 text-sm font-semibold text-danger-ink">
          <Icon name="alert" size={17} />
          {conflicts.length} appointment{conflicts.length === 1 ? "" : "s"} would fall outside your
          working hours
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-danger-ink/85">
          These appointments do not move — they stay at the exact moment they were booked for. Your
          working hours are what moves, because they are stored as clock times in your timezone. In{" "}
          {zoneName(impact?.timezone)} the times below land outside the hours you keep.
        </p>
      </div>

      <ul className="divide-y divide-line-soft">
        {conflicts.map((conflict) => (
          <li key={conflict.bookingId} className="px-4 py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm font-medium text-ink">
                {conflict.service?.name || "Appointment"}
                {conflict.client?.name && (
                  <span className="font-normal text-ink-2"> with {conflict.client.name}</span>
                )}
              </p>
              <Link
                to={`/bookings/${conflict.bookingId}`}
                className="flex shrink-0 items-center gap-1 text-xs font-semibold text-ink underline underline-offset-2"
              >
                Cancel or reschedule
                <Icon name="arrowRight" size={13} />
              </Link>
            </div>

            {/* The comparison, spelled out. Both readings are of one instant, so
                the arrow is the change to the clock face and not to the booking. */}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
              <span className="tabular-nums">{conflict.current?.startsAt}</span>
              <span className="text-ink-3">in {zoneName(conflict.current?.timezone)}</span>
              <Icon name="arrowRight" size={13} className="text-ink-3" />
              <span className="font-semibold tabular-nums text-danger-ink">
                {conflict.proposed?.startsAt}
              </span>
              <span className="text-ink-3">in {zoneName(conflict.proposed?.timezone)}</span>
            </p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-danger-line bg-subtle px-4 py-3">
        <p className="text-xs leading-relaxed text-ink-2">
          Cancel or reschedule {conflicts.length === 1 ? "it" : "them"}, then change your timezone —
          or keep the timezone you have.
        </p>
        <button type="button" onClick={onKeepCurrent} className={`${secondaryButton} ${buttonSm}`}>
          Keep {zoneName(savedZone)}
        </button>
      </div>
    </div>
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

function ReadOnlyRow({ label, value, hint, action }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0">
      <dt className="text-[0.8125rem] font-medium text-ink">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className="block truncate text-sm text-ink-2">{value || "—"}</span>
        {hint && <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>}
        {/* For a row that is read-only *by default* but has one way to change it
            — the role. Kept in the row rather than floated elsewhere so the
            control sits next to the value it changes. */}
        {action && <div className="mt-2 flex justify-end">{action}</div>}
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
        {(wiring) => (
        <div className="flex flex-wrap items-center gap-3">
          {/* A placeholder while the saved value is fetched. An empty, merely
              `disabled` number input is indistinguishable from a policy of zero
              hours — so this field spent its first moment stating the opposite
              of what it was about to say. */}
          {loading ? (
            <SkeletonBlock className="h-10 w-28 rounded-md" />
          ) : (
            <Input
              {...wiring}
              type="number"
              min="0"
              max="720"
              step="1"
              value={hours}
              onChange={(event) => setHours(event.target.value)}
              className="w-28"
            />
          )}
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
        )}
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
