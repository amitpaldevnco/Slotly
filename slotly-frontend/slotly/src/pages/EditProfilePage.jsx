// Profile and settings.
import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import TimezoneSelect from "react-timezone-select";
import { useAuth } from "../context/AuthContext";
import { imageUrl, parseApiError } from "../api/client";
import * as authApi from "../api/auth";
import Page, { PageHeader, Section, SplitLayout } from "../components/ui/Page";
import Avatar from "../components/ui/Avatar";
import Icon from "../components/ui/Icon";
import Field, { Input, Textarea, Select, CharCount } from "../components/ui/Field";
import { Alert, PageLoader } from "../components/ui/Feedback";
import {
  primaryButton,
  secondaryButton,
  buttonSm,
  fileInputClasses,
  hintClasses,
  linkClasses,
  zoneName,
} from "../lib/ui";
import {
  buildTimezonesWithCountry,
  normalizeTimezone,
  timezoneSelectClassNames,
  timezoneSelectMenuProps,
} from "../lib/timezones";

const BUSINESS_TYPES = [
  "Healthcare",
  "Salon & Beauty",
  "Fitness",
  "Education",
  "Legal",
  "Consulting",
  "Automotive",
  "Home Services",
  "Repair Services",
  "Photography",
  "Pet Care",
  "Travel",
  "Finance",
  "Other",
];

const MAX_BIO = 500;
const MAX_QUALIFICATIONS = 500;

export default function EditProfilePage() {
  const navigate = useNavigate();
  const { user, setUser } = useAuth();

  const timezonesWithCountry = useMemo(() => buildTimezonesWithCountry(), []);

  const [phoneNumber, setPhoneNumber] = useState("");
  const [timezone, setTimezone] = useState("");
  const [bio, setBio] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");
  const [profilePicture, setProfilePicture] = useState(null);
  const [profilePicturePreview, setProfilePicturePreview] = useState("");

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  // Load user data on mount
  useEffect(() => {
    if (user) {
      setPhoneNumber(user.phone_number || "");
      setTimezone(
        normalizeTimezone(user.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
      );
      setBio(user.bio || "");
      setQualifications(user.qualifications || "");
      setBusinessName(user.business_name || "");
      setBusinessType(user.business_type || "");
      if (user.avatar_url) setProfilePicturePreview(imageUrl(user.avatar_url));
    } else {
      navigate("/login");
    }
  }, [user, navigate]);

  const handleFileChange = (e) => {
    const file = e.target.files[0];
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setFormError("");
    setSuccessMessage("");
    setErrors({});

    try {
      const formData = new FormData();

      if (phoneNumber) formData.append("phoneNumber", phoneNumber);
      if (timezone) {
        formData.append(
          "timezone",
          normalizeTimezone(typeof timezone === "string" ? timezone : timezone.value)
        );
      }
      if (user.role === "provider" && bio !== undefined) {
        formData.append("bio", bio);
      }
      if (user.role === "provider") {
        formData.append("qualifications", qualifications);
      }
      if (user.role === "provider") {
        if (businessName) formData.append("businessName", businessName);
        if (businessType) formData.append("businessType", businessType);
      }
      if (profilePicture) {
        formData.append("profilePicture", profilePicture);
      }

      const updated = await authApi.updateProfile(formData);

      setSuccessMessage("Profile updated.");
      setUser(updated);
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

  const isProvider = user.role === "provider";

  return (
    <Page>
      <PageHeader
        title="Profile & settings"
        description="Your account details, and — for providers — what clients see on your public page."
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

      <form onSubmit={handleSubmit} noValidate>
        <SplitLayout
          aside={
            <>
              <Section title="Photo">
                <div className="flex items-center gap-3">
                  <Avatar
                    src={profilePicturePreview || user.avatar_url}
                    name={user.name}
                    size="xl"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{user.name}</p>
                    <p className="truncate text-xs text-ink-3">{user.email}</p>
                  </div>
                </div>

                <input
                  type="file"
                  aria-label="Profile picture"
                  accept="image/jpeg,image/png"
                  onChange={handleFileChange}
                  className={`${fileInputClasses} mt-3`}
                />
                <p className={hintClasses}>JPG or PNG, max 5MB.</p>
                {errors.profilePicture && (
                  <p className="mt-1.5 flex items-start gap-1 text-xs text-danger">
                    <Icon name="alert" size={13} className="mt-px" />
                    <span>{errors.profilePicture}</span>
                  </p>
                )}
              </Section>

              <Section title="Account" flush>
                <dl className="divide-y divide-line-soft text-sm">
                  <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <dt className="text-xs text-ink-3">Role</dt>
                    <dd className="text-[0.8125rem] capitalize text-ink">{user.role}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <dt className="text-xs text-ink-3">Email</dt>
                    <dd className="min-w-0 truncate text-[0.8125rem] text-ink">{user.email}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3 px-3 py-2">
                    <dt className="text-xs text-ink-3">Timezone</dt>
                    <dd className="text-right text-[0.8125rem] text-ink">{zoneName(user.timezone)}</dd>
                  </div>
                </dl>
                {/* Your role is fixed after setup, and someone will look for a way
                    to change it. Saying so is kinder than leaving them hunting. */}
                <p className="border-t border-line-soft px-3 py-2 text-xs leading-relaxed text-ink-3">
                  Your role cannot be changed after setup — it decides which half of
                  Slotly your account uses.
                </p>
              </Section>
            </>
          }
        >
          <Section title="Your details" description="Only you and the people you book with see these.">
            <div className="space-y-4">
              <Field id="phoneNumber" label="Phone number" error={errors.phoneNumber}>
                <Input
                  id="phoneNumber"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+91 98765 43210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                />
              </Field>

              <Field
                id="timezone"
                label="Timezone"
                error={errors.timezone}
                hint={
                  <>
                    Every appointment time in Slotly is shown in this zone. Change it while
                    travelling and your appointments follow — they do not move, the clock does.{" "}
                    <span className="text-ink-2">
                      See how it reads on{" "}
                      <a href="/dashboard" className={linkClasses}>
                        your dashboard
                      </a>
                      .
                    </span>
                  </>
                }
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
            </div>
          </Section>

          {isProvider && (
            <Section
              title="Your public page"
              description="Shown to anyone browsing the provider directory."
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field id="businessName" label="Business name" error={errors.businessName}>
                    <Input
                      id="businessName"
                      type="text"
                      placeholder="e.g. Sharma Skin Clinic"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                    />
                  </Field>

                  <Field id="businessType" label="Category" error={errors.businessType}>
                    <Select
                      id="businessType"
                      value={businessType}
                      onChange={(e) => setBusinessType(e.target.value)}
                      className={businessType === "" ? "text-ink-3" : ""}
                    >
                      <option value="" disabled>
                        Select a category
                      </option>
                      {BUSINESS_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Field
                  id="bio"
                  label="Bio"
                  error={errors.bio}
                  hint="A sentence or two on what you do. Shown under your name."
                  action={<CharCount value={bio} max={MAX_BIO} />}
                >
                  <Textarea
                    id="bio"
                    placeholder="Tell clients what you do and who you work with."
                    value={bio}
                    onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO))}
                    rows={3}
                  />
                </Field>

                <Field
                  id="qualifications"
                  label="Qualifications & experience"
                  error={errors.qualifications}
                  // Line breaks survive to the public page, so the field should say
                  // so — otherwise providers write one dense line.
                  hint="Shown on your public page. Line breaks are kept, so a list stays a list."
                  action={<CharCount value={qualifications} max={MAX_QUALIFICATIONS} />}
                >
                  <Textarea
                    id="qualifications"
                    placeholder={
                      "One per line, e.g.\n\nBPT, MPT (Sports Physiotherapy)\n12 years in practice\nCertified in dry needling"
                    }
                    value={qualifications}
                    onChange={(e) => setQualifications(e.target.value.slice(0, MAX_QUALIFICATIONS))}
                    rows={4}
                  />
                </Field>
              </div>
            </Section>
          )}

          {formError && <Alert tone="error">{formError}</Alert>}
          {successMessage && (
            <Alert tone="success" action={
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className={`${secondaryButton} ${buttonSm}`}
              >
                Go to dashboard
              </button>
            }>
              {successMessage}
            </Alert>
          )}
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-4">
            <button
              type="button"
              onClick={() => navigate("/dashboard")}
              className={secondaryButton}
            >
              Cancel
            </button>
            <button type="submit" disabled={loading} className={primaryButton}>
              {loading ? "Saving…" : "Save changes"}
            </button>
          </div>
        </SplitLayout>
      </form>
    </Page>
  );
}
