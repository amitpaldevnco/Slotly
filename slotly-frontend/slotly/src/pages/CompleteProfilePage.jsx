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
import Field, { Input, Select, Textarea, CardRadioGroup } from "../components/ui/Field";
import { CURRENCIES, currencyLabel, currencyForTimezone } from "../lib/currencies";
import { buildCountryOptions, countryFromTimezone } from "../lib/countries";
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

  // Country follows the same pattern as currency, and for the same reason: it is
  // inferred from the timezone the browser reported, re-inferred while the
  // person is still changing the timezone, and left alone the moment they answer
  // for themselves.
  //
  // It is asked of **both** roles. A client's country is not decoration — a
  // service marked Domestic is bookable only when the two countries match, so a
  // client without one cannot be told whether they are eligible.
  const [country, setCountry] = useState(() =>
    countryFromTimezone(normalizeTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone))
  );
  const [countryTouched, setCountryTouched] = useState(false);
  const [businessAddress, setBusinessAddress] = useState("");
  const countryOptions = useMemo(() => buildCountryOptions(), []);

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
        // "" rather than omitted when nothing could be inferred — UTC belongs to
        // no country, and the server reads an empty value as "not stated" and
        // leaves the column null, which the domestic rule treats as unknown and
        // allows through. Sending nothing would make the server re-infer from the
        // timezone and quietly disagree with the blank control on screen.
        country: country || "",
        ...(role === "provider"
          ? {
              businessName: businessName.trim(),
              businessType,
              currency,
              businessAddress: businessAddress.trim(),
            }
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
                  const zone = typeof next === "string" ? next : next?.value;
                  if (!currencyTouched) {
                    setCurrency(currencyForTimezone(normalizeTimezone(zone)));
                  }
                  if (!countryTouched) {
                    setCountry(countryFromTimezone(normalizeTimezone(zone)));
                  }
                }}
                labelStyle="original"
                timezones={timezonesWithCountry}
                unstyled
                classNames={timezoneSelectClassNames}
                {...timezoneSelectMenuProps}
              />
            </Field>

            {/* Directly under the timezone, because it is answering the same
                question from the other side and is pre-filled from it. Asked of
                clients as well as providers: a Domestic service compares the
                two countries, so a client without one cannot be told whether
                they may book. */}
            <Field
              id="country"
              label="Your country"
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
                value={country ?? ""}
                onChange={(e) => {
                  setCountryTouched(true);
                  setCountry(e.target.value);
                }}
              >
                <option value="">Prefer not to say</option>
                {countryOptions.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.name}
                  </option>
                ))}
              </Select>
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

                {/* Optional here, on purpose.
                    A provider who will only ever offer online sessions has no
                    premises, and this screen — reached before they have created a
                    single service — is the wrong place to discover that. Slotly
                    asks for it at the point it becomes load-bearing: publishing an
                    In-Person service, where the service form says so and links
                    back to the profile. */}
                <Field
                  id="businessAddress"
                  label="Business address"
                  optional
                  error={errors.businessAddress}
                  hint="Where in-person appointments happen. Leave it blank if you only work online — you can add it later."
                >
                  <Textarea
                    id="businessAddress"
                    rows={3}
                    placeholder={"e.g. Unit 4, 118 Great Portland Street\nLondon W1W 6PP"}
                    value={businessAddress}
                    onChange={(e) => setBusinessAddress(e.target.value)}
                  />
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
