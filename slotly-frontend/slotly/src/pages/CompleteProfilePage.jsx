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
import { CURRENCIES, currencyLabel, currencyForTimezone } from "../lib/currencies";
import { CATEGORIES } from "../lib/categories";
import { checkBusinessName, checkPhone, collectErrors } from "../lib/validation";
import usePageTitle from "../hooks/usePageTitle";
import { Alert } from "../components/ui/Feedback";
import Icon from "../components/ui/Icon";
import { primaryButton, buttonBlock, buttonLg, cardClasses, eyebrow } from "../lib/ui";

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

  // Seeded from the detected timezone and re-seeded whenever the provider picks a
  // different one — but only until they choose a currency themselves, after which
  // the guess must stop overwriting their answer. Hence the "touched" flag rather
  // than a plain effect on `timezone`.
  const [currency, setCurrency] = useState(() =>
    currencyForTimezone(normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone))
  );
  const [currencyTouched, setCurrencyTouched] = useState(false);

  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Checked locally first. The phone field had no format rule on either side
    // of this screen, which is how `abcdef` came to be stored as a number whose
    // only purpose is being reachable when an appointment has to move.
    const problems = collectErrors({
      phoneNumber: checkPhone(phoneNumber),
      ...(role === "provider" ? { businessName: checkBusinessName(businessName) } : {}),
    });
    if (Object.keys(problems).length > 0) {
      setErrors(problems);
      setFormError("");
      return;
    }

    setLoading(true);
    setFormError("");
    setErrors({});

    try {
      await authApi.completeProfile({
        role,
        phoneNumber: phoneNumber.trim(),
        timezone: normalizeTimezone(typeof timezone === "string" ? timezone : timezone.value),
        ...(role === "provider"
          ? { businessName: businessName.trim(), businessType, currency }
          : {}),
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

  usePageTitle("Complete your profile");

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
                onChange={(next) => {
                  setTimezone(next);
                  // Moving the timezone usually means moving the currency too, so
                  // the guess follows along — until the provider has answered for
                  // themselves, at which point their choice stands.
                  if (!currencyTouched) {
                    const zone = typeof next === "string" ? next : next?.value;
                    setCurrency(currencyForTimezone(normalizeTimezone(zone)));
                  }
                }}
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
                    {CATEGORIES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field
                  id="currency"
                  label="Currency you charge in"
                  error={errors.currency}
                  hint="Every price you set is shown in this currency, to you and to your clients."
                >
                  <Select
                    id="currency"
                    value={currency}
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      setCurrencyTouched(true);
                    }}
                  >
                    {CURRENCIES.map((entry) => (
                      <option key={entry.code} value={entry.code}>
                        {currencyLabel(entry)}
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
