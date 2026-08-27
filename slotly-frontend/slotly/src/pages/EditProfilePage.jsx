/**
 * Profile management — what other people see.
 *
 * A provider's profile is a public page: the photo, business name, category, bio
 * and qualifications here are exactly what a client reads in the directory
 * before deciding to book. A client's profile is much smaller, because nothing
 * about a client is published — only their photo and phone number, and the phone
 * number only reaches the providers they book with.
 *
 * The timezone is deliberately *not* editable here. It is an account setting
 * rather than a public detail, it lives on `/settings`, and having one field
 * with two save buttons on two pages is how two pages start disagreeing.
 *
 * The design's Office Location, Years of Experience and Primary Speciality
 * fields are absent for the same reason: there are no such columns on `users`
 * and no endpoint that would store them.
 */

import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { useNotifications } from "../context/NotificationsContext";
import { imageUrl, parseApiError } from "../api/client";
import * as authApi from "../api/auth";
import * as providersApi from "../api/providers";
import useApiResource from "../hooks/useApiResource";
import Page, { PageHeader, SectionNav } from "../components/ui/Page";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import Field, { Input, Textarea, Select, CharCount } from "../components/ui/Field";
import { CURRENCIES, currencyLabel, DEFAULT_CURRENCY } from "../lib/currencies";
import { buildCountryOptions } from "../lib/countries";
import { Alert, PageLoader } from "../components/ui/Feedback";
import {
  primaryButton,
  secondaryButton,
  buttonSm,
  cardClasses,
  zoneName,
} from "../lib/ui";
import { categoryOptions } from "../lib/categories";
import { checkBusinessName, checkName, checkPhone, collectErrors } from "../lib/validation";
import usePageTitle from "../hooks/usePageTitle";
import { NAME_MAX } from "../lib/validation";

const MAX_BIO = 500;
const MAX_QUALIFICATIONS = 500;

export default function EditProfilePage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();
  const toast = useToast();
  const { reload: reloadNotifications } = useNotifications();

  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [bio, setBio] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [currency, setCurrency] = useState(DEFAULT_CURRENCY);
  // Both roles. A client's country decides whether a Domestic service is
  // bookable by them, so this is not a provider-only field.
  const [country, setCountry] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [profilePicture, setProfilePicture] = useState(null);
  const [profilePicturePreview, setProfilePicturePreview] = useState("");

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const isProvider = user?.role === "provider";

  usePageTitle("Profile");

  useEffect(() => {
    if (user) {
      setName(user.name || "");
      setPhoneNumber(user.phone_number || "");
      setBio(user.bio || "");
      setQualifications(user.qualifications || "");
      setBusinessName(user.business_name || "");
      setBusinessType(user.business_type || "");
      setCurrency(user.currency || DEFAULT_CURRENCY);
      setCountry(user.country || "");
      setBusinessAddress(user.business_address || "");
      if (user.avatar_url) setProfilePicturePreview(imageUrl(user.avatar_url));
    } else {
      navigate("/login");
    }
  }, [user, navigate]);

  // Every country, not a shortlist: unlike a currency this is a fact with one
  // right answer, and a list that omits someone's country leaves them unable to
  // state it. See `lib/countries.js`.
  const countryOptions = useMemo(() => buildCountryOptions(), []);

  // The provider's own services, read for one purpose: to say whether clearing
  // the address would leave a published In-Person service with nowhere to go.
  //
  // Worth a request because the alternative is a hint that guesses. "You have
  // In-Person services published" is either true or it is a sentence that
  // frightens a purely-online provider for no reason, and this page cannot tell
  // which without asking. `enabled` keeps clients out of it entirely — they have
  // no services and no address field.
  const { data: ownServices } = useApiResource(
    ({ signal }) => providersApi.listServices(user.id, { signal }),
    { deps: [user?.id, isProvider], enabled: Boolean(isProvider && user?.id), initialData: [] }
  );

  const inPersonWithoutAddress =
    isProvider &&
    !businessAddress.trim() &&
    (ownServices ?? []).some((service) => service.isActive && service.deliveryType === "in_person");

  const sections = useMemo(() => {
    const list = [{ id: "basic-info", label: "Basic information" }];
    if (isProvider) {
      list.push({ id: "business", label: "Business details" });
      list.push({ id: "professional-info", label: "Bio & qualifications" });
      list.push({ id: "preview", label: "Public page" });
    }
    return list;
  }, [isProvider]);

  const active = useActiveSection(sections);

  const handleFileChange = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setErrors((current) => ({ ...current, profilePicture: "File size exceeds 5MB" }));
      return;
    }

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setErrors((current) => ({
        ...current,
        profilePicture: "Only JPG and PNG files are allowed",
      }));
      return;
    }

    setProfilePicture(file);
    setErrors((current) => ({ ...current, profilePicture: "" }));

    const reader = new FileReader();
    reader.onload = (event) => setProfilePicturePreview(event.target.result);
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    // Checked here before the request, so a bad value is reported against its
    // own field instead of coming back as the server's generic
    // "Failed to update profile" — which is what an over-long phone number used
    // to produce, with no indication of which field was at fault.
    const problems = collectErrors({
      name: checkName(name),
      phoneNumber: checkPhone(phoneNumber, { allowEmpty: true }),
      ...(isProvider ? { businessName: checkBusinessName(businessName) } : {}),
    });
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setFormError("");
      setSuccessMessage("");
      return;
    }

    setLoading(true);
    setFormError("");
    setSuccessMessage("");
    setErrors({});

    try {
      const formData = new FormData();

      formData.append("name", name.trim());

      // Sent even when empty, which is what makes clearing it possible. Under
      // `if (phoneNumber)` a cleared field was simply omitted, the request ended
      // up with nothing in it, and the server answered "No fields to update" —
      // so a number already shared with providers could never be withdrawn.
      formData.append("phoneNumber", phoneNumber.trim());
      // Always sent, including as "" — the server reads an empty value as a
      // deliberate "remove it" and stores null. Clearing has to be possible:
      // the country is *inferred* from a timezone for most accounts, so someone
      // whose inferred country is wrong needs a way to say "not this one" as
      // well as a way to correct it.
      formData.append("country", country);

      if (user.role === "provider") {
        formData.append("bio", bio);
        formData.append("qualifications", qualifications);
        formData.append("businessName", businessName.trim());
        if (businessType) formData.append("businessType", businessType);
        if (currency) formData.append("currency", currency);
        // Sent unconditionally for the same reason as country: an empty string is
        // how a provider withdraws an address that has become wrong, and a
        // truthiness check here would silently keep publishing the old one.
        formData.append("businessAddress", businessAddress);
      }
      if (profilePicture) {
        formData.append("profilePicture", profilePicture);
      }

      const updated = await authApi.updateProfile(formData);

      setSuccessMessage("Profile updated.");
      setUser(updated);
      toast.success("Profile updated.");
      // A bio or business name that was missing may no longer be, and the bell
      // is still carrying the warning that said so.
      reloadNotifications();
    } catch (err) {
      const parsed = parseApiError(err, "Something went wrong. Please try again.");

      if (Object.keys(parsed.fieldErrors).length > 0) {
        setErrors(parsed.fieldErrors);
      } else {
        setFormError(parsed.message);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!user) return <PageLoader label="Loading your profile…" />;

  return (
    <Page>
      <PageHeader
        title="Profile"
        description={
          isProvider
            ? "Your public page — what clients read before deciding to book with you."
            : "Your photo and contact details, shared only with the providers you book."
        }
        actions={
          isProvider && (
            <a
              href={`/providers/${user.id}`}
              className={`${secondaryButton} ${buttonSm}`}
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="external" size={14} />
              View public page
            </a>
          )
        }
      />

      <div className="grid items-start gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <SectionNav items={sections} active={active} />

        <form onSubmit={handleSubmit} noValidate className="min-w-0 space-y-10">
          {/* Basic information */}
          <ProfileSection
            id="basic-info"
            title="Basic information"
            description="Your email is fixed to the account you signed in with. Everything else here you can change."
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
              <div className="flex shrink-0 flex-col items-center gap-3">
                <Avatar
                  src={profilePicturePreview || user.avatar_url}
                  name={user.name}
                  size="2xl"
                  className="border border-line"
                />

                {/* A label styled as a button, because a native file input cannot
                    be made to match the rest of the controls on this page and a
                    label is the one element that already forwards its click. */}
                <label className={`${secondaryButton} ${buttonSm} cursor-pointer`}>
                  <Icon name="camera" size={14} />
                  Change photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>

                <p className="text-center text-xs text-ink-3">JPG or PNG, max 5MB</p>

                {errors.profilePicture && (
                  <p className="flex items-start gap-1.5 text-xs text-danger">
                    <Icon name="alert" size={13} className="mt-px" />
                    <span>{errors.profilePicture}</span>
                  </p>
                )}
              </div>

              <div className="min-w-0 flex-1 space-y-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  {/* Editable, where it used to be read-only on the grounds
                      that it "comes from the account you signed in with". That
                      is true of Google and GitHub but not of a password
                      account, which types its own name at sign-up — so a typo
                      there was permanent and followed the user onto every
                      appointment and review. */}
                  <Field id="name" label="Full name" error={errors.name} required>
                    <Input
                      type="text"
                      autoComplete="name"
                      maxLength={NAME_MAX}
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Your name"
                    />
                  </Field>
                  <ReadOnlyField label="Email" value={user.email} />
                </div>

                <Field
                  id="phoneNumber"
                  label="Phone number"
                  error={errors.phoneNumber}
                  hint={
                    isProvider
                      ? "Shared with the clients who book you, for when an appointment has to change at short notice."
                      : "Shared with the providers you book, for when an appointment has to change at short notice."
                  }
                >
                  <Input
                    id="phoneNumber"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+91 98765 43210"
                    value={phoneNumber}
                    onChange={(event) => setPhoneNumber(event.target.value)}
                  />
                </Field>

                {/* In Basic information rather than Business details, because
                    clients have one too: a service marked Domestic compares the
                    client's country with the provider's, so a client with none
                    cannot be told whether they are eligible to book it. */}
                <Field
                  id="country"
                  label="Country"
                  optional
                  error={errors.country}
                  hint={
                    isProvider
                      ? "Used for services you mark Domestic, and shown on your public page."
                      : "Lets Slotly tell you which providers offer their services where you are."
                  }
                >
                  <Select
                    id="country"
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                    className={country === "" ? "text-ink-3" : ""}
                  >
                    <option value="">Prefer not to say</option>
                    {countryOptions.map((option) => (
                      <option key={option.code} value={option.code}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-subtle px-4 py-3">
                  <p className="flex items-center gap-2 text-[0.8125rem] text-ink-2">
                    <Icon name="globe" size={15} className="text-ink-3" />
                    Timezone: <span className="font-medium text-ink">{zoneName(user.timezone)}</span>
                  </p>
                  <Link
                    to="/settings"
                    className="text-xs font-semibold text-ink underline underline-offset-2"
                  >
                    Change in Settings
                  </Link>
                </div>
              </div>
            </div>
          </ProfileSection>

          {isProvider && (
            <>
              {/* Business details */}
              <ProfileSection
                id="business"
                title="Business details"
                description="How you are listed in the provider directory."
              >
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field id="businessName" label="Business name" error={errors.businessName}>
                    <Input
                      id="businessName"
                      type="text"
                      placeholder="e.g. Sharma Skin Clinic"
                      value={businessName}
                      onChange={(event) => setBusinessName(event.target.value)}
                    />
                  </Field>

                  <Field id="businessType" label="Category" error={errors.businessType}>
                    <Select
                      id="businessType"
                      value={businessType}
                      onChange={(event) => setBusinessType(event.target.value)}
                      className={businessType === "" ? "text-ink-3" : ""}
                    >
                      <option value="" disabled>
                        Select a category
                      </option>
                      {/* Built from what is stored, not from the fixed list
                          alone. A `<select>` whose value matches no option
                          silently falls back to the first one, so a provider
                          stored as "Physiotherapy" was shown "Healthcare" —
                          a category that was not theirs, which saving the form
                          would then have written. `categoryOptions` surfaces the
                          real value, marked as unlisted, so they can see it and
                          choose a listed one. */}
                      {categoryOptions(user?.business_type).map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field
                    id="currency"
                    label="Currency you charge in"
                    error={errors.currency}
                    hint={
                      currency !== (user.currency || DEFAULT_CURRENCY)
                        ? "This relabels your existing prices — the amounts stay as they are, they are simply read in the new currency."
                        : "Every price you set is shown in this currency, to you and to your clients."
                    }
                  >
                    <Select
                      id="currency"
                      value={currency}
                      onChange={(event) => setCurrency(event.target.value)}
                    >
                      {CURRENCIES.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                          {currencyLabel(entry)}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {/* Where in-person appointments happen.
                      Clearable, deliberately, even while an In-Person service is
                      published: at the point someone empties this the address is
                      already wrong, and holding a stale one on a public page
                      would keep sending clients to a place the provider has left.
                      The dashboard's availability check reports the resulting gap
                      rather than the form refusing to accept the truth. */}
                  <Field
                    id="businessAddress"
                    label="Business address"
                    optional
                    error={errors.businessAddress}
                    hint={
                      inPersonWithoutAddress
                        ? "You have In-Person services published, so clients currently have no address to travel to."
                        : "Shown to clients booking an In-Person service. Leave it blank if you only work online."
                    }
                  >
                    <Textarea
                      id="businessAddress"
                      rows={3}
                      placeholder={"e.g. Unit 4, 118 Great Portland Street\nLondon W1W 6PP"}
                      value={businessAddress}
                      onChange={(event) => setBusinessAddress(event.target.value)}
                    />
                  </Field>
                </div>
              </ProfileSection>

              {/* Bio and qualifications */}
              <ProfileSection
                id="professional-info"
                title="Bio & qualifications"
                description="The two pieces of writing on your public page."
              >
                <div className="space-y-6">
                  <Field
                    id="bio"
                    label="Professional bio"
                    error={errors.bio}
                    hint="A sentence or two on what you do and who you work with. Shown under your name."
                    action={<CharCount value={bio} max={MAX_BIO} />}
                  >
                    <Textarea
                      id="bio"
                      placeholder="Tell clients what you do and who you work with."
                      value={bio}
                      onChange={(event) => setBio(event.target.value.slice(0, MAX_BIO))}
                      rows={4}
                    />
                  </Field>

                  <Field
                    id="qualifications"
                    label="Qualifications & experience"
                    error={errors.qualifications}
                    // Line breaks survive to the public page, so the field should
                    // say so — otherwise providers write one dense line.
                    hint="Line breaks are kept, so a list stays a list."
                    action={<CharCount value={qualifications} max={MAX_QUALIFICATIONS} />}
                  >
                    <Textarea
                      id="qualifications"
                      placeholder={
                        "One per line, e.g.\n\nBPT, MPT (Sports Physiotherapy)\n12 years in practice\nCertified in dry needling"
                      }
                      value={qualifications}
                      onChange={(event) =>
                        setQualifications(event.target.value.slice(0, MAX_QUALIFICATIONS))
                      }
                      rows={5}
                    />
                  </Field>
                </div>
              </ProfileSection>

              {/* Public page */}
              <ProfileSection
                id="preview"
                title="Public page"
                description="This is what a client sees before they book."
              >
                <div className="rounded-lg border border-line bg-subtle p-5">
                  <div className="flex items-start gap-4">
                    <Avatar
                      src={profilePicturePreview || user.avatar_url}
                      name={user.name}
                      size="lg"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-display text-base font-semibold text-ink">
                        {businessName || user.name}
                      </p>
                      <p className="truncate text-xs text-ink-3">
                        {businessName ? user.name : businessType || "Provider"}
                      </p>
                      {bio ? (
                        <p className="mt-2 line-clamp-3 text-[0.8125rem] leading-relaxed text-ink-2">
                          {bio}
                        </p>
                      ) : (
                        <p className="mt-2 text-[0.8125rem] italic text-ink-3">
                          No bio yet — clients see this space empty.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <a
                  href={`/providers/${user.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-4 ${secondaryButton} ${buttonSm}`}
                >
                  <Icon name="external" size={14} />
                  Open the live page
                </a>
              </ProfileSection>
            </>
          )}

          {formError && <Alert tone="error">{formError}</Alert>}
          {successMessage && (
            <Alert
              tone="success"
              action={
                <button
                  type="button"
                  onClick={() => navigate("/dashboard")}
                  className={`${secondaryButton} ${buttonSm}`}
                >
                  Go to dashboard
                </button>
              }
            >
              {successMessage}
            </Alert>
          )}

          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-3 border-t border-line bg-canvas/90 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-5">
            <button type="button" onClick={() => navigate("/dashboard")} className={secondaryButton}>
              Cancel
            </button>
            <button type="submit" disabled={loading} className={primaryButton}>
              {loading ? "Saving…" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </Page>
  );
}

/** A heading outside the card, the fields inside it. Matches Settings. */
function ProfileSection({ id, title, description, children }) {
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

/**
 * A value that came from the identity provider and cannot be edited here.
 *
 * Rendered to look like a disabled input rather than as plain text, because in a
 * column of fields a bare paragraph reads as something that failed to render.
 */
function ReadOnlyField({ label, value }) {
  return (
    <div>
      <p className="mb-2 block text-[0.8125rem] font-medium text-ink">{label}</p>
      <p className="flex min-h-11 items-center truncate rounded-md border border-line bg-subtle px-3 text-sm text-ink-2 sm:min-h-10">
        {value || "—"}
      </p>
    </div>
  );
}

/** Which section the reader is currently in, for the anchor list's active state. */
function useActiveSection(sections) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const elements = sections.map((section) => document.getElementById(section.id)).filter(Boolean);
    if (elements.length === 0) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 }
    );

    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [sections]);

  return active;
}
