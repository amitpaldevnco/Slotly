//The one-time setup step after a first sign-in.

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import TimezoneSelect from "react-timezone-select";
import { useAuth } from "../context/AuthContext";
import { parseApiError } from "../api/client";
import * as authApi from "../api/auth";
import {
  buildTimezonesWithCountry,
  normalizeTimezone,
  timezoneSelectClassNames,
  timezoneSelectMenuProps,
} from "../lib/timezones";
import Page from "../components/ui/Page";
import Field, { Input, Select, CardRadioGroup } from "../components/ui/Field";
import { Alert } from "../components/ui/Feedback";
import Icon from "../components/ui/Icon";
import { primaryButton, buttonBlock, buttonLg, cardClasses, eyebrow } from "../lib/ui";

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

export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const { refetchUser } = useAuth();

  const timezonesWithCountry = useMemo(() => buildTimezonesWithCountry(), []);

  const [role, setRole] = useState("client");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [timezone, setTimezone] = useState(
    normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  );
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("");

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setFormError("");
    setErrors({});

    try {
      await authApi.completeProfile({
        role,
        phoneNumber,
        timezone: normalizeTimezone(typeof timezone === "string" ? timezone : timezone.value),
        ...(role === "provider" ? { businessName, businessType } : {}),
      });

      await refetchUser();
      navigate("/dashboard");
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

  const isProvider = role === "provider";

  return (
    <Page narrow>
      <div className="animate-fade-in motion-reduce:animate-none">
        <p className={eyebrow}>One last step</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-[-0.02em] text-ink">
          Complete your profile
        </h1>
        <p className="mt-2 text-base text-ink-2">
          A few details, and Slotly is set up the way you will use it.
        </p>

        <form onSubmit={handleSubmit} noValidate className={`${cardClasses} mt-8 p-6 sm:p-8`}>
          {formError && <Alert tone="error" className="mb-6">{formError}</Alert>}

          <div className="space-y-6">
            <CardRadioGroup
              name="role"
              legend="How will you use Slotly?"
              value={role}
              onChange={setRole}
              options={[
                {
                  value: "client",
                  title: "I book appointments",
                  hint: "Find providers and reserve a time",
                  icon: "user",
                },
                {
                  value: "provider",
                  title: "I take appointments",
                  hint: "Publish services and manage a schedule",
                  icon: "briefcase",
                },
              ]}
            />
            {errors.role && (
              <p className="flex items-start gap-1 text-xs text-danger">
                <Icon name="alert" size={13} className="mt-px" />
                <span>{errors.role}</span>
              </p>
            )}

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
              label="Your timezone"
              error={errors.timezone}
              hint="Every appointment time you see will be shown in this zone. You can change it later."
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

            {isProvider && (
              <fieldset className="space-y-6 border-t border-line pt-6">
                <legend className={`${eyebrow} mb-2`}>About your business</legend>

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
              </fieldset>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className={`mt-8 ${primaryButton} ${buttonBlock} ${buttonLg}`}
          >
            {loading ? "Saving…" : "Continue to Slotly"}
          </button>
        </form>
      </div>
    </Page>
  );
}
